import { handle } from "@/lib/api";
import { diagnostics } from "@/lib/integrations/hyread";

export const GET = handle(
  () => new Response(diagnostics(), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }),
);
