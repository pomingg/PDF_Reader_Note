import { handle } from "@/lib/api";
import { downloadResponse } from "@/lib/download";
import { exportBackup } from "@/lib/export";

export const GET = handle(() => downloadResponse(exportBackup()));
