# Actual test results

Run on 2026-10-13 on the `audit-fix` branch against a local `wrangler dev` (workerd with SQLite Durable Objects). The raw command output is in [`docs/test-output/`](../test-output/). Nothing here is hand-edited except that machine paths were replaced with `.`.

| Check | Command | Result | Raw output |
|---|---|---|---|
| Type check | `npm run typecheck` | exit 0 | [typecheck.txt](../test-output/typecheck.txt) |
| Unit + Worker API tests | `npm test` | **79 / 79 passed** (2 files) | [vitest.txt](../test-output/vitest.txt) |
| Evaluation | `npm run eval` | **31 / 31 passed**, exit 0. Rule agreement 13/13. Coverage 5/10 open deals classifiable | [eval.txt](../test-output/eval.txt) |
| Broken rule | `npm run eval:broken` | **28 / 31, red**, exit 1. Fails CLS-SYN-1002, REC-4, REC-6 as designed | [eval-broken.txt](../test-output/eval-broken.txt) |
| Browser checks | `node scripts/ui-check.mjs` | **43 / 43 passed** | [ui-check.txt](../test-output/ui-check.txt) |
| Fixture sync | `npm run check:fixtures` | in sync | [fixtures.txt](../test-output/fixtures.txt) |
| Workers dry run | `npm run check:deploy` | bundle built, 66.56 KiB upload, bindings `WORKSPACE` (Durable Object) and `ASSETS`. Not deployed | [wrangler-dry-run.txt](../test-output/wrangler-dry-run.txt) |
| New audit tests on pre-fix code | `npx vitest run test/api.test.ts` in a worktree of `main` (b288359) | **7 of the new tests fail** there, as they should: reset without `expected_revision` succeeded, revisions restarted at 0, an old receipt replayed, multibyte and invalid UTF-8 bodies were accepted | [pre-fix-new-tests.txt](../test-output/pre-fix-new-tests.txt) |
| Oversize stream transport probe | `node` probe of 5 MB and 20 MB streamed bodies against local `wrangler dev`, before and after the drain fix | Before: the Worker answered 413 for 11 of 20 requests but the client received 413 only 3 times (4 local-proxy 500s "Network connection lost", 13 resets). After: 60 of 60 got the application's 413. Beyond the 16 MiB drain bound, 6 of 10 got the 413 and the rest lost the connection, as designed | [body-limit-transport.txt](../test-output/body-limit-transport.txt) |

## What the tests cover
- **Happy path:** clean import, exact source references, unique row hashes, preview saves nothing, commit creates exactly one revision.
- **Rejected inputs:** 10 file-level errors (missing as-of, unclosed quote, missing or extra columns, no rows, non-GBP reporting, duplicate or zero FX, impossible date, unknown directive), size and row limits, 14 row-level errors, duplicate IDs blocking the whole file, plus API refusals (non-JSON, cross-origin, no idempotency key, bad JSON, wrong method).
- **Hostile content:** formula prefixes, bidi override and control characters rejected; markup kept as inert text (no `<img>` element created in the browser); prompt-like notes cannot change a category; Markdown export escaped.
- **Staleness:** EB engagement at 30 and 31 days, next-step date passed, 22 days without activity, close date passed, missing next step.
- **Concurrent actions:** two commits racing on one revision (one 200, one 409), ten parallel edits (one wins), idempotent replay, key reuse with a different body refused, and two browser tabs where the stale tab is told to reload, including a stale tab trying to clear the workspace after a reset and reimport.
- **Visitor isolation:** separate cookies see separate workspaces, a forged cookie gets a fresh workspace, reset affects only the caller.
- **Reset safety:** reset without `expected_revision` is refused (400), a stale reset is refused (409) and keeps the newer work, a reset is itself a new empty revision, and revision numbers keep rising across three reset and reimport rounds (1 to 6). After a reset and reimport, stale evidence, import commit, board-ready, restore and reset commands from before the reset all fail and leave state byte-identical. A pre-reset preview cannot be committed even at the current revision (410). Replaying an Idempotency-Key recorded before the reset returns 409 `receipt_from_cleared_workspace` with no revision in the body, so it cannot claim a mutation in the new workspace; a retried reset in the same epoch still replays its own receipt.
- **Request body limits:** the 600,000-byte limit is counted in UTF-8 bytes while the body streams in, without a content-length. A body of exactly 600,000 bytes made of two-byte characters is accepted; 600,001 bytes is refused (413); 350,000 `é` characters (under the limit in characters, 700,010 bytes) is refused; a declared oversize body and a 5 MB stream (1 KiB and 64 KiB chunks) are refused with the application's own 413 JSON five times each, and the same visitor keeps working afterwards. Refused bytes are read and discarded (never stored) up to 16 MiB, so the 413 reaches the client. Answering mid-upload made the local proxy drop the connection and report a 500; that was a transport failure, not an application response. Invalid UTF-8 is refused (400 `bad_encoding`), and valid multibyte account names import normally.
- **Recovery:** restore an older revision as a new revision, retry after a lost response does not double-apply, a failed command leaves state untouched, and bounds are pruned (30 revisions, 20 narratives).
- **UI:** 1366px and 390px screenshots of every screen (including the cleared workspace at a nonzero revision), axe WCAG 2.1 AA (including colour contrast) on each screen at both widths, no horizontal overflow, modal dialogs (Escape cancels, focus returns), a keyboard-only path from the skip link to commit, and a visible focus ring.

## Screenshots
See [`docs/screenshots/`](../screenshots/).

## Not tested
- Real deployment on Cloudflare (dry run only, by instruction).
- Final public-demo video: not produced here. The script and deterministic flow are in [`video/`](../../video/README.md). A local rehearsal confirmed about 96 s of narration and no silence of 0.6 s or more.
- Real browsers other than Chromium; screen readers beyond axe's automated rules.
- Any real CRM data or real forecast accuracy.
