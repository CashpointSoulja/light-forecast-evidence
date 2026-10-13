// Browser checks against the running Worker: desktop and 390px screenshots, keyboard path, axe (incl. contrast), dialogs.
// Usage: BASE=http://127.0.0.1:8787 CHROME=/path/to/chrome node scripts/ui-check.mjs
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const base = process.env.BASE || "http://127.0.0.1:8787";
const out = "docs/screenshots";
mkdirSync(out, { recursive: true });
const axeSrc = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`); };
const b = await chromium.launch({ executablePath: process.env.CHROME });

async function axe(p, label) {
  if (!(await p.evaluate(() => !!window.axe))) await p.evaluate(axeSrc);
  const r = await p.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] }));
  check(`axe ${label}`, r.violations.length === 0, r.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ") || `${r.passes.length} rules passed`);
}

for (const [vp, w, hgt] of [["desktop-1366", 1366, 900], ["mobile-390", 390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: hgt } });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 120)));
  await p.goto(base + "/#import");
  await p.waitForSelector("#rev");
  const overflow = async () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await p.click("text=Hostile sample"); await p.waitForSelector(".s-rejected");
  await p.screenshot({ path: `${out}/${vp}-import-hostile.png` });
  check(`${vp} hostile file commit disabled`, await p.isDisabled("#commit-btn"));
  check(`${vp} markup rendered as text`, (await p.locator("img[src=x]").count()) === 0);
  await p.click("text=Clean sample (13 rows)"); await p.waitForSelector("#commit-btn:not([disabled])");
  await p.screenshot({ path: `${out}/${vp}-import-preview.png` });
  await axe(p, `${vp} import`);
  // Dialog: opens modal, Escape cancels and returns focus, confirm commits.
  await p.click("#commit-btn");
  check(`${vp} commit dialog modal`, await p.evaluate(() => document.querySelector("#commit-dialog").open && document.querySelector("#commit-dialog").matches(":modal")));
  await p.screenshot({ path: `${out}/${vp}-commit-dialog.png` });
  await p.keyboard.press("Escape");
  check(`${vp} Escape closes dialog without commit`, !(await p.evaluate(() => document.querySelector("#commit-dialog").open)) && (await p.textContent("#rev")) === "Revision 0");
  check(`${vp} focus returns to commit button`, await p.evaluate(() => document.activeElement?.id === "commit-btn"));
  await p.click("#commit-btn"); await p.click("#commit-confirm");
  await p.waitForSelector(".opp");
  check(`${vp} commit creates revision 1`, (await p.textContent("#rev")) === "Revision 1");
  await p.screenshot({ path: `${out}/${vp}-gates.png` });
  await p.click("text=Add evidence for SYN-1002");
  await p.fill("#ev-ref", "");
  await p.screenshot({ path: `${out}/${vp}-evidence-dialog.png` });
  await p.click("#ev-save");
  const refused = await p.waitForSelector("#ev-error:not([hidden])", { timeout: 3000 }).then(() => true, () => false);
  check(`${vp} evidence without ref refused in dialog`, refused && (await p.textContent("#rev")) === "Revision 1");
  await p.fill("#ev-date", "2026-10-08"); await p.fill("#ev-ref", "SYN-B1002B"); await p.click("#ev-save");
  await p.waitForFunction(() => document.querySelector("#rev").textContent === "Revision 2");
  check(`${vp} evidence saved as revision 2`, true);
  await axe(p, `${vp} gates`);
  await p.goto(base + "/#reconcile"); await p.waitForSelector(".metric");
  await p.screenshot({ path: `${out}/${vp}-reconcile.png`, fullPage: true });
  await axe(p, `${vp} reconcile`);
  check(`${vp} no horizontal overflow on reconcile`, (await overflow()) <= 0, `${await overflow()}px`);
  await p.goto(base + "/#narrative"); await p.click("#gen-btn"); await p.waitForSelector(".narr");
  // Make the first narrative stale with a restore, then confirm it is superseded and locked.
  await p.goto(base + "/#about"); await p.click("text=Restore revision 1"); await p.waitForFunction(() => document.querySelector("#rev").textContent === "Revision 3");
  await p.goto(base + "/#narrative"); await p.waitForSelector(".narr.superseded");
  check(`${vp} older narrative superseded and locked`, await p.isDisabled(".narr.superseded button"));
  await p.click("#gen-btn"); await p.waitForSelector(".narr:not(.superseded)");
  await p.screenshot({ path: `${out}/${vp}-narrative.png`, fullPage: true });
  await axe(p, `${vp} narrative`);
  await p.goto(base + "/#evaluation"); await p.click("#eval-broken-btn"); await p.waitForSelector(".evalsum .s-fail");
  await p.screenshot({ path: `${out}/${vp}-eval-broken.png` });
  await p.click("#eval-btn"); await p.waitForSelector(".evalsum .s-pass");
  await p.screenshot({ path: `${out}/${vp}-eval-pass.png` });
  await axe(p, `${vp} evaluation`);
  check(`${vp} no page or console errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// Keyboard-only path in a fresh visitor: skip link, tabs, sample, preview, commit dialog.
{
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(base + "/");
  await p.waitForSelector("#rev");
  await p.keyboard.press("Tab");
  check("keyboard: first Tab reaches skip link", await p.evaluate(() => document.activeElement?.classList.contains("skip")));
  const seen = [];
  for (let i = 0; i < 12; i++) { await p.keyboard.press("Tab"); seen.push(await p.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 30))); }
  check("keyboard: tabs and sample buttons reachable", seen.includes("2. Stage gates") && seen.includes("Clean sample (13 rows)"), seen.join(" → "));
  await p.focus("text=Clean sample (13 rows)");
  await p.keyboard.press("Enter"); await p.waitForSelector("#commit-btn:not([disabled])");
  await p.focus("#commit-btn"); await p.keyboard.press("Enter");
  check("keyboard: dialog focus moves inside", await p.evaluate(() => document.querySelector("#commit-dialog").contains(document.activeElement)));
  const ring = await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  await p.screenshot({ path: `${out}/keyboard-focus-dialog.png` });
  check("keyboard: visible focus ring", ring !== "none", ring);
  await p.focus("#commit-confirm"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.querySelector("#rev").textContent === "Revision 1");
  check("keyboard: commit by Enter", true);
  await ctx.close();
}

