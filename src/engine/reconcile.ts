import { evaluateOpportunity, weightOf, type OppView } from "./gates";
import { parseDate, quarterOf } from "./dates";
import { OPEN_STAGES, STAGE_WEIGHT, type EngineOptions, type FxRate, type Opportunity, type Snapshot } from "./types";

export interface Money { minor: string; display: string }
export interface Metric { label: string; value: Money; numerator_count: number; denominator_count: number; denominator: string; excluded: string[] }

export interface Reconciliation {
  as_of: string;
  quarter: string;
  reporting_currency: "GBP";
  fx: FxRate[];
  fx_note: string;
  gross_pipeline: Metric;
  weighted_reported: Metric;
  weighted_evidenced: Metric;
  closed_won: Metric;
  categories: { key: string; label: string; count: number; not_converted: number; value: Money }[];
  not_converted: { currency: string; count: number; native_minor: string; display: string }[];
  coverage: { classifiable: number; open: number; pct: string; rep_ahead: number; stale_next_step: number; missing_by_requirement: { label: string; count: number }[] };
  check: { ok: boolean; detail: string };
}

export function formatMinor(minor: bigint, cur = "GBP"): string {
  const neg = minor < 0n; const a = neg ? -minor : minor;
  const whole = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sym = cur === "GBP" ? "£" : `${cur} `;
  return `${neg ? "-" : ""}${sym}${whole}.${(a % 100n).toString().padStart(2, "0")}`;
}
const money = (m: bigint): Money => ({ minor: m.toString(), display: formatMinor(m) });

/** GBP minor units, rounded half-up, or null when no rate was imported. */
export function toGbp(o: Opportunity, fx: FxRate[]): bigint | null {
  const amt = BigInt(o.amount_minor);
  if (o.currency === "GBP") return amt;
  const r = fx.find((f) => f.currency === o.currency);
  if (!r) return null;
  return (amt * BigInt(r.micro) + 500_000n) / 1_000_000n;
}

const weighted = (gbp: bigint, pct: number) => (gbp * BigInt(pct) + 50n) / 100n;

export function views(s: Snapshot, opts: EngineOptions = {}): OppView[] {
  return s.opportunities.map((o) => evaluateOpportunity(o, s.as_of, opts));
}

export function reconcile(s: Snapshot, opts: EngineOptions = {}): Reconciliation {
  const vs = views(s, opts);
  const q = quarterOf(s.as_of);
  const open = s.opportunities.filter((o) => (OPEN_STAGES as string[]).includes(o.stage));
  const notConv = new Map<string, { count: number; native: bigint }>();
  let gross = 0n, wRep = 0n, wEv = 0n, convertedOpen = 0;
  const cat = new Map<string, { count: number; nc: number; v: bigint }>();
  for (const k of ["commit", "best_case", "pipeline", "not_classifiable"]) cat.set(k, { count: 0, nc: 0, v: 0n });
  for (const o of open) {
    const v = vs.find((x) => x.opp_id === o.opp_id)!;
    const gbp = toGbp(o, s.fx);
    const c = cat.get(v.category)!; c.count++;
    if (gbp === null) {
      const e = notConv.get(o.currency) ?? { count: 0, native: 0n };
      e.count++; e.native += BigInt(o.amount_minor); notConv.set(o.currency, e); c.nc++;
      continue;
    }
    convertedOpen++;
    gross += gbp; c.v += gbp;
    wRep += weighted(gbp, STAGE_WEIGHT[o.stage]);
    wEv += weighted(gbp, weightOf(v.evidenced_stage));
  }
  const ncList = [...notConv.entries()].sort().map(([currency, e]) => ({ currency, count: e.count, native_minor: e.native.toString(), display: formatMinor(e.native, currency) }));
  const ncText = ncList.map((n) => `${n.count} in ${n.currency} (${n.display}, no imported rate)`);

  let won = 0n, wonCount = 0, wonUnverified = 0, wonNc = 0, wonInQ = 0;
  for (const o of s.opportunities.filter((x) => x.stage === "closed_won")) {
    const cd = parseDate(o.close_date)!;
    if (cd < q.start || cd > q.end) continue;
    wonInQ++;
    const v = vs.find((x) => x.opp_id === o.opp_id)!;
    if (v.category !== "closed_won") { wonUnverified++; continue; }
    const gbp = toGbp(o, s.fx);
    if (gbp === null) { wonNc++; continue; }
    won += gbp; wonCount++;
  }

  const classifiable = vs.filter((v) => (OPEN_STAGES as string[]).includes(v.reported_stage) && v.category !== "not_classifiable").length;
  const missCount = new Map<string, number>();
  for (const v of vs) for (const m of v.missing) missCount.set(m.label, (missCount.get(m.label) ?? 0) + 1);
  const catSum = [...cat.values()].reduce((a, c) => a + c.v, 0n);
  const label: Record<string, string> = { commit: "Commit (evidence-backed)", best_case: "Best case (evidence-backed)", pipeline: "Pipeline (evidence-backed)", not_classifiable: "Not classifiable" };
  const fxNote = s.fx.length
    ? `Converted at imported synthetic rates (GBP per unit): ${s.fx.map((f) => `${f.currency} ${f.gbp_per_unit}`).join(", ")}. Rates are inputs, not market data.`
    : "No FX rates imported: only GBP rows are converted.";
  return {
    as_of: s.as_of, quarter: q.label, reporting_currency: "GBP", fx: s.fx, fx_note: fxNote,
    gross_pipeline: { label: "Gross open pipeline", value: money(gross), numerator_count: convertedOpen, denominator_count: open.length, denominator: `${convertedOpen} of ${open.length} open opportunities converted to GBP`, excluded: ncText },
    weighted_reported: { label: "Weighted forecast, reported stages", value: money(wRep), numerator_count: convertedOpen, denominator_count: open.length, denominator: `Stage weight × amount over the same ${convertedOpen} of ${open.length} open opportunities`, excluded: ncText },
    weighted_evidenced: { label: "Weighted forecast, evidenced stages", value: money(wEv), numerator_count: convertedOpen, denominator_count: open.length, denominator: `Weight of the highest stage the evidence supports, same ${convertedOpen} of ${open.length}`, excluded: ncText },
    closed_won: { label: `Closed won, ${q.label}`, value: money(won), numerator_count: wonCount, denominator_count: wonInQ, denominator: `${wonCount} of ${wonInQ} closed-won rows in ${q.label} counted`, excluded: [
      ...(wonUnverified ? [`${wonUnverified} without a contract reference (unverified)`] : []),
      ...(wonNc ? [`${wonNc} in a currency with no imported rate`] : []),
    ] },
    categories: ["commit", "best_case", "pipeline", "not_classifiable"].map((k) => ({ key: k, label: label[k], count: cat.get(k)!.count, not_converted: cat.get(k)!.nc, value: money(cat.get(k)!.v) })),
    not_converted: ncList,
    coverage: {
      classifiable, open: open.length, pct: open.length ? `${Math.round((classifiable / open.length) * 100)}%` : "n/a",
      rep_ahead: vs.filter((v) => v.rep_ahead).length, stale_next_step: vs.filter((v) => (OPEN_STAGES as string[]).includes(v.reported_stage) && v.next_step.state !== "fresh").length,
      missing_by_requirement: [...missCount.entries()].map(([l, c]) => ({ label: l, count: c })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    },
    check: { ok: catSum === gross, detail: catSum === gross ? `Category totals sum to gross pipeline (${formatMinor(gross)}).` : `Category totals ${formatMinor(catSum)} differ from gross ${formatMinor(gross)}.` },
  };
}
