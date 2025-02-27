import fs from "fs";
import path from "path";
import * as pdfjsLib from "pdfjs-dist";

import {
  PluginBase,
  AgentContext,
  PluginResult,
  UserInputContext,
  BaseContextItem,
} from "@maiar-ai/core";

// Local imports
import { PDFResponseSchema } from "./types";
import { generatePDFResponseTemplate } from "./templates";

export class PluginPDF extends PluginBase {
  constructor() {
    super({
      id: "plugin-pdf",
      name: "PDF Plugin",
      description:
        "Handle data from a PDF file. Analyze the text and image in the PDF file and add it to the conversation context for further analysis",
    });
    this.addExecutor({
      name: "analyze_pdf",
      description:
        "Use the full text of the PDF and context chain to answer a user question",
      execute: this.analyze_pdf.bind(this),
    });
    this.addExecutor({
      name: "add_pdf_to_context",
      description: "Download a PDF file from a URL, or local file, and add the full text to the context chain",
      execute: this.add_pdf_to_context.bind(this),
    });
  }

  private async analyze_pdf(context: AgentContext): Promise<PluginResult> {
    // Get the user question from the context chain
    const userQuestion = context.contextChain.find(
      (item) => item.type === "user_input"
    ) as UserInputContext;
    if (!userQuestion) {
      return { success: false, error: "No user question found in context." };
    }

    try {
      const result = await this.runtime.operations.getObject(
        PDFResponseSchema,
        generatePDFResponseTemplate(userQuestion.rawMessage, context.contextChain),
        { temperature: 0.2 }
      );
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: `Error generating PDF response. ${error}` };
    }
  }

  /**
   * Parse a PDF file from an ArrayBuffer and return the full text
   * @param buffer - The buffer of the PDF file
   * @returns Promise<{text: string}> The full text of the PDF file
   */
  private async parsePDF(buffer: ArrayBuffer): Promise<{ text: string }> {
    // Load the PDF document using pdfjs-dist
    const data = await pdfjsLib.getDocument(buffer).promise;
    let fullText = "";

    // Extract text from all pages
    for (let i = 1; i <= data.numPages; i++) {
      const page = await data.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(" ");
      fullText += pageText + "\n";
    }

    return {
      text: fullText,
    };
  }

  private async downloadPDF(url: string): Promise<{ text: string }> {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    return await this.parsePDF(buffer);
  }

  private async retrieveLocalPDF(filePath: string): Promise<{ text: string }> {
    const buffer = fs.readFileSync(filePath) as Buffer<ArrayBuffer>;
    return await this.parsePDF(buffer.buffer);
  }

  /**
   * Add the full text of the PDF to the context chain
   * @param context - The context of the agent
   * @returns Promise<PluginResult> The result of the operation
   */
  private async add_pdf_to_context(context: AgentContext): Promise<PluginResult> {
    const userInputContext = context.contextChain.find(
      (item) => item.type === "user_input"
    ) as UserInputContext;
    if (!userInputContext || !userInputContext.rawMessage) {
      return { success: false, error: "No user input found in context." };
    }

    let pdfData: { text: string } | undefined;

    // Check for URL
    const urlMatch = userInputContext.rawMessage.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      try {
        const url = urlMatch[0];
        pdfData = await this.downloadPDF(url);
      } catch (error) {
        return { success: false, error: "Error downloading PDF." };
      }
    }

    // Check for local file path
    const filePathMatch = userInputContext.rawMessage.match(/file:\/\/[^\s]+/);
    if (filePathMatch) {
      try {
        const filePath = filePathMatch[0];
        pdfData = await this.retrieveLocalPDF(filePath);
      } catch (error) {
        return { success: false, error: "Error retrieving local PDF." };
      }
    }

    // If the PDF data is not a URL, assume it is a base64 encoded string
    if (!pdfData) {
      try {
        const buffer = Buffer.from(userInputContext.rawMessage, "base64").buffer;
        pdfData = await this.parsePDF(buffer);
      } catch (error) {
        return { success: false, error: "Error parsing base64 encoded PDF." };
      }
    }

    try {

      const pdfContext: BaseContextItem = {
        id: `pdf-${Date.now()}`,
        pluginId: this.id,
        type: "pdf",
        action: "add_pdf_to_context",
        content: pdfData.text,
        timestamp: Date.now(),
      };
      context.contextChain.push(pdfContext);
      return {success: true};
    } catch (error) {
      return { success: false, error: "Error parsing PDF data." };
    }
  }
}
