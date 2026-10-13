import { Workspace } from "./workspace";
export { Workspace };

interface Env { WORKSPACE: DurableObjectNamespace<Workspace>; ASSETS: Fetcher }

const VID_RE = /^[a-f0-9]{32}$/;
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
};

function visitorId(req: Request): { id: string; fresh: boolean } {
  const m = /(?:^|;\s*)lfe_vid=([^;]+)/.exec(req.headers.get("cookie") ?? "");
  if (m && VID_RE.test(m[1])) return { id: m[1], fresh: false };
  const b = crypto.getRandomValues(new Uint8Array(16));
  return { id: [...b].map((x) => x.toString(16).padStart(2, "0")).join(""), fresh: true };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    const err = (status: number, error: string, message: string) =>
      new Response(JSON.stringify({ error, message }), { status, headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS } });
    if (url.pathname === "/api/health") return new Response(JSON.stringify({ ok: true, synthetic: true }), { headers: { "content-type": "application/json", ...SECURITY_HEADERS } });
    if (req.method === "POST") {
      const ct = req.headers.get("content-type") ?? "";
      if (!ct.toLowerCase().startsWith("application/json")) return err(415, "json_required", "POST bodies must be application/json.");
      const origin = req.headers.get("origin");
      if (origin && origin !== url.origin) return err(403, "cross_origin", "Cross-origin commands are refused.");
      const len = Number(req.headers.get("content-length") ?? "0");
      if (len > 600_000) return err(413, "too_large", "Request body too large.");
    } else if (req.method !== "GET") {
      return err(405, "method_not_allowed", "Only GET and POST are supported.");
    }
    const v = visitorId(req);
    const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(v.id));
    const res = await stub.fetch(req);
    const out = new Response(res.body, res);
    for (const [k, val] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, val);
    if (v.fresh) out.headers.append("set-cookie", `lfe_vid=${v.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
    return out;
  },
} satisfies ExportedHandler<Env>;
