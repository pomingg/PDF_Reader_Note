import { handle, json } from "@/lib/api";
import { listDir } from "@/lib/linked";

/** ?path=… — sub-folders and PDF count, for the "link a folder" picker. Without path: start places. */
export const GET = handle((req: Request) => json(listDir(new URL(req.url).searchParams.get("path"))));
