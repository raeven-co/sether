import { describe, it, expect } from 'vitest';
import {
  aliasValue,
  suggestAliases,
  shapeAlias,
  AliasVault,
} from '../src/alias.js';
import { emailDetector, creditCardDetector, ipv4Detector, ipv6Detector, ibanDetector, phoneDetector } from '../src/detectors/basic.js';
import { openaiKeyDetector, awsAccessKeyDetector, jwtDetector } from '../src/detectors/secrets.js';

// Deterministic rng (mulberry32) so failures reproduce.
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rngOpts = () => ({ rng: mulberry32(42) });

describe('aliasValue — decoys are realistic and never the original', () => {
  it('NAME keeps word count', () => {
    const one = aliasValue('NAME', 'Godfrey', rngOpts());
    const two = aliasValue('NAME', 'Godfrey Lebo', rngOpts());
    expect(one.split(' ')).toHaveLength(1);
    expect(two.split(' ')).toHaveLength(2);
    expect(two).not.toBe('Godfrey Lebo');
  });

  it('EMAIL is well-formed on a reserved domain and re-detectable', () => {
    const alias = aliasValue('EMAIL', 'emory@gmail.com', rngOpts());
    expect(alias).toMatch(/@example\.(com|org|net)$/);
    expect(emailDetector.detect(alias)).toHaveLength(1);
  });

  it('US phone lands in the fictional 555-01XX block, format mirrors original', () => {
    const national = aliasValue('PHONE', '(415) 555-2671', rngOpts());
    expect(national).toMatch(/^\(\d{3}\) 555-01\d{2}$/);
    const intl = aliasValue('PHONE', '+14155552671', rngOpts());
    expect(intl.startsWith('+1')).toBe(true);
    expect(intl).toContain('555 01');
  });

  it('GB phone uses the Ofcom drama range', () => {
    expect(aliasValue('PHONE', '+447911123456', rngOpts())).toMatch(/^\+44 7700 900\d{3}$/);
  });

  it('NG intl phone stays NG-shaped', () => {
    const alias = aliasValue('PHONE', '+2348065786535', rngOpts());
    expect(alias).toMatch(/^\+234 803 555 \d{4}$/);
    expect(phoneDetector.detect(alias)).toHaveLength(1);
  });

  it('national-format unknown-region phone keeps trunk prefix and shape', () => {
    const alias = aliasValue('PHONE', '0806 578 6535', rngOpts());
    expect(alias).toMatch(/^08\d{2} \d{3} \d{4}$/);
    expect(alias).not.toBe('0806 578 6535');
  });

  it('CC is Luhn-valid, 16 digits, grouping mirrors original', () => {
    const alias = aliasValue('CC', '4242 4242 4242 4242', rngOpts());
    expect(alias).toMatch(/^\d{4} \d{4} \d{4} \d{4}$/);
    expect(creditCardDetector.detect(alias)).toHaveLength(1); // Luhn passes
    const plain = aliasValue('CC', '4242424242424242', rngOpts());
    expect(plain).toMatch(/^\d{16}$/);
  });

  it('SSN uses the SSA advertising range (never issued to a real person)', () => {
    const alias = aliasValue('SSN', '123-45-6789', rngOpts());
    expect(alias).toMatch(/^987-65-43\d{2}$/);
    const bare = aliasValue('SSN', '123456789', rngOpts());
    expect(bare).toMatch(/^9876543\d{2}$/);
  });

  it('IPv4 lands in RFC 5737 TEST-NET', () => {
    const alias = aliasValue('IPV4', '10.1.2.3', rngOpts());
    expect(alias).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/);
    expect(ipv4Detector.detect(alias)).toHaveLength(1);
  });

  it('IPv6 lands in the RFC 3849 documentation prefix', () => {
    const alias = aliasValue('IPV6', 'fe80::1', rngOpts());
    expect(alias.startsWith('2001:db8:')).toBe(true);
    expect(ipv6Detector.detect(alias)).toHaveLength(1);
  });

  it('IBAN passes mod-97 and re-detects', () => {
    const alias = aliasValue('IBAN', 'GB82 WEST 1234 5698 7654 32', rngOpts());
    expect(ibanDetector.detect(alias)).toHaveLength(1);
  });

  it('DOB mirrors the original format family', () => {
    expect(aliasValue('DOB', '1995-03-14', rngOpts())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(aliasValue('DOB', '14/03/1995', rngOpts())).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(aliasValue('DOB', 'March 14, 1995', rngOpts())).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  });

  it('OPENAI_KEY decoy keeps the vendor prefix and re-detects', () => {
    const real = 'sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z';
    const alias = aliasValue('OPENAI_KEY', real, rngOpts());
    expect(alias.startsWith('sk-proj-')).toBe(true);
    expect(alias).not.toBe(real);
    expect(alias).toHaveLength(real.length);
    expect(openaiKeyDetector.detect(alias)).toHaveLength(1);
  });

  it('AWS_KEY decoy keeps AKIA prefix and re-detects', () => {
    const alias = aliasValue('AWS_KEY', 'AKIAIOSFODNN7EXAMPLE', rngOpts());
    expect(alias.startsWith('AKIA')).toBe(true);
    expect(awsAccessKeyDetector.detect(alias)).toHaveLength(1);
  });

  it('JWT decoy is detector-visible', () => {
    const alias = aliasValue('JWT', 'eyJx.eyJy.z', rngOpts());
    expect(jwtDetector.detect(alias)).toHaveLength(1);
  });

  it('CREDENTIAL keeps the env var name, replaces the secret', () => {
    const alias = aliasValue('CREDENTIAL', 'DB_PASSWORD=hunter2secret', rngOpts());
    expect(alias.startsWith('DB_PASSWORD=')).toBe(true);
    expect(alias).not.toContain('hunter2secret');
  });

  it('DB_URI keeps the scheme, scrambles credentials and host', () => {
    const alias = aliasValue('DB_URI', 'mongodb+srv://user:pass@cluster0.mongodb.net/db', rngOpts());
    expect(alias.startsWith('mongodb+srv://')).toBe(true);
    expect(alias).not.toContain('cluster0');
  });

  it('unknown/custom types shape-preserve', () => {
    const alias = aliasValue('CUSTOM:emp-id', 'EMP-12345-ab', rngOpts());
    expect(alias).toMatch(/^[A-Z]{3}-\d{5}-[a-z]{2}$/);
    expect(alias).not.toBe('EMP-12345-ab');
  });
});

