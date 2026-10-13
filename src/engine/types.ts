export const STAGES = ["discovery", "qualification", "solution", "proposal", "negotiation", "closed_won", "closed_lost"] as const;
export type Stage = (typeof STAGES)[number];
export const OPEN_STAGES: Stage[] = ["discovery", "qualification", "solution", "proposal", "negotiation"];
export const STAGE_LABEL: Record<Stage, string> = {
  discovery: "Discovery", qualification: "Qualification", solution: "Solution", proposal: "Proposal",
  negotiation: "Negotiation", closed_won: "Closed won", closed_lost: "Closed lost",
};
/** Synthetic stage weights (percent). Shown in the UI; an assumption, not a measured conversion rate. */
export const STAGE_WEIGHT: Record<Stage, number> = {
  discovery: 10, qualification: 25, solution: 40, proposal: 60, negotiation: 80, closed_won: 100, closed_lost: 0,
};
export const REP_CATEGORIES = ["commit", "best_case", "pipeline", "omitted"] as const;
export type RepCategory = (typeof REP_CATEGORIES)[number];
export type Category = "commit" | "best_case" | "pipeline" | "not_classifiable" | "closed_won" | "closed_won_unverified" | "closed_lost";

export const COLUMNS = [
  "opp_id", "account", "owner", "stage", "rep_category", "amount", "currency", "close_date", "next_step",
  "next_step_date", "last_activity_date", "metrics", "economic_buyer", "decision_criteria", "decision_process",
  "identify_pain", "champion", "eb_engaged_date", "discount_pct", "pricing_approval", "contract_ref", "notes",
] as const;
export type Column = (typeof COLUMNS)[number];

export const MEDDIC_FIELDS = ["metrics", "economic_buyer", "decision_criteria", "decision_process", "identify_pain", "champion"] as const;
export type MeddicField = (typeof MEDDIC_FIELDS)[number];
export const MEDDIC_LABEL: Record<MeddicField, string> = {
  metrics: "Metrics", economic_buyer: "Economic buyer identified", decision_criteria: "Decision criteria",
  decision_process: "Decision process", identify_pain: "Identify pain", champion: "Champion",
};

/** A validated opportunity as stored in a revision. Amount is in minor units (pence/cents) as a decimal string. */
export interface Opportunity {
  opp_id: string;
  account: string;
  owner: string;
  stage: Stage;
  rep_category: RepCategory | null;
  amount_minor: string;
  currency: string;
  close_date: string;
  next_step: string;
  next_step_date: string | null;
  last_activity_date: string | null;
  metrics: string;
  economic_buyer: string;
  decision_criteria: string;
  decision_process: string;
  identify_pain: string;
  champion: string;
  eb_engaged_date: string;
  discount_pct: number | null;
  pricing_approval: string;
  contract_ref: string;
  notes: string;
  source_ref: string;
  row_hash: string;
  /** Evidence entered after import, newest last. */
  evidence_log: { field: string; value: string; ref: string; revision: number }[];
}

export interface FxRate { currency: string; gbp_per_unit: string; micro: number }

export interface Snapshot {
  revision: number;
  as_of: string;
  source_name: string;
  fingerprint: string;
  fx: FxRate[];
  opportunities: Opportunity[];
}

export type EvidenceState = "evidenced" | "claimed" | "unknown" | "stale" | "missing" | "pending" | "not_required" | "fresh";

export interface Requirement {
  key: string;
  label: string;
  stage: Stage;
  ok: boolean;
  state: EvidenceState;
  detail: string;
}

export interface EngineOptions { brokenRule?: "eb-named-counts-as-engaged" | null }
