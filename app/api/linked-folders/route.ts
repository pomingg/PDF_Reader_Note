import { handle, json } from "@/lib/api";
import { addLinkedFolder, listLinkedFolders } from "@/lib/linked";

export const GET = handle(() => json(listLinkedFolders()));
/** Body: { path, projectId, folderId? } — open the PDFs in this computer folder in place. */
export const POST = handle(async (req: Request) => json(addLinkedFolder(await req.json()), 201));
