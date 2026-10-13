import { describe, expect, it } from "vitest";
import { FIXTURES } from "../src/generated/fixtures";

const BASE = () => process.env.LFE_BASE!;

/** A minimal browser stand-in: one cookie jar per visitor. */
class Visitor {
  cookie = "";
  async req(path: string, init: RequestInit = {}) {
    const res = await fetch(BASE() + path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(this.cookie ? { cookie: this.cookie } : {}) } });
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    const ct = res.headers.get("content-type") ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, headers: res.headers, body };
  }
  state() { return this.req("/api/state"); }
  post(path: string, body: unknown, key?: string) {
    return this.req(path, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body) });
  }
  async importClean(expected = 0, csv = FIXTURES["pipeline-q4"]) {
    const p = await this.post("/api/imports/preview", { csv });
    expect(p.status).toBe(200);
    return this.post("/api/imports/commit", { preview_id: p.body.preview_id, expected_revision: expected }, `commit-${crypto.randomUUID()}`);
  }
}
const key = () => `k-${crypto.randomUUID()}`;

describe("API happy path", () => {
  it("preview saves nothing; commit creates one revision", async () => {
    const v = new Visitor();
    const p = await v.post("/api/imports/preview", { csv: FIXTURES["pipeline-q4"] });
    expect(p.body.committable).toBe(true);
    expect((await v.state()).body.revision).toBe(0);
    const c = await v.post("/api/imports/commit", { preview_id: p.body.preview_id, expected_revision: 0 }, key());
    expect(c.body).toEqual({ revision: 1, imported: 13 });
    const s = (await v.state()).body;
    expect(s.revision).toBe(1);
    expect(s.reconciliation.gross_pipeline.value.minor).toBe("57590000");
    expect(s.views.find((x: { opp_id: string }) => x.opp_id === "SYN-1001").category).toBe("commit");
  });
  it("serves security headers and an HttpOnly visitor cookie", async () => {
    const v = new Visitor();
    const r = await v.state();
    expect(r.headers.get("set-cookie")).toMatch(/lfe_vid=[a-f0-9]{32}; Path=\/; HttpOnly; Secure; SameSite=Lax/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const page = await fetch(BASE() + "/");
    expect(page.headers.get("content-security-policy")).toMatch(/script-src 'self'/);
  });
});

describe("API rejected inputs", () => {
  it("a file with any rejected row has no preview id and cannot be committed", async () => {
    const v = new Visitor();
    const p = await v.post("/api/imports/preview", { csv: FIXTURES["hostile"] });
    expect(p.body.preview_id).toBeNull();
    expect(p.body.counts.rejected).toBe(6);
    const c = await v.post("/api/imports/commit", { preview_id: "00000000-0000-4000-8000-000000000000", expected_revision: 0 }, key());
    expect(c.status).toBe(410);
    expect((await v.state()).body.revision).toBe(0);
  });
  it("refuses non-JSON, cross-origin, missing keys and bad JSON", async () => {
    const v = new Visitor();
    expect((await v.req("/api/narratives", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await v.req("/api/narratives", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.invalid" }, body: "{}" })).status).toBe(403);
    expect((await v.post("/api/narratives", { expected_revision: 0 })).body.error).toBe("idempotency_key_required");
    expect((await v.req("/api/imports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" })).status).toBe(400);
    expect((await v.req("/api/state", { method: "DELETE" })).status).toBe(405);
  });
  it("refuses evidence without a source reference or with a formula", async () => {
    const v = new Visitor(); await v.importClean();
    const a = await v.post("/api/opportunities/SYN-1005/evidence", { expected_revision: 1, field: "economic_buyer", text: "CFO Kim", ref: "" }, key());
    expect(a.status).toBe(422);
    const b = await v.post("/api/opportunities/SYN-1005/evidence", { expected_revision: 1, field: "economic_buyer", text: "=cmd()", ref: "SYN-E1" }, key());
    expect(b.status).toBe(422);
    const c = await v.post("/api/opportunities/SYN-1005/evidence", { expected_revision: 1, field: "amount_minor", text: "1", ref: "SYN-E1" }, key());
    expect(c.status).toBe(400);
    expect((await v.state()).body.revision).toBe(1);
  });
});

describe("revisions, staleness and narratives", () => {
  it("a new revision supersedes older narratives, which cannot be marked board-ready", async () => {
    const v = new Visitor(); await v.importClean();
    const n1 = await v.post("/api/narratives", { expected_revision: 1 }, key());
    const e = await v.post("/api/opportunities/SYN-1002/evidence", { expected_revision: 1, field: "eb_engaged_date", date: "2026-10-08", ref: "SYN-B1002B" }, key());
    expect(e.body.revision).toBe(2);
    const s = (await v.state()).body;
    expect(s.narratives[0].superseded).toBe(true);
    expect(s.views.find((x: { opp_id: string }) => x.opp_id === "SYN-1002").category).toBe("commit");
    const br = await v.post(`/api/narratives/${n1.body.id}/board-ready`, { expected_revision: 2 }, key());
    expect(br.status).toBe(409);
    expect(br.body.error).toBe("narrative_superseded");
    const md = await v.req(`/api/narratives/${n1.body.id}/markdown`);
    expect(md.body).toContain("SUPERSEDED");
    const n2 = await v.post("/api/narratives", { expected_revision: 2 }, key());
    expect((await v.post(`/api/narratives/${n2.body.id}/board-ready`, { expected_revision: 2 }, key())).body.board_ready).toBe(true);
  });
});

describe("concurrent actions", () => {
  it("two tabs committing against the same revision: exactly one wins, the other gets 409", async () => {
    const v = new Visitor(); await v.state();
    const p1 = await v.post("/api/imports/preview", { csv: FIXTURES["pipeline-q4"] });
    const p2 = await v.post("/api/imports/preview", { csv: FIXTURES["pipeline-q4"].replace("120000", "125000") });
    const [a, b] = await Promise.all([
      v.post("/api/imports/commit", { preview_id: p1.body.preview_id, expected_revision: 0 }, key()),
      v.post("/api/imports/commit", { preview_id: p2.body.preview_id, expected_revision: 0 }, key()),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await v.state()).body.revision).toBe(1);
  });
  it("ten parallel evidence edits against one revision produce one new revision", async () => {
    const v = new Visitor(); await v.importClean();
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => v.post("/api/opportunities/SYN-1004/evidence", { expected_revision: 1, field: "decision_process", text: `Step ${i}`, ref: `SYN-P${i}X` }, key())));
    expect(rs.filter((r) => r.status === 200).length).toBe(1);
    expect(rs.filter((r) => r.status === 409).length).toBe(9);
    expect((await v.state()).body.revision).toBe(2);
  });
  it("idempotent replay returns the original result; reusing a key for another body is refused", async () => {
    const v = new Visitor(); await v.importClean();
    const k = key();
    const body = { expected_revision: 1, field: "decision_process", text: "CFO then board", ref: "SYN-P9" };
    const [a, b] = [await v.post("/api/opportunities/SYN-1004/evidence", body, k), await v.post("/api/opportunities/SYN-1004/evidence", body, k)];
    expect(b.body).toEqual(a.body);
    expect(b.headers.get("idempotent-replay")).toBe("true");
    expect((await v.state()).body.revision).toBe(2);
    expect((await v.post("/api/opportunities/SYN-1004/evidence", { ...body, text: "other" }, k)).status).toBe(422);
  });
});

describe("visitor isolation", () => {
  it("one visitor's import is invisible to another, and a forged cookie gets a fresh workspace", async () => {
    const a = new Visitor(), b = new Visitor();
    await a.importClean();
    await b.state();
    expect(a.cookie).not.toBe(b.cookie);
    expect((await b.state()).body.revision).toBe(0);
    const forged = new Visitor(); forged.cookie = "lfe_vid=../../etc";
    const f = await forged.state();
    expect(f.body.revision).toBe(0);
    expect(forged.cookie).toMatch(/^lfe_vid=[a-f0-9]{32}$/);
  });
  it("reset clears only the caller's workspace", async () => {
    const a = new Visitor(), b = new Visitor();
    await a.importClean(); await b.importClean();
    expect((await a.post("/api/reset", { confirm: "RESET", expected_revision: 1 }, key())).body).toEqual({ revision: 2, epoch: 1, cleared: true });
    const sa = (await a.state()).body;
    expect([sa.revision, sa.snapshot, sa.opportunities.length]).toEqual([2, null, 0]);
    expect((await b.state()).body.revision).toBe(1);
  });
});

describe("recovery and bounds", () => {
  it("restoring an older revision creates a new revision with the old contents", async () => {
    const v = new Visitor(); await v.importClean();
    await v.post("/api/opportunities/SYN-1002/evidence", { expected_revision: 1, field: "eb_engaged_date", date: "2026-10-08", ref: "SYN-B2" }, key());
    const r = await v.post("/api/revisions/1/restore", { expected_revision: 2 }, key());
    expect(r.body).toEqual({ revision: 3, restored_from: 1 });
    const s = (await v.state()).body;
    expect(s.views.find((x: { opp_id: string }) => x.opp_id === "SYN-1002").category).toBe("not_classifiable");
  });
  it("a retry after a lost response does not double-apply", async () => {
    const v = new Visitor(); await v.state();
    const p = await v.post("/api/imports/preview", { csv: FIXTURES["pipeline-q4"] });
    const k = key();
    await v.post("/api/imports/commit", { preview_id: p.body.preview_id, expected_revision: 0 }, k);
    const retry = await v.post("/api/imports/commit", { preview_id: p.body.preview_id, expected_revision: 0 }, k);
    expect(retry.body).toEqual({ revision: 1, imported: 13 });
    expect((await v.state()).body.revision).toBe(1);
  });
  it("a failed command leaves state untouched", async () => {
    const v = new Visitor(); await v.importClean();
    const before = JSON.stringify((await v.state()).body.opportunities);
    await v.post("/api/opportunities/NOPE-1/evidence", { expected_revision: 1, field: "metrics", text: "x", ref: "SYN-X1" }, key());
    expect(JSON.stringify((await v.state()).body.opportunities)).toBe(before);
  });
  it("keeps at most 30 revisions and 20 narratives", async () => {
    const v = new Visitor(); await v.importClean();
    for (let i = 0; i < 31; i++) {
      await v.post("/api/opportunities/SYN-1004/evidence", { expected_revision: i + 1, field: "decision_process", text: `Step ${i}`, ref: `SYN-P${i}Y` }, key());
    }
    for (let i = 0; i < 21; i++) await v.post("/api/narratives", { expected_revision: 32 }, key());
    const s = (await v.state()).body;
    expect(s.revision).toBe(32);
    expect(s.revisions.length).toBe(30);
    expect(s.narratives.length).toBe(20);
    expect((await v.post("/api/revisions/1/restore", { expected_revision: 32 }, key())).status).toBe(404);
  });
});

const ev = (expected: number, ref = `SYN-R${Math.floor(Math.random() * 1e6)}`) => ({ expected_revision: expected, field: "decision_process", text: "CFO then board", ref });

describe("reset safety", () => {
  it("reset needs the current expected_revision, so a stale tab cannot erase newer work", async () => {
    const v = new Visitor(); await v.importClean();
    expect((await v.post("/api/opportunities/SYN-1004/evidence", ev(1), key())).body.revision).toBe(2);
    const noRev = await v.post("/api/reset", { confirm: "RESET" }, key());
    expect([noRev.status, noRev.body.error]).toEqual([400, "expected_revision_required"]);
    const stale = await v.post("/api/reset", { confirm: "RESET", expected_revision: 1 }, key());
    expect([stale.status, stale.body.error, stale.body.current_revision]).toEqual([409, "stale_revision", 2]);
    const kept = (await v.state()).body;
    expect([kept.revision, kept.opportunities.length]).toEqual([2, 13]);
    const ok = await v.post("/api/reset", { confirm: "RESET", expected_revision: 2 }, key());
    expect(ok.body).toEqual({ revision: 3, epoch: 1, cleared: true });
    const s = (await v.state()).body;
    expect([s.revision, s.epoch, s.snapshot, s.opportunities.length, s.narratives.length]).toEqual([3, 1, null, 0, 0]);
    expect(s.revisions).toEqual([expect.objectContaining({ rev: 3, kind: "reset" })]);
  });

  it("revision numbers keep rising across resets and are never reused", async () => {
    const v = new Visitor();
    const seen: number[] = [];
    for (let round = 0; round < 3; round++) {
      const cur = (await v.state()).body.revision;
      seen.push((await v.importClean(cur)).body.revision);
      seen.push((await v.post("/api/reset", { confirm: "RESET", expected_revision: cur + 1 }, key())).body.revision);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await v.state()).body.epoch).toBe(3);
  });

  it("stale pre-reset imports, evidence, board-ready and restores cannot act after a reset and reimport", async () => {
    const v = new Visitor(); await v.importClean();
    const n = await v.post("/api/narratives", { expected_revision: 1 }, key());
    const oldPreview = await v.post("/api/imports/preview", { csv: FIXTURES["pipeline-q4"] });
    expect(oldPreview.body.base_revision).toBe(1);
    await v.post("/api/reset", { confirm: "RESET", expected_revision: 1 }, key());
    expect((await v.importClean(2)).body.revision).toBe(3);
    const before = JSON.stringify((await v.state()).body);

    const staleEvidence = await v.post("/api/opportunities/SYN-1004/evidence", ev(1), key());
    expect([staleEvidence.status, staleEvidence.body.error]).toEqual([409, "stale_revision"]);
    const staleCommit = await v.post("/api/imports/commit", { preview_id: oldPreview.body.preview_id, expected_revision: 1 }, key());
    expect(staleCommit.status).toBe(409);
    const oldPreviewNow = await v.post("/api/imports/commit", { preview_id: oldPreview.body.preview_id, expected_revision: 3 }, key());
    expect([oldPreviewNow.status, oldPreviewNow.body.error]).toEqual([410, "preview_gone"]);
    expect((await v.post(`/api/narratives/${n.body.id}/board-ready`, { expected_revision: 1 }, key())).status).toBe(409);
    expect((await v.post(`/api/narratives/${n.body.id}/board-ready`, { expected_revision: 3 }, key())).status).toBe(404);
    expect((await v.post("/api/revisions/1/restore", { expected_revision: 3 }, key())).status).toBe(404);
    const emptyRestore = await v.post("/api/revisions/2/restore", { expected_revision: 3 }, key());
    expect([emptyRestore.status, emptyRestore.body.error]).toEqual([422, "empty_revision"]);
    const staleReset = await v.post("/api/reset", { confirm: "RESET", expected_revision: 1 }, key());
    expect(staleReset.status).toBe(409);

    expect(JSON.stringify((await v.state()).body)).toBe(before);
  });

  it("a receipt from before a reset cannot claim a mutation in the new workspace", async () => {
    const v = new Visitor(); await v.state();
    const p = await v.post("/api/imports/preview", { csv: FIXTURES["pipeline-q4"] });
    const k = key(), body = { preview_id: p.body.preview_id, expected_revision: 0 };
    expect((await v.post("/api/imports/commit", body, k)).body).toEqual({ revision: 1, imported: 13 });
    const eKey = key();
    expect((await v.post("/api/opportunities/SYN-1004/evidence", ev(1, "SYN-OLD1"), eKey)).body.revision).toBe(2);

    const rk = key(), rb = { confirm: "RESET", expected_revision: 2 };
    const reset = await v.post("/api/reset", rb, rk);
    expect(reset.body).toEqual({ revision: 3, epoch: 1, cleared: true });
    const resetRetry = await v.post("/api/reset", rb, rk);
    expect([resetRetry.status, resetRetry.headers.get("idempotent-replay")]).toEqual([200, "true"]);
    expect(resetRetry.body).toEqual(reset.body);
    expect((await v.importClean(3)).body.revision).toBe(4);
    const before = JSON.stringify((await v.state()).body);

    const oldCommit = await v.post("/api/imports/commit", body, k);
    expect([oldCommit.status, oldCommit.body.error, oldCommit.body.current_revision]).toEqual([409, "receipt_from_cleared_workspace", 4]);
    expect(oldCommit.headers.get("idempotent-replay")).toBeNull();
    expect(oldCommit.body.revision).toBeUndefined();
    const oldEvidence = await v.post("/api/opportunities/SYN-1004/evidence", ev(1, "SYN-OLD1"), eKey);
    expect([oldEvidence.status, oldEvidence.body.error]).toEqual([409, "receipt_from_cleared_workspace"]);
    expect((await v.post("/api/opportunities/SYN-1004/evidence", { ...ev(1), text: "other" }, eKey)).status).toBe(422);

    expect(JSON.stringify((await v.state()).body)).toBe(before);
  });
});

describe("request body limits", () => {
  const LIMIT = 600_000;
  const stream = (bytes: Uint8Array, chunk = 64 * 1024) => new ReadableStream<Uint8Array>({
    start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.subarray(i, i + chunk)); c.close(); },
  });
  const send = (v: Visitor, bytes: Uint8Array, streamed: boolean) => v.req("/api/imports/preview", {
    method: "POST", headers: { "content-type": "application/json" },
    body: streamed ? stream(bytes) : bytes, ...(streamed ? { duplex: "half" } : {}),
  } as RequestInit);
  // {"csv":"<n x é>"} is 10 + 2n UTF-8 bytes but only 10 + n UTF-16 characters.
  const multibyte = (n: number, pad = "") => new TextEncoder().encode(JSON.stringify({ csv: pad + "é".repeat(n) }));

  it("counts UTF-8 bytes, not characters, while streaming without a content-length", async () => {
    const v = new Visitor(); await v.state();
    const atLimit = multibyte(299_995);
    expect(atLimit.byteLength).toBe(LIMIT);
    expect((await send(v, atLimit, true)).status).toBe(200);
    const over = multibyte(299_995, "a");
    expect(over.byteLength).toBe(LIMIT + 1);
    const r = await send(v, over, true);
    expect([r.status, r.body.error]).toEqual([413, "too_large"]);
    const charsOnly = multibyte(350_000);
    expect(JSON.stringify({ csv: "é".repeat(350_000) }).length).toBeLessThan(LIMIT);
    expect((await send(v, charsOnly, true)).status).toBe(413);
    expect((await v.state()).body.revision).toBe(0);
  });

  it("rejects invalid UTF-8 and accepts valid multibyte text", async () => {
    const v = new Visitor(); await v.state();
    const bad = new Uint8Array([...new TextEncoder().encode('{"csv":"'), 0xc3, 0x28, ...new TextEncoder().encode('"}')]);
    const r = await send(v, bad, false);
    expect([r.status, r.body.error]).toEqual([400, "bad_encoding"]);
    const csv = FIXTURES["pipeline-q4"].replace("Northwind Ledger", "Nørthwind Lédger €");
    const ok = await send(v, new TextEncoder().encode(JSON.stringify({ csv })), true);
    expect([ok.status, ok.body.committable]).toEqual([200, true]);
  });

  // Last in the file: the server stops reading mid-upload, which resets that client connection.
  it("refuses a declared oversize body and a stream far beyond the limit", async () => {
    const v = new Visitor(); await v.state();
    expect((await send(v, multibyte(299_995, "a"), false)).status).toBe(413);
    expect((await send(v, new Uint8Array(5_000_000).fill(0x20), true)).status).toBe(413);
  });
});
