import { handle, json, type IdContext } from "@/lib/api";
import { addBookmark, listBookmarks } from "@/lib/bookmarks";

export const GET = handle(async (_req: Request, ctx: IdContext) => json(listBookmarks((await ctx.params).id)));
export const POST = handle(async (req: Request, ctx: IdContext) => json(addBookmark((await ctx.params).id, await req.json()), 201));
