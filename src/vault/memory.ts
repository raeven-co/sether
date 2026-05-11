import type { Vault } from './types.js';

export interface MemoryVaultOptions {
  /** Maximum entries before LRU eviction. Default 10_000. */
  maxEntries?: number;
  /** Time-to-live in milliseconds per entry. Default 1 hour. */
  ttlMs?: number;
}

interface Entry {
  value: string;
  expiresAt: number;
}

export class MemoryVault implements Vault {
  readonly #maxEntries: number;
  readonly #ttlMs: number;
  readonly #store = new Map<string, Entry>();

  constructor(opts: MemoryVaultOptions = {}) {
    this.#maxEntries = opts.maxEntries ?? 10_000;
    this.#ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
  }

  set(token: string, value: string): void {
    this.#store.delete(token);
    this.#store.set(token, { value, expiresAt: Date.now() + this.#ttlMs });
    while (this.#store.size > this.#maxEntries) {
      const oldest = this.#store.keys().next().value;
      if (oldest === undefined) break;
      this.#store.delete(oldest);
    }
  }

  get(token: string): string | undefined {
    const entry = this.#store.get(token);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.#store.delete(token);
      return undefined;
    }
    this.#store.delete(token);
    this.#store.set(token, entry);
    return entry.value;
  }

  has(token: string): boolean {
    return this.get(token) !== undefined;
  }

  delete(token: string): boolean {
    return this.#store.delete(token);
  }

  size(): number {
    const now = Date.now();
    for (const [key, entry] of this.#store) {
      if (entry.expiresAt < now) {
        this.#store.delete(key);
      }
    }
    return this.#store.size;
  }

  clear(): void {
    this.#store.clear();
  }
}
