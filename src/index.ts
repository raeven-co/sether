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
}

export {
  MemoryVault,
  basicDetectors,
  emailDetector,
  creditCardDetector,
  ssnDetector,
  ipv4Detector,
  ipv6Detector,
  ibanDetector,
  phoneDetector,
  createRedactStream,
  createRestoreStream,
};

export type { Detector, Vault };
export type { RedactStreamOptions, RestoreStreamOptions };
export type { DetectorMatch } from './detectors/types.js';
export type { MemoryVaultOptions } from './vault/memory.js';
