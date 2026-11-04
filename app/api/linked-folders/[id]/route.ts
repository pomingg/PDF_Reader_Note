import { handle, json, type IdContext } from "@/lib/api";
import { removeLinkedFolder } from "@/lib/linked";

export const DELETE = handle(async (_req: Request, ctx: IdContext) => {
  removeLinkedFolder((await ctx.params).id);
  return json({ ok: true });
});
