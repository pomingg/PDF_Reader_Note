import { handle, json, type IdContext } from "@/lib/api";
import { deleteProject, getProject, updateProject } from "@/lib/library";

export const GET = handle(async (_req: Request, ctx: IdContext) => json(getProject((await ctx.params).id)));
export const PATCH = handle(async (req: Request, ctx: IdContext) =>
  json(updateProject((await ctx.params).id, await req.json())),
);
export const DELETE = handle(async (_req: Request, ctx: IdContext) => {
  deleteProject((await ctx.params).id);
  return json({ ok: true });
});
