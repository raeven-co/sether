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
 * Use when you hold the entire text in hand (a log line, a decoded JSON string
 * value) and don't need the chunk-boundary buffering of `createRestoreStream`
 * — which you should use instead when tokens may span chunk boundaries.
 *
 * Never call it on SERIALIZED JSON (e.g. tool-call arguments): originals are
 * inserted unescaped, so a `"` or `\` in one can add keys or break the
 * document. Use `restoreJson` / `restoreJsonValue` for JSON.
 */
export interface RestoreSyncOptions {
  vault: Vault;
  /**
   * Throw an `UnresolvedTokenError` instead of silently leaving token-shaped
   * text in the output. Default `false`.
   */
  strict?: boolean;
}

export function restoreSync(text: string, opts: RestoreSyncOptions): string {
  const unresolved = opts.strict ? new Set<string>() : undefined;
  const restored = restoreText(text, opts.vault, unresolved);
  throwIfUnresolved(unresolved);
  return restored;
}

/** A value as produced by `JSON.parse`. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * Restore tokens inside a SERIALIZED JSON document — e.g. LLM tool-call
 * arguments — without letting an original value change its structure.
 *
 * Parses `json`, restores every string value individually (object keys are
 * left as-is) and re-serializes, so `JSON.stringify` escapes any `"` or `\`
 * in an original instead of splicing it into the document.
 *
 * Throws `SyntaxError` if `json` is not valid JSON; it never falls back to
 * string replacement. The output is compact (input formatting is not kept)
 * and numbers round-trip through `JSON.parse`, so integers beyond
 * `Number.MAX_SAFE_INTEGER` lose precision — parse with your own reviver and
 * call `restoreJsonValue` when that matters. A string value that itself holds
 * serialized JSON is restored as plain text: parse and restore it separately.
 */
export function restoreJson(json: string, opts: RestoreSyncOptions): string {
  const parsed = JSON.parse(json) as JsonValue;
  return JSON.stringify(restoreJsonValue(parsed, opts));
}

/**
 * Restore tokens in every string value of an already-parsed JSON value.
 * Object keys are not restored. Returns a new value; the input is not mutated.
 */
export function restoreJsonValue(value: JsonValue, opts: RestoreSyncOptions): JsonValue {
  const unresolved = opts.strict ? new Set<string>() : undefined;
  const restored = restoreNode(value, opts.vault, unresolved);
  throwIfUnresolved(unresolved);
  return restored;
}

/**
 * Thrown by a strict restore when token-shaped text would be left in the
 * output: a well-formed token the vault cannot resolve (invented, expired, or
 * from another vault), a case-altered copy such as `<email_…>`, or a token in
 * an object key. Carries the tokens only — never restored originals.
 */
export class UnresolvedTokenError extends Error {
  readonly tokens: readonly string[];

  constructor(tokens: readonly string[]) {
    super(`Sether could not restore ${tokens.length} token(s): ${tokens.join(', ')}`);
    this.name = 'UnresolvedTokenError';
    this.tokens = tokens;
  }
}

// Case-insensitive twin of TOKEN_RE: also matches copies like `<email_…>`,
// which TOKEN_RE (and so restoration) skips. Both match the same `<`…`>` span,
// so a candidate is restorable exactly when it is canonical and in the vault.
const TOKEN_LIKE_RE = new RegExp(TOKEN_RE.source, 'gi');
const CANONICAL_TOKEN_RE = new RegExp(`^${TOKEN_RE.source}$`);

// Without a collector this is plain `replaceTokens`. With one (strict mode) it
// restores and records in a single pass, so what is reported is exactly what
// is left in the output.
function restoreText(text: string, vault: Vault, unresolved: Set<string> | undefined): string {
  if (unresolved === undefined) return replaceTokens(text, vault);
  return text.replace(TOKEN_LIKE_RE, (candidate) => {
    const value = CANONICAL_TOKEN_RE.test(candidate) ? vault.get(candidate) : undefined;
    if (typeof value === 'string') return value;
    unresolved.add(candidate);
    return candidate;
  });
}

