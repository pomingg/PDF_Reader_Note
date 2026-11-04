import { handle, json } from "@/lib/api";
import { regenerateSyncToken } from "@/lib/integrations/hyread";

/** Make a new sync token (the old one stops working). */
export const POST = handle(() => json({ token: regenerateSyncToken() }));
