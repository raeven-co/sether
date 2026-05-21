import { describe, it, expect } from 'vitest';
import { ConsoleAuditSink, MemoryAuditSink } from '../src/audit/console.js';
import { DEFAULT_REGULATION_MAPPINGS } from '../src/audit/types.js';
import type { AuditEvent } from '../src/audit/types.js';

describe('audit/types — default regulation mappings', () => {
  it('maps every basic detector type', () => {
    for (const t of ['EMAIL', 'PHONE', 'CC', 'SSN', 'IPV4', 'IPV6', 'IBAN']) {
      expect(DEFAULT_REGULATION_MAPPINGS[t]).toBeDefined();
      expect(DEFAULT_REGULATION_MAPPINGS[t]?.length).toBeGreaterThan(0);
    }
  });

  it('maps every secrets detector type', () => {
    for (const t of [
      'AWS_KEY',
      'OPENAI_KEY',
      'ANTHROPIC_KEY',
      'GITHUB_PAT',
      'SLACK_TOKEN',
      'STRIPE_KEY',
      'JWT',
      'HIGH_ENTROPY',
    ]) {
      expect(DEFAULT_REGULATION_MAPPINGS[t]).toBeDefined();
    }
  });
});

describe('MemoryAuditSink', () => {
  it('accumulates events', () => {
    const sink = new MemoryAuditSink();
    const event: AuditEvent = {
      timestamp: '2026-05-21T12:34:56.789Z',
      detector: 'EMAIL',
      valueLength: 17,
      token: '<EMAIL_abc>',
      action: 'REDACTED',
    };
    sink.write(event);
    sink.write({ ...event, action: 'RESTORED' });
    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]?.action).toBe('REDACTED');
    expect(sink.events[1]?.action).toBe('RESTORED');
  });

  it('clear() empties the buffer', () => {
    const sink = new MemoryAuditSink();
    sink.write({
      timestamp: 'x',
      detector: 'EMAIL',
      valueLength: 1,
      token: 't',
      action: 'REDACTED',
    });
    sink.clear();
    expect(sink.events).toHaveLength(0);
  });
});

describe('ConsoleAuditSink', () => {
  it('writes a JSONL line per event by default', () => {
    const lines: string[] = [];
    const sink = new ConsoleAuditSink({ write: (l) => lines.push(l) });
    sink.write({
      timestamp: '2026-05-21T00:00:00Z',
      detector: 'OPENAI_KEY',
      valueLength: 51,
      token: '<OPENAI_KEY_xyz>',
      action: 'REDACTED',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(lines[0]!.trim());
    expect(parsed.detector).toBe('OPENAI_KEY');
    expect(parsed.action).toBe('REDACTED');
  });

  it('pretty mode emits multi-line JSON', () => {
    const lines: string[] = [];
    const sink = new ConsoleAuditSink({ write: (l) => lines.push(l), pretty: true });
    sink.write({
      timestamp: '2026-05-21T00:00:00Z',
      detector: 'EMAIL',
      valueLength: 10,
      token: '<t>',
      action: 'REDACTED',
    });
    expect(lines[0]?.includes('\n')).toBe(true);
  });

  it('never leaks the original value (only valueLength is in the event)', () => {
    // Compile-time check via the type, but assert at runtime that no shape
    // accidentally captures the original.
    const sink = new MemoryAuditSink();
    sink.write({
      timestamp: 'x',
      detector: 'EMAIL',
      valueLength: 17,
      token: '<EMAIL_x>',
      action: 'REDACTED',
    });
    const recorded = sink.events[0]!;
    expect(Object.keys(recorded)).not.toContain('value');
  });
});
