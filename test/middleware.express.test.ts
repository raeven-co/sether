import { describe, it, expect } from 'vitest';
import { createExpressMiddleware } from '../src/middleware/express.js';
import { basicDetectors } from '../src/detectors/basic.js';
import { MemoryVault } from '../src/vault/memory.js';

// Minimal Express-shaped req/res doubles.
interface FakeRes {
  sent: unknown;
  send(body?: unknown): FakeRes;
  json(body?: unknown): FakeRes;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    sent: undefined,
    send(body?: unknown) {
      this.sent = body;
      return this;
    },
    json(body?: unknown) {
      this.sent = body;
      return this;
    },
  };
  return res;
}

describe('createExpressMiddleware', () => {
  it('redacts a string request body and restores the response synchronously', async () => {
    const vault = new MemoryVault();
    const mw = createExpressMiddleware({ detectors: basicDetectors, vault });

    const req: { body: unknown } = { body: 'contact alice@example.com' };
    const res = makeRes();

    let nextErr: unknown = 'NOT_CALLED';
    await mw(req, res, (err?: unknown) => {
      nextErr = err;
    });

    // Request body redacted in place before the handler runs.
    expect(nextErr).toBeUndefined();
    const reqBody = req.body as string;
    expect(reqBody).not.toContain('alice@example.com');
    const token = reqBody.match(/<EMAIL_[0-9a-f-]+>/)?.[0];
    if (token === undefined) throw new Error('expected an EMAIL token in the redacted body');

    // Response path: res.send must (a) return `res` synchronously — NOT a
    // Promise — to honour Express's contract, and (b) restore tokens.
    const ret = res.send(`reply to ${token}`);
    expect(ret).toBe(res);
    expect(ret).not.toBeInstanceOf(Promise);
    expect(res.sent).toBe('reply to alice@example.com');
  });

  it('redacts nested JSON request bodies and leaves non-strings untouched', async () => {
    const vault = new MemoryVault();
    const mw = createExpressMiddleware({ detectors: basicDetectors, vault });

    const req: { body: unknown } = {
      body: { msg: 'mail bob@example.com', count: 5, nested: { ip: '192.168.1.1' } },
    };
    await mw(req, makeRes(), () => {});

    const body = req.body as { msg: string; count: number; nested: { ip: string } };
    expect(body.msg).not.toContain('bob@example.com');
    expect(body.msg).toMatch(/<EMAIL_[0-9a-f-]+>/);
    expect(body.count).toBe(5);
    expect(body.nested.ip).toMatch(/<IPV4_[0-9a-f-]+>/);
  });

  it('restores tokens inside a JSON response and returns res synchronously', async () => {
    const vault = new MemoryVault();
    const mw = createExpressMiddleware({ detectors: basicDetectors, vault });

    const req: { body: unknown } = { body: 'see carol@example.com' };
    const res = makeRes();
    await mw(req, res, () => {});

    const token = (req.body as string).match(/<EMAIL_[0-9a-f-]+>/)?.[0];
    if (token === undefined) throw new Error('expected an EMAIL token');

    const ret = res.json({ note: `address is ${token}`, ok: true });
    expect(ret).toBe(res);
    expect(res.sent).toEqual({ note: 'address is carol@example.com', ok: true });
  });

  it('passes binary res.send bodies through untouched', async () => {
    const vault = new MemoryVault();
    const mw = createExpressMiddleware({ detectors: basicDetectors, vault });
    const res = makeRes();
    await mw({ body: undefined }, res, () => {});

    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    res.send(buffer);
    expect(res.sent).toBe(buffer);

    const bytes = new Uint8Array([1, 2, 3]);
    res.send(bytes);
    expect(res.sent).toBe(bytes);
  });

  it('keeps non-plain objects in a JSON response and restores the plain ones', async () => {
    const vault = new MemoryVault();
    const mw = createExpressMiddleware({ detectors: basicDetectors, vault });

    const req: { body: unknown } = { body: 'see dave@example.com' };
    const res = makeRes();
    await mw(req, res, () => {});

    const token = (req.body as string).match(/<EMAIL_[0-9a-f-]+>/)?.[0];
    if (token === undefined) throw new Error('expected an EMAIL token');

    const sentAt = new Date('2026-10-14T00:00:00.000Z');
    const attachment = Buffer.from('raw');
    const meta: Record<string, unknown> = Object.create(null);
    meta.to = token;

    res.json({ sentAt, attachment, meta, items: [{ to: token }] });

    const sent = res.sent as Record<string, unknown>;
    expect(sent.sentAt).toBe(sentAt);
    expect(sent.attachment).toBe(attachment);
    expect(sent.meta).toEqual({ to: 'dave@example.com' });
    expect(sent.items).toEqual([{ to: 'dave@example.com' }]);
    expect(JSON.stringify(sent)).toContain('"sentAt":"2026-10-14T00:00:00.000Z"');
  });

  it('restores a non-plain object through the string Express res.json hands to res.send', async () => {
    const vault = new MemoryVault();
    const mw = createExpressMiddleware({ detectors: basicDetectors, vault });

    // Like Express: res.json serializes the body and calls this.send(string).
    const res = makeRes();
    res.json = function (body?: unknown) {
      return this.send(JSON.stringify(body));
    };
    const req: { body: unknown } = { body: 'see erin@example.com' };
    await mw(req, res, () => {});

    const token = (req.body as string).match(/<EMAIL_[0-9a-f-]+>/)?.[0];
    if (token === undefined) throw new Error('expected an EMAIL token');

    class Reply {
      constructor(readonly to: string) {}
    }
    res.json(new Reply(token));

    expect(JSON.parse(String(res.sent))).toEqual({ to: 'erin@example.com' });
  });

  it('keeps a "__proto__" key in JSON bodies as data, never as the prototype', async () => {
    const vault = new MemoryVault();
    const mw = createExpressMiddleware({ detectors: basicDetectors, vault });

    // What express.json() produces for a client-sent "__proto__" key: an own property.
    const req: { body: unknown } = {
      body: JSON.parse('{"__proto__":{"isAdmin":true},"note":"mail alice@example.com"}'),
    };
    const res = makeRes();
    await mw(req, res, () => {});

    const body = req.body as Record<string, unknown>;
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
    expect(body.isAdmin).toBeUndefined();
    expect(Object.keys(body)).toEqual(['__proto__', 'note']);

    res.json(JSON.parse('{"__proto__":{"isAdmin":true},"to":"x"}'));
    const sent = res.sent as Record<string, unknown>;
    expect(Object.getPrototypeOf(sent)).toBe(Object.prototype);
    expect(sent.isAdmin).toBeUndefined();
  });
});
