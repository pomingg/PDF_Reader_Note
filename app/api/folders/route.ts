import { handle, json } from "@/lib/api";
import { createFolder, listFolders } from "@/lib/library";

export const GET = handle((req: Request) => {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? undefined;
  return json(listFolders(projectId));
});
export const POST = handle(async (req: Request) => json(createFolder(await req.json()), 201));
