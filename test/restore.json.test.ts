import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import {
  MemoryVault,
  TOKEN_RE,
  UnresolvedTokenError,
  basicDetectors,
  createExpressMiddleware,
  createSSERestoreStream,
  redactSync,
  restoreJson,
  restoreJsonValue,
  restoreSync,
  secretsDetectors,
  wrapAnthropic,
  wrapFetch,
  wrapOpenAI,
} from '../src/index.js';
import type { JsonValue } from '../src/index.js';

// Restoring tokens inside SERIALIZED JSON (e.g. LLM tool-call arguments) with
// plain string replacement inserts originals unescaped: a quote in an original
// value can add keys to the document, and a trailing backslash can break it.

const NAME = '<NAME_0f0e0d0c-0b0a-4908-8706-050403020100>';
const EMAIL = '<EMAIL_11111111-2222-4333-8444-555555555555>';
const UNKNOWN = '<EMAIL_00000000-0000-0000-0000-000000000000>';
const INJECTING_NAME = 'Alice", "bcc": "attacker@example.com';
const AWKWARD = 'O"Brien \\ "the client"\nsecond line end';
const RECIPIENT = 'bob@example.com';

function vaultWith(name: string): MemoryVault {
  const vault = new MemoryVault();
  vault.set(NAME, name);
  vault.set(EMAIL, RECIPIENT);
  return vault;
}

const toolArgs = JSON.stringify({ to: EMAIL, subject: `Hello ${NAME}` });

function backslashTerminatedPassword(): { token: string; vault: MemoryVault } {
  const vault = new MemoryVault();
  const redacted = redactSync('password: hunter2\\', { detectors: secretsDetectors, vault });
  const token = redacted.match(TOKEN_RE)?.[0];
  if (token === undefined) throw new Error('expected the labeled password to be redacted');
  expect(vault.get(token)).toBe('hunter2\\');
  return { token, vault };
}

function asObject(value: JsonValue): { [key: string]: JsonValue } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected a JSON object');
  }
  return value;
}

describe('restoreSync on serialized JSON (documented hazard, behaviour unchanged)', () => {
  it('lets an original containing quotes inject a key into tool-call arguments', () => {
    const restored = restoreSync(toolArgs, { vault: vaultWith(INJECTING_NAME) });
    expect(JSON.parse(restored)).toEqual({
      to: RECIPIENT,
      subject: 'Hello Alice',
      bcc: 'attacker@example.com',
    });
  });

  it('breaks the document when a built-in match ends in a backslash', () => {
    const { token, vault } = backslashTerminatedPassword();
    const restored = restoreSync(JSON.stringify({ note: token, to: EMAIL }), { vault });
    expect(() => JSON.parse(restored) as unknown).toThrow(SyntaxError);
  });
});

describe('restoreJson', () => {
  it('restores each string value without changing the document structure', () => {
    const restored = restoreJson(toolArgs, { vault: vaultWith(INJECTING_NAME) });
    expect(JSON.parse(restored)).toEqual({ to: RECIPIENT, subject: `Hello ${INJECTING_NAME}` });
  });

  it('round-trips quotes, backslashes, newlines and line separators', () => {
    const restored = restoreJson(toolArgs, { vault: vaultWith(AWKWARD) });
    expect(JSON.parse(restored)).toEqual({ to: RECIPIENT, subject: `Hello ${AWKWARD}` });
  });

  it('keeps the document valid when a built-in match ends in a backslash', () => {
    const { token, vault } = backslashTerminatedPassword();
    const restored = restoreJson(JSON.stringify({ note: token }), { vault });
    expect(JSON.parse(restored)).toEqual({ note: 'hunter2\\' });
  });

  it('restores tokens whose angle brackets the serializer escaped as \\u003c / \\u003e', () => {
    const escaped = `{"to":"${EMAIL.replace('<', '\\u003c').replace('>', '\\u003e')}"}`;
    expect(JSON.parse(restoreJson(escaped, { vault: vaultWith('x') }))).toEqual({ to: RECIPIENT });
  });

  it('keeps numbers, booleans, null and nesting intact', () => {
    const doc = { a: [1, 2.5, true, null, { b: EMAIL }], c: { d: false } };
    expect(JSON.parse(restoreJson(JSON.stringify(doc), { vault: vaultWith('x') }))).toEqual({
      a: [1, 2.5, true, null, { b: RECIPIENT }],
      c: { d: false },
    });
  });

  it('does not restore object keys', () => {
    const restored = restoreJson(JSON.stringify({ [EMAIL]: EMAIL }), { vault: vaultWith('x') });
    expect(JSON.parse(restored)).toEqual({ [EMAIL]: RECIPIENT });
  });

  it('throws on text that is not JSON instead of falling back to string replacement', () => {
    expect(() => restoreJson(`Hello ${NAME}`, { vault: vaultWith('x') })).toThrow(SyntaxError);
  });
});

