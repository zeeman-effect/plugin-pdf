import { z } from "zod";

export interface PDFResponse {
    text: string;
}

export const PDFResponseTemplate = z.object({
    message: z.string()
});

export type PDFResponseType = z.infer<typeof PDFResponseTemplate>;
