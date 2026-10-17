import { Transform, type TransformCallback } from 'node:stream';
import { redactSync } from './redact.js';
import { restoreJsonDocument, type RestoreString } from './restore.js';
import { TOKEN_RE } from '../token.js';
import type { Detector } from '../detectors/types.js';
import type { Vault } from '../vault/types.js';

// ─────────────────────────────────────────────────────────────────────────────
//  SSE-aware tokenisation
//
//  Server-Sent Events frame text as:
//    data: <payload-line-1>\n
//    data: <payload-line-2>\n
//    event: <name>\n
//    id: <id>\n
//    retry: <ms>\n
//    \n          ← event separator (blank line)
//
//  Naive whole-stream redaction breaks two things:
//   1. The `data:` / `event:` / `id:` / `retry:` field labels — these aren't
//      PII and shouldn't be touched.
//   2. The blank-line event separator — must be preserved verbatim.
//
//  This module extracts each line, redacts only `data:` payloads, and
//  reassembles the SSE frames. Field labels, event metadata, and separators
//  pass through untouched.
//
//  Each SSE line is a complete unit by design, so per-line synchronous
//  redaction is correct — we don't need the chunk-boundary safe-distance
//  buffering that the streaming Transform applies. (For PII that spans
//  multiple SSE lines, concatenate first then use `createRedactStream`.)
//
//  Used for: streaming OpenAI / Anthropic responses. They send SSE frames
//  where each `data:` line is a JSON chunk of the generated text.
// ─────────────────────────────────────────────────────────────────────────────

export interface SSEStreamOptions {
  detectors: readonly Detector[];
  vault: Vault;
}

/**
 * Wrap a redact stream with SSE-frame awareness. Input is raw SSE text;
 * output is the same SSE text with PII inside `data:` payloads tokenised.
 */
export function createSSERedactStream(opts: SSEStreamOptions): Transform {
  return createSSETransformer((payload) => redactSync(payload, opts));
}

/**
 * Wrap a restore stream with SSE-frame awareness. Input is tokenised SSE
 * text from a downstream service; output has tokens restored within each
 * `data:` payload.
 *
 * A payload that parses as JSON (the OpenAI / Anthropic chunk format) is
 * restored value by value: only the string values holding a token are
 * re-encoded, so an original containing `"`, `\` or a line break can neither
 * change the JSON nor break the SSE framing, and every other byte is kept.
 * Object keys are not restored. Any other payload is restored as text, and a
 * line break in an original continues it on a new `data: ` line, so it cannot
 * end the line and inject `event:` / `id:` / `data:` fields or a blank line.
 * The client joins the data lines with `\n`, so CR and CRLF in an original
 * arrive as `\n`. Each `data:` line is handled on its own, so a JSON payload
 * split across several `data:` lines is restored as text.
 */
export function createSSERestoreStream(opts: { vault: Vault }): Transform {
  const restoreString = (text: string): string => restoreSync(text, opts.vault);
  return createSSETransformer((payload) => restoreSSEPayload(payload, restoreString));
}

/**
 * Restore a complete, already-buffered SSE text the way
 * `createSSERestoreStream` does, with `restoreString` restoring each decoded
 * value (and, in a text payload, each token). Used for buffered
 * `text/event-stream` response bodies.
 */
export function restoreSSEText(text: string, restoreString: RestoreString): string {
  const restorePayload = (payload: string): string => restoreSSEPayload(payload, restoreString);
  return text
    .split('\n')
    .map((line) => processSSELine(line, restorePayload))
    .join('\n');
}

const LINE_BREAK_RE = /\r\n|\r|\n/g;

// A JSON payload is restored value by value, which escapes line breaks. A text
// payload is restored token by token, and each line break in an original
// starts a new data line in the line ending of the stream (a CRLF-framed line
// keeps its trailing `\r` in the payload). Continuation lines always use
// `data: `, so a leading space in the next part of the original is kept.
// Without a line break in an original, the output equals restoring the
// payload as text.
function restoreSSEPayload(payload: string, restoreString: RestoreString): string {
  const document = restoreJsonDocument(payload, restoreString);
  if (document !== undefined) return document;
  const newDataLine = payload.endsWith('\r') ? '\r\ndata: ' : '\ndata: ';
  return payload.replace(TOKEN_RE, (token) =>
    restoreString(token).replace(LINE_BREAK_RE, newDataLine),
  );
}

// Restore a single complete text fragment — the token-substitution mirror of
// `redactSync`. Tokens follow the same `<TYPE_<uuid>>` shape that the redact
// path emits.
function restoreSync(text: string, vault: Vault): string {
  // Match the canonical token shape (shared TOKEN_RE) emitted by
  // createRedactStream / redactSync.
  return text.replace(TOKEN_RE, (matchStr) => {
    const original = vault.get(matchStr);
    if (typeof original === 'string') return original;
    if (original !== undefined && typeof (original as { then?: unknown }).then === 'function') {
      // SSE restore is synchronous; async vaults aren't supported here.
      // Caller should hydrate the vault before restoration or use the
      // non-SSE restore stream.
      throw new Error(
        'createSSERestoreStream: async Vault.get() not supported. Use a synchronous Vault implementation (e.g. MemoryVault) or pre-resolve the vault.',
      );
    }
    return matchStr;
  });
}

// Route a `data:` line's payload through the processor; pass every other line
// through verbatim.
function processSSELine(line: string, processLinePayload: (payload: string) => string): string {
  if (!line.startsWith('data:')) return line;
  const afterColon = line.slice(5);
  const hasSpace = afterColon.startsWith(' ');
  const prefix = hasSpace ? 'data: ' : 'data:';
  const payload = hasSpace ? afterColon.slice(1) : afterColon;
  return prefix + processLinePayload(payload);
}

// Line-oriented SSE parser. Buffer until we have a complete line, then
// process it with `processSSELine`.
function createSSETransformer(processLinePayload: (payload: string) => string): Transform {
  let lineBuffer = '';

  return new Transform({
    encoding: 'utf8',
    transform(chunk, _enc, callback: TransformCallback) {
      try {
        lineBuffer += chunk.toString();
        let out = '';
        let nl: number;
        while ((nl = lineBuffer.indexOf('\n')) !== -1) {
          const line = lineBuffer.slice(0, nl);
          lineBuffer = lineBuffer.slice(nl + 1);
          out += processSSELine(line, processLinePayload) + '\n';
        }
        if (out) this.push(out);
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (lineBuffer) {
          this.push(processSSELine(lineBuffer, processLinePayload));
          lineBuffer = '';
        }
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}