// Two tabs, one visitor: the stale tab gets a 409 notice and reloads instead of overwriting.
{
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  const a = await ctx.newPage(); await a.goto(base + "/#import"); await a.click("text=Clean sample (13 rows)"); await a.click("#commit-btn"); await a.click("#commit-confirm"); await a.waitForSelector(".opp");
  const bTab = await ctx.newPage(); await bTab.goto(base + "/#narrative"); await bTab.waitForSelector("#gen-btn");
  await a.goto(base + "/#gates"); await a.click("text=Add evidence for SYN-1004"); await a.fill("#ev-text", "CFO then board"); await a.fill("#ev-ref", "SYN-P1004B"); await a.click("#ev-save");
  await a.waitForFunction(() => document.querySelector("#rev").textContent === "Revision 2");
  await bTab.evaluate(() => window.dispatchEvent(new Event("blur")));
  await bTab.click("#gen-btn");
  await bTab.waitForSelector("#notice:not([hidden])");
  const msg = await bTab.textContent("#notice");
  await bTab.screenshot({ path: `${out}/concurrency-409-notice.png` });
  check("two tabs: stale tab told to reload, nothing changed", /revision 1; the workspace is now at revision 2/.test(msg), msg.slice(0, 120));
  await ctx.close();
}
await b.close();
writeFileSync("docs/ui-check-results.json", JSON.stringify({ base: "local wrangler dev", results }, null, 2) + "\n");
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} UI checks passed`);
process.exit(failed ? 1 : 0);
