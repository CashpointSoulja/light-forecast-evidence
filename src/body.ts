import { HttpError } from "./errors";

/** Largest accepted command body in UTF-8 bytes: a 256 KB CSV can nearly double when JSON-escaped. */
export const MAX_BODY_BYTES = 600_000;

/**
 * Upper bound on bytes read and thrown away after a body is refused. Answering before the client has
 * finished sending makes HTTP/1.1 peers and proxies drop the connection, so the 413 never arrives.
 * Draining keeps memory flat (nothing is stored); past this bound the stream is cancelled instead.
 */
export const DRAIN_LIMIT_BYTES = 16 * 1024 * 1024;

const tooLarge = (max: number) => new HttpError(413, "too_large", `Request body is larger than ${max} bytes.`);

async function discardRest(reader: ReadableStreamDefaultReader<Uint8Array>, budget: number) {
  while (budget > 0) {
    const { done, value } = await reader.read();
    if (done) return;
    budget -= value.byteLength;
  }
  await reader.cancel().catch(() => {});
}

/** Reads at most `max` bytes from the stream, refusing as soon as the limit is crossed; refused bytes are discarded, never buffered. */
export async function readBodyLimited(req: Request, max = MAX_BODY_BYTES, drain = DRAIN_LIMIT_BYTES): Promise<Uint8Array> {
  const declared = req.headers.get("content-length");
  const reader = req.body?.getReader();
  if (declared !== null && (!/^\d{1,12}$/.test(declared) || Number(declared) > max)) {
    if (reader) {
      if (/^\d{1,12}$/.test(declared) && Number(declared) <= drain) await discardRest(reader, drain);
      else await reader.cancel().catch(() => {});
    }
    throw tooLarge(max);
  }
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await discardRest(reader, drain - total);
      throw tooLarge(max);
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
