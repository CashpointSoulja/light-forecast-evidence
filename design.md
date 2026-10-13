# design.md: Forecast Evidence Workbench

*An independent concept by Ayo Ahmed. Not an official Light product, and not affiliated with or endorsed by Light. All data is synthetic.*

This file is committed before any app code. It fixes the product shape, the rules and the visual language. The visual guide is `docs/visual-guide.html`, rendered to `docs/visual-guide.png`.

## 1. What it is
A forecast-inspection workbench for a RevOps lead preparing the weekly forecast call and the commercial board pack. It takes a synthetic CRM opportunity export and does five things:
1. **Atomic import.** Preview first, then one commit. Every row keeps its exact source reference (file, row number, row hash), and one bad row blocks the whole commit.
2. **Evidence-based stage gates.** For each opportunity it checks the MEDDIC fields, economic buyer engagement, next-step freshness and pricing approval. A missing field is *Unknown*, never assumed.
3. **Forecast classification.** Commit / Best case / Pipeline / Closed won / Closed lost, or *Not classifiable* when required evidence is missing. A rep's own call is shown beside the evidence call and never overrides it.
4. **Reconciliation.** Gross pipeline, weighted forecast (reported-stage vs evidenced-stage), closed-won, and FX assumptions to GBP. Every figure shows its denominator. Rows with no FX rate are excluded and counted, never converted at 1:1.
5. **Board narrative and named next actions.** Built only from the current revision. Any new revision marks every older narrative *Superseded*, and a superseded narrative can't be marked board-ready.

An Evaluation view runs labelled golden cases (expected vs actual) and shows evidence coverage with explicit denominators. A deliberately broken rule can be switched on to show the eval turning red. The adoption hypothesis is shown as TO TEST, with an unknown baseline.

**Out of scope, by design:** ERP accounting, journal entries, real HubSpot access, live email, outbound messages, model calls, and any time-saved or lift figure.

## 2. Rules (the engine contract)
- **Stage ladder and weights** (synthetic assumption, editable only in code, shown in UI): Discovery 10%, Qualification 25%, Solution 40%, Proposal 60%, Negotiation 80%, Closed won 100%, Closed lost 0%.
- **Gate requirements, cumulative:**
  - Discovery: Identify pain.
  - Qualification: + Metrics, + Champion.
  - Solution: + Decision criteria, + Economic buyer identified.
  - Proposal: + Decision process (all six MEDDIC fields now evidenced), + Economic buyer engagement evidenced (dated, with a ref), + Pricing state known (approved, not required, or pending).
  - Negotiation: + Economic buyer engaged within 30 days of as-of, + Pricing approved or not required (discount ≤ 15%), + Fresh next step, + Close date not before as-of.
  - Closed won: a contract reference with a ref. Without one, the row is *Closed won, unverified* and is excluded from the closed-won total (counted).
- **Evidence format:** a MEDDIC cell counts as evidenced only when it has text plus a source reference `[ref:SYN-…]`. Text without a ref is *Claimed, no evidence*. A blank cell is *Unknown*.
- **Stale next step:** a blank next-step date, a next-step date before the as-of date, or a last activity more than 21 days before as-of.
- **Evidenced stage:** the highest stage whose cumulative gate is fully met. **Weighted (evidenced)** uses that stage's weight; **Weighted (reported)** uses the rep's stage. The gap is shown.
- **Classification:** an open opportunity is classified only if the gate for its *reported* stage passes: Negotiation → `Commit`, Proposal → `Best case`, Discovery/Qualification/Solution → `Pipeline`. If any requirement for the reported stage is missing, claimed or unknown, it is `Not classifiable`, with the missing items listed and "evidence supports: <stage>" shown. A rep category above the evidence category (or any rep category on a non-classifiable deal) is flagged *Rep call ahead of evidence*. A stale next step is flagged at every stage.
- **Currency:** the reporting currency is GBP. FX rates are an explicit, labelled assumption imported with the file (`#fx,EUR,0.86`). A currency with no rate gives *Not converted* and is excluded from totals, with a count.
- **Revision:** each successful commit or evidence update increments the workspace revision. Commands carry `expected_revision`, and a mismatch returns 409. Commands carry an `Idempotency-Key`, and a replay returns the original result.
- **Bounds:** 256 KB per file, 300 rows, 600 characters per cell, 5 open previews, 30 stored revisions, 20 narratives. Older items are pruned oldest-first.
- **Hostile content:** cells starting with `=`, `+`, `@`, tab or CR (and `-` not followed by a digit) are rejected as formula-like. All rendering uses `textContent`. Instruction-like text in notes is inert data, and tests prove it can't change a classification.

