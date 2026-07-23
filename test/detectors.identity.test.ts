import { describe, it, expect } from 'vitest';
import {
  nameDetector,
  dobDetector,
  passportDetector,
  addressDetector,
} from '../src/detectors/identity.js';

describe('identity pack — multilingual labels (0.4.0)', () => {
  it('NAME: French label "Nom:"', () => {
    const m = nameDetector.detect('Nom: José Müller');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('José Müller');
  });

  it('NAME: Spanish label "Nombre:"', () => {
    const m = nameDetector.detect('Nombre: Carlos Ruiz');
    expect(m[0]?.value).toBe('Carlos Ruiz');
  });

  it('NAME: Japanese label "名前：" (fullwidth colon)', () => {
    const m = nameDetector.detect('名前：田中太郎');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('田中太郎');
  });

  it('NAME: Cyrillic label "Имя:"', () => {
    const m = nameDetector.detect('Имя: Иван Петров');
    expect(m[0]?.value).toBe('Иван Петров');
  });

  it('DOB: German label "Geburtsdatum:"', () => {
    const m = dobDetector.detect('Geburtsdatum: 1990-05-12');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('1990-05-12');
  });

  it('PASSPORT: German label "Reisepass:"', () => {
    const m = passportDetector.detect('Reisepass: A1234567');
    expect(m[0]?.value).toBe('A1234567');
  });

  it('ADDRESS: French label "Adresse:"', () => {
    const m = addressDetector.detect('Adresse: 12 Rue de la Paix, Paris 75002');
    expect(m.some((x) => x.value.includes('Rue de la Paix'))).toBe(true);
  });
});

describe('identity pack — correctness fixes (0.4.0)', () => {
  it('DOB does not carve a date out of a longer number (no digit leak)', () => {
    // "19999" must not match as "1999" leaving a stray "9".
    expect(dobDetector.detect('DOB: 1/1/19999')).toHaveLength(0);
  });

  it('NAME keeps the surname across a double space', () => {
    const m = nameDetector.detect('Name: John  Smith');
    expect(m[0]?.value).toBe('John  Smith');
  });

  it('NAME rejects salutation + common-noun ("Dear Sir")', () => {
    expect(nameDetector.detect('Dear Sir, thanks')).toHaveLength(0);
  });

  it('NAME rejects an all-common-words value ("Name: The Customer")', () => {
    expect(nameDetector.detect('Name: The Customer')).toHaveLength(0);
  });
});

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

describe('identity pack — JSON / structured-data keys (0.6.0)', () => {
  it('NAME: catches "customer_name": "…"', () => {
    const m = nameDetector.detect('{ "customer_name": "Amara Okafor" }');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('Amara Okafor');
  });

  it('NAME: catches snake, camel, and spaced keys', () => {
    expect(nameDetector.detect('"full_name": "John Smith"')[0]?.value).toBe('John Smith');
    expect(nameDetector.detect('"firstName": "Marie Curie"')[0]?.value).toBe('Marie Curie');
    expect(nameDetector.detect('"patient name": "Ada Lovelace"')[0]?.value).toBe('Ada Lovelace');
  });

  it('NAME: does NOT over-fire on filename / lowercase username values', () => {
    expect(nameDetector.detect('"filename": "report.pdf"')).toHaveLength(0);
    expect(nameDetector.detect('"username": "amara_dev"')).toHaveLength(0);
  });

  it('DOB: catches "date_of_birth" and "dob" keys, validates the date', () => {
    expect(dobDetector.detect('"date_of_birth": "1990-05-12"')[0]?.value).toBe('1990-05-12');
    expect(dobDetector.detect('"dob": "1985-01-30"')[0]?.value).toBe('1985-01-30');
    // implausible / non-date values are rejected
    expect(dobDetector.detect('"birth_place": "Lagos"')).toHaveLength(0);
    expect(dobDetector.detect('"date_of_birth": "2099-01-01"')).toHaveLength(0);
  });

  it('PASSPORT: catches "passport_number": "…"', () => {
    expect(passportDetector.detect('"passport_number": "A1234567"')[0]?.value).toBe('A1234567');
    expect(passportDetector.detect('"passport": "VALIDONLY"')).toHaveLength(0); // no digit
  });

  it('ADDRESS: catches "billing_address": "…" and lifts it cleanly (no trailing quote)', () => {
    const m = addressDetector.detect('"billing_address": "12 Marina Road, Lagos",');
    expect(m.some((x) => x.value === '12 Marina Road, Lagos')).toBe(true);
    // the captured value must not include the JSON closing quote
    expect(m.every((x) => !x.value.includes('"'))).toBe(true);
  });

  it('does NOT fire on natural-language prose (requires the "key": shape)', () => {
    expect(nameDetector.detect('the name is unknown right now')).toHaveLength(0);
    expect(dobDetector.detect('the birth of a nation was in 1915 somewhere')).toHaveLength(0);
  });
});
