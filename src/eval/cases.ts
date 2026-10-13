import { FIXTURES } from "../generated/fixtures";
import { parseImport, reconcile, views, buildNarrative, type EngineOptions, type Snapshot } from "../engine";

export interface EvalCase { id: string; group: string; description: string; expected: string; actual: string; pass: boolean }
export interface EvalReport {
  broken_rule: string | null;
  cases: EvalCase[];
  passed: number;
  total: number;
  classification_accuracy: { correct: number; total: number; pct: string };
  coverage: { classifiable: number; open: number; pct: string };
  note: string;
}

/**
 * Expected values were worked out by hand from fixtures/pipeline-q4.csv and the rules in design.md,
 * before the engine output was compared. They are labels for synthetic rows, not ground truth about real deals.
 */
const EXPECTED_CATEGORY: Record<string, [string, string | null]> = {
  "SYN-1001": ["commit", "negotiation"],
  "SYN-1002": ["not_classifiable", "proposal"], // EB engagement 53 days old
  "SYN-1003": ["best_case", "proposal"], // pricing pending is a known state at proposal
  "SYN-1004": ["not_classifiable", "solution"], // decision process blank
  "SYN-1005": ["not_classifiable", "qualification"], // EB claimed without a ref
  "SYN-1006": ["pipeline", "qualification"], // stale next step is flagged, not a gate below negotiation
  "SYN-1007": ["pipeline", "discovery"],
  "SYN-1008": ["not_classifiable", "solution"], // 25% discount, no approval status
  "SYN-1009": ["best_case", "proposal"], // CHF: classified but not converted
  "SYN-1010": ["closed_won", "closed_won"],
  "SYN-1011": ["closed_won_unverified", null],
  "SYN-1012": ["closed_lost", "closed_lost"],
  "SYN-1013": ["not_classifiable", "proposal"], // no next step
};

const EXPECTED_MONEY: Record<string, string> = {
  gross_pipeline: "57590000", // 386,000 GBP + 90,000 EUR × 0.86 + 150,000 USD × 0.75
  weighted_reported: "38727000",
  weighted_evidenced: "30429000",
  closed_won: "8000000", // SYN-1010 only; SYN-1011 has no contract ref
  commit: "12000000",
};

export async function runEval(opts: EngineOptions = {}): Promise<EvalReport> {
  const cases: EvalCase[] = [];
  const add = (group: string, id: string, description: string, expected: unknown, actual: unknown) => {
    const e = typeof expected === "string" ? expected : JSON.stringify(expected);
    const a = typeof actual === "string" ? actual : JSON.stringify(actual);
    cases.push({ id, group, description, expected: e, actual: a, pass: e === a });
  };

  const p = await parseImport(FIXTURES["pipeline-q4"], "");
  add("import", "IMP-1", "Clean synthetic file is committable with 13 valid rows", { committable: true, valid: 13, rejected: 0 }, { committable: p.committable, valid: p.counts.valid, rejected: p.counts.rejected });
  add("import", "IMP-2", "Every row carries an exact source reference", "synthetic-crm-export-2026-10-12.csv#row=7", p.opportunities[0]?.source_ref ?? "none");
  const s: Snapshot = { revision: 1, as_of: p.as_of!, source_name: p.source_name, fingerprint: p.fingerprint, fx: p.fx, opportunities: p.opportunities };
  const vs = views(s, opts);
  let correct = 0;
  for (const [id, [cat, ev]] of Object.entries(EXPECTED_CATEGORY)) {
    const v = vs.find((x) => x.opp_id === id);
    const actual = v ? `${v.category} / ${v.evidenced_stage ?? "none"}` : "missing";
    const expected = `${cat} / ${ev ?? "none"}`;
    if (actual === expected) correct++;
    add("classification", `CLS-${id}`, `${id} category / evidenced stage`, expected, actual);
  }
  const r = reconcile(s, opts);
  add("reconcile", "REC-1", "Gross open pipeline (GBP minor units)", EXPECTED_MONEY.gross_pipeline, r.gross_pipeline.value.minor);
  add("reconcile", "REC-2", "Gross pipeline denominator", "9 of 10 open opportunities converted to GBP", r.gross_pipeline.denominator);
  add("reconcile", "REC-3", "Weighted forecast on reported stages", EXPECTED_MONEY.weighted_reported, r.weighted_reported.value.minor);
  add("reconcile", "REC-4", "Weighted forecast on evidenced stages", EXPECTED_MONEY.weighted_evidenced, r.weighted_evidenced.value.minor);
  add("reconcile", "REC-5", "Closed won excludes the unverified row", EXPECTED_MONEY.closed_won, r.closed_won.value.minor);
  add("reconcile", "REC-6", "Evidence-backed commit total", EXPECTED_MONEY.commit, r.categories.find((c) => c.key === "commit")!.value.minor);
  add("reconcile", "REC-7", "CHF without a rate is excluded and counted", [{ currency: "CHF", count: 1 }], r.not_converted.map((n) => ({ currency: n.currency, count: n.count })));
  add("reconcile", "REC-8", "Category totals sum to gross pipeline", true, r.check.ok);

  const n = buildNarrative(s, opts);
  const ids = new Set(s.opportunities.map((o) => o.opp_id));
  add("narrative", "NAR-1", "Narrative is stamped with the revision it was built from", 1, n.revision);
  add("narrative", "NAR-2", "Every named action points at an opportunity in the current snapshot", true, n.actions.every((a) => ids.has(a.opp_id)));
  add("narrative", "NAR-3", "No action for the clean commit deal SYN-1001", false, n.actions.some((a) => a.opp_id === "SYN-1001"));
  add("narrative", "NAR-4", "Narrative never states time saved or lift", false, /saved \d|hours saved|% (faster|lift)/i.test(n.paragraphs.join(" ")));

  const h = await parseImport(FIXTURES["hostile"], "");
  add("hostile", "HOS-1", "Hostile file is not committable", false, h.committable);
  add("hostile", "HOS-2", "Rejected lines", [5, 6, 7, 8, 9, 10], h.rows.filter((x) => x.status === "rejected").map((x) => x.line));
  add("hostile", "HOS-3", "Markup and prompt-like text pass as inert text on line 4", "valid", h.rows.find((x) => x.line === 4)?.status ?? "missing");
  const m = await parseImport(FIXTURES["malformed"], "");
  add("hostile", "HOS-4", "Malformed file fails before row checks", { committable: false, rows: 0 }, { committable: m.committable, rows: m.rows.length });

  const open = vs.filter((v) => ["discovery", "qualification", "solution", "proposal", "negotiation"].includes(v.reported_stage));
  const total = Object.keys(EXPECTED_CATEGORY).length;
  return {
    broken_rule: opts.brokenRule ?? null,
    cases, passed: cases.filter((c) => c.pass).length, total: cases.length,
    classification_accuracy: { correct, total, pct: `${Math.round((correct / total) * 100)}%` },
    coverage: { classifiable: open.filter((v) => v.category !== "not_classifiable").length, open: open.length, pct: r.coverage.pct },
    note: "Accuracy is agreement with hand-written labels on 13 synthetic rows. It says nothing about real forecast accuracy.",
  };
}
