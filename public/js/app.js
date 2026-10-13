// Forecast Evidence Workbench UI. All data rendered with textContent; no innerHTML.
const $ = (s) => document.querySelector(s);
const STAGE = { discovery: "Discovery", qualification: "Qualification", solution: "Solution", proposal: "Proposal", negotiation: "Negotiation", closed_won: "Closed won", closed_lost: "Closed lost" };
const CAT = { commit: "Commit", best_case: "Best case", pipeline: "Pipeline", not_classifiable: "Not classifiable", closed_won: "Closed won", closed_won_unverified: "Closed won, unverified", closed_lost: "Closed lost" };
const STATE = { evidenced: "Evidenced", claimed: "Claimed, no ref", unknown: "Unknown", stale: "Stale", missing: "Missing", pending: "Pending", not_required: "Not required", fresh: "Fresh" };
const REP = { commit: "Commit", best_case: "Best case", pipeline: "Pipeline", omitted: "Omitted" };
const FIELD = { identify_pain: "Identify pain", metrics: "Metrics", champion: "Champion", decision_criteria: "Decision criteria", economic_buyer: "Economic buyer identified", decision_process: "Decision process", eb_engaged_date: "Economic buyer engagement (dated)", pricing_approval: "Pricing approval", contract_ref: "Contract reference", next_step: "Next step (dated)" };
const REQ_FIELD = { eb_engaged: "eb_engaged_date", eb_recent: "eb_engaged_date", pricing_known: "pricing_approval", pricing_approved: "pricing_approval", next_step_fresh: "next_step", contract_ref: "contract_ref" };

let state = null, preview = null, gateFilter = "all", evalReport = null;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const chip = (cls, text) => h("span", { class: `chip s-${cls}`, text });
const fill = (el, ...kids) => { el.replaceChildren(...kids.flat().filter(Boolean)); return el; };

function notice(msg, ok = false) {
  const n = $("#notice");
  n.textContent = msg; n.className = ok ? "notice ok" : "notice"; n.hidden = false;
}
function clearNotice() { $("#notice").hidden = true; }

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("json") ? await res.json() : await res.text();
  return { status: res.status, body, replay: res.headers.get("idempotent-replay") === "true" };
}

/** Commands carry the revision the user was looking at, plus an idempotency key reused if the request is retried. */
async function command(path, payload, key = crypto.randomUUID()) {
  const send = () => api(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ expected_revision: state.revision, ...payload }) });
  let r;
  try { r = await send(); } catch { r = await send(); }
  if (r.status === 409) {
    await load();
    notice(`${r.body.message} The view has been reloaded at revision ${state.revision}; nothing was changed.`);
  }
  return r;
}

async function load() {
  const r = await api("/api/state");
  state = r.body;
  render();
}

