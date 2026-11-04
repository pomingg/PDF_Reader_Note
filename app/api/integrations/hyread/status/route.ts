import { handle, json } from "@/lib/api";
import { syncStatus } from "@/lib/integrations/hyread";

export const GET = handle(() => json(syncStatus()));
