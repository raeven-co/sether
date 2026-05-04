import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { Sether } from '../src/index.js';

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk.toString());
  }
  return chunks.join('');
}

describe('Sether streaming', () => {
  it('redacts an email in a single chunk', async () => {
    const sether = new Sether();
    const input = Readable.from(['my email is bob@example.com today']);
    const result = await streamToString(input.pipe(sether.redact()));
    expect(result).not.toContain('bob@example.com');
    expect(result).toMatch(/<EMAIL_[0-9a-f-]+>/);
  });

  it('redacts then restores to the original (round-trip, single chunk)', async () => {
    const sether = new Sether();
    const original = 'contact bob@example.com about CC 4532015112830366';
    const redacted = await streamToString(Readable.from([original]).pipe(sether.redact()));
    expect(redacted).not.toContain('bob@example.com');
    expect(redacted).not.toContain('4532015112830366');
    const restored = await streamToString(Readable.from([redacted]).pipe(sether.restore()));
    expect(restored).toBe(original);
  });

  it('handles PII split across chunks (the v1 critical bug)', async () => {
    const sether = new Sether();
    const chunks = ['my email is foo@', 'bar.com today, more text to push past the safe distance buffer. '.repeat(10)];
    const input = Readable.from(chunks);
    const result = await streamToString(input.pipe(sether.redact()));
    expect(result).not.toContain('foo@bar.com');
    expect(result).toMatch(/<EMAIL_[0-9a-f-]+>/);
  });

  it('round-trips across many tiny single-character chunks', async () => {
    const sether = new Sether();
    const original = 'email me at alice@example.com or 192.168.1.1, end. ' + 'x'.repeat(300);
    const chunks = Array.from(original);
    const redacted = await streamToString(Readable.from(chunks).pipe(sether.redact()));
    expect(redacted).not.toContain('alice@example.com');
    expect(redacted).not.toContain('192.168.1.1');
    const restored = await streamToString(Readable.from([redacted]).pipe(sether.restore()));
    expect(restored).toBe(original);
  });

  it('restore handles tokens split across chunks', async () => {
    const sether = new Sether();
    const original = 'reach alice@example.com please';
    const redacted = await streamToString(Readable.from([original]).pipe(sether.redact()));
    // Split the redacted output mid-token
    const mid = Math.floor(redacted.length / 2);
    const chunks = [redacted.slice(0, mid), redacted.slice(mid)];
    const restored = await streamToString(Readable.from(chunks).pipe(sether.restore()));
    expect(restored).toBe(original);
  });

  it('passes through text with no PII unchanged', async () => {
    const sether = new Sether();
    const original = 'Just some plain text with no sensitive data at all. '.repeat(20);
    const redacted = await streamToString(Readable.from([original]).pipe(sether.redact()));
    expect(redacted).toBe(original);
  });

  it('handles multiple PII items in same chunk', async () => {
    const sether = new Sether();
    const original = 'a@b.co and c@d.io and 192.168.1.1';
    const redacted = await streamToString(Readable.from([original]).pipe(sether.redact()));
    expect(redacted).not.toContain('a@b.co');
    expect(redacted).not.toContain('c@d.io');
    expect(redacted).not.toContain('192.168.1.1');
    const restored = await streamToString(Readable.from([redacted]).pipe(sether.restore()));
    expect(restored).toBe(original);
  });
});
