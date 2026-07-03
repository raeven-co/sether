import { Transform, type TransformCallback } from 'node:stream';
import { TOKEN_RE } from '../token.js';
import type { Vault } from '../vault/types.js';

export interface RestoreStreamOptions {
  vault: Vault;
  /**
   * Maximum length we'll buffer waiting for a token to complete. If a `<`
   * is followed by more than this many chars without a `>`, we emit it as
   * literal text. Default 128.
   *
   * Must comfortably exceed the longest token your detectors produce — a
   * built-in token is ~45-60 chars (`<TYPE_` + 36-char UUID + `>`). Setting
   * this below the real token length makes a token split across a chunk
   * boundary flush as literal text before its `>` arrives, and it can then
   * never be restored. Don't lower it unless you also shorten token types.
   */
  maxTokenLength?: number;
}

export function createRestoreStream(opts: RestoreStreamOptions): Transform {
  const maxToken = opts.maxTokenLength ?? 128;
  let buffer = '';

  return new Transform({
    encoding: 'utf8',
    transform(chunk, _encoding, callback: TransformCallback) {
      try {
        buffer += chunk.toString();
        const result = process(buffer, opts.vault, maxToken, false);
        buffer = result.kept;
        if (result.emitted) this.push(result.emitted);
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (buffer) {
          const result = process(buffer, opts.vault, maxToken, true);
          if (result.emitted) this.push(result.emitted);
          buffer = '';
        }
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}

function process(
  text: string,
  vault: Vault,
  maxTokenLength: number,
  isFinal: boolean,
): { emitted: string; kept: string } {
  if (isFinal) {
    return { emitted: replaceTokens(text, vault), kept: '' };
  }

  const lastOpen = text.lastIndexOf('<');
  if (lastOpen === -1) {
    return { emitted: text, kept: '' };
  }

  const tail = text.slice(lastOpen);
  if (tail.includes('>')) {
    return { emitted: replaceTokens(text, vault), kept: '' };
  }

  if (tail.length >= maxTokenLength) {
    return { emitted: replaceTokens(text, vault), kept: '' };
  }

  const safe = text.slice(0, lastOpen);
  return { emitted: replaceTokens(safe, vault), kept: tail };
}

function replaceTokens(text: string, vault: Vault): string {
  return text.replace(TOKEN_RE, (token) => {
    // Substitute only when the vault returns a string. A vault that returns a
    // non-string (e.g. a mistakenly async `get()` yielding a Promise) leaves
    // the token in place instead of inserting `[object Promise]`. No change for
    // the documented synchronous `Vault` contract; matches every other restore
    // path in the package.
    const value = vault.get(token);
    return typeof value === 'string' ? value : token;
  });
}

/**
 * Synchronous one-shot restoration of a complete text fragment — the mirror of
 * `redactSync`. Swaps every `<TYPE_uuid>` token back to its original value via
 * the vault; a token with no vault entry (expired, evicted, or from a different
 * vault) is left untouched.
 *
 * Use when you hold the entire text in hand (a JSON field, a log line, one SSE
 * payload) and don't need the chunk-boundary buffering of `createRestoreStream`
 * — which you should use instead when tokens may span chunk boundaries.
 */
export interface RestoreSyncOptions {
  vault: Vault;
}

export function restoreSync(text: string, opts: RestoreSyncOptions): string {
  return replaceTokens(text, opts.vault);
}
