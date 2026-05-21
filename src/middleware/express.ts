import { Readable } from 'node:stream';
import type { Detector } from '../detectors/types.js';
import type { Vault } from '../vault/types.js';
import { createRedactStream } from '../stream/redact.js';
import { createRestoreStream } from '../stream/restore.js';

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

      // Wrap res.send + res.json to restore on the way out.
      const originalSend = res.send.bind(res);
      const originalJson = res.json.bind(res);

      res.send = async function (body?: unknown) {
        if (typeof body === 'string') {
          body = await pipeThrough(body, opts, 'restore');
        } else if (body && typeof body === 'object') {
          body = await restoreJsonValue(body, opts);
        }
        return originalSend(body);
      };
      res.json = async function (body?: unknown) {
        if (body && typeof body === 'object') {
          body = await restoreJsonValue(body, opts);
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

// Walk JSON values; redact/restore strings in place. Numbers, booleans,
// nulls pass through.
async function redactJsonValue(value: unknown, opts: ExpressMiddlewareOptions): Promise<unknown> {
  return mapJson(value, (s) => pipeThrough(s, opts, 'redact'));
}
async function restoreJsonValue(value: unknown, opts: ExpressMiddlewareOptions): Promise<unknown> {
  return mapJson(value, (s) => pipeThrough(s, opts, 'restore'));
}

async function mapJson(value: unknown, mapStr: (s: string) => Promise<string>): Promise<unknown> {
  if (typeof value === 'string') return mapStr(value);
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => mapJson(v, mapStr)));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = await mapJson(v, mapStr);
    }
    return out;
  }
  return value;
}
