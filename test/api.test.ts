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
    expect((await a.post("/api/reset", { confirm: "RESET" }, key())).body.revision).toBe(0);
    expect((await a.state()).body.revision).toBe(0);
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
