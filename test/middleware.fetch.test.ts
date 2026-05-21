import { describe, it, expect } from 'vitest';
import { wrapFetch } from '../src/middleware/fetch.js';
import { basicDetectors } from '../src/detectors/basic.js';
import { MemoryVault } from '../src/vault/memory.js';

describe('wrapFetch', () => {
  it('redacts string body before calling fetch + restores text response', async () => {
    const vault = new MemoryVault();
    let seenByServer = '';
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      seenByServer = typeof init?.body === 'string' ? init.body : '';
      // Echo the body back so the test can see the redacted token shape.
      return new Response(seenByServer, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    };

    const safeFetch = wrapFetch({ detectors: basicDetectors, vault, fetchImpl: fakeFetch });

    const original = 'Please email alice@example.com about order 4532-0151-1283-0366';
    const res = await safeFetch('https://example.test/echo', {
      method: 'POST',
      body: original,
    });
    const restored = await res.text();

    // Server saw tokens, not PII
    expect(seenByServer).not.toContain('alice@example.com');
    expect(seenByServer).not.toContain('4532-0151-1283-0366');
    expect(seenByServer).toMatch(/<EMAIL_/);

    // Caller got the original values back
    expect(restored).toContain('alice@example.com');
    expect(restored).toContain('4532-0151-1283-0366');
    expect(restored).toBe(original);
  });

  it('passes binary / non-string bodies through untouched', async () => {
    const vault = new MemoryVault();
    const blob = new Blob(['alice@example.com'], { type: 'application/octet-stream' });
    let seenContentType = '';
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      seenContentType =
        (init?.headers && (init.headers as Record<string, string>)['content-type']) ?? 'none';
      return new Response('binary-ok', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    };
    const safeFetch = wrapFetch({ detectors: basicDetectors, vault, fetchImpl: fakeFetch });
    await safeFetch('https://example.test/upload', {
      method: 'POST',
      body: blob,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(seenContentType).toBe('application/octet-stream');
  });

  it('does not touch responses with non-text content types', async () => {
    const vault = new MemoryVault();
    const binaryBytes = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG magic
    const fakeFetch = async (): Promise<Response> =>
      new Response(binaryBytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    const safeFetch = wrapFetch({ detectors: basicDetectors, vault, fetchImpl: fakeFetch });
    const res = await safeFetch('https://example.test/img');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(bytes[2]).toBe(0xff);
  });
});
