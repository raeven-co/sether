import type { AuditEvent, AuditSink } from './types.js';

// Minimal reference AuditSink — writes one JSON line per event to stderr by
// default. Useful for local development and as a template for production
// sinks (Datadog, Splunk, Logpush, R2, etc.).
//
// Sinks are intentionally simple — one method. Anything more complex (batching,
// retries, structured forwarding) lives in your own adapter.

export interface ConsoleAuditSinkOptions {
  /** Where to write the line. Defaults to process.stderr.write. */
  write?: (line: string) => void;
  /** Pretty-print with 2-space indent (default false — JSONL). */
  pretty?: boolean;
}

export class ConsoleAuditSink implements AuditSink {
  readonly #write: (line: string) => void;
  readonly #pretty: boolean;

  constructor(opts: ConsoleAuditSinkOptions = {}) {
    this.#write = opts.write ?? ((line) => process.stderr.write(line));
    this.#pretty = opts.pretty ?? false;
  }

  write(event: AuditEvent): void {
    const json = this.#pretty ? JSON.stringify(event, null, 2) : JSON.stringify(event);
    this.#write(json + '\n');
  }
}

// Even simpler sink — accumulates events in memory. Used by tests and by the
// in-browser sandbox.
export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  write(event: AuditEvent): void {
    this.events.push(event);
  }
  clear(): void {
    this.events.length = 0;
  }
}
