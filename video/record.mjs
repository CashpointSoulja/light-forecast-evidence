// Records the real app (BASE) with a visible pointer, paced by the narration lengths in script.json.
// Frames are JPEG screenshots at 1280x720 CSS px, DPR 1.5 (1920x1080), each with its capture time.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
const base = process.env.BASE || "http://127.0.0.1:8787";
const SRC = process.env.VIDEO_SRC || "video/build";
const script = JSON.parse(readFileSync(`${SRC}/script.json`, "utf8"));
const dur = Object.fromEntries(script.map((s) => [s.id, s.dur]));
rmSync(`${SRC}/frames`, { recursive: true, force: true });
mkdirSync(`${SRC}/frames`, { recursive: true });

const b = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    document.documentElement.style.scrollBehavior = "auto";
    const d = document.createElement("div");
    Object.assign(d.style, { position: "fixed", left: "0", top: "0", width: "18px", height: "18px", marginLeft: "-9px", marginTop: "-9px", borderRadius: "50%", background: "rgba(255,72,0,.85)", border: "2px solid #fff", boxShadow: "0 0 0 1px #1F2022", zIndex: "2147483647", pointerEvents: "none", transform: "translate(640px,360px)", transition: "background .1s" });
    d.id = "__pointer";
    document.body.append(d);
    const top = () => { const m = document.querySelector("dialog[open]"); if (m && d.parentNode !== m) m.append(d); else if (!m && d.parentNode !== document.body) document.body.append(d); };
    addEventListener("mousemove", (e) => { top(); d.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
    addEventListener("mousedown", () => { d.style.background = "rgba(255,214,0,.95)"; }, true);
    addEventListener("mouseup", () => { d.style.background = "rgba(255,72,0,.85)"; }, true);
    new MutationObserver(top).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
  });
});
const p = await ctx.newPage();
await p.goto(base + "/#import");
await p.waitForSelector("#rev");
let mx = 640, my = 360;
await p.mouse.move(mx, my);

const frames = []; const scenes = []; let running = true; let n = 0; let paused = false;
const loop = (async () => {
  while (running) {
    if (paused) { await new Promise((r) => setTimeout(r, 5)); continue; }
    const t = Date.now();
    const f = `${SRC}/frames/${String(n++).padStart(5, "0")}.jpg`;
    await p.screenshot({ path: f, type: "jpeg", quality: 88 });
    frames.push({ t, f });
  }
})();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
async function moveTo(x, y, ms = 650) {
  const steps = Math.max(8, Math.round(ms / 30)); const sx = mx, sy = my;
  for (let i = 1; i <= steps; i++) { const k = ease(i / steps); await p.mouse.move(sx + (x - sx) * k, sy + (y - sy) * k); await sleep(ms / steps); }
  mx = x; my = y;
}
async function box(sel) {
  const l = p.locator(sel).filter({ visible: true }).first();
  await l.waitFor({ state: "visible" });
  return l.boundingBox();
}
async function scrollTo(y, ms = 700) {
  const sy = await p.evaluate(() => scrollY);
  const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const ty = Math.max(0, Math.min(max, y)); const steps = 16;
  for (let i = 1; i <= steps; i++) { await p.evaluate((v) => scrollTo(0, v), sy + (ty - sy) * ease(i / steps)); await sleep(ms / steps); }
}
async function reveal(sel, frac = 0.45) {
  const bb = await box(sel);
  if (bb.y < 70 || bb.y + bb.height > 690) await scrollTo((await p.evaluate(() => scrollY)) + bb.y - 720 * frac);
  return box(sel);
}
async function point(sel, ms) { const bb = await reveal(sel); await moveTo(bb.x + Math.min(bb.width / 2, 120), bb.y + bb.height / 2, ms); return bb; }
async function click(sel, ms) { await point(sel, ms); await sleep(120); await p.mouse.down(); await sleep(90); await p.mouse.up(); await sleep(60); }
async function scene(id, fn) {
  const t0 = Date.now(); scenes.push({ id, t: t0 });
  await fn(t0);
  const end = t0 + dur[id] * 1000 + 250;
  const left = end - Date.now();
  if (left > 0) await sleep(left); else console.log(`scene ${id} overran VO by ${-left} ms`);
}
const at = async (t0, s) => { const w = t0 + s * 1000 - Date.now(); if (w > 0) await sleep(w); };

