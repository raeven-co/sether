import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { createSSERedactStream, createSSERestoreStream } from '../src/stream/sse.js';
import { basicDetectors } from '../src/detectors/basic.js';
import { MemoryVault } from '../src/vault/memory.js';

async function pipeToString(stream: NodeJS.ReadableStream): Promise<string> {
  let out = '';
  for await (const chunk of stream) out += chunk.toString();
  return out;
}

describe('SSE-aware redact / restore', () => {
  it('redacts PII inside data: lines while preserving SSE framing', async () => {
    const vault = new MemoryVault();
    const redact = createSSERedactStream({ detectors: basicDetectors, vault });
    const sse =
      'data: User email is alice@example.com\n' +
      'event: message\n' +
      'data: Call +1 415 555 2671 about it\n' +
      '\n';
    const out = await pipeToString(Readable.from([sse]).pipe(redact));
    // Field labels untouched
    expect(out).toContain('event: message');
    // Empty separator preserved
    expect(out).toContain('\n\n');
    // PII tokenised inside data: lines
    expect(out).not.toContain('alice@example.com');
    expect(out).not.toContain('+1 415 555 2671');
    expect(out).toMatch(/data: User email is <EMAIL_/);
  });

  it('round-trips redact → restore to identity for SSE streams', async () => {
    const vault = new MemoryVault();
    const original =
      'data: Sarah Chen <sarah@acme.com> called from 192.168.1.1\n' +
      'event: update\n' +
      'data: Order 4532-0151-1283-0366 ready\n' +
      '\n';

    const redact = createSSERedactStream({ detectors: basicDetectors, vault });
    const redacted = await pipeToString(Readable.from([original]).pipe(redact));

    const restore = createSSERestoreStream({ vault });
    const restored = await pipeToString(Readable.from([redacted]).pipe(restore));

    expect(restored).toBe(original);
  });

  it('passes comment lines and unknown SSE fields through verbatim', async () => {
    const vault = new MemoryVault();
    const redact = createSSERedactStream({ detectors: basicDetectors, vault });
    const sse = ': this is a comment\nid: 42\nretry: 1000\ndata: alice@example.com\n\n';
    const out = await pipeToString(Readable.from([sse]).pipe(redact));
    expect(out).toContain(': this is a comment');
    expect(out).toContain('id: 42');
    expect(out).toContain('retry: 1000');
    expect(out).not.toContain('alice@example.com');
  });

  it('handles SSE lines with no space after `data:`', async () => {
    const vault = new MemoryVault();
    const redact = createSSERedactStream({ detectors: basicDetectors, vault });
    const sse = 'data:alice@example.com\n\n';
    const out = await pipeToString(Readable.from([sse]).pipe(redact));
    // Preserves the no-space form
    expect(out.startsWith('data:<EMAIL_') || out.startsWith('data:<')).toBe(true);
    expect(out).not.toContain('alice@example.com');
  });
});
