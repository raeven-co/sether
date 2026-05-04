import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import fc from 'fast-check';
import { Sether } from '../src/index.js';

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk.toString());
  }
  return chunks.join('');
}

function partition(s: string, partitionPoints: number[]): string[] {
  if (s.length === 0) return [s];
  const cuts = [...new Set(partitionPoints.map((p) => Math.floor(p * s.length)))]
    .filter((c) => c > 0 && c < s.length)
    .sort((a, b) => a - b);
  if (cuts.length === 0) return [s];
  const out: string[] = [];
  let last = 0;
  for (const c of cuts) {
    out.push(s.slice(last, c));
    last = c;
  }
  out.push(s.slice(last));
  return out;
}

describe('property: redact-then-restore is identity for any chunk partition', () => {
  it('round-trips arbitrary text under arbitrary chunk splits', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 500 }),
        fc.array(fc.float({ min: 0, max: 1, noNaN: true }), { maxLength: 15 }),
        async (text, partitionPoints) => {
          const sether = new Sether();
          const chunks = partition(text, partitionPoints);
          const redacted = await streamToString(Readable.from(chunks).pipe(sether.redact()));
          const restored = await streamToString(Readable.from([redacted]).pipe(sether.restore()));
          expect(restored).toBe(text);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('round-trips text with embedded PII under arbitrary chunk splits', async () => {
    const piiBlobs = [
      'alice@example.com',
      'bob@mail.example.co.uk',
      '192.168.1.1',
      '10.0.0.1',
      '4532015112830366',
      '4532 0151 1283 0366',
      '123-45-6789',
    ];
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.constantFrom(...piiBlobs),
            fc.constantFrom(' ', ', ', '. ', ' and ', '\n', ' regular text '),
          ),
          { minLength: 1, maxLength: 12 },
        ),
        fc.array(fc.float({ min: 0, max: 1, noNaN: true }), { maxLength: 15 }),
        async (parts, partitionPoints) => {
          const text = parts.join('');
          const sether = new Sether();
          const chunks = partition(text, partitionPoints);
          const redacted = await streamToString(Readable.from(chunks).pipe(sether.redact()));
          const restored = await streamToString(Readable.from([redacted]).pipe(sether.restore()));
          expect(restored).toBe(text);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('redacted output never contains the original PII (across chunk splits)', async () => {
    const pii = 'alice@example.com';
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.float({ min: 0, max: 1, noNaN: true }), { maxLength: 15 }),
        async (partitionPoints) => {
          const text = `prefix text ${pii} suffix text ${'x'.repeat(300)}`;
          const sether = new Sether();
          const chunks = partition(text, partitionPoints);
          const redacted = await streamToString(Readable.from(chunks).pipe(sether.redact()));
          expect(redacted).not.toContain(pii);
        },
      ),
      { numRuns: 30 },
    );
  });
});