describe('restoreJsonValue', () => {
  it('restores string leaves of a parsed value without mutating the input', () => {
    const input: JsonValue = { to: [EMAIL], subject: `Hello ${NAME}` };
    const snapshot = JSON.stringify(input);

    const output = restoreJsonValue(input, { vault: vaultWith(INJECTING_NAME) });

    expect(output).toEqual({ to: [RECIPIENT], subject: `Hello ${INJECTING_NAME}` });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('keeps a "__proto__" key as data and never as the prototype', () => {
    const parsed: JsonValue = JSON.parse(
      `{"__proto__":{"bcc":"attacker@example.com"},"to":"${EMAIL}"}`,
    );

    const output = asObject(restoreJsonValue(parsed, { vault: vaultWith('x') }));

    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(output.bcc).toBeUndefined();
    expect(Object.keys(output)).toEqual(['__proto__', 'to']);
    expect(output.to).toBe(RECIPIENT);
  });

  it('restores a top-level string value as text', () => {
    expect(restoreJsonValue(`Hi ${EMAIL}`, { vault: vaultWith('x') })).toBe(`Hi ${RECIPIENT}`);
  });
});

describe('strict mode', () => {
  const vault = vaultWith('Alice');

  function unresolvedOf(run: () => unknown): readonly string[] {
    try {
      run();
    } catch (err) {
      if (err instanceof UnresolvedTokenError) return err.tokens;
      throw err;
    }
    throw new Error('expected an UnresolvedTokenError');
  }

  it('reports well-formed tokens the vault cannot resolve', () => {
    const doc = JSON.stringify({ to: UNKNOWN, cc: EMAIL, again: UNKNOWN });
    expect(unresolvedOf(() => restoreJson(doc, { vault, strict: true }))).toEqual([UNKNOWN]);
  });

  it('reports case-altered tokens that restoration would silently skip', () => {
    const lowered = EMAIL.toLowerCase();
    const doc = JSON.stringify({ to: lowered });
    expect(unresolvedOf(() => restoreJson(doc, { vault, strict: true }))).toEqual([lowered]);
  });

  it('reports tokens in object keys, which are never restored', () => {
    const doc = JSON.stringify({ [EMAIL]: 'x' });
    expect(unresolvedOf(() => restoreJson(doc, { vault, strict: true }))).toEqual([EMAIL]);
  });

  it('applies to restoreSync and restoreJsonValue too', () => {
    expect(unresolvedOf(() => restoreSync(`cc ${UNKNOWN}`, { vault, strict: true }))).toEqual([
      UNKNOWN,
    ]);
    expect(unresolvedOf(() => restoreJsonValue([UNKNOWN], { vault, strict: true }))).toEqual([
      UNKNOWN,
    ]);
  });

  it('never puts restored originals in the error message', () => {
    const doc = JSON.stringify({ to: EMAIL, cc: UNKNOWN });
    expect(() => restoreJson(doc, { vault, strict: true })).toThrow(UnresolvedTokenError);
    try {
      restoreJson(doc, { vault, strict: true });
    } catch (err) {
      expect(String(err)).not.toContain(RECIPIENT);
    }
  });

  it('returns the restored value when every token resolves', () => {
    expect(restoreSync(`to ${EMAIL}`, { vault, strict: true })).toBe(`to ${RECIPIENT}`);
    expect(JSON.parse(restoreJson(toolArgs, { vault, strict: true }))).toEqual({
      to: RECIPIENT,
      subject: 'Hello Alice',
    });
  });

  it('is off by default: unresolved tokens stay in place', () => {
    expect(restoreSync(`cc ${UNKNOWN}`, { vault })).toBe(`cc ${UNKNOWN}`);
    expect(JSON.parse(restoreJson(JSON.stringify({ cc: UNKNOWN }), { vault }))).toEqual({
      cc: UNKNOWN,
    });
  });
});

describe('TOKEN_RE export', () => {
  it('matches exactly the tokens redactSync issues', () => {
    const vault = new MemoryVault();
    const redacted = redactSync('mail bob@example.com or 10.0.0.1', {
      detectors: basicDetectors,
      vault,
    });
    const tokens = redacted.match(TOKEN_RE) ?? [];
    expect(tokens).toHaveLength(2);
    for (const token of tokens) expect(vault.has(token)).toBe(true);
  });
});

describe('SDK wrappers leave tool-call arguments tokenized', () => {
  it('wrapOpenAI does not restore choices[].message.tool_calls[].function.arguments', async () => {
    const client = {
      chat: {
        completions: {
          create: async (_request: unknown): Promise<unknown> => ({
            choices: [
              { message: { content: null, tool_calls: [{ function: { arguments: toolArgs } }] } },
            ],
          }),
        },
      },
    };
    const wrapped = wrapOpenAI(client, { detectors: basicDetectors, vault: vaultWith('Alice') });

    const reply = (await wrapped.chat.completions.create({ messages: [] })) as {
      choices: Array<{ message: { tool_calls: Array<{ function: { arguments: string } }> } }>;
    };

    expect(reply.choices[0]?.message.tool_calls[0]?.function.arguments).toBe(toolArgs);
  });

  it('wrapAnthropic does not restore tool_use input', async () => {
    const input = { to: EMAIL };
    const client = {
      messages: {
        create: async (_request: unknown): Promise<unknown> => ({
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'send_email', input }],
        }),
      },
    };
    const wrapped = wrapAnthropic(client, { detectors: basicDetectors, vault: vaultWith('Alice') });

    const reply = (await wrapped.messages.create({ messages: [] })) as {
      content: Array<{ input: unknown }>;
    };

    expect(reply.content[0]?.input).toEqual({ to: EMAIL });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Sether's own restore paths: JSON is restored value by value
// ─────────────────────────────────────────────────────────────────────────────

const INJECTED = { to: RECIPIENT, subject: `Hello ${INJECTING_NAME}` };

async function restoreSSE(chunks: string[], vault: MemoryVault): Promise<string> {
  let out = '';
  for await (const chunk of Readable.from(chunks).pipe(createSSERestoreStream({ vault }))) {
    out += String(chunk);
  }
  return out;
}

describe('createSSERestoreStream restores JSON data payloads value by value', () => {
  it('keeps each JSON data payload intact when an original contains quotes', async () => {
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: `Hi ${NAME}` } }] })}\n\n`;

    const out = await restoreSSE([sse], vaultWith(INJECTING_NAME));

    const payload: unknown = JSON.parse(out.slice('data: '.length));
    expect(payload).toEqual({ choices: [{ delta: { content: `Hi ${INJECTING_NAME}` } }] });
  });

  it('keeps the payload valid when a built-in match ends in a backslash', async () => {
    const { token, vault } = backslashTerminatedPassword();

    const out = await restoreSSE([`data: ${JSON.stringify({ note: token })}\n\n`], vault);

    expect(JSON.parse(out.slice('data: '.length))).toEqual({ note: 'hunter2\\' });
  });

  it('keeps an original containing line breaks inside its own data line', async () => {
    const original = 'Alice\n\nevent: injected\ndata: {}';

    const out = await restoreSSE([`data: ${JSON.stringify({ c: NAME })}\n\n`], vaultWith(original));

    expect(out.split('\n')).toEqual([`data: ${JSON.stringify({ c: original })}`, '', '']);
  });

  it('changes only the restored string values and keeps every other byte', async () => {
    const payload = `{ "id": 12345678901234567890, "n": 1.0, "s": "caf\\u00e9 \\/", "c": "Hi ${NAME}" }`;

    const out = await restoreSSE([`data:${payload}\r\n\r\n`], vaultWith(INJECTING_NAME));

    const restored = payload.replace(`"Hi ${NAME}"`, JSON.stringify(`Hi ${INJECTING_NAME}`));
    expect(out).toBe(`data:${restored}\r\n\r\n`);
  });

  it('restores escaped and chunk-split tokens in values but never keys', async () => {
    const escaped = EMAIL.replace('<', '\\u003c').replace('>', '\\u003e');
    const sse = `data: {"${EMAIL}":"${escaped}","b":"${NAME}"}\n\n`;

    const out = await restoreSSE(
      [sse.slice(0, 20), sse.slice(20, 70), sse.slice(70)],
      vaultWith(INJECTING_NAME),
    );

    expect(JSON.parse(out.slice('data: '.length))).toEqual({
      [EMAIL]: RECIPIENT,
      b: INJECTING_NAME,
    });
  });

  it('still restores non-JSON payloads as text and passes [DONE] through', async () => {
    const out = await restoreSSE([`data: Hi ${NAME}\n\ndata: [DONE]\n\n`], vaultWith('Alice'));

    expect(out).toBe('data: Hi Alice\n\ndata: [DONE]\n\n');
  });
});

// A non-JSON `data:` payload is restored as text, so a line break in an
// original must not end the line: the rest would be read as new SSE fields.

interface SSEEvent {
  type: string;
  data: string;
  lastEventId: string;
}

// Parse SSE text the way a browser EventSource does (WHATWG HTML,
// "Interpreting an event stream").
function parseSSE(text: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  let data = '';
  let type = '';
  let lastEventId = '';
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line === '') {
      if (data !== '') {
        events.push({ type: type || 'message', data: data.slice(0, -1), lastEventId });
      }
      data = '';
      type = '';
      continue;
    }
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'data') data += `${value}\n`;
    else if (field === 'event') type = value;
    else if (field === 'id') lastEventId = value;
  }
  return events;
}

const BREAKING = 'Alice\n\nevent: injected\nid: 7\ndata: {}';

describe('SSE restore keeps an original with line breaks inside a text payload', () => {
  it('continues the original on new data lines instead of injecting fields', async () => {
    const out = await restoreSSE([`data: Hi ${NAME}!\n\n`], vaultWith(BREAKING));

    expect(parseSSE(out)).toEqual([{ type: 'message', data: `Hi ${BREAKING}!`, lastEventId: '' }]);
    expect(out).toBe(
      'data: Hi Alice\ndata: \ndata: event: injected\ndata: id: 7\ndata: data: {}!\n\n',
    );
  });

  it('turns CR, LF and CRLF into data lines in the line ending of the stream', async () => {
    const original = 'a\rb\r\nc\n d';

    const out = await restoreSSE([`data:${NAME}\r\n\r\n`], vaultWith(original));

    expect(out).toBe('data:a\r\ndata: b\r\ndata: c\r\ndata:  d\r\n\r\n');
    expect(parseSSE(out)).toEqual([{ type: 'message', data: 'a\nb\nc\n d', lastEventId: '' }]);
  });

  it('restores chunk-split tokens in a payload that is not valid JSON', async () => {
    const sse = `data: {"c":"${NAME}"\n\n`;

    const out = await restoreSSE([sse.slice(0, 20), sse.slice(20)], vaultWith(BREAKING));

    expect(parseSSE(out)).toEqual([
      { type: 'message', data: `{"c":"${BREAKING}"`, lastEventId: '' },
    ]);
  });

  it('keeps every byte when no original has a line break', async () => {
    const sse = `data:Hi ${NAME}\r\n\r\nevent: x\nid: 1\ndata: ${NAME} ${EMAIL} ${UNKNOWN}\n\n`;

    const out = await restoreSSE([sse], vaultWith('Alice'));

    expect(out).toBe(
      `data:Hi Alice\r\n\r\nevent: x\nid: 1\ndata: Alice ${RECIPIENT} ${UNKNOWN}\n\n`,
    );
  });

  it('applies to a buffered event-stream body in wrapFetch', async () => {
    const wrapped = wrapFetch({
      detectors: basicDetectors,
      vault: vaultWith(BREAKING),
      fetchImpl: async (): Promise<Response> =>
        new Response(`data: Hi ${NAME}\n\ndata: [DONE]\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        }),
    });

    const res = await wrapped('https://x.test');

    expect(parseSSE(await res.text())).toEqual([
      { type: 'message', data: `Hi ${BREAKING}`, lastEventId: '' },
      { type: 'message', data: '[DONE]', lastEventId: '' },
    ]);
  });
});

