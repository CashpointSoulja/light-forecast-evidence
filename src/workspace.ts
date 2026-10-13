import { DurableObject } from "cloudflare:workers";
import {
  buildNarrative, hasControlChars, isFormulaLike, narrativeMarkdown, parseDate, parseImport, reconcile, views,
  MEDDIC_FIELDS, LIMITS, type Narrative, type Opportunity, type Snapshot,
} from "./engine";
import { sha256Hex } from "./engine/hash";
import { FIXTURES } from "./generated/fixtures";
import { runEval } from "./eval/cases";

export const BOUNDS = { previews: 5, revisions: 30, narratives: 20, commands: 200, events: 60 } as const;
const IDEM_RE = /^[A-Za-z0-9_-]{8,80}$/;
const REF_RE = /^SYN-[A-Z0-9-]{2,40}$/;
const EDITABLE = [...MEDDIC_FIELDS, "eb_engaged_date", "pricing_approval", "contract_ref", "next_step"] as const;

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

const now = () => new Date().toISOString();

export class Workspace extends DurableObject {
  sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions (rev INTEGER PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS previews (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, base_revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS narratives (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, created_at TEXT NOT NULL, board_ready INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (key TEXT PRIMARY KEY, route TEXT NOT NULL, body_hash TEXT NOT NULL, status INTEGER NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
    `);
  }

  revision(): number {
    const r = this.sql.exec("SELECT v FROM meta WHERE k = 'revision'").toArray()[0];
    return r ? Number(r.v) : 0;
  }

  snapshot(rev = this.revision()): Snapshot | null {
    if (rev === 0) return null;
    const r = this.sql.exec("SELECT snapshot FROM revisions WHERE rev = ?", rev).toArray()[0];
    return r ? (JSON.parse(String(r.snapshot)) as Snapshot) : null;
  }

  event(kind: string, detail: string) {
    this.sql.exec("INSERT INTO events (at, kind, detail) VALUES (?, ?, ?)", now(), kind, detail.slice(0, 300));
    this.sql.exec("DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT ?)", BOUNDS.events);
  }

  /** Writes a new revision and prunes old ones. Caller runs inside transactionSync. */
  writeRevision(s: Omit<Snapshot, "revision">, kind: string, summary: string): number {
    const rev = this.revision() + 1;
    const snap: Snapshot = { ...s, revision: rev };
    this.sql.exec("INSERT INTO revisions (rev, created_at, kind, summary, snapshot) VALUES (?, ?, ?, ?, ?)", rev, now(), kind, summary, JSON.stringify(snap));
    this.sql.exec("INSERT INTO meta (k, v) VALUES ('revision', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(rev));
    this.sql.exec("DELETE FROM revisions WHERE rev <= ?", rev - BOUNDS.revisions);
    this.sql.exec("DELETE FROM previews WHERE base_revision < ?", rev);
    this.event(kind, `Revision ${rev}: ${summary}`);
    return rev;
  }

  expectRevision(expected: unknown) {
    const cur = this.revision();
    if (typeof expected !== "number" || !Number.isInteger(expected)) throw new HttpError(400, "expected_revision_required", "expected_revision must be an integer.");
    if (expected !== cur) throw new HttpError(409, "stale_revision", `This view is based on revision ${expected}; the workspace is now at revision ${cur}. Reload before acting.`, { current_revision: cur });
  }

  async fetch(req: Request): Promise<Response> {
    try {
      return await this.route(req);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message, ...e.extra });
      return json(500, { error: "internal", message: "Unexpected error. No partial change was saved." });
    }
  }

  async route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const m = req.method;
    if (m === "GET" && path === "/api/state") return json(200, this.state());
    if (m === "GET" && path.startsWith("/api/samples/")) {
      const name = path.slice("/api/samples/".length);
      if (!Object.hasOwn(FIXTURES, name)) throw new HttpError(404, "not_found", "Unknown sample.");
      return new Response(FIXTURES[name], { headers: { "content-type": "text/csv; charset=utf-8" } });
    }
    if (m === "GET" && path === "/api/eval") {
      return json(200, await runEval({ brokenRule: url.searchParams.get("broken") === "1" ? "eb-named-counts-as-engaged" : null }));
    }
    let nm = /^\/api\/narratives\/([a-f0-9-]{36})\/markdown$/.exec(path);
    if (m === "GET" && nm) {
      const row = this.sql.exec("SELECT data FROM narratives WHERE id = ?", nm[1]).toArray()[0];
      if (!row) throw new HttpError(404, "not_found", "Narrative not found.");
      return new Response(narrativeMarkdown(JSON.parse(String(row.data)) as Narrative, this.revision()), { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": "attachment; filename=\"board-narrative-synthetic.md\"" } });
    }
    if (m !== "POST") throw new HttpError(404, "not_found", "No such route.");

    const raw = await req.text();
    if (raw.length > LIMITS.maxBytes * 2) throw new HttpError(413, "too_large", "Request body too large.");
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw || "{}"); } catch { throw new HttpError(400, "bad_json", "Body is not valid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "bad_json", "Body must be a JSON object.");

    if (path === "/api/imports/preview") return json(200, await this.preview(body));

    const key = req.headers.get("idempotency-key") ?? "";
    if (!IDEM_RE.test(key)) throw new HttpError(400, "idempotency_key_required", "Idempotency-Key header (8-80 letters, digits, - or _) is required for commands.");
    const bodyHash = await sha256Hex(`${path}\n${raw}`);
    // From here on the handler is synchronous, so no other request can interleave between the revision check and the write.
    const prior = this.sql.exec("SELECT route, body_hash, status, response FROM commands WHERE key = ?", key).toArray()[0];
    if (prior) {
      if (prior.body_hash !== bodyHash) throw new HttpError(422, "idempotency_key_reused", "This Idempotency-Key was already used for a different command.");
      return new Response(String(prior.response), { status: Number(prior.status), headers: { "content-type": "application/json; charset=utf-8", "idempotent-replay": "true" } });
    }
    let status = 200, result: unknown;
    try {
      result = this.ctx.storage.transactionSync(() => this.command(path, body));
    } catch (e) {
      if (!(e instanceof HttpError) || e.status >= 500) throw e;
      status = e.status; result = { error: e.code, message: e.message, ...e.extra };
    }
    const response = JSON.stringify(result);
    if (status !== 409) {
      this.sql.exec("INSERT INTO commands (key, route, body_hash, status, response, created_at) VALUES (?, ?, ?, ?, ?, ?)", key, path, bodyHash, status, response, now());
      this.sql.exec("DELETE FROM commands WHERE key NOT IN (SELECT key FROM commands ORDER BY created_at DESC, key LIMIT ?)", BOUNDS.commands);
    }
    return new Response(response, { status, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  command(path: string, body: Record<string, unknown>): unknown {
    if (path === "/api/imports/commit") return this.commit(body);
    if (path === "/api/narratives") return this.createNarrative(body);
    if (path === "/api/reset") return this.reset(body);
    let mm = /^\/api\/opportunities\/([A-Z0-9-]{3,40})\/evidence$/.exec(path);
    if (mm) return this.addEvidence(mm[1], body);
    mm = /^\/api\/narratives\/([a-f0-9-]{36})\/board-ready$/.exec(path);
    if (mm) return this.boardReady(mm[1], body);
    mm = /^\/api\/revisions\/(\d{1,6})\/restore$/.exec(path);
    if (mm) return this.restore(Number(mm[1]), body);
    throw new HttpError(404, "not_found", "No such route.");
  }

  async preview(body: Record<string, unknown>) {
    const csv = body.csv;
    if (typeof csv !== "string") throw new HttpError(400, "csv_required", "csv must be a string.");
    const p = await parseImport(csv, typeof body.source_name === "string" ? body.source_name : "");
    const id = crypto.randomUUID();
    const base = this.revision();
    const cur = this.snapshot();
    const curIds = new Set(cur?.opportunities.map((o) => o.opp_id) ?? []);
    const newIds = new Set(p.opportunities.map((o) => o.opp_id));
    const diff = {
      added: [...newIds].filter((x) => !curIds.has(x)).length,
      replaced: [...newIds].filter((x) => curIds.has(x)).length,
      removed: [...curIds].filter((x) => !newIds.has(x)).length,
    };
    if (p.committable) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("INSERT INTO previews (id, created_at, base_revision, data) VALUES (?, ?, ?, ?)", id, now(), base, JSON.stringify(p));
        this.sql.exec("DELETE FROM previews WHERE id NOT IN (SELECT id FROM previews ORDER BY created_at DESC, id LIMIT ?)", BOUNDS.previews);
      });
    }
    return {
      preview_id: p.committable ? id : null, base_revision: base, source_name: p.source_name, fingerprint: p.fingerprint,
      as_of: p.as_of, fx: p.fx, file_errors: p.file_errors, counts: p.counts, committable: p.committable, rows: p.rows, diff,
      message: p.committable ? "Preview only. Nothing is saved until you commit." : "This file cannot be committed. Nothing was saved.",
    };
  }

  commit(body: Record<string, unknown>) {
    this.expectRevision(body.expected_revision);
    if (typeof body.preview_id !== "string") throw new HttpError(400, "preview_required", "preview_id is required.");
    const row = this.sql.exec("SELECT base_revision, data FROM previews WHERE id = ?", body.preview_id).toArray()[0];
    if (!row) throw new HttpError(410, "preview_gone", "This preview expired or was superseded. Preview the file again.");
    const p = JSON.parse(String(row.data)) as Awaited<ReturnType<typeof parseImport>>;
    const rev = this.writeRevision(
      { as_of: p.as_of!, source_name: p.source_name, fingerprint: p.fingerprint, fx: p.fx, opportunities: p.opportunities },
      "import", `Imported ${p.counts.valid} synthetic rows from ${p.source_name}`,
    );
    this.sql.exec("DELETE FROM previews WHERE id = ?", body.preview_id);
    return { revision: rev, imported: p.counts.valid };
  }

  addEvidence(oppId: string, body: Record<string, unknown>) {
    this.expectRevision(body.expected_revision);
    const s = this.snapshot();
    if (!s) throw new HttpError(409, "empty_workspace", "Import opportunities first.");
    const field = body.field as string;
    if (!(EDITABLE as readonly string[]).includes(field)) throw new HttpError(400, "bad_field", "That field cannot be edited here.");
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const ref = typeof body.ref === "string" ? body.ref.trim() : "";
    const date = typeof body.date === "string" ? body.date.trim() : "";
    const problems: string[] = [];
    if (text.length > 400) problems.push("Evidence text is longer than 400 characters.");
    if (isFormulaLike(text) || hasControlChars(text)) problems.push("Evidence text starts like a formula or contains control characters.");
    if (/\[ref:/i.test(text)) problems.push("Put the source reference in the reference box, not in the text.");
    if (!REF_RE.test(ref)) problems.push("Source reference must look like SYN-ABC123. Evidence without a reference is not accepted here.");
    let cell: string;
    if (field === "eb_engaged_date" || field === "next_step") {
      const d = parseDate(date);
      if (d === null) problems.push("A valid YYYY-MM-DD date is required.");
      else if (field === "eb_engaged_date" && d > parseDate(s.as_of)!) problems.push("Engagement date cannot be after the as-of date.");
      if (field === "next_step" && !text) problems.push("Describe the next step.");
      cell = field === "eb_engaged_date" ? `${date} [ref:${ref}]` : `${text} [ref:${ref}]`;
    } else if (field === "pricing_approval") {
      cell = `approved [ref:${ref}]`;
    } else {
      if (!text) problems.push("Evidence text is required.");
      cell = `${text} [ref:${ref}]`;
    }
    if (problems.length) throw new HttpError(422, "invalid_evidence", problems.join(" "), { problems });
    const idx = s.opportunities.findIndex((o) => o.opp_id === oppId);
    if (idx < 0) throw new HttpError(404, "not_found", `No opportunity ${oppId} in revision ${s.revision}.`);
    const o: Opportunity = { ...s.opportunities[idx], evidence_log: [...s.opportunities[idx].evidence_log] };
    (o as unknown as Record<string, string>)[field] = cell;
    if (field === "next_step") { o.next_step_date = date; o.last_activity_date = s.as_of; }
    o.evidence_log.push({ field, value: cell, ref, revision: s.revision + 1 });
    if (o.evidence_log.length > 20) o.evidence_log.shift();
    const opps = [...s.opportunities]; opps[idx] = o;
    const { revision: _r, ...rest } = s;
    const rev = this.writeRevision({ ...rest, opportunities: opps }, "evidence", `${oppId}: ${field} evidenced [ref:${ref}]`);
    return { revision: rev, opp_id: oppId, field };
  }

  createNarrative(body: Record<string, unknown>) {
    this.expectRevision(body.expected_revision);
    const s = this.snapshot();
    if (!s) throw new HttpError(409, "empty_workspace", "Import opportunities first.");
    const n = buildNarrative(s);
    const id = crypto.randomUUID();
    this.sql.exec("INSERT INTO narratives (id, revision, created_at, data) VALUES (?, ?, ?, ?)", id, s.revision, now(), JSON.stringify(n));
    this.sql.exec("DELETE FROM narratives WHERE id NOT IN (SELECT id FROM narratives ORDER BY created_at DESC, id LIMIT ?)", BOUNDS.narratives);
    this.event("narrative", `Narrative built from revision ${s.revision}`);
    return { id, revision: s.revision };
  }

  boardReady(id: string, body: Record<string, unknown>) {
    this.expectRevision(body.expected_revision);
    const row = this.sql.exec("SELECT revision FROM narratives WHERE id = ?", id).toArray()[0];
    if (!row) throw new HttpError(404, "not_found", "Narrative not found.");
    if (Number(row.revision) !== this.revision()) throw new HttpError(409, "narrative_superseded", `Built from revision ${row.revision}; current is ${this.revision()}. Regenerate it.`, { current_revision: this.revision() });
    this.sql.exec("UPDATE narratives SET board_ready = 1 WHERE id = ?", id);
    this.event("board_ready", `Narrative for revision ${row.revision} marked board-ready (synthetic)`);
    return { id, board_ready: true };
  }

  restore(rev: number, body: Record<string, unknown>) {
    this.expectRevision(body.expected_revision);
    const s = this.snapshot(rev);
    if (!s) throw new HttpError(404, "not_found", `Revision ${rev} is not retained (the last ${BOUNDS.revisions} are kept).`);
    const { revision: _r, ...rest } = s;
    const n = this.writeRevision(rest, "restore", `Restored revision ${rev}`);
    return { revision: n, restored_from: rev };
  }

  reset(body: Record<string, unknown>) {
    if (body.confirm !== "RESET") throw new HttpError(400, "confirm_required", 'Send {"confirm":"RESET"}.');
    for (const t of ["revisions", "previews", "narratives", "events"]) this.sql.exec(`DELETE FROM ${t}`);
    this.sql.exec("DELETE FROM meta");
    this.event("reset", "Workspace cleared");
    return { revision: 0 };
  }

  state() {
    const rev = this.revision();
    const s = this.snapshot(rev);
    const narratives = this.sql.exec("SELECT id, revision, created_at, board_ready, data FROM narratives ORDER BY created_at DESC, id").toArray().map((r) => ({
      id: String(r.id), revision: Number(r.revision), created_at: String(r.created_at), board_ready: Number(r.board_ready) === 1,
      superseded: Number(r.revision) !== rev, narrative: JSON.parse(String(r.data)) as Narrative,
    }));
    return {
      revision: rev,
      snapshot: s ? { as_of: s.as_of, source_name: s.source_name, fingerprint: s.fingerprint, fx: s.fx, count: s.opportunities.length } : null,
      opportunities: s?.opportunities ?? [],
      views: s ? views(s) : [],
      reconciliation: s ? reconcile(s) : null,
      narratives,
      revisions: this.sql.exec("SELECT rev, created_at, kind, summary FROM revisions ORDER BY rev DESC").toArray(),
      events: this.sql.exec("SELECT at, kind, detail FROM events ORDER BY id DESC LIMIT 20").toArray(),
      bounds: { ...BOUNDS, ...LIMITS },
    };
  }
}
