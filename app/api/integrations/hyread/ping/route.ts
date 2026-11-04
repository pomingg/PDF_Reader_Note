import { HttpError } from "@/lib/library";
import { checkToken, corsHeaders } from "@/lib/integrations/hyread";

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** Lets the extension's settings page test the connection and the token. */
export function GET(req: Request) {
  const headers = corsHeaders(req);
  try {
    checkToken(req);
    return Response.json({ ok: true, app: "pdf-reader-note" }, { headers });
  } catch (err) {
    const e = err instanceof HttpError ? err : new HttpError(500, "伺服器錯誤");
    return Response.json({ error: e.message }, { status: e.status, headers });
  }
}