describe('wrapFetch restores JSON and event-stream bodies value by value', () => {
  function fetchReturning(body: string, contentType: string): typeof fetch {
    return wrapFetch({
      detectors: basicDetectors,
      vault: vaultWith(INJECTING_NAME),
      fetchImpl: async (): Promise<Response> =>
        new Response(body, { headers: { 'content-type': contentType } }),
    });
  }

  it('keeps an application/json body intact when an original contains quotes', async () => {
    const res = await fetchReturning(toolArgs, 'application/json; charset=utf-8')('https://x.test');

    expect(JSON.parse(await res.text())).toEqual(INJECTED);
  });

  it('changes only the restored string values of a JSON body', async () => {
    const body = `{\n  "id": 12345678901234567890,\n  "to": "${EMAIL}"\n}`;

    const res = await fetchReturning(body, 'application/json')('https://x.test');

    expect(await res.text()).toBe(body.replace(EMAIL, RECIPIENT));
  });

  it('restores each line of an NDJSON body on its own', async () => {
    const body = `${toolArgs}\n${JSON.stringify({ done: true, by: NAME })}\n`;

    const res = await fetchReturning(body, 'application/x-ndjson')('https://x.test');

    const lines = (await res.text()).split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0] ?? '')).toEqual(INJECTED);
    expect(JSON.parse(lines[1] ?? '')).toEqual({ done: true, by: INJECTING_NAME });
  });

  it('leaves a JSON-typed body that is not valid JSON tokenized', async () => {
    // Truncated upstream JSON: restored as text, this original would complete
    // it into a valid document with an extra key.
    const truncated = `{"to":"${RECIPIENT}","note":"${NAME}`;
    const safeFetch = wrapFetch({
      detectors: basicDetectors,
      vault: vaultWith('x", "bcc": "attacker@example.com"}'),
      fetchImpl: async (): Promise<Response> =>
        new Response(truncated, { headers: { 'content-type': 'application/json' } }),
    });

    const res = await safeFetch('https://x.test');

    expect(await res.text()).toBe(truncated);
  });

  it('restores the JSON data payloads of an event-stream body', async () => {
    const body = `data: ${toolArgs}\n\ndata: [DONE]\n\n`;

    const res = await fetchReturning(body, 'text/event-stream')('https://x.test');

    const text = await res.text();
    expect(text.slice(text.indexOf('\n'))).toBe('\n\ndata: [DONE]\n\n');
    expect(JSON.parse(text.slice('data: '.length, text.indexOf('\n')))).toEqual(INJECTED);
  });
});