## 3. Architecture
- Cloudflare Worker (`src/worker.ts`), plus one SQLite-backed Durable Object per visitor (`Workspace`, `new_sqlite_classes`, available on Workers Free). The visitor id is a random 128-bit HttpOnly cookie, and the Durable Object is addressed by `idFromName(visitorId)`, so visitors never share state.
- A pure TypeScript engine (`src/engine/*`) shared by the Worker, the unit tests and `eval/run.ts`. There is one implementation of every rule.
- Static UI (`public/`): vanilla HTML/CSS/ES modules, no framework, no third-party runtime calls.

## 4. Brand inspection (light.inc, 2026-10-13)
Measured from computed styles and pixel samples of the live site at 1366 px and 390 px, light and dark scheme, plus the official brand package README.

| Token | Live site | Brand package | This concept |
|---|---|---|---|
| Ink | `#1F2022` (body), `#121314` (dark bg) | `#171717` | `#1F2022` |
| Base / cream | hero panel `#FFEDE5` (pixel sampled) | Warm cream `#FFEDE5` | `#FFEDE5` panels |
| Accent | `--lava: #FF4800` (CTA fill) | Vermilion `#F5410F` | `#FF4800` fills only; `#B83300` when used as text |
| Headline type | Lora 400, tight tracking (-1%) | Hedvig Letters Serif | Lora 400 (matches live pixels); both are OFL |
| UI type | Rethink Sans 400/500, 17 px body | Rethink Sans | Rethink Sans 400/500/600 |
| Radius | panels 24 px, cards 12–16 px, pills 999 px | n/a | same |
| Muted text | `#4D4D4D`, `#86868B` | n/a | `#5C5D60` (`#86868B` is 3.62:1 on white, too low for small text) |

Composition cues borrowed (not copied): a dark announcement strip above the header (used here for the **synthetic data** label); a centred pill nav; a split hero with one cream panel and one dark panel; uppercase tracked eyebrow labels; serif headlines over sans UI. **Not** borrowed: Light's 3D ledger illustration, product screens, photography, copy or customer data.

**Deliberate deviation:** Light's orange CTA uses white text on `#FF4800` (3.40:1), which fails WCAG AA for 14–16 px text. Here primary actions are ink pills with white text (16.3:1). Vermilion marks state and focus.

## 5. Marks and publication restrictions
- I use the official Light logo + wordmark file unmodified (`public/brand/`, from the brand package). It appears only as context ("Concept for [Light]"), right of and smaller than the product name and Ayo's byline, at ≥100 px wide with one grid square of clear space, on a background with contrast, as the package asks.
- The brand package says: "'Light' is a registered trademark… They don't grant a licence to use the Light name or mark to suggest a partnership, endorsement, or affiliation that isn't there." So every surface carries "Independent concept by Ayo Ahmed. Not affiliated with or endorsed by Light."
- Light's Terms forbid reverse engineering the Services. This concept never touches the Services, only public marketing pages.
- Fonts are self-hosted OFL files (Rethink Sans, Lora) with their licences in `public/fonts/`.
- Screenshots of light.inc are not committed (see `research/SOURCES.md`).
- If Light asks for the mark to be removed, delete `public/brand/` and the one `<img>` in the header. Nothing else depends on it.

## 6. Screens
1. **Header:** product name (serif) + "Independent concept by Ayo Ahmed", then a context chip "Concept for [Light logo]". The dark strip above reads "Synthetic data: fictional companies, people and amounts. No CRM, ERP or email connection."
2. **Status split hero:** a cream panel (revision, as-of date, source file, narrative status) and a dark panel (gross pipeline, weighted evidenced vs reported, closed-won, each with its denominator).
3. **Pill nav:** Import · Stage gates · Reconcile · Board narrative · Evaluation · Docs.
4. **Import:** sample selector (clean / with errors / hostile) or paste/upload, a preview table (row, source ref, status, reasons), Commit (confirm dialog). Stale preview → conflict dialog.
5. **Stage gates:** a table on desktop, cards at ≤720 px. Gate chips use a text label + glyph (✓ Evidenced, ! Missing, ◷ Stale, ? Unknown, ~ Claimed), never colour alone. A row opens the evidence dialog: source ref, every field with its ref, and a "Record evidence" form (synthetic, needs a ref).
6. **Reconcile:** totals with denominators, a row ledger (imported = open + won + lost; converted vs not), and the FX assumption table.
7. **Board narrative:** Generate (from current revision), a list of narratives with Current/Superseded badges, named next actions (owner, opportunity, action, due), Mark board-ready (blocked when superseded), and Copy as Markdown.
8. **Evaluation:** golden-case table (expected vs actual, pass/fail), a coverage panel, a broken-rule toggle, and the adoption hypothesis card (TO TEST, baseline unknown).
9. **Docs:** links to the PM package.

## 7. Accessibility
Native `<dialog>` with focus moved in and returned on close, Esc closes. Visible 3 px vermilion focus ring with offset. Every interactive element is reachable by Tab. Status is never conveyed by colour alone. Tables have `<th scope>`. Text contrast ≥ 4.5:1 everywhere (pairs listed in `public/css/tokens.css`). The layout is checked at 1366 px and 390 px.
