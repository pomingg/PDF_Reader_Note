import { handle, json, type IdContext } from "@/lib/api";
import { deleteFolder, getFolder, updateFolder } from "@/lib/library";

export const GET = handle(async (_req: Request, ctx: IdContext) => json(getFolder((await ctx.params).id)));
export const PATCH = handle(async (req: Request, ctx: IdContext) =>
  json(updateFolder((await ctx.params).id, await req.json())),
);
export const DELETE = handle(async (_req: Request, ctx: IdContext) => {
  deleteFolder((await ctx.params).id);
  return json({ ok: true });
});
