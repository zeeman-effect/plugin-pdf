import fs from "fs";
import path from "path";

import Database from "better-sqlite3";

import { createLogger, MemoryService } from "@maiar-ai/core";

import {
  MemoryProvider,
  Message,
  Context,
  Conversation,
  MemoryQueryOptions
} from "@maiar-ai/core";

const log = createLogger("memory:sqlite");

type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

export interface SQLiteConfig {
  dbPath: string;
}

export interface History {
  id: string;
  conversationId: string;
  type: string;
  content: string;
  timestamp: number;
}

export interface SQLiteMemoryProvider extends MemoryProvider {
  storeHistory(history: History, conversationId: string): Promise<void>;
  getHistory(conversationId: string): Promise<History[]>;
  deleteHistory(conversationId: string): Promise<void>;
}

export interface ExtendedMemoryService extends MemoryService {
  storeHistory(history: History, conversationId: string): Promise<void>;
  getHistory(conversationId: string): Promise<History[]>;
  deleteHistory(conversationId: string): Promise<void>;
}

export function isExtendedMemoryService(service: MemoryService): service is ExtendedMemoryService {
    return 'storeHistory' in service;
}

export class SQLiteProvider implements SQLiteMemoryProvider {
  readonly id = "sqlite";
  readonly name = "SQLite Memory";
  readonly description = "Stores conversations in a SQLite database";

  private db: Database.Database;

  constructor(config: SQLiteConfig) {
    const dbDir = path.dirname(config.dbPath);
    fs.mkdirSync(dbDir, { recursive: true });

    this.db = new Database(path.resolve(config.dbPath));
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initializeStorage();
    this.checkHealth();
  }

  private checkHealth() {
    try {
      this.db.prepare("SELECT 1").get();
      this.db.transaction(() => {})();
      const fkEnabled = this.db.prepare("PRAGMA foreign_keys").get() as {
        foreign_keys: number;
      };
      if (!fkEnabled || !fkEnabled.foreign_keys) {
        throw new Error("Foreign key constraints are not enabled");
      }
      log.info({ msg: "SQLite health check passed" });
    } catch (error) {
      log.error({ msg: "SQLite health check failed", error });
      throw new Error(
        `Failed to initialize SQLite database: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private initializeStorage() {
    this.createTables().then(() => {
      log.info({ msg: "Initialized SQLite memory storage" });
    });
  }

  private async createTables(): Promise<void> {
    await this.db.exec(`
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                user TEXT NOT NULL,
                platform TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                context_id TEXT,
                user_message_id TEXT,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id),
                FOREIGN KEY (context_id) REFERENCES contexts(id),
                FOREIGN KEY (user_message_id) REFERENCES messages(id)
            );

            CREATE TABLE IF NOT EXISTS contexts (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                type TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            );

            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                type TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            );
        `);
  }

  async createConversation(options?: {
    id?: string;
    metadata?: Record<string, JSONValue>;
  }): Promise<string> {
    const stmt = this.db.prepare(
      "INSERT INTO conversations (id, user, platform, created_at) VALUES (?, ?, ?, ?)"
    );
    const id = options?.id || Math.random().toString(36).substring(2);
    const [user, platform] = id.split("-");
    const timestamp = Date.now();

    log.info({ msg: "Creating new conversation", id });
    try {
      stmt.run(id, user, platform, timestamp);
      log.info({ msg: "Created conversation successfully", id });
      return id;
    } catch (error) {
      log.error({ msg: "Failed to create conversation", id, error });
      throw error;
    }
  }

  async storeHistory(history: History, conversationId: string): Promise<void> {
    console.log('[SQLite] Storing history', history);
    const stmt = this.db.prepare(`
            INSERT INTO history (id, conversation_id, type, content, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `);
    stmt.run(
      history.id,
      conversationId,
      history.type,
      history.content,
      history.timestamp
    );
  } 

  async storeMessage(message: Message, conversationId: string): Promise<void> {
    const stmt = this.db.prepare(`
            INSERT INTO messages (id, conversation_id, role, content, timestamp, context_id, user_message_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
    stmt.run(
      message.id,
      conversationId,
      message.role,
      message.content,
      message.timestamp,
      message.contextId,
      message.user_message_id
    );
  }

  async storeContext(context: Context, conversationId: string): Promise<void> {
    const stmt = this.db.prepare(`
            INSERT INTO contexts (id, conversation_id, type, content, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `);
    stmt.run(
      context.id,
      conversationId,
      context.type,
      context.content,
      context.timestamp
    );
  }

  async getHistory(conversationId: string): Promise<History[]> {
    const stmt = this.db.prepare(
      "SELECT * FROM history WHERE conversation_id = ?"
    );
    return stmt.all(conversationId) as History[];
  }

  async getMessages(options: MemoryQueryOptions): Promise<Message[]> {
    if (!options.conversationId) {
      throw new Error("Conversation ID is required for SQLite memory provider");
    }

    let query = "SELECT * FROM messages WHERE conversation_id = ?";
    const params: (string | number)[] = [options.conversationId];

    if (options.after) {
      query += " AND timestamp > ?";
      params.push(options.after);
    }

    if (options.before) {
      query += " AND timestamp < ?";
      params.push(options.before);
    }

    query += " ORDER BY timestamp DESC";

    if (options.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Message[];
  }

  async getContexts(conversationId: string): Promise<Context[]> {
    const stmt = this.db.prepare(
      "SELECT * FROM contexts WHERE conversation_id = ?"
    );
    return stmt.all(conversationId) as Context[];
  }

  async getConversation(conversationId: string): Promise<Conversation> {
    log.info({ msg: "Fetching conversation", conversationId });
    const conversationStmt = this.db.prepare(
      "SELECT * FROM conversations WHERE id = ?"
    );
    const conversation = conversationStmt.get(conversationId) as {
      id: string;
      metadata: string | null;
    };

    if (!conversation) {
      log.error({ msg: "Conversation not found", conversationId });
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const messages = await this.getMessages({ conversationId });
    const contexts = await this.getContexts(conversationId);
    log.info({
      msg: "Retrieved conversation",
      conversationId,
      messageCount: messages.length,
      contextCount: contexts.length
    });

    return {
      id: conversationId,
      messages,
      contexts,
      metadata: conversation.metadata
        ? JSON.parse(conversation.metadata)
        : undefined
    };
  }

  async deleteHistory(conversationId: string): Promise<void> {
    const deleteHistory = this.db.prepare(
      "DELETE FROM history WHERE conversation_id = ?"
    );
    deleteHistory.run(conversationId);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const deleteMessages = this.db.prepare(
      "DELETE FROM messages WHERE conversation_id = ?"
    );
    const deleteContexts = this.db.prepare(
      "DELETE FROM contexts WHERE conversation_id = ?"
    );
    const deleteConversation = this.db.prepare(
      "DELETE FROM conversations WHERE id = ?"
    );

    const transaction = this.db.transaction(() => {
      deleteMessages.run(conversationId);
      deleteContexts.run(conversationId);
      deleteConversation.run(conversationId);
    });

    try {
      transaction();
    } catch (error) {
      log.error({
        msg: "Failed to delete conversation",
        conversationId,
        error
      });
      throw error;
    }
  }
}
