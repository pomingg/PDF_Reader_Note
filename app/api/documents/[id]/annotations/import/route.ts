import { handle, json, type IdContext } from "@/lib/api";
import { HttpError } from "@/lib/library";
import { importAnnotations } from "@/lib/notes";

/** Body: { items: ImportedAnnotation[], fileVersion?: number } */
export const POST = handle(async (req: Request, ctx: IdContext) => {
  const body = await req.json();
  if (!Array.isArray(body?.items)) throw new HttpError(400, "缺少要匯入的註解");
  const version = Number.isInteger(body.fileVersion) ? body.fileVersion : undefined;
  return json(importAnnotations((await ctx.params).id, body.items, version));
});
