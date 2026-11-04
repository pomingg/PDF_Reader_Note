import { handle, json, type IdContext } from "@/lib/api";
import { deleteDocument, getDocument, updateDocument } from "@/lib/library";

export const GET = handle(async (_req: Request, ctx: IdContext) => json(getDocument((await ctx.params).id)));
export const PATCH = handle(async (req: Request, ctx: IdContext) =>
  json(updateDocument((await ctx.params).id, await req.json())),
);
export const DELETE = handle(async (_req: Request, ctx: IdContext) => {
  deleteDocument((await ctx.params).id);
  return json({ ok: true });
});
