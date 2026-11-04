import { handle, json } from "@/lib/api";
import { scanAllLinked } from "@/lib/linked";

/** Body: { force?: boolean } — rescan linked folders (at most once a minute unless forced). */
export const POST = handle(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  return json(scanAllLinked(!!body?.force));
});