function restoreNode(
  value: JsonValue,
  vault: Vault,
  unresolved: Set<string> | undefined,
): JsonValue {
  if (typeof value === 'string') return restoreText(value, vault, unresolved);
  if (Array.isArray(value)) return value.map((item) => restoreNode(item, vault, unresolved));
  if (value !== null && typeof value === 'object') {
    // Object.fromEntries defines own properties, so a "__proto__" key from
    // JSON.parse stays data instead of becoming the result's prototype.
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        // Keys are never restored, so any token shape in a key is left behind.
        if (unresolved) {
          for (const token of key.match(TOKEN_LIKE_RE) ?? []) unresolved.add(token);
        }
        return [key, restoreNode(item, vault, unresolved)];
      }),
    );
  }
  return value;
}

function throwIfUnresolved(unresolved: Set<string> | undefined): void {
  if (unresolved !== undefined && unresolved.size > 0) {
    throw new UnresolvedTokenError([...unresolved]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  In-place JSON restore for Sether's own restore paths (SSE payloads,
//  response bodies, JSON-mode SDK replies). Not exported from the package root.
//
//  Unlike `restoreJson`, which re-serializes the whole parsed value, this only
//  re-encodes the string values that actually change and keeps every other
//  byte: formatting, key order, escapes and numbers. That matters for streams
//  passed through verbatim, and JSON.parse would round integers beyond 2^53.
// ─────────────────────────────────────────────────────────────────────────────

/** Restores one decoded string value, e.g. `(s) => restoreSync(s, { vault })`. */
export type RestoreString = (value: string) => string;

// A token can only reach a decoded JSON string through a raw `<` or the
// `<` escape (the only two encodings of `<`). Without either, there is
// nothing to restore.
const ESCAPED_LT_RE = /\\u003c/i;

function mayHoldToken(text: string): boolean {
  return text.includes('<') || ESCAPED_LT_RE.test(text);
}

/**
 * Restore the string values of the JSON document `text` in place: each value
 * holding a token is decoded, restored with `restoreString` and re-encoded by
 * `JSON.stringify`, so an original can never change the document's structure.
 * Object keys are never restored.
 *
 * Returns `undefined` when `text` is not valid JSON. Text with nothing
 * token-shaped in it is returned as-is without being parsed.
 */
export function restoreJsonDocument(
  text: string,
  restoreString: RestoreString,
): string | undefined {
  if (!mayHoldToken(text)) return text;
  try {
    JSON.parse(text);
  } catch {
    return undefined;
  }

  // `text` is valid JSON, so every `"` outside a string literal opens one.
  let out = '';
  let copiedUpTo = 0;
  for (let open = text.indexOf('"'); open !== -1;) {
    const close = closingQuoteOf(text, open);
    const literal = text.slice(open, close + 1);
    if (!isObjectKey(text, close + 1) && mayHoldToken(literal)) {
      const value = JSON.parse(literal) as string;
      const restored = restoreString(value);
      if (restored !== value) {
        out += text.slice(copiedUpTo, open) + JSON.stringify(restored);
        copiedUpTo = close + 1;
      }
    }
    open = text.indexOf('"', close + 1);
  }
  return copiedUpTo === 0 ? text : out + text.slice(copiedUpTo);
}

/**
 * The rule for a payload whose format is not declared (a body sent through
 * Express): if it parses as JSON, restore it value by value; otherwise restore
 * it as text. SSE `data:` payloads use their own rule in `sse.ts`.
 */
export function restoreJsonOrText(text: string, restoreString: RestoreString): string {
  return restoreJsonDocument(text, restoreString) ?? restoreString(text);
}

// Index of the quote closing the string literal that opens at `open`. Only
// called on validated JSON, so the literal is always terminated.
function closingQuoteOf(json: string, open: number): number {
  let i = open + 1;
  while (i < json.length) {
    const code = json.charCodeAt(i);
    if (code === 0x22) return i; // "
    i += code === 0x5c ? 2 : 1; // a backslash escapes the next character
  }
  throw new SyntaxError('Unterminated string in JSON');
}

// A string literal is an object key exactly when the next non-whitespace
// character is a colon.
function isObjectKey(json: string, from: number): boolean {
  let i = from;
  while (i < json.length) {
    const char = json[i];
    if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') return char === ':';
    i++;
  }
  return false;
}
