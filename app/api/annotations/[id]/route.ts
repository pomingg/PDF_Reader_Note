import { handle, json, type IdContext } from "@/lib/api";
import { deleteAnnotation, getAnnotation, updateAnnotation } from "@/lib/notes";

export const GET = handle(async (_req: Request, ctx: IdContext) => json(getAnnotation((await ctx.params).id)));
export const PATCH = handle(async (req: Request, ctx: IdContext) =>
  json(updateAnnotation((await ctx.params).id, await req.json())),
);
export const DELETE = handle(async (_req: Request, ctx: IdContext) => {
  deleteAnnotation((await ctx.params).id);
  return json({ ok: true });
});
