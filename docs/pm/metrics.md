# Metrics with denominators and the adoption hypothesis

## Product metrics shown in the prototype (synthetic fixture, revision 1)
| Metric | Numerator | Denominator | Fixture value |
|---|---|---|---|
| Gross open pipeline (GBP) | Sum of open deals with a known rate | Open deals | £575,900.00 over 9 of 10 (1 CHF deal not converted) |
| Weighted forecast, reported stages | Σ stage weight × amount | Same 9 of 10 | £387,270.00 |
| Weighted forecast, evidenced stages | Σ weight of highest evidenced stage × amount | Same 9 of 10 | £304,290.00 |
| Closed won, Q4 2026 | Closed-won with a sourced contract reference | Closed-won rows in the quarter | £80,000.00, 1 of 2 counted |
| Classification coverage | Open deals with no blocking gap | Open deals | 5 of 10 (50%) |
| Rep calls ahead of evidence | Rep category above evidenced category | Open deals with a rep call | 5 |
| Stale or missing next step | Next step missing, past due, or no activity for more than 21 days | Open deals | 2 of 10 |

Stage weights (10/25/40/60/80%) are illustrative assumptions, not Light's or anyone's calibrated weights.

## Evaluation metrics
| Metric | Definition | Current result |
|---|---|---|
| Rule agreement | Rows where engine category and evidenced stage match hand-written labels / labelled rows | 13 / 13 |
| Eval pass rate | Passed cases / total cases | 31 / 31 |
| Broken-rule sensitivity | Cases that fail when `eb-named-counts-as-engaged` is on | 3 (CLS-SYN-1002, REC-4, REC-6) |

Rule agreement measures whether the code follows the written rules on synthetic rows. It is **not** forecast accuracy. Real forecast accuracy would need historical deals and their outcomes, which I do not have.

## Adoption hypothesis (baseline unknown)
> If forecast preparers can see, per deal, which stage evidence is missing and who owns the gap, then over a pilot quarter the share of open deals that are classifiable will rise and fewer board narratives will need correction after circulation.

| Measure | Numerator / denominator | Baseline | Target |
|---|---|---|---|
| Weekly active preparers | Preparers who open the workbench in a week / named preparers | Unknown | Set after baseline |
| Classification coverage | Classifiable open deals / open deals | Unknown | Set after baseline |
| Gap closure | Named actions resolved within 7 days / named actions | Unknown | Set after baseline |
| Narrative corrections | Narratives corrected after circulation / narratives circulated | Unknown | Set after baseline |

I report no time saved, no lift and no improvement. There is no baseline, and a missing baseline is not turned into an impact figure.

## Guardrails
- Reps do not game it: watch for sources attached without substance. A sample audit of references is needed.
- Coverage should not go up just because deals are moved to earlier stages. Track stage regressions alongside it.
