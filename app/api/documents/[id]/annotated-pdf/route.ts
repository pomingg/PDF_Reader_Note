import { handle, type IdContext } from "@/lib/api";
import { downloadResponse } from "@/lib/download";
import { annotatedPdf } from "@/lib/pdfWrite";

/** Download a copy of the PDF with this app's highlights and notes written in as standard PDF annotations. */
export const GET = handle(async (_req: Request, ctx: IdContext) => {
  const { filename, body } = await annotatedPdf((await ctx.params).id);
  return downloadResponse({ filename, contentType: "application/pdf", body });
});
