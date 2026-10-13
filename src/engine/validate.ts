import { parseCsv } from "./csv";
import { parseDate } from "./dates";
import { sha256Hex } from "./hash";
import { COLUMNS, REP_CATEGORIES, STAGES, type FxRate, type Opportunity, type RepCategory, type Stage } from "./types";

export const LIMITS = { maxBytes: 256 * 1024, maxRows: 300, maxCell: 600 } as const;

export interface RowResult {
  line: number;
  source_ref: string;
  row_hash: string;
  opp_id: string;
  account: string;
  status: "valid" | "rejected";
  reasons: string[];
}

export interface ParsedImport {
  source_name: string;
  fingerprint: string;
  as_of: string | null;
  fx: FxRate[];
  file_errors: string[];
  rows: RowResult[];
  opportunities: Opportunity[];
  counts: { total: number; valid: number; rejected: number };
  committable: boolean;
}

const ID_RE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
const MONEY_RE = /^(\d{1,9})(?:\.(\d{1,2}))?$/;
const REF_RE = /\[ref:(SYN-[A-Z0-9-]{2,40})\]/;
const SOURCE_RE = /^[A-Za-z0-9._ -]{1,80}$/;

/** Cells that a spreadsheet would execute. A leading "-" followed by a digit is a plain negative number and is judged by the numeric rules instead. */
export function isFormulaLike(s: string): boolean {
  if (s.length === 0) return false;
  if (/^[=+@\t\r]/.test(s)) return true;
  if (s[0] === "-" && !/^-\d/.test(s)) return true;
  return false;
}

export function hasControlChars(s: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(s);
}

export function extractRef(s: string): string | null {
  const m = REF_RE.exec(s);
  return m ? m[1] : null;
}

function stageOf(s: string): Stage | null {
  const k = s.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (STAGES as readonly string[]).includes(k) ? (k as Stage) : null;
}

function repCatOf(s: string): RepCategory | null | "bad" {
  const k = s.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (k === "") return null;
  return (REP_CATEGORIES as readonly string[]).includes(k) ? (k as RepCategory) : "bad";
}

export function parseMoneyMinor(s: string): string | null {
  const m = MONEY_RE.exec(s);
  if (!m) return null;
  const minor = BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  return minor.toString();
}

