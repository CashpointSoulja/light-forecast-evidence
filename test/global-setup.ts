import { spawn, type ChildProcess } from "node:child_process";

const PORT = process.env.LFE_TEST_PORT ?? "8799";
let child: ChildProcess | null = null;

/** Starts the real Worker (local workerd, SQLite Durable Objects) for the API tests. Each run gets a fresh state dir. */
export async function setup() {
  const dir = `.wrangler/test-state-${Date.now()}`;
  child = spawn("npx", ["wrangler", "dev", "--port", PORT, "--ip", "127.0.0.1", "--persist-to", dir, "--show-interactive-dev-session=false"], { stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, NO_COLOR: "1" } });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  const deadline = Date.now() + 80000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (Date.now() >= deadline) throw new Error(`wrangler dev did not start:\n${log}`);
  process.env.LFE_BASE = `http://127.0.0.1:${PORT}`;
}

export async function teardown() {
  if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ } }
}
