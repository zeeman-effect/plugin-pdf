/* eslint-disable no-useless-escape */
import { BaseContextItem } from "@maiar-ai/core";

interface PDFData extends BaseContextItem {
  text?: string;
}

export function generatePDFResponseTemplate(
  userQuestion: string,
  contextChain: BaseContextItem[]
): string {
  // Only add the pdfData.text to the context if it exists
  const pdfData: PDFData | undefined = contextChain.find((item) => item.action === "add_pdf_to_context");
  if (!pdfData) {
    throw new Error("No PDF data found in context chain");
  }

  return `Generate a response to the user's question based on the text of a pdf file and the context chain. Your response should be a JSON object with a single "message" field containing your response.
    The response should be related to the original message you received from the user. The response should be concise and to the point.

    IMPORTANT: Your response MUST be valid JSON:
    - Use double quotes (") not single quotes (')
    - Escape any quotes within strings with backslash (\")
    - Do not use smart/curly quotes
    - The response must be parseable by JSON.parse()

    Do NOT include any metadata, context information, or explanation of how the response was generated.
    Look for the relevant information in the most recent context items (e.g. generated text, current time, etc).

    Here is the user's question
    ==========================
    ${userQuestion}

    Below is the full text of the PDF file
    ====================================
    ${pdfData.text}

    Here is the context chain
    ========================
    ${contextChain.map((item) => item.content).join("\n")}

    Your job is to synthesize the context chain into a comprehensive and useful response to the user's intitial message.

    Return a JSON object with a single "message" field containing your response.
    `;
}
