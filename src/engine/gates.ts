import { parseDate } from "./dates";
import { extractRef } from "./validate";
import {
  MEDDIC_LABEL, OPEN_STAGES, STAGE_LABEL, STAGE_WEIGHT,
  type Category, type EngineOptions, type EvidenceState, type MeddicField, type Opportunity, type Requirement, type Stage,
} from "./types";

export const EB_FRESH_DAYS = 30;
export const ACTIVITY_STALE_DAYS = 21;
export const DISCOUNT_APPROVAL_THRESHOLD = 15;

export interface OppView {
  opp_id: string;
  account: string;
  owner: string;
  source_ref: string;
  reported_stage: Stage;
  evidenced_stage: Stage | null;
  category: Category;
  rep_category: string | null;
  rep_ahead: boolean;
  requirements: Requirement[];
  missing: Requirement[];
  fields: Record<string, { state: EvidenceState; ref: string | null; text: string }>;
  next_step: { state: "fresh" | "stale" | "unknown"; reasons: string[] };
  pricing: EvidenceState;
  eb_engagement: EvidenceState;
  flags: string[];
}

export function evidenceState(cell: string): { state: EvidenceState; ref: string | null } {
  if (!cell.trim()) return { state: "unknown", ref: null };
  const ref = extractRef(cell);
  return ref ? { state: "evidenced", ref } : { state: "claimed", ref: null };
}

function ebEngagement(o: Opportunity, asOfDay: number, opts: EngineOptions): { state: EvidenceState; ref: string | null; days: number | null } {
  if (opts.brokenRule === "eb-named-counts-as-engaged") {
    // Deliberately broken rule for the eval demo: a named economic buyer is treated as fresh engagement.
    if (evidenceState(o.economic_buyer).state === "evidenced") return { state: "evidenced", ref: extractRef(o.economic_buyer), days: 0 };
  }
  const cell = o.eb_engaged_date.trim();
  if (!cell) return { state: "unknown", ref: null, days: null };
  const day = parseDate(cell.split(/\s+/)[0]);
  const ref = extractRef(cell);
  if (day === null) return { state: "unknown", ref: null, days: null };
  if (!ref) return { state: "claimed", ref: null, days: asOfDay - day };
  const days = asOfDay - day;
  return { state: days > EB_FRESH_DAYS ? "stale" : "evidenced", ref, days };
}

function pricingState(o: Opportunity): { state: EvidenceState; ref: string | null } {
  if (o.discount_pct === null) return { state: "unknown", ref: null };
  if (o.discount_pct <= DISCOUNT_APPROVAL_THRESHOLD) return { state: "not_required", ref: null };
  const pa = o.pricing_approval.trim().toLowerCase();
  if (!pa) return { state: "missing", ref: null };
  if (pa.startsWith("pending")) return { state: "pending", ref: null };
  const ref = extractRef(o.pricing_approval);
  return ref ? { state: "evidenced", ref } : { state: "claimed", ref: null };
}

function nextStepState(o: Opportunity, asOfDay: number): { state: "fresh" | "stale" | "unknown"; reasons: string[] } {
  const reasons: string[] = [];
  if (!o.next_step.trim()) return { state: "unknown", reasons: ["No next step recorded."] };
  const nsd = o.next_step_date ? parseDate(o.next_step_date) : null;
  if (nsd === null) reasons.push("Next step has no date.");
  else if (nsd < asOfDay) reasons.push(`Next step date ${o.next_step_date} has passed.`);
  const lad = o.last_activity_date ? parseDate(o.last_activity_date) : null;
  if (lad === null) reasons.push("No last activity date.");
  else if (asOfDay - lad > ACTIVITY_STALE_DAYS) reasons.push(`Last activity ${asOfDay - lad} days before as-of (limit ${ACTIVITY_STALE_DAYS}).`);
  return { state: reasons.length ? "stale" : "fresh", reasons };
}

const GATE_FIELDS: Record<Stage, MeddicField[]> = {
  discovery: ["identify_pain"], qualification: ["metrics", "champion"], solution: ["decision_criteria", "economic_buyer"],
  proposal: ["decision_process"], negotiation: [], closed_won: [], closed_lost: [],
};

const STATE_TEXT: Record<EvidenceState, string> = {
  evidenced: "Evidenced", claimed: "Claimed, no source ref", unknown: "Unknown", stale: "Stale", missing: "Missing",
  pending: "Pending", not_required: "Not required", fresh: "Fresh",
};

