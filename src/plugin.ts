import fs from "fs";
import path from "path";
import pdf from "pdf-parse";

import { PluginBase, AgentContext, PluginResult, UserInputContext } from "@maiar-ai/core";

// Local imports
import { PDFResponse } from "./types";

export class PluginPDF extends PluginBase {
    private helpfulInstructions: string;

    constructor() {
        super({
            id: "plugin-pdf",
            name: "PDF Plugin",
            description: "Handle data from a PDF file. Analyze the text and image in the PDF file and add it to the conversation context for further analysis",
        });
        this.addExecutor({
            name: "handlePDF",
            description: "Handle a PDF file from a buffer or URL and add the text to the conversation context for further analysis",
            execute: this.handlePDF.bind(this)
        });
        this.addExecutor({
            name: "analyzePDFFromPrompt",
            description: "Analyze the text and image in the PDF file and add it to the conversation context for further analysis",
            execute: this.analyzePDFFromPrompt.bind(this)
        });
        this.addExecutor({
            name: "analyzePDFFromSegment",
            description: "Analyze a segment of the PDF using the full text as context",
            execute: this.analyzePDFFromSegment.bind(this)
        });
        this.helpfulInstructions = fs.readFileSync(path.join(process.cwd(), "src", "prompts", "pdf.txt"), "utf-8");
    }

    private async parsePDF(buffer: Buffer): Promise<PDFResponse> {
        const data = await pdf(buffer);
        return {
            text: data.text
        };
    }

    private async downloadPDF(url: string): Promise<PluginResult> {
        try {
            const response = await fetch(url);
            const buffer = await response.arrayBuffer();
            const pdfData = await this.parsePDF(Buffer.from(buffer));
            return { success: true, data: {
                pdfData,
                helpfulInstructions: this.helpfulInstructions,
            }};
        } catch (error) {
            return { success: false, error: 'Error downloading PDF.' };
        }
    }

    private async analyzePDFFromSegment(context: AgentContext): Promise<PluginResult> {
        const userInputContext = context.contextChain.find(item => item.type === 'user_input') as UserInputContext;
        if (!userInputContext) {
            return { success: false, error: 'No user input found in context.' };
        }

        const pdfData = userInputContext.rawMessage;
        if (!pdfData) {
            return { success: false, error: 'No PDF data found in user input.' };
        }
        
        // Extract the text from the user input segment using parsePDF
        const pdfResponse = await this.parsePDF(Buffer.from(pdfData, 'base64'));
        
        try {
            const prompt = `
            Analyze the following text using the full text of the PDF as context:
            ${pdfResponse.text}
            `;
            const result = await this.runtime.operations.getText(prompt);
            return { success: true, data: result};
        } catch (error) {
            return { success: false, error: 'Error parsing PDF data.' };
        }
    }

    private async handlePDF(context: AgentContext): Promise<PluginResult> {
        const userInputContext = context.contextChain.find(item => item.type === 'user_input') as UserInputContext;
        if (!userInputContext) {
            return { success: false, error: 'No user input found in context.' };
        }

        // Extract the URL from the user input, even if it is part of a
        // larger message
        const pdfData = userInputContext.rawMessage;
        if (!pdfData) {
            return { success: false, error: 'No PDF data found in user input.' };
        }

        const urlMatch = userInputContext.rawMessage.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
            const url = urlMatch[0];
            const pdfData = await this.downloadPDF(url);
            return pdfData;
        }

        try {
            const pdfResponse = await this.parsePDF(Buffer.from(pdfData, 'base64'));
            return { success: true, data: {
                pdfResponse,
                helpfulInstructions: this.helpfulInstructions,
            }};
        } catch (error) {
            return { success: false, error: 'Error parsing PDF data.' };
        }
    }

    private async analyzePDFFromPrompt(context: AgentContext): Promise<PluginResult> {
        // Find the last user input in the context chain
        const userInputContext = context.contextChain.find(item => item.type === 'user_input') as UserInputContext;
        if (!userInputContext) {
            return { success: false, error: 'No user input found in context.' };
        }

        const prompt = `
        Using previous conversation context related to the pdf file, answer the following question:
        ${userInputContext.rawMessage}
        `;

        try {
            const result = await this.runtime.operations.getText(prompt);
            return { success: true, data: result };
        } catch (error) {
            return { success: false, error: 'Error analyzing PDF from prompt.' };
        }
    }
}