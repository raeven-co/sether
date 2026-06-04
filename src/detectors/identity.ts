import type { Detector, DetectorMatch } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Identity detector pack  (opt-in — NOT part of `basicDetectors`)
//
//  These cover the higher-context PII classes — names, dates of birth,
//  passport numbers, and postal addresses — that have no self-validating
//  shape the way an IBAN or credit card does. A bare regex for "any human
//  name" or "any address" is a false-positive machine, so instead we use
//  LABEL-ANCHORED detection: we only redact a value when it appears next to
//  the label that introduces it ("Name:", "DOB:", "Passport No:",
//  "Address:") or, for the few distinctive shapes that stand alone (street
//  line with a house number + street suffix, UK postcode), a structural
//  pattern strong enough to keep false positives low.
//
//  Design rules (identical discipline to detectors/basic.ts):
//    • Every regex literal is a single bounded character class or a fixed
//      alternation — no nested quantifiers, no backtracking surface. The CI
//      scanner (scripts/check-regex-safety.mjs, safe-regex2) enforces this.
//    • We over-match a small candidate window with a simple regex, then do
//      the precise extraction and validation in plain code.
//
//  Multilingual (new in 0.4.0): each class is anchored on labels in many
//  languages. Latin-script labels (English, French, Spanish, German, Dutch,
//  Portuguese, Italian) use ASCII word boundaries; non-Latin labels (CJK,
//  Cyrillic, Arabic) are anchored on a trailing colon instead, since `\b` is
//  ASCII-only. Value capture is Unicode-aware throughout, so "Nom: José
//  Müller", "名前: 田中太郎", and "Имя: Иван Петров" are all redacted.
//
//  Known limitation: free-text NER (unlabelled names / organisations /
//  locations in running prose) is NOT covered here — that needs the ONNX
//  model shipping in the separate `@raeven-co/sether-ner` package. This pack
//  is deterministic and dependency-free.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_VALUE_LEN = 60;
const MAX_ADDRESS_LEN = 120;

/** True for a letter that has distinct upper/lower case (Latin, Greek, Cyrillic…). */
function isCasedLetter(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase();
}

const LETTER_RE = /[\p{L}\p{M}]/u;
function isLetter(ch: string): boolean {
  return LETTER_RE.test(ch);
}

/**
 * Run each label regex over `text` and call `cb` with the offset immediately
 * after every label match (the point where the value begins). Each detector
 * then extracts and validates its own value from there.
 */