await scene("s01", async () => { await moveTo(330, 110, 1400); await sleep(1600); await moveTo(1180, 120, 1400); });
await scene("s02", async () => {
  await click("text=Hostile sample");
  await p.waitForSelector(".s-rejected");
  await sleep(500);
  await point(".s-rejected", 800);
});
await scene("s03", async () => {
  await scrollTo(0, 500);
  await click("text=Clean sample (13 rows)");
  await p.waitForSelector("#commit-btn:not([disabled])");
  await sleep(600);
  await point("td.ref >> nth=0", 900);
});
await scene("s04", async (t0) => {
  await click("#commit-btn", 700);
  await p.waitForSelector("#commit-dialog[open]");
  await at(t0, 1.9);
  await click("#commit-confirm", 500);
  await p.waitForSelector(".opp");
});
await scene("s05", async () => { await scrollTo(0, 400); await point(".filters button >> nth=1", 700); await sleep(500); await point(".filters button >> nth=3", 900); });
await scene("s06", async (t0) => {
  await click(".filters button >> nth=1", 600);
  await sleep(400);
  await point(".opp >> nth=0", 700);
  await at(t0, 3.4);
  await point(".blocking >> nth=0", 800);
});
await scene("s07", async (t0) => {
  await scrollTo(0, 400);
  await click('.tabs a[data-tab="reconcile"]', 600);
  await p.waitForSelector(".metric");
  await point(".metric >> nth=0", 600);
  await at(t0, 5.2);
  await point(".metric .excl >> nth=0", 700);
});
await scene("s08", async (t0) => { await point(".metric >> nth=1", 700); await at(t0, 2.6); await point(".metric >> nth=2", 700); });
await scene("s09", async () => {
  await scrollTo(0, 400);
  await click('.tabs a[data-tab="narrative"]', 600);
  await click("#gen-btn", 600);
  await p.waitForSelector(".narr");
  await sleep(500);
  await point(".narr ol li >> nth=0", 700);
});
await scene("s10", async (t0) => {
  await scrollTo(0, 400);
  await click('.tabs a[data-tab="gates"]', 600);
  await click("text=Add evidence for SYN-1002", 700);
  await p.waitForSelector("#evidence-dialog[open]");
  await p.fill("#ev-date", "2026-10-08");
  await click("#ev-ref", 500);
  await p.keyboard.type("SYN-B1002B", { delay: 70 });
  await at(t0, 4.6);
  await click("#ev-save", 500);
  await p.waitForFunction(() => document.querySelector("#rev").textContent === "Revision 2");
});
await scene("s11", async (t0) => {
  await scrollTo(0, 400);
  await click('.tabs a[data-tab="narrative"]', 600);
  await p.waitForSelector(".narr.superseded");
  await point(".narr.superseded .banner", 600);
  await at(t0, 2.6);
  await point(".narr.superseded button", 700);
});
await scene("s12", async () => {
  await scrollTo(0, 400);
  await click('.tabs a[data-tab="evaluation"]', 600);
  await click("#eval-btn", 500);
  await p.waitForSelector(".evalsum .s-pass");
  await point(".evalsum .s-pass", 600);
});
await scene("s13", async () => {
  await click("#eval-broken-btn", 600);
  await p.waitForSelector(".evalsum .s-fail");
  await point(".evalsum .s-fail", 500);
  await sleep(500);
  await point("tr:has(.s-fail) >> nth=0", 900);
});
await scene("s14", async () => {
  await scrollTo(0, 500);
  await click('.tabs a[data-tab="about"]', 600);
  await sleep(500);
  await moveTo(400, 300, 900);
});
running = false; await loop;
await b.close();
writeFileSync(`${SRC}/rec-log.json`, JSON.stringify({ base_kind: base.includes("127.0.0.1") || base.includes("localhost") ? "local wrangler dev" : base, end: Date.now(), scenes, frames: frames.map(({ t, f }) => ({ t, f: f.split("/").pop() })) }, null, 1));
console.log(`frames ${frames.length}, ${((frames.at(-1).t - frames[0].t) / 1000).toFixed(1)} s, fps ${(frames.length / ((frames.at(-1).t - frames[0].t) / 1000)).toFixed(1)}`);