describe('suggestAliases', () => {
  it('returns the requested number of distinct suggestions, none the original', () => {
    const s = suggestAliases('NAME', 'Godfrey Lebo', 4, rngOpts());
    expect(s).toHaveLength(4);
    expect(new Set(s).size).toBe(4);
    expect(s).not.toContain('Godfrey Lebo');
  });

  it('works for every built-in type without throwing', () => {
    const samples: [string, string][] = [
      ['EMAIL', 'a@b.com'], ['PHONE', '+2348065786535'], ['CC', '4242424242424242'],
      ['SSN', '123-45-6789'], ['IPV4', '1.2.3.4'], ['IPV6', '2001:db8::1'],
      ['IBAN', 'GB82WEST12345698765432'], ['NAME', 'Ada Obi'], ['DOB', '01/02/1990'],
      ['ADDRESS', '12 Marina Rd, Lagos'], ['PASSPORT', 'A1234567'],
      ['JWT', 'eyJa.eyJb.c'], ['DB_URI', 'redis://u:p@h:6379'],
      ['CREDENTIAL', 'TOKEN=abc123'], ['PASSWORD', 'hunter2'],
      ['HIGH_ENTROPY', 'a1B2c3D4e5F6g7H8a1B2c3D4e5F6g7H8'],
    ];
    for (const [type, value] of samples) {
      const s = suggestAliases(type, value, 3, rngOpts());
      expect(s.length, `${type} suggestions`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('shapeAlias', () => {
  it('preserves length, punctuation, and character classes', () => {
    const alias = shapeAlias('Ab1-Cd2_e3', rngOpts());
    expect(alias).toMatch(/^[A-Z][a-z]\d-[A-Z][a-z]\d_[a-z]\d$/);
  });
});

describe('AliasVault', () => {
  it('assigns stable aliases per original', () => {
    const vault = new AliasVault();
    const a1 = vault.aliasFor('NAME', 'Godfrey Lebo', rngOpts());
    const a2 = vault.aliasFor('NAME', 'Godfrey Lebo', rngOpts());
    expect(a1).toBe(a2);
  });

  it('generated aliases are unique across originals', () => {
    const vault = new AliasVault();
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const alias = vault.aliasFor('NAME', `Person Number${i}`);
      expect(seen.has(alias)).toBe(false);
      seen.add(alias);
    }
  });

  it('set() refuses an alias already claimed by a different original', () => {
    const vault = new AliasVault();
    expect(vault.set('godfrey@gmail.com', 'jane.doe@example.com', 'EMAIL')).toBe(true);
    expect(vault.set('emory@gmail.com', 'jane.doe@example.com', 'EMAIL')).toBe(false);
    expect(vault.set('emory@gmail.com', 'john.smith@example.org', 'EMAIL')).toBe(true);
  });

  it('set() re-pointing the same original replaces its alias', () => {
    const vault = new AliasVault();
    vault.set('X', 'A', 'NAME');
    vault.set('X', 'B', 'NAME');
    expect(vault.aliasOf('X')).toBe('B');
    expect(vault.originalOf('A')).toBeUndefined();
    expect(vault.originalOf('B')).toBe('X');
  });

  it('apply()/restore() round-trip a realistic prompt', () => {
    const vault = new AliasVault();
    vault.set('Godfrey Lebo', 'John Doe', 'NAME');
    vault.set('emory@gmail.com', 'jane.doe@example.org', 'EMAIL');
    vault.set('+2348065786535', '+234 803 555 1234', 'PHONE');

    const original =
      'My name is Godfrey Lebo, my email address is emory@gmail.com, ' +
      'call me on +2348065786535. Sign off as Godfrey Lebo.';
    const applied = vault.apply(original);
    expect(applied).not.toContain('Godfrey Lebo');
    expect(applied).not.toContain('emory@gmail.com');
    expect(applied).not.toContain('+2348065786535');
    expect(applied).toContain('John Doe');
    // Multiple mentions all use the same alias, and the trip reverses cleanly.
    expect(applied.match(/John Doe/g)).toHaveLength(2);
    expect(vault.restore(applied)).toBe(original);
  });

  it('restore() works on AI-reply text containing the alias', () => {
    const vault = new AliasVault();
    vault.set('Godfrey Lebo', 'John Doe', 'NAME');
    const reply = 'Dear John Doe,\n\nThanks for reaching out. Best,\nJohn Doe’s assistant';
    expect(vault.restore(reply)).toBe(
      'Dear Godfrey Lebo,\n\nThanks for reaching out. Best,\nGodfrey Lebo’s assistant',
    );
  });

  it('substitutes longest-first so substring originals cannot clobber', () => {
    const vault = new AliasVault();
    vault.set('Ann', 'Mei', 'NAME');
    vault.set('Annabel Lee', 'Ingrid Hall', 'NAME');
    const applied = vault.apply('Annabel Lee met Ann.');
    expect(applied).toBe('Ingrid Hall met Mei.');
    expect(vault.restore(applied)).toBe('Annabel Lee met Ann.');
  });

  it('delete() and clear() drop mappings', () => {
    const vault = new AliasVault();
    vault.set('X', 'A', 'NAME');
    expect(vault.delete('X')).toBe(true);
    expect(vault.aliasOf('X')).toBeUndefined();
    vault.set('Y', 'B', 'NAME');
    vault.clear();
    expect(vault.size).toBe(0);
  });
});