describe('createExpressMiddleware restores JSON strings passed to res.send value by value', () => {
  // Mirrors Express: res.json serializes the object and hands the string to res.send.
  async function expressResponse(): Promise<{
    send(body?: unknown): unknown;
    json(body?: unknown): unknown;
    sent: unknown;
  }> {
    const res = {
      sent: undefined as unknown,
      send(body?: unknown): unknown {
        this.sent = body;
        return this;
      },
      json(body?: unknown): unknown {
        return this.send(JSON.stringify(body));
      },
    };
    const middleware = createExpressMiddleware({
      detectors: basicDetectors,
      vault: vaultWith(INJECTING_NAME),
    });
    await middleware({ body: undefined }, res, () => {});
    return res;
  }

  it('keeps a serialized JSON body intact when an original contains quotes', async () => {
    const res = await expressResponse();

    res.send(toolArgs);

    expect(JSON.parse(String(res.sent))).toEqual(INJECTED);
  });

  it('does not splice an original into a key on the res.json -> res.send path', async () => {
    const res = await expressResponse();

    res.json({ [NAME]: 'x', note: NAME });

    expect(JSON.parse(String(res.sent))).toEqual({ [NAME]: 'x', note: INJECTING_NAME });
  });
});

describe('wrapOpenAI JSON-mode content and opt-in tool-call arguments', () => {
  interface Reply {
    choices: Array<{
      message: {
        content: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
  }

  function clientReturning(message: Record<string, unknown>) {
    return {
      chat: {
        completions: {
          create: async (_request: unknown): Promise<unknown> => ({ choices: [{ message }] }),
        },
      },
    };
  }

  it.each(['json_object', 'json_schema'])('restores %s content value by value', async (type) => {
    const client = clientReturning({ content: toolArgs });
    const wrapped = wrapOpenAI(client, {
      detectors: basicDetectors,
      vault: vaultWith(INJECTING_NAME),
    });

    const reply = (await wrapped.chat.completions.create({
      messages: [],
      response_format: { type },
    })) as Reply;

    expect(JSON.parse(reply.choices[0]?.message.content ?? '')).toEqual(INJECTED);
  });

  it('leaves JSON-mode content that is not valid JSON tokenized', async () => {
    const truncated = toolArgs.slice(0, -2);
    const client = clientReturning({ content: truncated });
    const wrapped = wrapOpenAI(client, {
      detectors: basicDetectors,
      vault: vaultWith(INJECTING_NAME),
    });

    const reply = (await wrapped.chat.completions.create({
      messages: [],
      response_format: { type: 'json_object' },
    })) as Reply;

    expect(reply.choices[0]?.message.content).toBe(truncated);
  });

  it('restores tool-call arguments value by value when restoreToolArguments is set', async () => {
    const invalid = `{"to":"${EMAIL}"`;
    const client = clientReturning({
      content: null,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'send_email', arguments: toolArgs } },
        { id: 'call_2', type: 'function', function: { name: 'send_email', arguments: invalid } },
      ],
    });
    const wrapped = wrapOpenAI(client, {
      detectors: basicDetectors,
      vault: vaultWith(INJECTING_NAME),
      restoreToolArguments: true,
    });

    const reply = (await wrapped.chat.completions.create({ messages: [] })) as Reply;

    const calls = reply.choices[0]?.message.tool_calls ?? [];
    expect(calls.map((call) => [call.id, call.function.name])).toEqual([
      ['call_1', 'send_email'],
      ['call_2', 'send_email'],
    ]);
    expect(JSON.parse(calls[0]?.function.arguments ?? '')).toEqual(INJECTED);
    expect(calls[1]?.function.arguments).toBe(invalid);
  });
});

