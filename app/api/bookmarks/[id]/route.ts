import { handle, json, type IdContext } from "@/lib/api";
import { deleteBookmark, renameBookmark } from "@/lib/bookmarks";

export const PATCH = handle(async (req: Request, ctx: IdContext) => {
  const { title } = await req.json();
  return json(renameBookmark((await ctx.params).id, title));
});
export const DELETE = handle(async (_req: Request, ctx: IdContext) => {
  deleteBookmark((await ctx.params).id);
  return json({ ok: true });
});
