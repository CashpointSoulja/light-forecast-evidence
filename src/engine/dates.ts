const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict calendar date check; returns days since epoch or null. Never compares dates as strings. */
export function parseDate(s: string): number | null {
  const m = ISO.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(t / 86400000);
}

export function formatDay(day: number): string {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = parseDate(iso);
  if (d === null) throw new Error("invalid date");
  return formatDay(d + n);
}

export function quarterOf(iso: string): { label: string; start: number; end: number } {
  const d = parseDate(iso);
  if (d === null) throw new Error("invalid date");
  const dt = new Date(d * 86400000);
  const y = dt.getUTCFullYear();
  const q = Math.floor(dt.getUTCMonth() / 3);
  const start = Math.round(Date.UTC(y, q * 3, 1) / 86400000);
  const end = Math.round(Date.UTC(y, q * 3 + 3, 1) / 86400000) - 1;
  return { label: `Q${q + 1} ${y}`, start, end };
}
