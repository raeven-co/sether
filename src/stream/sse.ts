import { Transform, type TransformCallback } from 'node:stream';
import { redactSync } from './redact.js';
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
 */
export function createSSERestoreStream(opts: { vault: Vault }): Transform {
  return createSSETransformer((payload) => restoreSync(payload, opts.vault));
}

// Restore a single complete text fragment — the token-substitution mirror of
// `redactSync`. Tokens follow the same `<TYPE_<uuid>>` shape that the redact
// path emits.
function restoreSync(text: string, vault: Vault): string {
  // Match the token pattern emitted by createRedactStream / redactSync.
  // Type is a contiguous ASCII identifier; UUID body is hex with dashes.
  const TOKEN_RE = /<([A-Z_][A-Z0-9_]*)_([0-9a-fA-F-]{8,})>/g;
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

// Line-oriented SSE parser. Buffer until we have a complete line, route
// `data:` payloads through the line processor, pass everything else through
// verbatim.
function createSSETransformer(processLinePayload: (payload: string) => string): Transform {
  let lineBuffer = '';

  function processLine(line: string): string {
    if (!line.startsWith('data:')) return line;
    const afterColon = line.slice(5);
    const hasSpace = afterColon.startsWith(' ');
    const prefix = hasSpace ? 'data: ' : 'data:';
    const payload = hasSpace ? afterColon.slice(1) : afterColon;
    return prefix + processLinePayload(payload);
  }

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
          out += processLine(line) + '\n';
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
          this.push(processLine(lineBuffer));
          lineBuffer = '';
        }
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}
