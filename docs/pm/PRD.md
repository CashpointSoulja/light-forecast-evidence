# PRD: Forecast Evidence Workbench

Independent concept by Ayo Ahmed. Not an official Light product, not affiliated with or endorsed by Light. All data is synthetic.

## Problem I am designing for
I wrote this around the public AI & Revenue Operations Lead role at Light ([posting](https://jobs.ashbyhq.com/light-inc/c8970651-2f80-442d-9c5a-348c845cb116)). The posting asks for forecasting, board-pack preparation, MEDDIC discipline, stage gates, economic-buyer engagement and pricing approvals. I do not know how Light forecasts today, and I make no claim about any internal problem. The general problem I am testing is a common one in B2B sales: a forecast number gets repeated in a board pack after the evidence behind it has changed, or was never recorded.

## Who it is for
- **Primary:** the person who prepares the weekly forecast and the board pipeline narrative (RevOps lead).
- **Secondary:** sales leaders who review deals, and deal owners who get named next actions.
- **Not for:** finance close, revenue recognition, or ERP accounting. The workbench reports pipeline. It does not book revenue.

## Goals
1. A forecast category is only shown as confident when the evidence for the reported stage exists and has a source reference.
2. Every total says what it counts and what it leaves out (explicit denominators).
3. A board narrative is tied to one revision. Once a newer revision exists it cannot be circulated as current.
4. Next actions name an owner and point to the source row.

## Non-goals
No CRM access (HubSpot or other), no ERP, no email, no scheduling, no model calls, no time-saved or forecast-lift claims.

## Workflow and requirements
| # | Requirement | How the prototype meets it |
|---|---|---|
| R1 | Import synthetic opportunities with exact source references | Every valid row gets `source_ref = <file>#row=<line>` and a 12-character row hash |
| R2 | One atomic preview/commit | Preview stores nothing in the dataset. Commit writes one revision in one transaction. A file with any rejected row cannot be committed |
| R3 | Reject malformed or hostile input | Exact columns, strict dates, integer money, no formula prefixes, no bidi or control characters, 256 KB / 300 rows / 600 chars per cell |
| R4 | Evidence-based stage gates | Cumulative MEDDIC fields, economic buyer identified and engaged (dated, sourced, within 30 days at Negotiation), pricing state, fresh next step, current close date |
| R5 | Missing fields block confident classification | A deal that fails any gate for its reported stage is "Not classifiable" and lists what is blocking |
| R6 | Reconcile with denominators | Gross pipeline, weighted forecast (reported vs evidenced stage), closed won this quarter, category totals that sum to gross, currencies without a rate counted but not converted |
| R7 | A revision invalidates older narratives | Narratives carry their revision. Older ones show as superseded, are struck through, cannot be marked board-ready, and their Markdown export is stamped SUPERSEDED |
| R8 | Narrative and named actions from current state only | Built from the current snapshot only, with no free-text generation and no model |
| R9 | Accuracy and coverage evaluation | 31 expected/actual cases, plus a broken-rule mode that turns red |
| R10 | Adoption hypothesis | Stated with an unknown baseline. See [metrics.md](metrics.md) |
| R11 | Visitor isolation, revision checks, idempotency, bounded state, recovery | One SQLite Durable Object per visitor cookie, `expected_revision` on every command, `Idempotency-Key`, pruning limits, restore and reset |

## Success criteria for the prototype
These are about whether the prototype behaves correctly. They say nothing about business impact: the automated suite passes, the broken rule fails exactly the cases it should, and the UI checks pass at 1366px and 390px. Actual results are in [test-results.md](test-results.md).

## What would have to be true for a real version
See [assumptions.md](assumptions.md) and [discovery-hypotheses.md](discovery-hypotheses.md). Before any build, I would want discovery with the people who prepare and consume the forecast.
