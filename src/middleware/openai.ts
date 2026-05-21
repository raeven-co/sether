import { redactSync, type RedactSyncOptions } from '../stream/redact.js';
import type { Vault } from '../vault/types.js';

// ─────────────────────────────────────────────────────────────────────────────
//  OpenAI SDK wrapper
//
//  Wraps an `OpenAI` client instance so every `chat.completions.create` (and
//  related `create` method) call:
//   1. Redacts the message contents before they go out.
//   2. Restores the response choices on the way back.
//
//  The `openai` package is a peer dependency (optional). Users who don't use
//  this wrapper pay no install cost.
//
//  Usage:
//    import OpenAI from 'openai';
//    import { Sether, wrapOpenAI } from '@raeven-co/sether';
//
//    const sether = new Sether();
//    const openai = wrapOpenAI(new OpenAI({ apiKey }), sether);
//
//    const completion = await openai.chat.completions.create({
//      model: 'gpt-4',
//      messages: [{ role: 'user', content: 'Hi I am alice@example.com' }],
//    });
//    // The message that left your process had `<EMAIL_...>` instead.
//    // `completion.choices[0].message.content` has any tokens the model
//    // echoed back restored to the original PII.
// ─────────────────────────────────────────────────────────────────────────────

export interface WrapOpenAIOptions {
  detectors: readonly import('../detectors/types.js').Detector[];
  vault: Vault;
  /** Synchronous restore — true by default. */
  restoreResponses?: boolean;
}

// Minimal duck-typed surface. We avoid importing the OpenAI types at all
// (peer dep) — anything with `chat.completions.create` works.
interface ChatLike {
  completions: { create: (...args: unknown[]) => Promise<unknown> };
}
interface OpenAILike {
  chat: ChatLike;
}

export function wrapOpenAI<C extends OpenAILike>(client: C, opts: WrapOpenAIOptions): C {
  const restore = opts.restoreResponses ?? true;
  const redactOpts: RedactSyncOptions = { detectors: opts.detectors, vault: opts.vault };

  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  client.chat.completions.create = async function (...args: unknown[]): Promise<unknown> {
    const [request, ...rest] = args;
    const redactedRequest = request ? redactRequest(request, redactOpts) : request;
    const response = await originalCreate(redactedRequest, ...rest);
    return restore ? restoreResponse(response, opts.vault) : response;
  } as typeof client.chat.completions.create;

  return client;
}

// Walk the OpenAI Chat Completions request shape and redact string content
// in `messages[].content` (string OR array-of-parts).
function redactRequest(req: unknown, opts: RedactSyncOptions): unknown {
  if (!req || typeof req !== 'object') return req;
  const r = req as Record<string, unknown>;
  const messages = r.messages;
  if (!Array.isArray(messages)) return req;
  return {
    ...r,
    messages: messages.map((msg) => redactMessage(msg, opts)),
  };
}

function redactMessage(msg: unknown, opts: RedactSyncOptions): unknown {
  if (!msg || typeof msg !== 'object') return msg;
  const m = msg as Record<string, unknown>;
  const content = m.content;
  if (typeof content === 'string') {
    return { ...m, content: redactSync(content, opts) };
  }
  if (Array.isArray(content)) {
    return {
      ...m,
      content: content.map((part) => {
        if (
          part &&
          typeof part === 'object' &&
          (part as Record<string, unknown>).type === 'text' &&
          typeof (part as Record<string, unknown>).text === 'string'
        ) {
          return {
            ...(part as Record<string, unknown>),
            text: redactSync((part as Record<string, unknown>).text as string, opts),
          };
        }
        return part;
      }),
    };
  }
  return msg;
}

// Walk the response and restore tokens in `choices[].message.content` and
// `choices[].delta.content` (streaming chunks).
function restoreResponse(res: unknown, vault: Vault): unknown {
  if (!res || typeof res !== 'object') return res;
  const r = res as Record<string, unknown>;
  const choices = r.choices;
  if (!Array.isArray(choices)) return res;
  return {
    ...r,
    choices: choices.map((c) => restoreChoice(c, vault)),
  };
}

function restoreChoice(choice: unknown, vault: Vault): unknown {
  if (!choice || typeof choice !== 'object') return choice;
  const c = choice as Record<string, unknown>;
  const out: Record<string, unknown> = { ...c };
  for (const key of ['message', 'delta'] as const) {
    const v = c[key];
    if (v && typeof v === 'object') {
      const inner = v as Record<string, unknown>;
      if (typeof inner.content === 'string') {
        out[key] = { ...inner, content: restoreInPlace(inner.content, vault) };
      }
    }
  }
  return out;
}

function restoreInPlace(text: string, vault: Vault): string {
  const TOKEN_RE = /<([A-Z_][A-Z0-9_]*)_([0-9a-fA-F-]{8,})>/g;
  return text.replace(TOKEN_RE, (m) => {
    const v = vault.get(m);
    if (typeof v === 'string') return v;
    return m;
  });
}
