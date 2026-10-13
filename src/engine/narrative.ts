import { reconcile, views, formatMinor, toGbp } from "./reconcile";
import { stageLabel, type OppView } from "./gates";
import { OPEN_STAGES, type EngineOptions, type Snapshot } from "./types";

export interface NextAction { owner: string; opp_id: string; account: string; action: string; why: string; source_ref: string }
export interface Narrative {
  revision: number;
  as_of: string;
  fingerprint: string;
  title: string;
  paragraphs: string[];
  actions: NextAction[];
  caveats: string[];
}

function actionFor(v: OppView): { action: string; why: string } | null {
  const m = v.missing[0];
  if (v.category === "closed_won_unverified") return { action: "Attach the signed contract reference", why: "Closed won without a contract reference is excluded from closed-won." };
  if (!m && v.next_step.state === "fresh") return null;
  if (!m) return { action: "Set a dated next step with the buyer", why: v.next_step.reasons.join(" ") };
  const map: Record<string, string> = {
    identify_pain: "Record the buyer's stated pain with a source reference",
    metrics: "Record the agreed success metric with a source reference",
    champion: "Name and evidence the champion",
    decision_criteria: "Record the buyer's written decision criteria",
    economic_buyer: "Identify the economic buyer with a source reference",
    decision_process: "Map the decision process with a source reference",
    eb_engaged: "Log a dated economic-buyer meeting with a source reference",
    eb_recent: "Re-engage the economic buyer (last engagement older than 30 days)",
    pricing_known: "Record the discount and pricing-approval status",
    pricing_approved: "Get pricing approval for the discount on file",
    next_step_fresh: "Set a dated next step with the buyer",
    close_date_current: "Re-date the close (current date has passed)",
  };
  return { action: map[m.key] ?? `Resolve: ${m.label}`, why: `${m.label}: ${m.detail}.${v.missing.length > 1 ? ` ${v.missing.length - 1} more gap(s).` : ""}` };
}

/** Built only from the snapshot passed in. Nothing from older revisions or outside the import is read. */
export function buildNarrative(s: Snapshot, opts: EngineOptions = {}): Narrative {
  const r = reconcile(s, opts);
  const vs = views(s, opts);
  const open = vs.filter((v) => (OPEN_STAGES as string[]).includes(v.reported_stage));
  const commit = r.categories.find((c) => c.key === "commit")!;
  const best = r.categories.find((c) => c.key === "best_case")!;
  const nc = r.categories.find((c) => c.key === "not_classifiable")!;
  const paragraphs: string[] = [];
  paragraphs.push(`As of ${r.as_of}, synthetic revision ${s.revision} holds ${s.opportunities.length} opportunities, ${open.length} open. ${r.gross_pipeline.label} is ${r.gross_pipeline.value.display} (${r.gross_pipeline.denominator}).${r.not_converted.length ? ` Not converted: ${r.gross_pipeline.excluded.join("; ")}.` : ""}`);
  paragraphs.push(`Evidence supports ${commit.count} commit deal${commit.count === 1 ? "" : "s"} worth ${commit.value.display} and ${best.count} best-case deal${best.count === 1 ? "" : "s"} worth ${best.value.display}. ${nc.count} of ${r.coverage.open} open deals (${nc.value.display} converted) cannot be classified because required evidence is missing, claimed without a source, or stale.`);
  paragraphs.push(`Weighted forecast is ${r.weighted_reported.value.display} on reported stages and ${r.weighted_evidenced.value.display} on evidenced stages, over the same ${r.weighted_reported.denominator_count ? `${r.weighted_reported.numerator_count} of ${r.weighted_reported.denominator_count}` : "0"} open deals. The gap is the part of the forecast that rests on stage labels rather than recorded evidence.`);
  paragraphs.push(`${r.closed_won.label}: ${r.closed_won.value.display} (${r.closed_won.denominator}${r.closed_won.excluded.length ? `; excluded: ${r.closed_won.excluded.join("; ")}` : ""}).`);
  if (r.coverage.rep_ahead || r.coverage.stale_next_step) paragraphs.push(`${r.coverage.rep_ahead} rep call${r.coverage.rep_ahead === 1 ? " is" : "s are"} ahead of the evidence, and ${r.coverage.stale_next_step} of ${r.coverage.open} open deals have a stale or missing next step.`);

  const ranked = [...vs].sort((a, b) => {
    const oa = s.opportunities.find((o) => o.opp_id === a.opp_id)!, ob = s.opportunities.find((o) => o.opp_id === b.opp_id)!;
    const ga = toGbp(oa, s.fx) ?? -1n, gb = toGbp(ob, s.fx) ?? -1n;
    return gb > ga ? 1 : gb < ga ? -1 : a.opp_id.localeCompare(b.opp_id);
  });
  const actions: NextAction[] = [];
  for (const v of ranked) {
    const a = actionFor(v);
    if (a && actions.length < 8) actions.push({ owner: v.owner, opp_id: v.opp_id, account: v.account, ...a, source_ref: v.source_ref });
  }
  const caveats = [
    "All opportunities, people, companies and amounts are synthetic.",
    "Stage weights are fixed assumptions, not measured conversion rates.",
    r.fx_note,
    "No CRM, ERP, email or finance system was read or written.",
    "Time saved and forecast-accuracy lift are not measured; there is no baseline.",
  ];
  return { revision: s.revision, as_of: s.as_of, fingerprint: s.fingerprint, title: `Board pipeline narrative, ${r.quarter}, revision ${s.revision} (synthetic)`, paragraphs, actions, caveats };
}

export function narrativeMarkdown(n: Narrative, currentRevision: number): string {
  const stale = n.revision !== currentRevision;
  const esc = (t: string) => t.replace(/[\\`*_[\]<>|#]/g, (c) => `\\${c}`);
  const lines = [`# ${esc(n.title)}`, ""];
  if (stale) lines.push(`> SUPERSEDED: built from revision ${n.revision}; current revision is ${currentRevision}. Do not circulate.`, "");
  lines.push(`As of ${n.as_of}. Import fingerprint ${n.fingerprint.slice(0, 12)}.`, "");
  for (const p of n.paragraphs) lines.push(esc(p), "");
  lines.push("## Named next actions", "");
  for (const a of n.actions) lines.push(`- **${esc(a.owner)}**, ${esc(a.opp_id)} ${esc(a.account)}: ${esc(a.action)}. ${esc(a.why)} (${esc(a.source_ref)})`);
  lines.push("", "## Caveats", "", ...n.caveats.map((c) => `- ${esc(c)}`), "", "Independent concept by Ayo Ahmed. Not affiliated with or endorsed by Light.");
  return lines.join("\n") + "\n";
}
export { stageLabel, formatMinor };
