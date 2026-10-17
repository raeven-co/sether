import { Readable } from 'node:stream';
import type { Detector } from '../detectors/types.js';
import type { Vault } from '../vault/types.js';
import { createRedactStream } from '../stream/redact.js';
import { restoreJsonDocument, restoreSync, type RestoreString } from '../stream/restore.js';
import { restoreSSEText } from '../stream/sse.js';

// ─────────────────────────────────────────────────────────────────────────────
//  fetch wrapper
//
//  Returns a function with the same signature as the global `fetch`. The
//  wrapper redacts outgoing request bodies (when they're strings or JSON)
//  before they leave the process, then restores the response body on the
//  way back.
//
//  The underlying fetch implementation is REQUIRED — the caller injects it.
//  Sether does not reach for `globalThis.fetch` itself. This keeps the
//  package's supply-chain capability surface honest: the *caller* declares
//  the network surface, not the library.
//
//  Usage:
//    const safeFetch = wrapFetch({
//      detectors,
//      vault,
//      fetchImpl: fetch,   //  Node 18+ / browsers — pass the runtime's fetch
//    });
//    const response = await safeFetch('https://api.openai.com/v1/chat/completions', {
//      method: 'POST',
//      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
//      body: JSON.stringify({ model: 'gpt-4', messages: [...] }),
//    });
//    const data = await response.text();   // PII restored
//
//  JSON is never restored as text: a body that parses as JSON is restored
//  value by value, a JSON-typed body that doesn't (NDJSON) line by line, with
//  lines that are not valid JSON left tokenized, and an event-stream body per
//  `data:` payload. Other text bodies are restored as text.
//
//  Out of scope (deliberately):
//   - Binary bodies (Blob / FormData / ArrayBuffer) — passed through unmodified
//   - Streaming responses where you want SSE-aware restoration — use
//     createSSERestoreStream on the response.body ReadableStream instead
// ─────────────────────────────────────────────────────────────────────────────

export interface WrapFetchOptions {
  detectors: readonly Detector[];
  vault: Vault;
  safeDistanceBytes?: number;
  /**
   * The underlying fetch implementation to wrap. Required — Sether does not
   * implicitly reach for a global `fetch`. Callers pass their runtime's
   * fetch (Node 18+, undici, polyfill, mock, etc.) explicitly.
   */
  fetchImpl: typeof fetch;
}

export function wrapFetch(opts: WrapFetchOptions): typeof fetch {
  if (typeof opts.fetchImpl !== 'function') {
    throw new Error(
      'wrapFetch: opts.fetchImpl is required. Pass your runtime fetch: wrapFetch({ ..., fetchImpl: fetch }) on Node 18+ or in the browser.',
    );
  }
  const baseFetch = opts.fetchImpl;

  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const redactedInit = init ? await redactRequestBody(init, opts) : init;
    const response = await baseFetch(input, redactedInit);
    return wrapResponse(response, opts);
  }) as typeof fetch;
}

async function redactRequestBody(init: RequestInit, opts: WrapFetchOptions): Promise<RequestInit> {
  if (init.body === null || init.body === undefined) return init;
  if (typeof init.body !== 'string') return init; // pass through Blob/FormData/etc

  const redacted = await redactText(init.body, opts);
  return { ...init, body: redacted };
}

async function wrapResponse(response: Response, opts: WrapFetchOptions): Promise<Response> {
  // Only restore textual bodies; pass through everything else.
  const contentType = response.headers.get('content-type') ?? '';
  const isText =
    contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('event-stream');

  if (!isText) return response;

  // Read the body once, restore, and rebuild a Response.
  const original = await response.text();
  const restored = restoreBody(original, contentType, opts.vault);

  // Restoration changes the body length, and reading it via `.text()` has
  // already decoded any transfer/content encoding. Carrying the upstream
  // `content-length` / `content-encoding` forward would describe the *old*
  // bytes and mislead any consumer or proxy that trusts those headers (a
  // stale `content-encoding: gzip` on now-plaintext is the dangerous one).
  // Drop both so the rebuilt Response stays self-consistent.
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');

  return new Response(restored, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Restore a complete textual body without splicing an original unescaped
// into JSON.
function restoreBody(body: string, contentType: string, vault: Vault): string {
  const restoreString: RestoreString = (text) => restoreSync(text, { vault });
  if (contentType.includes('event-stream')) return restoreSSEText(body, restoreString);
  const document = restoreJsonDocument(body, restoreString);
  if (document !== undefined) return document;
  if (!contentType.includes('json')) return restoreString(body);
  // A JSON type that is not one document: NDJSON / JSON Lines. A line that is
  // not valid JSON stays tokenized rather than being restored as text, so an
  // original cannot complete a truncated document into a different one.
  return body
    .split('\n')
    .map((line) => restoreJsonDocument(line, restoreString) ?? line)
    .join('\n');
}

async function redactText(text: string, opts: WrapFetchOptions): Promise<string> {
  const transform = createRedactStream({
    detectors: opts.detectors,
    vault: opts.vault,
    safeDistanceBytes: opts.safeDistanceBytes,
  });

  return new Promise<string>((resolve, reject) => {
    let out = '';
    transform.on('data', (chunk: Buffer | string) => {
      out += chunk.toString();
    });
    transform.on('end', () => resolve(out));
    transform.on('error', reject);
    Readable.from([text]).pipe(transform);
  });
}
