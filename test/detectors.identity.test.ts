import { describe, it, expect } from 'vitest';
import {
  nameDetector,
  dobDetector,
  passportDetector,
  addressDetector,
} from '../src/detectors/identity.js';

describe('nameDetector (label-anchored)', () => {
  it('captures a labelled full name', () => {
    const m = nameDetector.detect('Name: John Smith');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('John Smith');
  });

  it('captures a name after a salutation', () => {
    const m = nameDetector.detect('Dear Alice Johnson, your order shipped.');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('Alice Johnson');
  });

  it('captures a non-English (diacritic) name', () => {
    const m = nameDetector.detect('Name: José Müller');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('José Müller');
  });

  it('captures an uncased-script (CJK) name', () => {
    const m = nameDetector.detect('Patient: 田中太郎 arrived');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('田中太郎');
  });

  it('does not fire on "filename" or "username" (word-boundary safe)', () => {
    expect(nameDetector.detect('filename: report.pdf')).toHaveLength(0);
    expect(nameDetector.detect('username: not_a_name')).toHaveLength(0);
  });

  it('rejects lowercase / non-name values after the label', () => {
    expect(nameDetector.detect('the name is unknown right now')).toHaveLength(0);
  });

  it('rejects denylisted placeholder values', () => {
    expect(nameDetector.detect('Name: Unknown')).toHaveLength(0);
  });

  it('offsets point at the value, not the label', () => {
    const text = 'Customer: Bob Lee';
    const m = nameDetector.detect(text);
    expect(m).toHaveLength(1);
    expect(text.slice(m[0]!.start, m[0]!.end)).toBe('Bob Lee');
  });
});

describe('dobDetector (label-anchored, calendar-validated)', () => {
  it('matches an ISO date of birth', () => {
    const m = dobDetector.detect('DOB: 1990-05-12');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('1990-05-12');
  });

  it('matches a written date of birth', () => {
    const m = dobDetector.detect('Date of birth: 12 January 1985');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('12 January 1985');
  });

  it('matches a numeric date of birth', () => {
    const m = dobDetector.detect('born 03/04/1978 in Lagos');
    expect(m).toHaveLength(1);
  });

  it('rejects an implausible (future) birth year', () => {
    expect(dobDetector.detect('DOB: 2099-01-01')).toHaveLength(0);
  });

  it('rejects an invalid calendar date', () => {
    expect(dobDetector.detect('DOB: 1990-13-40')).toHaveLength(0);
  });

  it('does not fire on an unlabelled date', () => {
    expect(dobDetector.detect('Invoice dated 2024-01-15')).toHaveLength(0);
  });
});

describe('passportDetector (label-anchored)', () => {
  it('matches a labelled passport number', () => {
    const m = passportDetector.detect('Passport No: A1234567');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('A1234567');
  });

  it('matches a 9-digit passport number', () => {
    const m = passportDetector.detect('passport 123456789 issued');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('123456789');
  });

  it('requires at least one digit (rejects pure letters)', () => {
    expect(passportDetector.detect('passport: VALIDONLY')).toHaveLength(0);
  });

  it('does not fire on an unlabelled alphanumeric token', () => {
    expect(passportDetector.detect('order id A1234567 shipped')).toHaveLength(0);
  });
});

describe('addressDetector', () => {
  it('captures a labelled address line', () => {
    const m = addressDetector.detect('Address: 221B Baker Street, London');
    expect(m.length).toBeGreaterThanOrEqual(1);
    expect(m.some((x) => x.value.includes('221B Baker Street'))).toBe(true);
  });

  it('captures a standalone street line (number + suffix)', () => {
    const m = addressDetector.detect('Ship to 1600 Pennsylvania Avenue today');
    expect(m.some((x) => x.value.includes('1600 Pennsylvania Avenue'))).toBe(true);
  });

  it('captures a UK postcode', () => {
    const m = addressDetector.detect('Postcode SW1A 1AA confirmed');
    expect(m.some((x) => x.value.replace(/\s/g, '') === 'SW1A1AA')).toBe(true);
  });

  it('does not fire on a labelled line with no address-like content', () => {
    expect(addressDetector.detect('Address: see above')).toHaveLength(0);
  });
});
