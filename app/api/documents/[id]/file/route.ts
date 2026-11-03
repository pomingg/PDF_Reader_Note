import { readFileSync } from "node:fs";
import { handle, json, type IdContext } from "@/lib/api";
import { documentFilePath, HttpError, replaceDocumentFile } from "@/lib/library";

export const GET = handle(async (_req: Request, ctx: IdContext) => {
  let data: Buffer;
  try {
    data = readFileSync(documentFilePath((await ctx.params).id));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(404, "PDF 檔案不存在");
  }
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=3600" },
  });
});

/** Replace the PDF with a newer version (multipart field "file"); notes are kept. */
export const PUT = handle(async (req: Request, ctx: IdContext) => {
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new HttpError(400, "沒有收到檔案");
  return json(replaceDocumentFile((await ctx.params).id, Buffer.from(await file.arrayBuffer())));
});
