import { writeFileSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { handle, json } from "@/lib/api";
import { PDF_DIR } from "@/lib/db";
import { createDocument, HttpError, listDocuments } from "@/lib/library";
import type { DocumentQuery } from "@/lib/types";

export const GET = handle((req: Request) => {
  const sp = new URL(req.url).searchParams;
  const query: DocumentQuery = {
    view: (sp.get("view") as DocumentQuery["view"]) ?? undefined,
    projectId: sp.get("projectId") ?? undefined,
    folderId: sp.get("folderId") ?? undefined,
    recursive: sp.get("recursive") === "1",
    q: sp.get("q") ?? undefined,
  };
  return json(listDocuments(query));
});

/** Upload one or more PDFs (multipart field "files"), optionally into projectId / folderId. */
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError(400, "沒有收到檔案");
  const projectId = (form.get("projectId") as string) || null;
  const folderId = (form.get("folderId") as string) || null;

  const created = [];
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-")
      throw new HttpError(400, `「${file.name}」不是 PDF 檔`);
    const id = nanoid(12);
    const filename = `${id}.pdf`;
    writeFileSync(path.join(PDF_DIR, filename), bytes);
    const title = file.name.replace(/\.pdf$/i, "") || "未命名文件";
    created.push(createDocument({ id, title, filename, size: bytes.length, projectId, folderId }));
  }
  return json(created, 201);
});
