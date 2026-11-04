import { handle, json, type IdContext } from "@/lib/api";
import { deleteDocument, getDocument, updateDocument } from "@/lib/library";
import { documentSnapshots, pruneTags, removeSnapshots } from "@/lib/notes";

export const GET = handle(async (_req: Request, ctx: IdContext) => json(getDocument((await ctx.params).id)));
export const PATCH = handle(async (req: Request, ctx: IdContext) =>
  json(updateDocument((await ctx.params).id, await req.json())),
);
export const DELETE = handle(async (_req: Request, ctx: IdContext) => {
  const { id } = await ctx.params;
  const snapshots = documentSnapshots(id);
  deleteDocument(id); // annotations go with it (ON DELETE CASCADE)
  removeSnapshots(snapshots);
  pruneTags();
  return json({ ok: true });
});
