import { handle, json } from "@/lib/api";
import { restoreBackup } from "@/lib/export";
import { HttpError } from "@/lib/library";

/** Upload a backup zip (multipart field "file") to replace all data. */
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "沒有收到備份檔");
  if (form.get("confirm") !== "replace-all") throw new HttpError(400, "還原需要確認");
  return json(restoreBackup(new Uint8Array(await file.arrayBuffer())));
});