function eachLabelMatch(
  text: string,
  regexes: readonly RegExp[],
  cb: (valueStart: number) => void,
): void {
  for (const re of regexes) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      cb(m.index + m[0].length);
      // Defensive: never spin on a zero-length match.
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  NAME — label/salutation anchored, Unicode-aware
// ─────────────────────────────────────────────────────────────────────────────

// Latin-script labels. `\b…\b` keeps "name" from matching inside
// "filename"/"username"; the trailing class consumes the separator (": ", etc.).
const NAME_LABEL_RE =
  /\b(?:full[\s_-]?name|first[\s_-]?name|last[\s_-]?name|name|nom|nombre|nome|naam|navn|patient|customer|client|contact|cardholder|account[\s_-]?holder|beneficiary|attn|attention|dear|mr|mrs|ms|mx|dr|prof)\b[\s:.=_-]{0,3}/gi;

// Non-Latin labels — anchored on a trailing colon (ASCII or fullwidth).
const NAME_LABEL_INTL_RE = /(?:名前|氏名|姓名|이름|성명|имя|الاسم)\s*[:：]\s*/gi;

const NAME_LABELS = [NAME_LABEL_RE, NAME_LABEL_INTL_RE] as const;

// Words that follow a name label but are clearly not a person. If EVERY
// captured word is in this set ("The Customer", "Dear Sir", "Service Team"),
// the value is rejected.
const NAME_COMMON_WORDS = new Set([
  'the', 'and', 'is', 'of', 'a', 'an', 'our', 'your', 'my', 'their',
  'unknown', 'none', 'null', 'na', 'anonymous', 'redacted', 'test',
  'sir', 'madam', 'madame', 'team', 'service', 'support', 'customer',
  'client', 'user', 'admin', 'everyone', 'all', 'hello', 'hi', 'dear',
  'valued', 'account', 'holder', 'name', 'please', 'thanks', 'regards',
  'mr', 'mrs', 'ms', 'dr', 'prof', 'staff', 'department', 'desk', 'president',
]);

/**
 * Capture a person name starting at `pos`. Returns the captured value (already
 * trimmed) or null. Accepts up to 4 capitalised words for cased scripts, or a
 * single run of letters for uncased scripts (CJK, etc.).
 */
function captureName(text: string, pos: number): string | null {
  // Skip leading whitespace the label class did not consume.
  let i = pos;
  while (i < text.length && /\s/.test(text[i] as string)) i++;
  const start = i;
  let words = 0;
  while (i < text.length && words < 4 && i - start < MAX_VALUE_LEN) {
    const first = text[i] as string;
    if (!isLetter(first)) break;
    // For cased scripts a name word must start uppercase ("John", not "is").
    if (isCasedLetter(first) && first !== first.toUpperCase()) break;
    // Consume this word: letters, marks, internal apostrophes / hyphens.
    let j = i + 1;
    while (j < text.length) {
      const c = text[j] as string;
      if (isLetter(c)) {
        j++;
        continue;
      }
      if ((c === "'" || c === '’' || c === '-') && j + 1 < text.length && isLetter(text[j + 1] as string)) {
        j++;
        continue;
      }
      break;
    }
    words++;
    i = j;
    // Allow one or more spaces/tabs (not newlines) before the next word.
    let k = i;
    while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;
    if (k > i && k < text.length && isLetter(text[k] as string)) i = k;
    else break;
  }
  const value = text.slice(start, i).replace(/\s+$/, '');
  if (value.length < 2 || words === 0) return null;
  // Reject when every word is a common non-name word.
  const parts = value.toLowerCase().split(/\s+/);
  if (parts.every((w) => NAME_COMMON_WORDS.has(w))) return null;
  return value;
}

export const nameDetector: Detector = {
  type: 'NAME',
  detect(text) {
    const matches: DetectorMatch[] = [];
    eachLabelMatch(text, NAME_LABELS, (valueStart) => {
      const value = captureName(text, valueStart);
      if (!value) return;
      const start = text.indexOf(value, valueStart);
      if (start === -1) return;
      matches.push({ start, end: start + value.length, value });
    });
    return matches;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  DOB — date of birth, label-anchored + calendar/plausibility validated
// ─────────────────────────────────────────────────────────────────────────────

const DOB_LABEL_RE =
  /\b(?:date\s+of\s+birth|date\s+de\s+naissance|fecha\s+de\s+nacimiento|data\s+de\s+nascimento|geburtsdatum|geboortedatum|d\.?o\.?b\.?|birth\s?date|born)\b[\s:=-]{0,3}/gi;

const DOB_LABEL_INTL_RE = /(?:生年月日|出生日期|出生日|생년월일|дата\s+рождения)\s*[:：]\s*/gi;

const DOB_LABELS = [DOB_LABEL_RE, DOB_LABEL_INTL_RE] as const;

const MONTHS =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Trailing (?!\d) stops a valid date being carved out of a longer number
// (e.g. "19999" must not match as "1999", leaking the stray digit).
const DATE_ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/;
const DATE_NUM_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?!\d)/;
const DATE_DMY_RE = new RegExp(`^(\\d{1,2})\\s+(${MONTHS})\\.?\\s*,?\\s*(\\d{4})(?!\\d)`, 'i');
const DATE_MDY_RE = new RegExp(`^(${MONTHS})\\.?\\s+(\\d{1,2})\\s*,?\\s*(\\d{4})(?!\\d)`, 'i');

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function isPlausibleBirthDate(year: number, month: number, day: number): boolean {
  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/** Try to match a date at `text.slice(pos)`. Returns the raw matched text or null. */
function matchDateAt(text: string, pos: number): string | null {
  const slice = text.slice(pos, pos + 32);

  const iso = DATE_ISO_RE.exec(slice);
  if (iso && isPlausibleBirthDate(+(iso[1] as string), +(iso[2] as string), +(iso[3] as string))) {
    return iso[0];
  }

  const num = DATE_NUM_RE.exec(slice);
  if (num) {
    const a = +(num[1] as string);
    const b = +(num[2] as string);
    let year = +(num[3] as string);
    if (year < 100) year += year < 30 ? 2000 : 1900;
    // Accept either D/M/Y or M/D/Y, whichever yields a plausible date.
    if (isPlausibleBirthDate(year, b, a) || isPlausibleBirthDate(year, a, b)) return num[0];
  }

  const dmy = DATE_DMY_RE.exec(slice);
  if (dmy) {
    const month = MONTH_INDEX[(dmy[2] as string).slice(0, 3).toLowerCase()];
    if (month && isPlausibleBirthDate(+(dmy[3] as string), month, +(dmy[1] as string))) return dmy[0];
  }

  const mdy = DATE_MDY_RE.exec(slice);
  if (mdy) {
    const month = MONTH_INDEX[(mdy[1] as string).slice(0, 3).toLowerCase()];
    if (month && isPlausibleBirthDate(+(mdy[3] as string), month, +(mdy[2] as string))) return mdy[0];
  }

  return null;
}

export const dobDetector: Detector = {
  type: 'DOB',
  detect(text) {
    const matches: DetectorMatch[] = [];
    eachLabelMatch(text, DOB_LABELS, (vs) => {
      let valueStart = vs;
      while (valueStart < text.length && /\s/.test(text[valueStart] as string)) valueStart++;
      const date = matchDateAt(text, valueStart);
      if (!date) return;
      matches.push({ start: valueStart, end: valueStart + date.length, value: date });
    });
    return matches;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  PASSPORT — label-anchored (passport numbers have no universal checksum)
// ─────────────────────────────────────────────────────────────────────────────

const PASSPORT_LABEL_RE =
  /\b(?:passport|passeport|pasaporte|reisepass|passaporto|paspoort|passaporte)(?:\s(?:no|number|num|#))?\b[\s:.#=-]{0,3}/gi;

const PASSPORT_LABEL_INTL_RE = /(?:パスポート|护照|여권|паспорт)\s*[:：#]?\s*/gi;

const PASSPORT_LABELS = [PASSPORT_LABEL_RE, PASSPORT_LABEL_INTL_RE] as const;

const PASSPORT_VALUE_RE = /^[A-Za-z0-9]{6,9}\b/;

export const passportDetector: Detector = {
  type: 'PASSPORT',
  detect(text) {
    const matches: DetectorMatch[] = [];
    eachLabelMatch(text, PASSPORT_LABELS, (vs) => {
      let valueStart = vs;
      while (valueStart < text.length && /\s/.test(text[valueStart] as string)) valueStart++;
      const v = PASSPORT_VALUE_RE.exec(text.slice(valueStart, valueStart + 12));
      if (!v) return;
      const value = v[0];
      // Require at least one digit — pure-letter words are not passport numbers.
      if (!/\d/.test(value)) return;
      matches.push({ start: valueStart, end: valueStart + value.length, value });
    });
    return matches;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  ADDRESS — labelled line, standalone street line, and UK postcode
// ─────────────────────────────────────────────────────────────────────────────

const ADDRESS_LABEL_RE =
  /\b(?:(?:shipping|billing|mailing|home|residential)\s)?(?:address|adresse|adres|direccion|indirizzo|endereco)(?:es)?\b[\s:.=-]{0,3}/gi;

const ADDRESS_LABEL_INTL_RE = /(?:住所|地址|주소|адрес|dirección|endereço)\s*[:：]\s*/gi;

const ADDRESS_LABELS = [ADDRESS_LABEL_RE, ADDRESS_LABEL_INTL_RE] as const;

const STREET_SUFFIX_RE =
  /\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|terrace|ter|square|sq|highway|hwy|parkway|pkwy)\b\.?/gi;

// A street line ending at the suffix: house number + up to ~40 chars of words.
const STREET_HEAD_RE = /\d{1,6}\s+[A-Za-z0-9.' -]{0,40}$/;

const UK_POSTCODE_RE = /\b[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}\b/g;

export const addressDetector: Detector = {
  type: 'ADDRESS',
  detect(text) {
    const matches: DetectorMatch[] = [];

    // (a) Labelled address line — capture to end of line, bounded.
    eachLabelMatch(text, ADDRESS_LABELS, (vs) => {
      let start = vs;
      while (start < text.length && /[ \t]/.test(text[start] as string)) start++;
      let end = start;
      while (end < text.length && text[end] !== '\n' && end - start < MAX_ADDRESS_LEN) end++;
      const value = text.slice(start, end).replace(/\s+$/, '');
      // Keep false positives down: an address line has a digit or a comma.
      if (value.length >= 5 && /[\d,]/.test(value)) {
        matches.push({ start, end: start + value.length, value });
      }
    });

    // (b) Standalone street line: street suffix preceded by a house number.
    STREET_SUFFIX_RE.lastIndex = 0;
    let s: RegExpExecArray | null;
    while ((s = STREET_SUFFIX_RE.exec(text)) !== null) {
      const suffixEnd = s.index + s[0].length;
      const windowStart = Math.max(0, s.index - 50);
      const head = STREET_HEAD_RE.exec(text.slice(windowStart, s.index));
      if (!head) continue;
      const start = windowStart + (head.index as number);
      matches.push({ start, end: suffixEnd, value: text.slice(start, suffixEnd) });
    }

    // (c) UK postcode — distinctive enough to stand alone.
    UK_POSTCODE_RE.lastIndex = 0;
    let p: RegExpExecArray | null;
    while ((p = UK_POSTCODE_RE.exec(text)) !== null) {
      matches.push({ start: p.index, end: p.index + p[0].length, value: p[0] });
    }

    return matches;
  },
};

// Convenience export — all identity detectors in one array. Opt-in:
//   new Sether({ detectors: [...basicDetectors, ...identityDetectors] })
export const identityDetectors: readonly Detector[] = [
  nameDetector,
  dobDetector,
  passportDetector,
  addressDetector,
];
