import { handle, json } from "@/lib/api";
import { reprocessAll } from "@/lib/integrations/hyread";

export const POST = handle(() => json(reprocessAll()));
