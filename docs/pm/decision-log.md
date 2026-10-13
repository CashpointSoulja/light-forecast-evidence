# Decision log

| # | Date | Decision | Reason |
|---|---|---|---|
| D1 | 2026-10-13 | Research the role and brand before any code, and commit design.md and the visual guide first | Brief order. Keeps the build grounded in public sources |
| D2 | 2026-10-13 | Primary buttons in dark ink, not Light orange | White on #FF4800 measured about 3.40:1, below AA for body text |
| D3 | 2026-10-13 | Lora headlines, Rethink Sans body, both self-hosted OFL | Close to the live site's feel without copying proprietary fonts |
| D4 | 2026-10-13 | Deterministic rules, no model calls | Auditable, free, and notes cannot steer classification |
| D5 | 2026-10-13 | A file with any rejected row cannot be committed | Atomic import. No partial totals |
| D6 | 2026-10-13 | "Not classifiable" is a forecast category | Missing evidence must not be guessed into commit or best case |
| D7 | 2026-10-13 | Show weighted forecast twice: reported stage and evidenced stage | The gap between them is the point of the tool |
| D8 | 2026-10-13 | Currencies without a rate are counted, not converted | Explicit denominator, no guessed FX |
| D9 | 2026-10-13 | Closed won needs a sourced contract reference | Otherwise it is unverified and excluded from the total |
| D10 | 2026-10-13 | One SQLite Durable Object per visitor cookie | Isolation and transactions on Workers Free without accounts |
| D11 | 2026-10-13 | `expected_revision` and `Idempotency-Key` on every command | Safe retries and no lost updates |
| D12 | 2026-10-13 | Superseded narratives are locked and watermarked, not deleted | History stays visible, but cannot be circulated as current |
| D13 | 2026-10-13 | Broken-rule mode `eb-named-counts-as-engaged` | A plausible real-world shortcut, and it shows the evaluation catches it |
| D14 | 2026-10-13 | No inline styles; strict CSP | Hostile-content defence in depth |
| D15 | 2026-10-13 | Prepare Workers Free config and dry run only, no deploy | Owner instruction |
| D16 | 2026-10-13 | Ship the grounded walkthrough script and a deterministic recording flow, not a final video | Owner records the public demo after audit and deployment |
