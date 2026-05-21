import { Readable } from 'node:stream';
import type { Detector } from '../detectors/types.js';
import type { Vault } from '../vault/types.js';
import { createRedactStream } from '../stream/redact.js';
import { createRestoreStream } from '../stream/restore.js';

// ─────────────────────────────────────────────────────────────────────────────
//  fetch wrapper
//
//  Returns a function with the same signature as the global `fetch`. The
//  wrapper redacts outgoing request bodies (when they're strings or JSON)
//  before they leave the process, then restores the response body on the
//  way back.
//
//  Use it as a drop-in replacement:
//    const safeFetch = wrapFetch({ detectors, vault });
//    const response = await safeFetch('https://api.openai.com/v1/chat/completions', {
//      method: 'POST',
//      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
//      body: JSON.stringify({ model: 'gpt-4', messages: [...] }),
//    });
//    const data = await response.text();   // PII restored
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
  /** Underlying fetch impl. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export function wrapFetch(opts: WrapFetchOptions): typeof fetch {
  const baseFetch = opts.fetchImpl ?? globalThis.fetch;
  if (typeof baseFetch !== 'function') {
    throw new Error('wrapFetch: no fetch implementation available. Pass fetchImpl explicitly on Node < 18.');
  }

  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const redactedInit = init ? await redactRequestBody(init, opts) : init;
    const response = await baseFetch(input, redactedInit);
    return wrapResponse(response, opts);
  }) as typeof fetch;
}

async function redactRequestBody(
  init: RequestInit,
  opts: WrapFetchOptions,
): Promise<RequestInit> {
  if (init.body === null || init.body === undefined) return init;
  if (typeof init.body !== 'string') return init; // pass through Blob/FormData/etc

  const redacted = await streamRoundTrip(init.body, opts, 'redact');
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
  const restored = await streamRoundTrip(original, opts, 'restore');

  return new Response(restored, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function streamRoundTrip(
  text: string,
  opts: WrapFetchOptions,
  mode: 'redact' | 'restore',
): Promise<string> {
  const transform =
    mode === 'redact'
      ? createRedactStream({
          detectors: opts.detectors,
          vault: opts.vault,
          safeDistanceBytes: opts.safeDistanceBytes,
        })
      : createRestoreStream({ vault: opts.vault });

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
