import { redactSync, type RedactSyncOptions } from '../stream/redact.js';
import type { Vault } from '../vault/types.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Anthropic SDK wrapper
//
//  Wraps an `Anthropic` client so every `messages.create` call:
//   1. Redacts user message contents before the request goes out.
//   2. Restores the response content blocks on the way back.
//
//  The `@anthropic-ai/sdk` package is a peer dependency (optional).
//
//  Usage:
//    import Anthropic from '@anthropic-ai/sdk';
//    import { Sether, wrapAnthropic } from '@raeven-co/sether';
//
//    const sether = new Sether();
//    const anthropic = wrapAnthropic(new Anthropic({ apiKey }), sether);
//
//    const reply = await anthropic.messages.create({
//      model: 'claude-opus-4-7',
//      max_tokens: 1024,
//      messages: [{ role: 'user', content: 'Email alice@example.com please' }],
//    });
//    // The request to Anthropic carried `<EMAIL_...>`; the response has
//    // anything the model echoed back restored.
// ─────────────────────────────────────────────────────────────────────────────

export interface WrapAnthropicOptions {
  detectors: readonly import('../detectors/types.js').Detector[];
  vault: Vault;
  /** Synchronous restore — true by default. */
  restoreResponses?: boolean;
}

interface MessagesLike {
  create: (...args: unknown[]) => Promise<unknown>;
}
interface AnthropicLike {
  messages: MessagesLike;
}

export function wrapAnthropic<C extends AnthropicLike>(client: C, opts: WrapAnthropicOptions): C {
  const restore = opts.restoreResponses ?? true;
  const redactOpts: RedactSyncOptions = { detectors: opts.detectors, vault: opts.vault };

  const originalCreate = client.messages.create.bind(client.messages);

  client.messages.create = async function (...args: unknown[]): Promise<unknown> {
    const [request, ...rest] = args;
    const redactedRequest = request ? redactRequest(request, redactOpts) : request;
    const response = await originalCreate(redactedRequest, ...rest);
    return restore ? restoreResponse(response, opts.vault) : response;
  } as typeof client.messages.create;

  return client;
}

function redactRequest(req: unknown, opts: RedactSyncOptions): unknown {
  if (!req || typeof req !== 'object') return req;
  const r = req as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };

  // Top-level `system` prompt may be a string or an array of content blocks.
  if (typeof r.system === 'string') {
    out.system = redactSync(r.system, opts);
  } else if (Array.isArray(r.system)) {
    out.system = r.system.map((b) => redactBlock(b, opts));
  }

  if (Array.isArray(r.messages)) {
    out.messages = r.messages.map((msg) => {
      if (!msg || typeof msg !== 'object') return msg;
      const m = msg as Record<string, unknown>;
      if (typeof m.content === 'string') {
        return { ...m, content: redactSync(m.content, opts) };
      }
      if (Array.isArray(m.content)) {
        return { ...m, content: m.content.map((b) => redactBlock(b, opts)) };
      }
      return msg;
    });
  }
  return out;
}

function redactBlock(block: unknown, opts: RedactSyncOptions): unknown {
  if (!block || typeof block !== 'object') return block;
  const b = block as Record<string, unknown>;
  if (b.type === 'text' && typeof b.text === 'string') {
    return { ...b, text: redactSync(b.text, opts) };
  }
  return block;
}

function restoreResponse(res: unknown, vault: Vault): unknown {
  if (!res || typeof res !== 'object') return res;
  const r = res as Record<string, unknown>;
  if (!Array.isArray(r.content)) return res;
  return {
    ...r,
    content: r.content.map((block) => {
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          return { ...b, text: restoreInPlace(b.text, vault) };
        }
      }
      return block;
    }),
  };
}

function restoreInPlace(text: string, vault: Vault): string {
  const TOKEN_RE = /<([A-Z_][A-Z0-9_]*)_([0-9a-fA-F-]{8,})>/g;
  return text.replace(TOKEN_RE, (m) => {
    const v = vault.get(m);
    if (typeof v === 'string') return v;
    return m;
  });
}
