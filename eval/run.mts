import { runEval } from "../src/eval/cases";

const broken = process.argv.includes("--broken-rule");
const r = await runEval({ brokenRule: broken ? "eb-named-counts-as-engaged" : null });
console.log(`Forecast Evidence Workbench evaluation (synthetic fixtures)${broken ? " with deliberately broken rule eb-named-counts-as-engaged" : ""}`);
for (const c of r.cases) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.id.padEnd(14)} ${c.description}`);
  if (!c.pass) console.log(`      expected ${c.expected}\n      actual   ${c.actual}`);
}
console.log(`\n${r.passed}/${r.total} passed. Classification agreement ${r.classification_accuracy.correct}/${r.classification_accuracy.total} (${r.classification_accuracy.pct}). Coverage ${r.coverage.classifiable}/${r.coverage.open} open deals classifiable (${r.coverage.pct}).`);
console.log(r.note);
process.exit(r.passed === r.total ? 0 : 1);
