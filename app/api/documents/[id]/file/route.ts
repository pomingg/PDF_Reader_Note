import { readFileSync } from "node:fs";
import { handle, type IdContext } from "@/lib/api";
import { documentFilePath, HttpError } from "@/lib/library";

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
