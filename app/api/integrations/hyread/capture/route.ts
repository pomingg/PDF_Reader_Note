import { HttpError } from "@/lib/library";
import { checkToken, corsHeaders, receiveCapture } from "@/lib/integrations/hyread";

const MAX_BYTES = 3 * 1024 * 1024;

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** The browser extension posts highlight / note data it saw on HyRead pages here. */
export async function POST(req: Request) {
  const headers = corsHeaders(req);
  try {
    checkToken(req);
    const text = await req.text();
    if (text.length > MAX_BYTES) throw new HttpError(413, "資料太大");
    let body: { url?: string; kind?: string; pageTitle?: string; payload?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, "資料格式錯誤");
    }
    if (body.payload === undefined) throw new HttpError(400, "缺少資料");
    const r = receiveCapture({ url: String(body.url ?? ""), kind: body.kind, pageTitle: body.pageTitle, payload: body.payload });
    const created = r.results.reduce((s, x) => s + x.created, 0);
    const updated = r.results.reduce((s, x) => s + x.updated, 0);
    return Response.json({ ok: true, status: r.status, created, updated }, { headers });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "伺服器錯誤";
    if (!(err instanceof HttpError)) console.error(err);
    return Response.json({ error: message }, { status, headers });
  }
}
