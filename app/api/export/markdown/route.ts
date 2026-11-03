import { handle } from "@/lib/api";
import { downloadResponse } from "@/lib/download";
import { exportMarkdown } from "@/lib/export";
import { HttpError } from "@/lib/library";

/** ?documentId=… | ?projectId=…[&folderId=…] | ?all=1 */
export const GET = handle((req: Request) => {
  const sp = new URL(req.url).searchParams;
  const documentId = sp.get("documentId");
  const projectId = sp.get("projectId");
  if (documentId) return downloadResponse(exportMarkdown({ documentId }));
  if (projectId) return downloadResponse(exportMarkdown({ projectId, folderId: sp.get("folderId") }));
  if (sp.get("all") === "1") return downloadResponse(exportMarkdown({ all: true }));
  throw new HttpError(400, "請指定要匯出的範圍");
});
