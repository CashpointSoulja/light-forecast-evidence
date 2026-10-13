# Actual test results

Run on 2026-10-13 against a local `wrangler dev` (workerd with SQLite Durable Objects). The raw command output is in [`docs/test-output/`](../test-output/). Nothing here is hand-edited except that machine paths were replaced with `.`.

| Check | Command | Result | Raw output |
|---|---|---|---|
| Type check | `npm run typecheck` | exit 0 | [typecheck.txt](../test-output/typecheck.txt) |
| Unit + Worker API tests | `npm test` | **72 / 72 passed** (2 files) | [vitest.txt](../test-output/vitest.txt) |
| Evaluation | `npm run eval` | **31 / 31 passed**, exit 0. Rule agreement 13/13. Coverage 5/10 open deals classifiable | [eval.txt](../test-output/eval.txt) |
| Broken rule | `npm run eval:broken` | **28 / 31, red**, exit 1. Fails CLS-SYN-1002, REC-4, REC-6 as designed | [eval-broken.txt](../test-output/eval-broken.txt) |
| Browser checks | `node scripts/ui-check.mjs` | **38 / 38 passed** | [ui-check.txt](../test-output/ui-check.txt) |
| Fixture sync | `npm run check:fixtures` | in sync | [fixtures.txt](../test-output/fixtures.txt) |
| Workers dry run | `npm run check:deploy` | bundle built, bindings `WORKSPACE` (Durable Object) and `ASSETS`. Not deployed | [wrangler-dry-run.txt](../test-output/wrangler-dry-run.txt) |

## What the tests cover
- **Happy path:** clean import, exact source references, unique row hashes, preview saves nothing, commit creates exactly one revision.
- **Rejected inputs:** 10 file-level errors (missing as-of, unclosed quote, missing or extra columns, no rows, non-GBP reporting, duplicate or zero FX, impossible date, unknown directive), size and row limits, 14 row-level errors, duplicate IDs blocking the whole file, plus API refusals (non-JSON, cross-origin, no idempotency key, bad JSON, wrong method).
- **Hostile content:** formula prefixes, bidi override and control characters rejected; markup kept as inert text (no `<img>` element created in the browser); prompt-like notes cannot change a category; Markdown export escaped.
- **Staleness:** EB engagement at 30 and 31 days, next-step date passed, 22 days without activity, close date passed, missing next step.
- **Concurrent actions:** two commits racing on one revision (one 200, one 409), ten parallel edits (one wins), idempotent replay, key reuse with a different body refused, and two browser tabs where the stale tab is told to reload.
- **Visitor isolation:** separate cookies see separate workspaces, a forged cookie gets a fresh workspace, reset affects only the caller.
- **Recovery:** restore an older revision as a new revision, retry after a lost response does not double-apply, a failed command leaves state untouched, and bounds are pruned (30 revisions, 20 narratives).
- **UI:** 1366px and 390px screenshots of every screen, axe WCAG 2.1 AA (including colour contrast) on each screen at both widths, no horizontal overflow, modal dialogs (Escape cancels, focus returns), a keyboard-only path from the skip link to commit, and a visible focus ring.

## Screenshots
See [`docs/screenshots/`](../screenshots/).

## Not tested
- Real deployment on Cloudflare (dry run only, by instruction).
- Real browsers other than Chromium; screen readers beyond axe's automated rules.
- Any real CRM data or real forecast accuracy.
