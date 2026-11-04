import { handle, json, type IdContext } from "@/lib/api";
import { createAnnotation, listAnnotations } from "@/lib/notes";

export const GET = handle(async (_req: Request, ctx: IdContext) => json(listAnnotations((await ctx.params).id)));
export const POST = handle(async (req: Request, ctx: IdContext) =>
  json(createAnnotation((await ctx.params).id, await req.json()), 201),
);