export function parseFxMicro(s: string): number | null {
  if (!/^\d{1,4}(?:\.\d{1,6})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const micro = Number(w) * 1_000_000 + Number(f.padEnd(6, "0"));
  return micro > 0 && Number.isSafeInteger(micro) ? micro : null;
}

export function sanitizeSourceName(s: string): string | null {
  const t = s.trim();
  return SOURCE_RE.test(t) ? t : null;
}

export async function parseImport(text: string, sourceNameInput: string): Promise<ParsedImport> {
  const file_errors: string[] = [];
  const out: ParsedImport = {
    source_name: "", fingerprint: await sha256Hex(text), as_of: null, fx: [], file_errors,
    rows: [], opportunities: [], counts: { total: 0, valid: 0, rejected: 0 }, committable: false,
  };
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > LIMITS.maxBytes) { file_errors.push(`File is ${bytes} bytes; the limit is ${LIMITS.maxBytes}.`); return out; }
  if (text.trim() === "") { file_errors.push("File is empty."); return out; }

  const parsed = parseCsv(text.replace(/^\uFEFF/, ""));
  if (parsed.error) { file_errors.push(parsed.error); return out; }

  let sourceName = sanitizeSourceName(sourceNameInput || "");
  const directives = parsed.records.filter((r) => r.cells[0]?.startsWith("#"));
  const body = parsed.records.filter((r) => !r.cells[0]?.startsWith("#"));
  let reporting = "GBP";
  const fxSeen = new Set<string>();
  for (const d of directives) {
    const key = d.cells[0].slice(1).trim().toLowerCase();
    const v = d.cells.slice(1).map((c) => c.trim());
    if (key === "as_of") {
      if (out.as_of !== null) file_errors.push(`Line ${d.line}: as_of appears more than once.`);
      else if (v.length !== 1 || parseDate(v[0]) === null) file_errors.push(`Line ${d.line}: as_of must be one valid YYYY-MM-DD date.`);
      else out.as_of = v[0];
    } else if (key === "source") {
      const s = sanitizeSourceName(v[0] ?? "");
      if (!s || v.length !== 1) file_errors.push(`Line ${d.line}: source name must be 1-80 letters, digits, dot, dash, underscore or space.`);
      else sourceName = s;
    } else if (key === "reporting_currency") {
      reporting = v[0] ?? "";
      if (reporting !== "GBP") file_errors.push(`Line ${d.line}: only GBP reporting is supported (got "${reporting.slice(0, 8)}").`);
    } else if (key === "fx") {
      const [cur, rate] = v;
      const micro = parseFxMicro(rate ?? "");
      if (v.length !== 2 || !/^[A-Z]{3}$/.test(cur ?? "") || micro === null) file_errors.push(`Line ${d.line}: fx must be "#fx,CUR,rate" with a positive rate (max 6 decimals).`);
      else if (fxSeen.has(cur)) file_errors.push(`Line ${d.line}: fx rate for ${cur} appears more than once.`);
      else if (cur === "GBP" && micro !== 1_000_000) file_errors.push(`Line ${d.line}: GBP rate must be 1.`);
      else { fxSeen.add(cur); if (cur !== "GBP") out.fx.push({ currency: cur, gbp_per_unit: rate, micro }); }
    } else {
      file_errors.push(`Line ${d.line}: unknown directive "#${key.slice(0, 24)}".`);
    }
  }
  if (out.as_of === null && !file_errors.some((e) => e.includes("as_of"))) file_errors.push("Missing #as_of directive: the as-of date cannot be assumed.");
  out.source_name = sourceName ?? "pasted-export.csv";
  out.fx.sort((a, b) => a.currency.localeCompare(b.currency));

  if (body.length === 0) { file_errors.push("No header row."); return out; }
  const header = body[0].cells.map((c) => c.trim());
  const missing = COLUMNS.filter((c) => !header.includes(c));
  const extra = header.filter((c) => !(COLUMNS as readonly string[]).includes(c));
  const dupCols = header.filter((c, i) => header.indexOf(c) !== i);
  if (missing.length) file_errors.push(`Missing columns: ${missing.join(", ")}.`);
  if (extra.length) file_errors.push(`Unexpected columns: ${extra.map((e) => e.slice(0, 30)).join(", ")}.`);
  if (dupCols.length) file_errors.push(`Duplicate columns: ${dupCols.join(", ")}.`);
  const dataRows = body.slice(1);
  if (dataRows.length === 0) file_errors.push("No opportunity rows: nothing to import.");
  if (dataRows.length > LIMITS.maxRows) file_errors.push(`${dataRows.length} rows; the limit is ${LIMITS.maxRows}.`);
  if (file_errors.length) return out;

  const asOfDay = parseDate(out.as_of!)!;
  const idx = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>;
  const idCount = new Map<string, number>();
  for (const r of dataRows) { const id = (r.cells[idx.opp_id] ?? "").trim(); idCount.set(id, (idCount.get(id) ?? 0) + 1); }

  for (const r of dataRows) {
    const reasons: string[] = [];
    const get = (c: string) => (r.cells[idx[c]] ?? "");
    if (r.cells.length !== header.length) reasons.push(`Has ${r.cells.length} cells; header has ${header.length}.`);
    for (const c of COLUMNS) {
      const v = get(c);
      if (v.length > LIMITS.maxCell) reasons.push(`${c} is longer than ${LIMITS.maxCell} characters.`);
      if (isFormulaLike(v)) reasons.push(`${c} starts like a spreadsheet formula.`);
      if (hasControlChars(v)) reasons.push(`${c} contains control or bidi characters.`);
    }
    const t = (c: string) => get(c).trim();
    const opp_id = t("opp_id");
    if (!ID_RE.test(opp_id)) reasons.push("opp_id must be 3-40 uppercase letters, digits or dashes.");
    else if ((idCount.get(opp_id) ?? 0) > 1) reasons.push(`opp_id ${opp_id} appears more than once in this file.`);
    if (!t("account")) reasons.push("account is blank.");
    if (!t("owner")) reasons.push("owner is blank.");
    const stage = stageOf(t("stage"));
    if (!stage) reasons.push(`stage "${t("stage").slice(0, 30)}" is not one of ${STAGES.join(", ")}.`);
    const rep = repCatOf(t("rep_category"));
    if (rep === "bad") reasons.push(`rep_category "${t("rep_category").slice(0, 30)}" is not commit, best_case, pipeline, omitted or blank.`);
    const amount_minor = parseMoneyMinor(t("amount"));
    if (amount_minor === null) reasons.push(`amount "${t("amount").slice(0, 20)}" must be a non-negative number with at most 2 decimals and no separators.`);
    const currency = t("currency");
    if (!/^[A-Z]{3}$/.test(currency)) reasons.push("currency must be a 3-letter uppercase code.");
    const closeDay = parseDate(t("close_date"));
    if (closeDay === null) reasons.push(`close_date "${t("close_date").slice(0, 20)}" is not a valid YYYY-MM-DD date.`);
    for (const c of ["next_step_date", "last_activity_date"]) {
      if (t(c) && parseDate(t(c)) === null) reasons.push(`${c} "${t(c).slice(0, 20)}" is not a valid YYYY-MM-DD date.`);
    }
    const lad = t("last_activity_date") ? parseDate(t("last_activity_date")) : null;
    if (lad !== null && lad > asOfDay) reasons.push("last_activity_date is after the as-of date.");
    const eb = t("eb_engaged_date");
    if (eb) {
      const ebDate = eb.split(/\s+/)[0];
      const ebDay = parseDate(ebDate);
      if (ebDay === null) reasons.push(`eb_engaged_date must start with a valid YYYY-MM-DD date.`);
      else if (ebDay > asOfDay) reasons.push("eb_engaged_date is after the as-of date.");
    }
    if (stage === "closed_won" && closeDay !== null && closeDay > asOfDay) reasons.push("Closed won with a close_date after the as-of date.");
    let discount: number | null = null;
    if (t("discount_pct")) {
      const d = t("discount_pct");
      if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(d) || Number(d) > 100) reasons.push(`discount_pct "${d.slice(0, 10)}" must be 0-100.`);
      else discount = Number(d);
    }
    const pa = t("pricing_approval").toLowerCase();
    if (pa && !/^(approved|pending)(\s|$)/.test(pa)) reasons.push(`pricing_approval must be blank, "pending" or "approved [ref:SYN-…]".`);

    const row_hash = (await sha256Hex(r.raw)).slice(0, 12);
    const source_ref = `${out.source_name}#row=${r.line}`;
    out.rows.push({ line: r.line, source_ref, row_hash, opp_id: opp_id.slice(0, 40), account: t("account").slice(0, 80), status: reasons.length ? "rejected" : "valid", reasons });
    if (reasons.length === 0) {
      out.opportunities.push({
        opp_id, account: t("account"), owner: t("owner"), stage: stage!, rep_category: rep as RepCategory | null,
        amount_minor: amount_minor!, currency, close_date: t("close_date"), next_step: t("next_step"),
        next_step_date: t("next_step_date") || null, last_activity_date: t("last_activity_date") || null,
        metrics: t("metrics"), economic_buyer: t("economic_buyer"), decision_criteria: t("decision_criteria"),
        decision_process: t("decision_process"), identify_pain: t("identify_pain"), champion: t("champion"),
        eb_engaged_date: eb, discount_pct: discount, pricing_approval: t("pricing_approval"), contract_ref: t("contract_ref"),
        notes: t("notes"), source_ref, row_hash, evidence_log: [],
      });
    }
  }
  out.counts = { total: out.rows.length, valid: out.opportunities.length, rejected: out.rows.length - out.opportunities.length };
  out.committable = file_errors.length === 0 && out.counts.rejected === 0 && out.counts.valid > 0;
  return out;
}
