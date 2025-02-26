import fs from "fs";
import path from "path";
import * as pdfjsLib from "pdfjs-dist";

import {
  PluginBase,
  AgentContext,
  PluginResult,
  UserInputContext,
} from "@maiar-ai/core";

// Local imports
import { PDFResponseSchema } from "./types";
import { generateResponseTemplate } from "./templates";

interface PDFPluginContext {
  platform: string;
  responseHandler: (response: unknown) => void;
  metadata?: Record<string, unknown>;
}

export class PluginPDF extends PluginBase {
  private helpfulInstructions: string;

  constructor() {
    super({
      id: "plugin-pdf",
      name: "PDF Plugin",
      description:
        "Handle data from a PDF file. Analyze the text and image in the PDF file and add it to the conversation context for further analysis",
    });
    this.addExecutor({
      name: "handlePDF",
      description:
        "Handle a PDF file from a buffer or URL and add the text to the conversation context for further analysis",
      execute: this.handlePDF.bind(this),
    });
    this.addExecutor({
      name: "analyzePDFFromSegment",
      description:
        "Analyze a segment of the PDF using the full text as context",
      execute: this.analyzePDFFromSegment.bind(this),
    });
    this.helpfulInstructions = fs.readFileSync(
      path.join(process.cwd(), "src", "prompts", "pdf.txt"),
      "utf-8"
    );
  }

  private async receivePDF( 
    context: AgentContext
  ): Promise<PluginResult> {
    const platformContext = context?.platformContext as PDFPluginContext;
    if (!platformContext?.responseHandler) {
      return {
        success: false,
        error: "No response handler found in platform context"
      };
    }

    try {
      const pdfData = await this.runtime.operations.getObject(
        PDFResponseSchema,
        generateResponseTemplate(context.contextChain),
        { temperature: 0.2 }
      );

      await platformContext.responseHandler(pdfData);
      return {
        success: true,
        data: {
          pdfData,
          helpfulInstructions: this.helpfulInstructions,
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to receive PDF: ${errorMessage}`
      };
    }
  }

  private async handleSendMessage(
    context: AgentContext
  ): Promise<PluginResult> {
    const platformContext = context?.platformContext as PDFPluginContext;
    if (!platformContext?.responseHandler) {
      return {
        success: false,
        error: "No response handler found in platform context"
      };
    }

    try {
      // Format the response based on the context chain
      const formattedResponse = await this.runtime.operations.getObject(
        PDFResponseSchema,
        generateResponseTemplate(context.contextChain),
        { temperature: 0.2 }
      );

      await platformContext.responseHandler(formattedResponse.message);
      return {
        success: true,
        data: {
          message: "Hello, world!",
          helpfulInstructions: this.helpfulInstructions,
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to send message: ${errorMessage}`
      };
    }
  }

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

  private async downloadPDF(url: string): Promise<PluginResult> {
    try {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const pdfData = await this.parsePDF(buffer);
      return {
        success: true,
        data: {
          pdfData,
          helpfulInstructions: this.helpfulInstructions,
        },
      };
    } catch (error) {
      return { success: false, error: "Error downloading PDF." };
    }
  }

  private async analyzePDFFromSegment(
    context: AgentContext
  ): Promise<PluginResult> {
    const userInputContext = context.contextChain.find(
      (item) => item.type === "user_input"
    ) as UserInputContext;
    if (!userInputContext) {
      return { success: false, error: "No user input found in context." };
    }

    const pdfData = userInputContext.rawMessage;
    if (!pdfData) {
      return { success: false, error: "No PDF data found in user input." };
    }

    // Extract the text from the user input segment using parsePDF
    const buffer = Buffer.from(pdfData, "base64").buffer;
    const pdfResponse = await this.parsePDF(buffer);

    try {
      const prompt = `
            Analyze the following text using the full text of the PDF as context:
            ${pdfResponse.text}
            `;
      const result = await this.runtime.operations.getText(prompt);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: "Error parsing PDF data." };
    }
  }

  private async handlePDF(context: AgentContext): Promise<PluginResult> {
    const userInputContext = context.contextChain.find(
      (item) => item.type === "user_input"
    ) as UserInputContext;
    if (!userInputContext) {
      return { success: false, error: "No user input found in context." };
    }

    // Extract the URL from the user input, even if it is part of a larger message
    const pdfData = userInputContext.rawMessage;
    if (!pdfData) {
      return { success: false, error: "No PDF data found in user input." };
    }

    const urlMatch = userInputContext.rawMessage.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const url = urlMatch[0];
      const pdfData = await this.downloadPDF(url);
      return pdfData;
    }

    try {
      const buffer = Buffer.from(pdfData, "base64").buffer;
      const pdfResponse = await this.parsePDF(buffer);
      return {
        success: true,
        data: {
          pdfResponse,
          helpfulInstructions: this.helpfulInstructions,
        },
      };
    } catch (error) {
      return { success: false, error: "Error parsing PDF data." };
    }
  }
}
