import { readFileSync } from "node:fs";
import { handle, type IdContext } from "@/lib/api";
import { HttpError } from "@/lib/library";
import { snapshotPath } from "@/lib/notes";

export const GET = handle(async (_req: Request, ctx: IdContext) => {
  const file = snapshotPath((await ctx.params).id);
  let data: Buffer;
  try {
    data = readFileSync(file);
  } catch {
    throw new HttpError(404, "截圖檔案不存在");
  }
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": file.endsWith(".jpg") ? "image/jpeg" : "image/png",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});
