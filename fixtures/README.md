# Synthetic fixtures

Every row, company, person, amount, reference and FX rate here is invented for this independent concept by Ayo Ahmed. None comes from Light, its customers or any CRM. `[ref:SYN-…]` tags are synthetic source references, not links to real documents.

- `pipeline-q4.csv`: 13 opportunities, as of 2026-10-12, with EUR and USD rates and one CHF deal with no rate.
- `hostile.csv`: markup, prompt-like text, formula cells, a bidi override, bad numbers, an impossible date and a duplicate id. The import is rejected as a whole.
- `malformed.csv`: no `#as_of` and an unclosed quote. Rejected before row checks.
