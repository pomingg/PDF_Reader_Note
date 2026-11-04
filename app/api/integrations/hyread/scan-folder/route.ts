import { handle, json } from "@/lib/api";
import { HttpError } from "@/lib/library";
import { scanFolder } from "@/lib/integrations/hyread";

/** Body: { path } — list a local folder's files (read-only) to find where the desktop app keeps notes. */
export const POST = handle(async (req: Request) => {
  const { path } = await req.json();
  if (typeof path !== "string" || !path.trim()) throw new HttpError(400, "請輸入資料夾路徑");
  return json(scanFolder(path.trim()));
});
