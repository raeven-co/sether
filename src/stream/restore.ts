import { Transform, type TransformCallback } from 'node:stream';
import type { Vault } from '../vault/types.js';

export interface RestoreStreamOptions {
  vault: Vault;
  /**
   * Maximum length we'll buffer waiting for a token to complete. If a `<`
   * is followed by more than this many chars without a `>`, we emit it as
   * literal text. Default 128.
   */
  maxTokenLength?: number;
}

const TOKEN_PATTERN = /<[A-Z][A-Z0-9_]*_[0-9a-fA-F-]{8,}>/g;

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
  return text.replace(TOKEN_PATTERN, (token) => vault.get(token) ?? token);
}
