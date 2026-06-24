import { describe, it, expect } from 'vitest';
import { redactSync, restoreSync } from '../src/index.js';
import { basicDetectors } from '../src/detectors/basic.js';
import { MemoryVault } from '../src/vault/memory.js';

describe('redactSync / restoreSync', () => {
  it('round-trips a complete string back to the original', () => {
    const vault = new MemoryVault();
    const original = 'Contact alice@example.com or 192.168.1.1 about CC 4532015112830366.';

    const redacted = redactSync(original, { detectors: basicDetectors, vault });
    expect(redacted).not.toContain('alice@example.com');
    expect(redacted).not.toContain('192.168.1.1');
    expect(redacted).not.toContain('4532015112830366');
    expect(redacted).toMatch(/<EMAIL_[0-9a-f-]+>/);

    const restored = restoreSync(redacted, { vault });
    expect(restored).toBe(original);
  });

  it('leaves a token with no vault entry untouched', () => {
    const vault = new MemoryVault();
    const text = 'see <EMAIL_00000000-0000-0000-0000-000000000000> here';
    expect(restoreSync(text, { vault })).toBe(text);
  });

  it('is a no-op on text containing no tokens', () => {
    const vault = new MemoryVault();
    expect(restoreSync('just plain text, nothing to restore', { vault })).toBe(
      'just plain text, nothing to restore',
    );
  });

  it('does not corrupt output when a vault returns a non-string (async misuse)', () => {
    // A Vault whose get() mistakenly returns a Promise must not yield
    // "[object Promise]" — the token is left in place instead.
    const original = 'mail bob@example.com';
    const memory = new MemoryVault();
    const redacted = redactSync(original, { detectors: basicDetectors, vault: memory });

    const asyncVault = {
      set() {},
      get(token: string) {
        return Promise.resolve(memory.get(token)) as unknown as string | undefined;
      },
      has: () => false,
      delete: () => false,
      size: () => 0,
      clear() {},
    };
    const restored = restoreSync(redacted, { vault: asyncVault });
    expect(restored).not.toContain('[object Promise]');
    expect(restored).toBe(redacted); // token left intact, no corruption
  });
});