function route() {
  const tab = (location.hash || "#import").slice(1);
  const valid = ["import", "gates", "reconcile", "narrative", "evaluation", "about"];
  const t = valid.includes(tab) ? tab : "import";
  document.querySelectorAll("[data-view]").forEach((s) => { s.hidden = s.dataset.view !== t; });
  document.querySelectorAll(".tabs a").forEach((a) => { if (a.dataset.tab === t) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
}

function render() {
  if (!state) return;
  $("#rev").textContent = `Revision ${state.revision}`;
  $("#asof").textContent = state.snapshot ? `As of ${state.snapshot.as_of} · ${state.snapshot.count} synthetic opportunities · ${state.snapshot.source_name}` : "No import yet";
  renderGates(); renderReconcile(); renderNarratives(); renderAbout();
}

/* ---------- Import ---------- */
async function loadSample(name) {
  const r = await api(`/api/samples/${name}`);
  $("#csv").value = r.body;
  $("#csv").dataset.source = `${name}.csv`;
  await doPreview();
}

async function doPreview() {
  clearNotice();
  const csv = $("#csv").value;
  const r = await api("/api/imports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv, source_name: $("#csv").dataset.source || "pasted-export.csv" }) });
  preview = r.status === 200 ? r.body : null;
  renderPreview(r);
}

function renderPreview(r) {
  const box = $("#preview");
  if (r.status !== 200) return fill(box, h("h3", { text: "Preview" }), h("p", { class: "error", text: r.body.message || "Preview failed." }));
  const p = r.body;
  const kids = [h("h3", { text: "Preview" }), h("p", { class: "muted", text: p.message })];
  kids.push(h("dl", { class: "kv" },
    h("dt", { text: "Source" }), h("dd", { text: p.source_name }),
    h("dt", { text: "As of" }), h("dd", { text: p.as_of || "Unknown" }),
    h("dt", { text: "Rows" }), h("dd", { text: `${p.counts.valid} valid, ${p.counts.rejected} rejected, of ${p.counts.total}` }),
    h("dt", { text: "FX inputs" }), h("dd", { text: p.fx.length ? p.fx.map((f) => `${f.currency} ${f.gbp_per_unit}`).join(", ") : "None (non-GBP rows will not convert)" }),
    h("dt", { text: "Fingerprint" }), h("dd", { class: "ref", text: p.fingerprint.slice(0, 16) }),
  ));
  if (p.file_errors.length) kids.push(h("div", { class: "error", role: "alert" }, h("strong", { text: "File rejected before row checks:" }), h("ul", {}, p.file_errors.map((e) => h("li", { text: e })))));
  if (p.rows.length) {
    kids.push(h("div", { class: "tablewrap", tabindex: "0", role: "region", "aria-label": "Table (scrolls sideways on small screens)" }, h("table", { class: "stack" },
      h("caption", { class: "muted", text: "Each row and its exact source reference" }),
      h("thead", {}, h("tr", {}, h("th", { text: "Line" }), h("th", { text: "Opportunity" }), h("th", { text: "Status" }), h("th", { text: "Source ref" }))),
      h("tbody", {}, p.rows.map((row) => h("tr", {},
        h("td", { "data-label": "Line", text: String(row.line) }),
        h("td", { "data-label": "Opportunity" }, h("div", { text: `${row.opp_id || "(no id)"} ${row.account}` }), row.reasons.length ? h("ul", { class: "reasons" }, row.reasons.map((x) => h("li", { text: x }))) : null),
        h("td", { "data-label": "Status" }, chip(row.status, row.status === "valid" ? "Valid" : "Rejected")),
        h("td", { "data-label": "Source ref", class: "ref", text: `${row.source_ref} · ${row.row_hash}` }),
      ))),
    )));
  }
  const btn = h("button", { type: "button", class: "btn primary", id: "commit-btn", onclick: openCommit }, "Commit import…");
  if (!p.committable) { btn.disabled = true; kids.push(h("p", { class: "help", text: "Commit is disabled: the whole file is held until every row is valid." })); }
  kids.push(h("div", { class: "row gap mt16" }, btn));
  fill(box, kids);
}

function openCommit() {
  if (!preview?.committable) return;
  fill($("#commit-body"), h("dl", { class: "kv" },
    h("dt", { text: "Rows" }), h("dd", { text: `${preview.counts.valid} synthetic opportunities` }),
    h("dt", { text: "Against" }), h("dd", { text: `Revision ${state.revision} → ${state.revision + 1}` }),
    h("dt", { text: "Changes" }), h("dd", { text: `${preview.diff.added} new, ${preview.diff.replaced} replaced, ${preview.diff.removed} removed` }),
  ));
  const d = $("#commit-dialog");
  d.returnValue = "";
  d.showModal();
}

async function doCommit() {
  const r = await command("/api/imports/commit", { preview_id: preview.preview_id });
  if (r.status === 200) {
    preview = null;
    fill($("#preview"), h("h3", { text: "Preview" }), h("p", { class: "muted", text: "Committed. Preview another file to replace it." }));
    await load();
    notice(`Imported ${r.body.imported} synthetic opportunities as revision ${r.body.revision}.`, true);
    location.hash = "#gates";
  } else if (r.status !== 409) notice(r.body.message || "Commit failed. Nothing was saved.");
}

/* ---------- Gates ---------- */
function renderGates() {
  const box = $("#gates");
  if (!state.views.length) return fill(box, h("div", { class: "panel cream" }, h("p", { text: "No opportunities yet. Import the clean sample first." })));
  const filters = [["all", "All"], ["not_classifiable", "Not classifiable"], ["rep_ahead", "Rep call ahead"], ["stale", "Stale next step"], ["classified", "Classified"]];
  const match = (v) => gateFilter === "all" || (gateFilter === "not_classifiable" && v.category === "not_classifiable") || (gateFilter === "rep_ahead" && v.rep_ahead) || (gateFilter === "stale" && v.flags.includes("Stale next step")) || (gateFilter === "classified" && ["commit", "best_case", "pipeline"].includes(v.category));
  const shown = state.views.filter(match);
  fill(box,
    h("div", { class: "filters", role: "group", "aria-label": "Filter opportunities" }, filters.map(([k, l]) => h("button", { type: "button", class: "btn ghost small", "aria-pressed": String(gateFilter === k), onclick: () => { gateFilter = k; renderGates(); } }, `${l} · ${state.views.filter((v) => { const o = gateFilter; gateFilter = k; const m = match(v); gateFilter = o; return m; }).length}`))),
    h("p", { class: "muted", text: `Showing ${shown.length} of ${state.views.length}.` }),
    h("div", { class: "cards" }, shown.map(oppCard)),
  );
}

function oppCard(v) {
  const o = state.opportunities.find((x) => x.opp_id === v.opp_id);
  const money = `${o.currency} ${(Number(BigInt(o.amount_minor) / 100n)).toLocaleString("en-GB")}`;
  return h("article", { class: "opp", "aria-labelledby": `t-${v.opp_id}` },
    h("header", {},
      h("div", {}, h("h3", { id: `t-${v.opp_id}`, text: `${v.opp_id} · ${v.account}` }), h("div", { class: "meta", text: `${v.owner} · ${money} · close ${o.close_date}` })),
      h("div", { class: "row gap" }, chip(v.category, CAT[v.category])),
    ),
    h("div", { class: "meta mt6" }, `Reported stage ${STAGE[v.reported_stage]} · evidence supports ${v.evidenced_stage ? STAGE[v.evidenced_stage] : "no stage"} · rep call ${v.rep_category ? REP[v.rep_category] : "none"}`),
    v.flags.length ? h("div", { class: "flags" }, v.flags.map((f) => chip("warn", f))) : null,
    v.missing.length ? h("p", { class: "blocking" }, h("strong", { text: "Blocking: " }), v.missing.map((m) => `${m.label} (${m.detail})`).join("; ")) : null,
    h("details", {}, h("summary", { text: `Requirements for ${STAGE[v.reported_stage]} (${v.requirements.length - v.missing.length} of ${v.requirements.length} met)` }),
      h("ul", { class: "reqs" }, v.requirements.map((r) => h("li", {}, chip(r.ok ? (r.state === "not_required" ? "not_required" : r.state === "stale" ? "evidenced" : r.state) : r.state, r.ok ? (r.state === "stale" ? "On record" : STATE[r.state]) : STATE[r.state]), h("span", { text: r.label }), h("span", { class: "stage", text: STAGE[r.stage] })))),
      v.next_step.reasons.length ? h("p", { class: "help", text: `Next step: ${v.next_step.reasons.join(" ")}` }) : null,
      h("p", { class: "ref", text: `Source: ${v.source_ref} · row ${o.row_hash}` }),
      o.evidence_log.length ? h("ul", { class: "help" }, o.evidence_log.map((e) => h("li", { text: `Revision ${e.revision}: ${FIELD[e.field] || e.field} → ${e.value}` }))) : null,
    ),
    ["closed_lost"].includes(v.category) ? null : h("div", { class: "row gap mt12" }, h("button", { type: "button", class: "btn ghost small", onclick: () => openEvidence(v) }, `Add evidence for ${v.opp_id}`)),
  );
}

let evTarget = null, evKey = null;
function openEvidence(v) {
  evTarget = v; evKey = crypto.randomUUID();
  $("#evidence-for").textContent = `${v.opp_id} · ${v.account} (synthetic)`;
  const sel = $("#ev-field");
  const firstMissing = v.missing[0] ? (REQ_FIELD[v.missing[0].key] || v.missing[0].key) : "metrics";
  fill(sel, Object.entries(FIELD).map(([k, l]) => h("option", { value: k, selected: k === firstMissing }, l)));
  $("#ev-text").value = ""; $("#ev-ref").value = ""; $("#ev-date").value = state.snapshot.as_of;
  $("#ev-error").hidden = true;
  syncEvFields();
  $("#evidence-dialog").showModal();
}
function syncEvFields() {
  const f = $("#ev-field").value;
  $("#ev-date-wrap").hidden = !(f === "eb_engaged_date" || f === "next_step");
  $("#ev-text-wrap").hidden = f === "eb_engaged_date" || f === "pricing_approval";
}
async function saveEvidence(e) {
  e.preventDefault();
  if (!$("#ev-ref").value.trim()) {
    const err = $("#ev-error"); err.textContent = "Add a synthetic source reference. Evidence without one is not accepted."; err.hidden = false;
    $("#ev-ref").focus();
    return;
  }
  const r = await command(`/api/opportunities/${encodeURIComponent(evTarget.opp_id)}/evidence`, { field: $("#ev-field").value, text: $("#ev-text").value, date: $("#ev-date").value, ref: $("#ev-ref").value }, evKey);
  if (r.status === 200) {
    $("#evidence-dialog").close("saved");
    await load();
    notice(`Saved as revision ${r.body.revision}. Narratives from earlier revisions are now superseded.`, true);
  } else if (r.status === 409) {
    $("#evidence-dialog").close("stale");
  } else {
    const err = $("#ev-error"); err.textContent = r.body.message || "Not saved."; err.hidden = false;
    evKey = crypto.randomUUID();
  }
}

/* ---------- Reconcile ---------- */
function metric(m, dark = false) {
  return h("div", { class: `metric${dark ? " dark" : ""}` },
    h("div", { class: "label", text: m.label }), h("div", { class: "value", text: m.value.display }),
    h("p", { class: "denom", text: m.denominator }),
    m.excluded.length ? h("p", { class: "excl", text: `Excluded: ${m.excluded.join("; ")}` }) : null);
}
function renderReconcile() {
  const box = $("#reconcile"); const r = state.reconciliation;
  if (!r) return fill(box, h("div", { class: "panel cream" }, h("p", { text: "Nothing to reconcile yet." })));
  fill(box,
    h("div", { class: "grid3" }, metric(r.gross_pipeline, true), metric(r.weighted_reported), metric(r.weighted_evidenced), metric(r.closed_won)),
    h("div", { class: "panel" }, h("h3", { text: "Forecast categories from evidence" }),
      h("div", { class: "tablewrap", tabindex: "0", role: "region", "aria-label": "Table (scrolls sideways on small screens)" }, h("table", { class: "stack" },
        h("thead", {}, h("tr", {}, h("th", { text: "Category" }), h("th", { class: "num", text: "Open deals" }), h("th", { class: "num", text: "Not converted" }), h("th", { class: "num", text: "GBP (converted only)" }))),
        h("tbody", {}, r.categories.map((c) => h("tr", {}, h("td", { "data-label": "Category" }, chip(c.key, c.label)), h("td", { class: "num", "data-label": "Open deals", text: String(c.count) }), h("td", { class: "num", "data-label": "Not converted", text: String(c.not_converted) }), h("td", { class: "num", "data-label": "GBP", text: c.value.display })))),
      )),
      h("p", { class: r.check.ok ? "help" : "error", text: r.check.detail })),
    h("div", { class: "grid2" },
      h("div", { class: "panel" }, h("h3", { text: "Currency assumptions" }), h("p", { text: r.fx_note }),
        r.not_converted.length ? h("p", { class: "error", text: `Not converted: ${r.not_converted.map((n) => `${n.count} deal(s) in ${n.currency}, ${n.display}`).join("; ")}. They are counted, not guessed.` }) : h("p", { class: "help", text: "Every open deal converted." })),
      h("div", { class: "panel" }, h("h3", { text: "Classification coverage" }),
        h("p", {}, h("strong", { text: `${r.coverage.classifiable} of ${r.coverage.open}` }), ` open deals classifiable (${r.coverage.pct}).`),
        h("p", { text: `${r.coverage.rep_ahead} rep calls ahead of evidence. ${r.coverage.stale_next_step} of ${r.coverage.open} open deals with a stale or missing next step.` }),
        r.coverage.missing_by_requirement.length ? h("ul", {}, r.coverage.missing_by_requirement.map((m) => h("li", { text: `${m.label}: ${m.count}` }))) : null)),
  );
}

/* ---------- Narrative ---------- */
function renderNarratives() {
  const box = $("#narrative");
  if (!state.snapshot) return fill(box, h("div", { class: "panel cream" }, h("p", { text: "Import opportunities before generating a narrative." })));
  const gen = h("button", { type: "button", class: "btn primary", id: "gen-btn", onclick: generate }, `Generate from revision ${state.revision}`);
  fill(box, h("div", { class: "row gap mb16" }, gen),
    state.narratives.length ? state.narratives.map(narrCard) : h("p", { class: "muted", text: "No narratives yet." }));
}
function narrCard(x) {
  const n = x.narrative;
  const ready = h("button", { type: "button", class: "btn ghost small", onclick: () => boardReady(x) }, x.board_ready ? "Board-ready (synthetic)" : "Mark board-ready");
  if (x.superseded || x.board_ready) ready.disabled = true;
  return h("article", { class: `panel narr${x.superseded ? " superseded" : ""}`, "aria-label": n.title },
    x.superseded ? h("p", { class: "banner", text: `Superseded: built from revision ${x.revision}, workspace is at revision ${state.revision}. Do not circulate.` }) : null,
    h("h3", { text: n.title }),
    h("p", { class: "ref", text: `As of ${n.as_of} · fingerprint ${n.fingerprint.slice(0, 12)} · created ${x.created_at.slice(0, 19).replace("T", " ")} UTC` }),
    n.paragraphs.map((p) => h("p", { class: "np", text: p })),
    h("h4", { text: "Named next actions" }),
    h("ol", { class: "actions" }, n.actions.map((a) => h("li", {}, h("strong", { text: a.owner }), ` · ${a.opp_id} ${a.account}: ${a.action}. `, h("span", { class: "muted", text: a.why })))),
    h("details", {}, h("summary", { text: "Caveats" }), h("ul", {}, n.caveats.map((c) => h("li", { text: c })))),
    h("div", { class: "row gap mt12" }, ready, h("a", { class: "btn ghost small", href: `/api/narratives/${x.id}/markdown`, download: "" }, "Download Markdown")),
  );
}
async function generate() {
  const r = await command("/api/narratives", {});
  if (r.status === 200) { await load(); notice(`Narrative built from revision ${r.body.revision}.`, true); }
  else if (r.status !== 409) notice(r.body.message);
}
async function boardReady(x) {
  const r = await command(`/api/narratives/${x.id}/board-ready`, {});
  if (r.status === 200) { await load(); notice("Marked board-ready. This is a label in this synthetic workspace; nothing was sent.", true); }
  else if (r.status !== 409) notice(r.body.message);
}

/* ---------- Evaluation ---------- */
async function runEval(broken) {
  const r = await api(`/api/eval${broken ? "?broken=1" : ""}`);
  evalReport = r.body; renderEval();
}
function renderEval() {
  const e = evalReport; const box = $("#evaluation");
  const failed = e.total - e.passed;
  fill(box,
    h("div", { class: "evalsum" },
      chip(failed ? "fail" : "pass", failed ? `${failed} of ${e.total} failed` : `${e.passed} of ${e.total} passed`),
      h("span", { text: e.broken_rule ? `Broken rule active: ${e.broken_rule}` : "Rules as designed" }),
      h("span", { text: `Classification agreement ${e.classification_accuracy.correct} of ${e.classification_accuracy.total} (${e.classification_accuracy.pct})` }),
      h("span", { text: `Coverage ${e.coverage.classifiable} of ${e.coverage.open} open deals classifiable (${e.coverage.pct})` })),
    h("p", { class: "help", text: e.note }),
    h("div", { class: "tablewrap", tabindex: "0", role: "region", "aria-label": "Table (scrolls sideways on small screens)" }, h("table", { class: "stack" },
      h("thead", {}, h("tr", {}, h("th", { text: "Case" }), h("th", { text: "Check" }), h("th", { text: "Expected" }), h("th", { text: "Actual" }), h("th", { text: "Result" }))),
      h("tbody", {}, e.cases.map((c) => h("tr", {}, h("td", { "data-label": "Case", class: "ref", text: c.id }), h("td", { "data-label": "Check", text: c.description }), h("td", { "data-label": "Expected", class: "ref", text: c.expected }), h("td", { "data-label": "Actual", class: "ref", text: c.actual }), h("td", { "data-label": "Result" }, chip(c.pass ? "pass" : "fail", c.pass ? "Pass" : "Fail"))))),
    )),
  );
}

/* ---------- About ---------- */
function renderAbout() {
  const b = state.bounds;
  $("#bounds").textContent = `${b.maxRows} rows and ${Math.round(b.maxBytes / 1024)} KB per file, ${b.previews} open previews, ${b.revisions} revisions, ${b.narratives} narratives, ${b.commands} remembered command keys`;
  fill($("#history"), h("h3", { text: "Revision history" }),
    state.revisions.length ? h("ul", {}, state.revisions.map((r) => h("li", {}, `Revision ${r.rev} (${r.kind}): ${r.summary} `,
      r.rev !== state.revision ? h("button", { type: "button", class: "btn ghost small", onclick: () => restore(r.rev) }, `Restore revision ${r.rev}`) : h("span", { class: "muted", text: "(current)" })))) : h("p", { class: "muted", text: "No revisions." }));
}
async function restore(rev) {
  const r = await command(`/api/revisions/${rev}/restore`, {});
  if (r.status === 200) { await load(); notice(`Restored revision ${rev} as new revision ${r.body.revision}.`, true); }
  else if (r.status !== 409) notice(r.body.message);
}

/* ---------- Wiring ---------- */
document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", () => loadSample(b.dataset.sample)));
$("#preview-btn").addEventListener("click", doPreview);
$("#file").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > 256 * 1024) { notice(`${f.name} is ${f.size} bytes; the limit is 262144.`); return; }
  $("#csv").value = await f.text(); $("#csv").dataset.source = f.name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 80);
  await doPreview();
});
$("#csv").addEventListener("input", () => { delete $("#csv").dataset.source; });
$("#commit-dialog").addEventListener("close", () => { if ($("#commit-dialog").returnValue === "confirm") doCommit(); else $("#commit-btn")?.focus(); });
$("#ev-field").addEventListener("change", syncEvFields);
$("#evidence-form").addEventListener("submit", (e) => { if (e.submitter?.value === "save") saveEvidence(e); });
$("#eval-btn").addEventListener("click", () => runEval(false));
$("#eval-broken-btn").addEventListener("click", () => runEval(true));
$("#reset-btn").addEventListener("click", () => { $("#reset-dialog").returnValue = ""; $("#reset-dialog").showModal(); });
$("#reset-dialog").addEventListener("close", async () => {
  if ($("#reset-dialog").returnValue !== "confirm") return;
  const r = await command("/api/reset", { confirm: "RESET" });
  if (r.status === 200) { preview = null; await load(); notice("Workspace cleared for this browser.", true); location.hash = "#import"; }
});
window.addEventListener("hashchange", () => { route(); $("#main").focus({ preventScroll: true }); });
window.addEventListener("focus", () => load());
route();
load();