describe('wrapAnthropic JSON-mode text and opt-in tool_use input', () => {
  interface Reply {
    content: Array<{ type: string; text?: string; input?: unknown }>;
  }

  function clientReturning(content: unknown[]) {
    return {
      messages: {
        create: async (_request: unknown): Promise<unknown> => ({ content }),
      },
    };
  }

  it.each([
    ['output_config.format', { output_config: { format: { type: 'json_schema', schema: {} } } }],
    ['output_format', { output_format: { type: 'json_schema', schema: {} } }],
  ])('restores %s text value by value', async (_name, outputOption) => {
    const client = clientReturning([{ type: 'text', text: toolArgs }]);
    const wrapped = wrapAnthropic(client, {
      detectors: basicDetectors,
      vault: vaultWith(INJECTING_NAME),
    });

    const reply = (await wrapped.messages.create({ messages: [], ...outputOption })) as Reply;

    expect(JSON.parse(reply.content[0]?.text ?? '')).toEqual(INJECTED);
  });

  it('restores tool_use input value by value when restoreToolArguments is set', async () => {
    const input = { to: EMAIL, subject: `Hello ${NAME}` };
    const client = clientReturning([{ type: 'tool_use', id: 'toolu_1', name: 'send', input }]);
    const wrapped = wrapAnthropic(client, {
      detectors: basicDetectors,
      vault: vaultWith(INJECTING_NAME),
      restoreToolArguments: true,
    });

    const reply = (await wrapped.messages.create({ messages: [] })) as Reply;

    expect(reply.content[0]?.input).toEqual(INJECTED);
    expect(input).toEqual({ to: EMAIL, subject: `Hello ${NAME}` });
  });
});
