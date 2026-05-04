import { isIPv6 } from 'node:net';
import { findPhoneNumbersInText } from 'libphonenumber-js';
import type { Detector, DetectorMatch } from './types.js';

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export const emailDetector: Detector = {
  type: 'EMAIL',
  detect(text) {
    return matchAll(text, EMAIL_RE);
  },
};

// Bounded character class — no nested quantifier, no ReDoS surface.
// Matches digits with optional space/dash separators; validated by Luhn.
const CC_RE = /\b[\d -]{13,23}/g;

export const creditCardDetector: Detector = {
  type: 'CC',
  detect(text) {
    const matches: DetectorMatch[] = [];
    CC_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CC_RE.exec(text)) !== null) {
      const trimmed = m[0].replace(/[\s-]+$/, '');
      const digits = trimmed.replace(/\D/g, '');
      if (digits.length < 13 || digits.length > 19) continue;
      if (!luhn(digits)) continue;
      matches.push({ start: m.index, end: m.index + trimmed.length, value: trimmed });
    }
    return matches;
  },
};

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const c = digits.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return false;
    let n = c;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const SSN_RE = /\b(\d{3})-(\d{2})-(\d{4})\b/g;
const SSN_INVALID_AREAS = new Set(['000', '666']);

export const ssnDetector: Detector = {
  type: 'SSN',
  detect(text) {
    const matches: DetectorMatch[] = [];
    SSN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SSN_RE.exec(text)) !== null) {
      const area = m[1];
      const group = m[2];
      const serial = m[3];
      if (!area || !group || !serial) continue;
      if (SSN_INVALID_AREAS.has(area)) continue;
      if (parseInt(area, 10) >= 900) continue;
      if (group === '00') continue;
      if (serial === '0000') continue;
      matches.push({ start: m.index, end: m.index + m[0].length, value: m[0] });
    }
    return matches;
  },
};

const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_RE = new RegExp(`\\b${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}\\b`, 'g');

export const ipv4Detector: Detector = {
  type: 'IPV4',
  detect(text) {
    return matchAll(text, IPV4_RE);
  },
};

// Conservative bounded character class — no ReDoS surface.
// We over-match candidates and validate via Node's native isIPv6.
const IPV6_CANDIDATE = /\b[0-9A-Fa-f:]{4,39}\b/g;

export const ipv6Detector: Detector = {
  type: 'IPV6',
  detect(text) {
    const matches: DetectorMatch[] = [];
    IPV6_CANDIDATE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IPV6_CANDIDATE.exec(text)) !== null) {
      const candidate = m[0];
      if (!candidate.includes(':')) continue;
      if (!isIPv6(candidate)) continue;
      matches.push({ start: m.index, end: m.index + candidate.length, value: candidate });
    }
    return matches;
  },
};

// IBAN: country code (2 letters) + 2 check digits + 11–30 alphanumeric.
// Single bounded character class — no nested quantifier, no ReDoS surface.
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9 ]{11,40}/g;

export const ibanDetector: Detector = {
  type: 'IBAN',
  detect(text) {
    const matches: DetectorMatch[] = [];
    IBAN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IBAN_RE.exec(text)) !== null) {
      const trimmed = m[0].replace(/\s+$/, '');
      const cleaned = trimmed.replace(/\s/g, '');
      if (cleaned.length < 15 || cleaned.length > 34) continue;
      if (!ibanMod97(cleaned)) continue;
      matches.push({ start: m.index, end: m.index + trimmed.length, value: trimmed });
    }
    return matches;
  },
};

function ibanMod97(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let numeric = '';
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      // A=10 .. Z=35
      numeric += (code - 55).toString();
    } else if (code >= 48 && code <= 57) {
      numeric += ch;
    } else {
      return false;
    }
  }
  // mod-97 over a long string by chunked reduction
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const chunk = remainder.toString() + numeric.slice(i, i + 7);
    remainder = parseInt(chunk, 10) % 97;
  }
  return remainder === 1;
}

export const phoneDetector: Detector = {
  type: 'PHONE',
  detect(text) {
    const matches: DetectorMatch[] = [];
    for (const found of findPhoneNumbersInText(text)) {
      matches.push({
        start: found.startsAt,
        end: found.endsAt,
        value: text.slice(found.startsAt, found.endsAt),
      });
    }
    return matches;
  },
};

function matchAll(text: string, re: RegExp): DetectorMatch[] {
  const matches: DetectorMatch[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, value: m[0] });
  }
  return matches;
}

export const basicDetectors: readonly Detector[] = [
  emailDetector,
  creditCardDetector,
  ssnDetector,
  ipv4Detector,
  ipv6Detector,
  ibanDetector,
  phoneDetector,
];
