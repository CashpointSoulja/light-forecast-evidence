import { HttpError } from "./errors";

/** Largest accepted command body in UTF-8 bytes: a 256 KB CSV can nearly double when JSON-escaped. */
export const MAX_BODY_BYTES = 600_000;

/** Reads at most `max` bytes from the stream, refusing as soon as the limit is crossed, then decodes strict UTF-8. */
export async function readBodyLimited(req: Request, max = MAX_BODY_BYTES): Promise<Uint8Array> {
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d{1,12}$/.test(declared) || Number(declared) > max)) throw new HttpError(413, "too_large", `Request body is larger than ${max} bytes.`);
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "too_large", `Request body is larger than ${max} bytes.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

export function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); }
  catch { throw new HttpError(400, "bad_encoding", "Request body is not valid UTF-8."); }
}
