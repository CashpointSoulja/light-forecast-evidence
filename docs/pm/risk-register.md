# Risk register

| ID | Risk | Likelihood | Impact | Mitigation in prototype | Open |
|---|---|---|---|---|---|
| K1 | Mistaken for an official Light product | Medium | High | Persistent non-affiliation banner, Ayo authorship first, logo small and contextual, [PUBLICATION.md](../../PUBLICATION.md) | Owner review before sharing |
| K2 | Synthetic data mistaken for real | Low | High | "(synthetic)" on every account, SYN- IDs, banner, caveats in narratives | — |
| K3 | Formula or markup injection through CSV export | Medium | High | Formula prefixes and control characters rejected, Markdown escaped, DOM text only, CSP | — |
| K4 | Concurrent edits overwrite each other | Medium | Medium | `expected_revision` → 409, idempotency keys | — |
| K5 | Stale narrative circulated | Medium | High | Superseded lock and watermark | Only within the tool, not on copies already sent |
| K6 | Unbounded storage on a free plan | Low | Medium | Limits on rows, revisions, narratives, commands, events | — |
| K7 | Rules seen as a reporting penalty by sales | Medium | Medium | Shows the specific blocking gap and its owner | H5 untested |
| K8 | Assumed thresholds wrong for the business | High | Medium | Documented as assumptions | Calibrate in discovery |
| K9 | Public demo abused | Low | Low | Per-visitor isolation, size limits, no outbound calls | Rate limiting at the platform level |
| K10 | Overclaiming impact | Medium | High | No lift or time-saved claims, [claims ledger](claims-and-caveats.md) | — |
