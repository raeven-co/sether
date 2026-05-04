import { describe, it, expect } from 'vitest';
import { MemoryVault } from '../src/vault/memory.js';

describe('MemoryVault', () => {
  it('stores and retrieves values', () => {
    const v = new MemoryVault();
    v.set('a', 'alpha');
    expect(v.get('a')).toBe('alpha');
  });

  it('returns undefined for unknown tokens', () => {
    const v = new MemoryVault();
    expect(v.get('nope')).toBeUndefined();
  });

  it('expires entries past TTL', async () => {
    const v = new MemoryVault({ ttlMs: 10 });
    v.set('a', 'alpha');
    expect(v.get('a')).toBe('alpha');
    await new Promise((r) => setTimeout(r, 20));
    expect(v.get('a')).toBeUndefined();
  });

  it('evicts oldest entry when over maxEntries', () => {
    const v = new MemoryVault({ maxEntries: 2 });
    v.set('a', '1');
    v.set('b', '2');
    v.set('c', '3');
    expect(v.get('a')).toBeUndefined();
    expect(v.get('b')).toBe('2');
    expect(v.get('c')).toBe('3');
  });

  it('LRU touch on get prevents eviction', () => {
    const v = new MemoryVault({ maxEntries: 2 });
    v.set('a', '1');
    v.set('b', '2');
    v.get('a');
    v.set('c', '3');
    expect(v.get('a')).toBe('1');
    expect(v.get('b')).toBeUndefined();
    expect(v.get('c')).toBe('3');
  });

  it('clears all entries', () => {
    const v = new MemoryVault();
    v.set('a', '1');
    v.set('b', '2');
    v.clear();
    expect(v.size()).toBe(0);
    expect(v.get('a')).toBeUndefined();
  });
});
