import { Readable } from 'node:stream';
import { TOKEN_RE } from '../token.js';
import type { Detector } from '../detectors/types.js';
import type { Vault } from '../vault/types.js';
import { createRedactStream } from '../stream/redact.js';
import { createRestoreStream, restoreJsonOrText } from '../stream/restore.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Express middleware
//
//  Drop-in middleware that redacts incoming request bodies and restores
//  outgoing response bodies. Designed to be inserted just before any route
//  that calls an LLM provider, so application code never has to think about
//  redaction in its handlers.
//
//  Usage:
//    import express from 'express';
//    import { Sether, createExpressMiddleware } from '@raeven-co/sether';
//
//    const app = express();
//    app.use(express.json());
//    const sether = new Sether();
//    app.use(createExpressMiddleware(sether));   // ← here
//    app.post('/chat', (req, res) => { ... });
//
//  Notes:
//   - Express is a peer dependency. We don't import it here; we just rely on
//     the standard Express middleware signature (req, res, next).
//   - We only operate on string and JSON bodies. Binary/multipart bodies pass
//     through unmodified.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpressMiddlewareOptions {
  detectors: readonly Detector[];
  vault: Vault;
  safeDistanceBytes?: number;
}

// Minimal local types to avoid pulling `@types/express` as a hard dep.
interface MinimalReq {
  body?: unknown;
}
interface MinimalRes {
  send: (body?: unknown) => unknown;
  json: (body?: unknown) => unknown;
}
type NextFn = (err?: unknown) => void;

export function createExpressMiddleware(opts: ExpressMiddlewareOptions) {
  return async function setherMiddleware(req: MinimalReq, res: MinimalRes, next: NextFn) {
    try {
      // Redact incoming body if it's a string or a parsed JSON object.
      if (typeof req.body === 'string') {
        req.body = await pipeThrough(req.body, opts, 'redact');
      } else if (req.body && typeof req.body === 'object') {
        req.body = await redactJsonValue(req.body, opts);
      }

      // Wrap res.send + res.json to restore on the way out. Restoration is pure
      // token->value substitution, so it runs synchronously — and it must.
      // Express requires res.send / res.json to return `res` (for chaining) and
      // does not await them; an async override returns a pending Promise, so the
      // real send fires a microtask later and an unrestored body can go out
      // first or a double-send / "headers already sent" can occur.
      //
      // A string body that parses as JSON (including the string Express's own
      // res.json hands to res.send) is restored value by value, never as text.
      const restoreString = (text: string): string => restoreStringSync(text, opts.vault);
      const originalSend = res.send.bind(res);
      const originalJson = res.json.bind(res);

      res.send = function (body?: unknown) {
        if (typeof body === 'string') {
          body = restoreJsonOrText(body, restoreString);
        } else if (body && typeof body === 'object') {
          body = restoreJsonValueSync(body, opts.vault);
        }
        return originalSend(body);
      };
      res.json = function (body?: unknown) {
        if (body && typeof body === 'object') {
          body = restoreJsonValueSync(body, opts.vault);
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

async function pipeThrough(
  text: string,
  opts: ExpressMiddlewareOptions,
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

// Walk JSON values; redact strings in place. Numbers, booleans, nulls pass
// through. The request body is already fully buffered by express.json(), so the
// streaming redactor sees it as a single chunk (no chunk-boundary concern).
async function redactJsonValue(value: unknown, opts: ExpressMiddlewareOptions): Promise<unknown> {
  return mapJson(value, (s) => pipeThrough(s, opts, 'redact'));
}

// Synchronous token -> value restoration for the response path, so the wrapped
// res.send / res.json stay synchronous. Matches the canonical `<TYPE_uuid>`
// token shape (shared TOKEN_RE) emitted by the redact stream.
function restoreStringSync(text: string, vault: Vault): string {
  return text.replace(TOKEN_RE, (token) => {
    const value = vault.get(token);
    return typeof value === 'string' ? value : token;
  });
}

// Only strings, arrays and plain objects are walked. Anything else (a Buffer or
// typed array sent as binary, a Date or other value with its own toJSON, a class
// instance) is returned as is: copying its own properties into a plain object
// would turn a Buffer into `{0: .., 1: ..}` and a Date into `{}`.
function restoreJsonValueSync(value: unknown, vault: Vault): unknown {
  if (typeof value === 'string') return restoreStringSync(value, vault);
  if (Array.isArray(value)) return value.map((v) => restoreJsonValueSync(v, vault));
  if (isPlainObject(value)) {
    // Object.fromEntries defines own properties, so a "__proto__" key from
    // JSON.parse stays data instead of becoming the result's prototype.
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, restoreJsonValueSync(v, vault)]),
    );
  }
  return value;
}

// A plain object is what JSON.parse or an object literal produces: its
// prototype is Object.prototype, or null for Object.create(null).
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

async function mapJson(value: unknown, mapStr: (s: string) => Promise<string>): Promise<unknown> {
  if (typeof value === 'string') return mapStr(value);
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => mapJson(v, mapStr)));
  }
  if (value && typeof value === 'object') {
    const entries: Array<[string, unknown]> = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      entries.push([k, await mapJson(v, mapStr)]);
    }
    // Defines own properties: a client-sent "__proto__" key must stay data,
    // never become req.body's prototype.
    return Object.fromEntries(entries);
  }
  return value;
}
