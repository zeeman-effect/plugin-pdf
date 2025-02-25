import { z } from "zod";

export const PDFResponseSchema = z.object({
    message: z.string().describe("The message to be sent to the user"),
});