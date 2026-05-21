import type { Transform } from 'node:stream';
import { createRedactStream, type RedactStreamOptions } from './stream/redact.js';
import { createRestoreStream, type RestoreStreamOptions } from './stream/restore.js';
import { MemoryVault } from './vault/memory.js';
import type { Vault } from './vault/types.js';
import type { Detector } from './detectors/types.js';
import {
  basicDetectors,
  emailDetector,
  creditCardDetector,
  ssnDetector,
  ipv4Detector,
  ipv6Detector,
  ibanDetector,
  phoneDetector,
} from './detectors/basic.js';

export interface SetherOptions {
  detectors?: readonly Detector[];
  vault?: Vault;
  safeDistanceBytes?: number;
}

export class Sether {
  readonly #detectors: readonly Detector[];
  readonly #vault: Vault;
  readonly #safeDistance: number;

  constructor(opts: SetherOptions = {}) {
    this.#detectors = opts.detectors ?? basicDetectors;
    this.#vault = opts.vault ?? new MemoryVault();
    this.#safeDistance = opts.safeDistanceBytes ?? 256;
  }

  redact(): Transform {
    return createRedactStream({
      detectors: this.#detectors,
      vault: this.#vault,
      safeDistanceBytes: this.#safeDistance,
    });
  }

  restore(): Transform {
    return createRestoreStream({ vault: this.#vault });
  }

  get vault(): Vault {
    return this.#vault;
  }

  get detectors(): readonly Detector[] {
    return this.#detectors;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public exports
// ─────────────────────────────────────────────────────────────────────────────

// Core
export { MemoryVault, createRedactStream, createRestoreStream };
export { redactSync } from './stream/redact.js';
export type { RedactSyncOptions } from './stream/redact.js';

// Detectors — basic pack
export {
  basicDetectors,
  emailDetector,
  creditCardDetector,
  ssnDetector,
  ipv4Detector,
  ipv6Detector,
  ibanDetector,
  phoneDetector,
};

// Detectors — secrets pack (new in 0.2.0)
export {
  secretsDetectors,
  awsAccessKeyDetector,
  openaiKeyDetector,
  anthropicKeyDetector,
  githubPatDetector,
  slackTokenDetector,
  stripeKeyDetector,
  jwtDetector,
  highEntropyDetector,
} from './detectors/secrets.js';

// SSE / JSON-stream mode (new in 0.2.0)
export { createSSERedactStream, createSSERestoreStream } from './stream/sse.js';
export type { SSEStreamOptions } from './stream/sse.js';

// Audit (new in 0.2.0)
export type { AuditEvent, AuditSink, RegulationMapping } from './audit/types.js';
export { DEFAULT_REGULATION_MAPPINGS } from './audit/types.js';
export { ConsoleAuditSink, MemoryAuditSink } from './audit/console.js';
export type { ConsoleAuditSinkOptions } from './audit/console.js';

// Middleware (new in 0.2.0)
export { wrapFetch } from './middleware/fetch.js';
export type { WrapFetchOptions } from './middleware/fetch.js';
export { createExpressMiddleware } from './middleware/express.js';
export type { ExpressMiddlewareOptions } from './middleware/express.js';
export { wrapOpenAI } from './middleware/openai.js';
export type { WrapOpenAIOptions } from './middleware/openai.js';
export { wrapAnthropic } from './middleware/anthropic.js';
export type { WrapAnthropicOptions } from './middleware/anthropic.js';

// Types
export type { Detector, Vault };
export type { RedactStreamOptions, RestoreStreamOptions };
export type { DetectorMatch } from './detectors/types.js';
export type { MemoryVaultOptions } from './vault/memory.js';
