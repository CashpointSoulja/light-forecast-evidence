# V2 roadmap (conditional on discovery)

1. **Read-only CRM connector** (sandbox first). Map real fields and keep the same atomic preview/commit. No writes.
2. **Team workspaces** with sign-in, roles (preparer, reviewer, owner) and an audit trail per user.
3. **Configurable gates:** thresholds (EB freshness, discount limit, staleness) set by the team and versioned with each revision.
4. **Weekly diff:** what changed between revisions, and which categories moved and why.
5. **Calibrated weights** from historical outcomes, with the accuracy method documented and backtested.
6. **Finance-approved FX source** in place of rates supplied with the file.
7. **Action follow-through:** owners mark gaps resolved with a source, and the system measures gap-closure rate against a baseline.
8. **Agent-assisted evidence capture** (optional, later): suggest a source for a gap from meeting notes, always as a proposal a human confirms, never as an automatic category change.
