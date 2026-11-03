import type { ExportFile } from "./export";

/** A file download response with a UTF-8 safe file name. */
export function downloadResponse(file: ExportFile): Response {
  const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