export function evaluateOpportunity(o: Opportunity, asOf: string, opts: EngineOptions = {}): OppView {
  const asOfDay = parseDate(asOf)!;
  const fields: OppView["fields"] = {};
  for (const f of Object.keys(MEDDIC_LABEL) as MeddicField[]) fields[f] = { ...evidenceState(o[f]), text: o[f] };
  const eb = ebEngagement(o, asOfDay, opts);
  const pr = pricingState(o);
  const ns = nextStepState(o, asOfDay);
  fields.eb_engaged_date = { state: eb.state, ref: eb.ref, text: o.eb_engaged_date };
  fields.pricing_approval = { state: pr.state, ref: pr.ref, text: o.pricing_approval };
  fields.contract_ref = { ...evidenceState(o.contract_ref), text: o.contract_ref };

  const reqs: Requirement[] = [];
  for (const stage of OPEN_STAGES) {
    for (const f of GATE_FIELDS[stage]) {
      const st = fields[f].state;
      reqs.push({ key: f, label: MEDDIC_LABEL[f], stage, ok: st === "evidenced", state: st, detail: STATE_TEXT[st] });
    }
    if (stage === "proposal") {
      const ebOk = eb.state === "evidenced" || eb.state === "stale";
      reqs.push({ key: "eb_engaged", label: "Economic buyer engagement on record", stage, ok: ebOk, state: eb.state, detail: eb.days !== null ? `${STATE_TEXT[eb.state]} (${eb.days} days before as-of)` : STATE_TEXT[eb.state] });
      const pKnown = pr.state === "evidenced" || pr.state === "not_required" || pr.state === "pending";
      reqs.push({ key: "pricing_known", label: "Pricing approval status known", stage, ok: pKnown, state: pr.state, detail: o.discount_pct === null ? "Discount unknown" : `${STATE_TEXT[pr.state]} (discount ${o.discount_pct}%)` });
    }
    if (stage === "negotiation") {
      reqs.push({ key: "eb_recent", label: `Economic buyer engaged within ${EB_FRESH_DAYS} days`, stage, ok: eb.state === "evidenced", state: eb.state, detail: eb.days !== null ? `${eb.days} days before as-of` : STATE_TEXT[eb.state] });
      const pOk = pr.state === "evidenced" || pr.state === "not_required";
      reqs.push({ key: "pricing_approved", label: `Pricing approved (discount > ${DISCOUNT_APPROVAL_THRESHOLD}%)`, stage, ok: pOk, state: pr.state, detail: o.discount_pct === null ? "Discount unknown" : `${STATE_TEXT[pr.state]} (discount ${o.discount_pct}%)` });
      reqs.push({ key: "next_step_fresh", label: "Fresh, dated next step", stage, ok: ns.state === "fresh", state: ns.state === "fresh" ? "fresh" : ns.state, detail: ns.reasons.join(" ") || "Fresh" });
      const cd = parseDate(o.close_date)!;
      reqs.push({ key: "close_date_current", label: "Close date not before as-of", stage, ok: cd >= asOfDay, state: cd >= asOfDay ? "fresh" : "stale", detail: cd >= asOfDay ? o.close_date : `${o.close_date} has passed` });
    }
  }

  const flags: string[] = [];
  if (ns.state !== "fresh" && (OPEN_STAGES as string[]).includes(o.stage)) flags.push("Stale next step");
  let evidenced_stage: Stage | null = null;
  let category: Category;
  let applicable: Requirement[] = [];
  let missing: Requirement[] = [];
  let rep_ahead = false;

  if (o.stage === "closed_lost") {
    category = "closed_lost"; evidenced_stage = "closed_lost";
  } else if (o.stage === "closed_won") {
    const ok = fields.contract_ref.state === "evidenced";
    applicable = [{ key: "contract_ref", label: "Contract reference", stage: "closed_won", ok, state: fields.contract_ref.state, detail: STATE_TEXT[fields.contract_ref.state] }];
    missing = applicable.filter((r) => !r.ok);
    category = ok ? "closed_won" : "closed_won_unverified";
    evidenced_stage = ok ? "closed_won" : null;
    if (!ok) flags.push("Closed won without contract reference");
  } else {
    const reportedIdx = OPEN_STAGES.indexOf(o.stage);
    for (let s = 0; s <= reportedIdx; s++) {
      const stageReqs = reqs.filter((r) => OPEN_STAGES.indexOf(r.stage) <= s);
      if (stageReqs.every((r) => r.ok)) evidenced_stage = OPEN_STAGES[s]; else break;
    }
    applicable = reqs.filter((r) => OPEN_STAGES.indexOf(r.stage) <= reportedIdx);
    missing = applicable.filter((r) => !r.ok);
    if (missing.length) category = "not_classifiable";
    else category = o.stage === "negotiation" ? "commit" : o.stage === "proposal" ? "best_case" : "pipeline";
    const rank: Record<string, number> = { commit: 3, best_case: 2, pipeline: 1, omitted: 0 };
    if (o.rep_category && o.rep_category !== "omitted") {
      rep_ahead = category === "not_classifiable" || rank[o.rep_category] > rank[category];
    }
    if (rep_ahead) flags.push("Rep call ahead of evidence");
    if (parseDate(o.close_date)! < asOfDay) flags.push("Close date has passed");
  }

  return {
    opp_id: o.opp_id, account: o.account, owner: o.owner, source_ref: o.source_ref, reported_stage: o.stage,
    evidenced_stage, category, rep_category: o.rep_category, rep_ahead, requirements: applicable, missing,
    fields, next_step: ns, pricing: pr.state, eb_engagement: eb.state, flags,
  };
}

export function weightOf(stage: Stage | null): number { return stage ? STAGE_WEIGHT[stage] : 0; }
export function stageLabel(stage: Stage | null): string { return stage ? STAGE_LABEL[stage] : "None"; }
