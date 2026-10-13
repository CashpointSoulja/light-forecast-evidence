# Trade-offs

| Decision | Chose | Gave up | Why |
|---|---|---|---|
| Rules versus model | Deterministic rules | Fuzzy reading of notes | Results can be audited and repeated, with no paid calls. Notes cannot change a category (prompt-like text is inert) |
| Whole-file rejection | One bad row blocks the commit | Partial imports | A board total built from part of a file is worse than no total |
| Not classifiable as a category | Separate bucket | Cleaner-looking forecast | Unknown evidence stays unknown |
| Unconverted currencies | Counted, not converted | A single GBP total | No guessed rates |
| Revision-bound narratives | Superseded and locked | Editing an old narrative in place | Stops stale numbers from circulating |
| Durable Object per visitor | Strong isolation, SQLite transactions | Shared or team workspaces | Public demo with no accounts. Teams are a v2 item |
| CSV input | Portable, synthetic | Live CRM sync | No real system access is allowed or needed for the concept |
| Integer money (BigInt) | Exact sums | Simplicity | Totals have to reconcile exactly to the penny |
