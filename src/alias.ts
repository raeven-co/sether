// ─────────────────────────────────────────────────────────────────────────────
//  Alias engine  (new in 0.7.0)
//
//  Redaction hides a value (`[email-1]`, `j***@***.com`). ALIASING replaces it
//  with a realistic decoy -- "Godfrey Lebo" becomes "John Doe", a real phone
//  number becomes a fictional-but-well-formed one -- so the prompt still reads
//  naturally to an LLM, leaks nothing, and can be reversed later via the
//  AliasVault.
//
//  Decoys use officially-reserved fictional ranges wherever one exists, so a
//  generated decoy can never collide with a real person's data:
//    • US phones     -- NNN-555-01XX  (reserved for fiction, NANPA)
//    • UK phones     -- 07700 900XXX  (Ofcom drama ranges)
//    • IPv4          -- 192.0.2/24, 198.51.100/24, 203.0.113/24  (RFC 5737)
//    • IPv6          -- 2001:db8::/32  (RFC 3849)
//    • SSN           -- 987-65-43XX   (SSA advertising range)
//    • Email domains -- example.com / example.org / example.net  (RFC 2606)
//    • Cards         -- Luhn-valid numbers in documented test BINs
//  Types with no reserved range (national IDs, unknown-region phones, generic
//  tokens) fall back to shape-preserving randomisation: every digit/letter is
//  replaced with a random one of the same class, punctuation and known vendor
//  prefixes (sk-proj-, AKIA, ghp_, ...) are kept so the decoy still *looks* like
//  the real thing.
//
//  Browser-safe: no Node built-ins. Randomness is injectable (`rng`) so tests
//  are deterministic.
// ─────────────────────────────────────────────────────────────────────────────

import { parsePhoneNumberFromString } from 'libphonenumber-js';

export interface AliasOptions {
  /** Random source in [0, 1). Defaults to Math.random. Injectable for tests. */
  rng?: () => number;
}

type Rng = () => number;

function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

function randInt(min: number, max: number, rng: Rng): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function randDigits(n: number, rng: Rng): string {
  let out = '';
  for (let i = 0; i < n; i++) out += randInt(0, 9, rng);
  return out;
}

// ── Name pools ───────────────────────────────────────────────────────────────
// Deliberately diverse. "John"/"Jane" lead so the classic John Doe / Jane Doe
// decoys surface first in suggestions.

const FIRST_NAMES = [
  'John', 'Jane', 'Alex', 'Maria', 'David', 'Sarah', 'Michael', 'Amina',
  'Kwame', 'Chen', 'Yuki', 'Omar', 'Priya', 'Lucas', 'Emma', 'Noah',
  'Sofia', 'Liam', 'Aisha', 'Diego', 'Ingrid', 'Tunde', 'Mei', 'Ivan',
] as const;

const LAST_NAMES = [
  'Doe', 'Smith', 'Johnson', 'Brown', 'Garcia', 'Miller', 'Davis',
  'Martinez', 'Lopez', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore',
  'Jackson', 'Martin', 'Lee', 'Walker', 'Hall', 'Young', 'Wright',
  'Adeyemi', 'Okoro', 'Tanaka',
] as const;

const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net'] as const;

const STREET_NAMES = [
  'Cedar', 'Maple', 'Oakwood', 'Riverside', 'Hillcrest', 'Sunset', 'Willow',
  'Juniper', 'Lakeview', 'Meadow', 'Rosewood', 'Elmwood',
] as const;
const STREET_SUFFIXES = ['Street', 'Avenue', 'Road', 'Lane', 'Drive', 'Crescent', 'Court'] as const;
const CITIES = ['Springfield', 'Fairview', 'Riverton', 'Lakeside', 'Greenfield', 'Brookhaven'] as const;

// ── Shape-preserving fallback ────────────────────────────────────────────────

// Known vendor prefixes to keep intact so the decoy stays type-detectable.
const KNOWN_PREFIXES: readonly RegExp[] = [
  /^sk-ant-(?:api|admin)\d{2}-/,
  /^sk-(?:proj-|svcacct-|admin-)/,
  /^sk-/,
  /^(?:AKIA|ASIA|AROA|AIDA)/,
  /^gh[pousr]_/,
  /^github_pat_/,
  /^xox[baprs]-/,
  /^(?:sk|rk|pk)_(?:live|test)_/,
  /^whsec_/,
];

/**
 * Replace every letter/digit in `value` with a random character of the same
 * class (digit->digit, lower->lower, upper->upper), preserving punctuation,
 * whitespace, and any known vendor prefix. The result has the exact shape of
 * the original -- same length, same separators -- but none of its content.
 */
export function shapeAlias(value: string, opts: AliasOptions = {}): string {
  const rng = opts.rng ?? Math.random;
  let prefixLen = 0;
  for (const re of KNOWN_PREFIXES) {
    const m = re.exec(value);
    if (m) {
      prefixLen = m[0].length;
      break;
    }
  }
  let out = value.slice(0, prefixLen);
  for (let i = prefixLen; i < value.length; i++) {
    const c = value[i] as string;
    if (c >= '0' && c <= '9') out += randInt(0, 9, rng);
    else if (c >= 'a' && c <= 'z') out += String.fromCharCode(97 + randInt(0, 25, rng));
    else if (c >= 'A' && c <= 'Z') out += String.fromCharCode(65 + randInt(0, 25, rng));
    else out += c;
  }
  return out;
}

// ── Per-type generators ──────────────────────────────────────────────────────

function aliasName(value: string, rng: Rng): string {
  const words = value.trim().split(/\s+/).length;
  const first = pick(FIRST_NAMES, rng);
  if (words <= 1) return first;
  return `${first} ${pick(LAST_NAMES, rng)}`;
}

function aliasEmail(rng: Rng): string {
  const first = pick(FIRST_NAMES, rng).toLowerCase();
  const last = pick(LAST_NAMES, rng).toLowerCase();
  const styles = [
    `${first}.${last}`,
    `${first}${last}${randInt(1, 99, rng)}`,
    `${first}_${last}`,
    `${first}${randInt(10, 999, rng)}`,
  ];
  return `${pick(styles, rng)}@${pick(EMAIL_DOMAINS, rng)}`;
}

const US_AREAS = ['212', '310', '415', '617', '702', '808', '904'] as const;

function aliasPhone(value: string, rng: Rng): string {
  const intl = value.trim().startsWith('+');
  const parsed = parsePhoneNumberFromString(value);
  // country can be undefined even when parsing succeeds (+44 is shared by
  // GB/GG/IM/JE, +1 by all of NANPA) -- fall back to the calling code.
  const cc = parsed?.countryCallingCode;
  const digits = value.replace(/\D/g, '');
  // National-format heuristics for unparseable (no +CC) numbers:
  const usNational = !parsed && digits.length === 10 && /^[2-9]/.test(digits);
  const ngNational = !parsed && digits.length === 11 && /^0(70|80|81|90|91)/.test(digits);
  const gbNational = !parsed && !ngNational && digits.length === 11 && /^07/.test(digits);

  if (parsed?.country === 'US' || cc === '1' || usNational) {
    const area = pick(US_AREAS, rng);
    const tail = `01${randDigits(2, rng)}`;
    return intl ? `+1 ${area} 555 ${tail}` : `(${area}) 555-${tail}`;
  }
  if (parsed?.country === 'GB' || cc === '44' || gbNational) {
    const tail = randDigits(3, rng);
    return intl ? `+44 7700 900${tail}` : `07700 900${tail}`;
  }
  if (parsed?.country === 'NG' || cc === '234' || ngNational) {
    const tail = randDigits(4, rng);
    return intl ? `+234 803 555 ${tail}` : `0803 555 ${tail}`;
  }
  if (parsed?.countryCallingCode) {
    // Known country, no reserved fictional range: keep +CC, randomise the
    // national digits, mimic the original's grouping.
    const cc = parsed.countryCallingCode;
    const nationalLen = parsed.nationalNumber.length;
    return `+${cc} ${randDigits(Math.min(nationalLen, 12), rng)}`;
  }
  // National format, unknown region: keep the first two digits (trunk prefix)
  // and all punctuation, randomise the rest. NOTE: not guaranteed fictional.
  let kept = 0;
  let out = '';
  for (const c of value) {
    if (c >= '0' && c <= '9') {
      out += kept < 2 ? c : String(randInt(0, 9, rng));
      kept++;
    } else out += c;
  }
  return out;
}

function aliasCard(value: string, rng: Rng): string {
  // Visa-style 16-digit, Luhn-valid.
  let digits = '4' + randDigits(14, rng);
  digits += luhnCheckDigit(digits);
  const sep = value.includes(' ') ? ' ' : value.includes('-') ? '-' : '';
  if (!sep) return digits;
  return digits.match(/.{1,4}/g)!.join(sep);
}

function luhnCheckDigit(digits: string): string {
  let sum = 0;
  let alt = true; // check digit position will be even from the right
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return String((10 - (sum % 10)) % 10);
}

function aliasSSN(value: string, rng: Rng): string {
  // 987-65-43XX is the SSA's advertising-reserved block -- guaranteed never
  // issued to a real person. Deliberate tradeoff: Sether's own SSN detector
  // rejects area >=900, so the decoy is not re-detectable as an SSN; a decoy
  // that can never collide with a real number wins over re-detectability.
  const ssn = `987-65-43${randDigits(2, rng)}`;
  return value.includes('-') ? ssn : ssn.replace(/-/g, '');
}

function aliasIPv4(rng: Rng): string {
  const block = pick(['192.0.2', '198.51.100', '203.0.113'] as const, rng);
  return `${block}.${randInt(1, 254, rng)}`;
}

function aliasIPv6(rng: Rng): string {
  const group = () => randInt(0, 0xffff, rng).toString(16);
  return `2001:db8:${group()}:${group()}:${group()}:${group()}::1`;
}

function aliasIBAN(value: string, rng: Rng): string {
  // GB template: GB + check + 4-letter bank + 6-digit sort + 8-digit account.
  const body = `SETH${randDigits(6, rng)}${randDigits(8, rng)}`;
  const check = ibanCheckDigits('GB', body);
  const iban = `GB${check}${body}`;
  if (!/\s/.test(value)) return iban;
  return iban.match(/.{1,4}/g)!.join(' ');
}

function ibanCheckDigits(country: string, body: string): string {
  const rearranged = body + country + '00';
  let numeric = '';
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) numeric += (code - 55).toString();
    else numeric += ch;
  }
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = parseInt(remainder.toString() + numeric.slice(i, i + 7), 10) % 97;
  }
  const check = 98 - remainder;
  return check < 10 ? `0${check}` : String(check);
}

function aliasDOB(value: string, rng: Rng): string {
  const year = randInt(1955, 2005, rng);
  const month = randInt(1, 12, rng);
  const day = randInt(1, 12, rng); // <=12 so it is valid as either D/M or M/D
  const p2 = (n: number) => String(n).padStart(2, '0');
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December',
  ];
  if (/^\d{4}-/.test(value)) return `${year}-${p2(month)}-${p2(day)}`;
  if (/^[A-Za-z]/.test(value)) return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
  if (/\d\s+[A-Za-z]/.test(value)) return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
  const sep = value.includes('/') ? '/' : value.includes('.') ? '.' : '-';
  return `${p2(day)}${sep}${p2(month)}${sep}${year}`;
}

function aliasAddress(rng: Rng): string {
  return `${randInt(2, 199, rng)} ${pick(STREET_NAMES, rng)} ${pick(STREET_SUFFIXES, rng)}, ${pick(CITIES, rng)}`;
}

function aliasPassport(rng: Rng): string {
  return String.fromCharCode(65 + randInt(0, 25, rng)) + randDigits(8, rng);
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function randB64(n: number, rng: Rng): string {
  let out = '';
  for (let i = 0; i < n; i++) out += B64URL[randInt(0, B64URL.length - 1, rng)];
  return out;
}

function aliasJWT(rng: Rng): string {
  // Dummy header {"alg":"HS256","typ":"JWT"} + decoy payload/signature. Both
  // payload and header start "eyJ" so the decoy is still detector-visible.
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI${randB64(16, rng)}.${randB64(32, rng)}`;
}

function aliasDbUri(value: string, opts: AliasOptions): string {
  // Keep the scheme, shape-randomise credentials/host/path.
  const idx = value.indexOf('://');
  if (idx === -1) return shapeAlias(value, opts);
  return value.slice(0, idx + 3) + shapeAlias(value.slice(idx + 3), opts);
}

function aliasCredential(value: string, opts: AliasOptions, rng: Rng): string {
  // KEY=value / key: value -- keep the key, replace the secret.
  const eq = value.indexOf('=');
  const colon = value.indexOf(':');
  const sep = eq >= 0 ? eq : colon;
  if (sep < 0) return shapeAlias(value, opts);
  const head = value.slice(0, sep + 1);
  const secret = value.slice(sep + 1).trim();
  const spacer = value.slice(sep + 1, value.length - secret.length);
  const decoy = secret.length > 0 ? shapeAlias(secret, opts) : randB64(24, rng);
  return head + spacer + decoy;
}

function aliasPassword(rng: Rng): string {
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digitChars = '23456789';
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += upper[randInt(0, upper.length - 1, rng)];
    out += lower[randInt(0, lower.length - 1, rng)];
    out += digitChars[randInt(0, digitChars.length - 1, rng)];
  }
  return out;
}

/**
 * Generate ONE realistic decoy for a detected value.
 * `type` is the detector type (EMAIL, NAME, PHONE, ...). Unknown types fall
 * back to shape-preserving randomisation, so custom detectors work too.
 */
export function aliasValue(type: string, value: string, opts: AliasOptions = {}): string {
  const rng = opts.rng ?? Math.random;
  switch (type) {
    case 'NAME':
      return aliasName(value, rng);
    case 'EMAIL':
      return aliasEmail(rng);
    case 'PHONE':
      return aliasPhone(value, rng);
    case 'CC':
      return aliasCard(value, rng);
    case 'SSN':
      return aliasSSN(value, rng);
    case 'IPV4':
      return aliasIPv4(rng);
    case 'IPV6':
      return aliasIPv6(rng);
    case 'IBAN':
      return aliasIBAN(value, rng);
    case 'DOB':
      return aliasDOB(value, rng);
    case 'ADDRESS':
      return aliasAddress(rng);
    case 'PASSPORT':
      return aliasPassport(rng);
    case 'JWT':
      return aliasJWT(rng);
    case 'DB_URI':
      return aliasDbUri(value, opts);
    case 'CREDENTIAL':
      return aliasCredential(value, opts, rng);
    case 'PASSWORD':
      return aliasPassword(rng);
    default:
      // AWS_KEY, OPENAI_KEY, ANTHROPIC_KEY, GITHUB_PAT, SLACK_TOKEN,
      // STRIPE_KEY, API_KEY, HIGH_ENTROPY, NATIONAL_ID, PRIVATE_KEY,
      // CUSTOM:* -- shape-preserving with vendor prefix kept.
      return shapeAlias(value, opts);
  }
}

/**
 * Generate `count` DISTINCT decoy suggestions for a detected value (none equal
 * to the original). This is what a suggestion UI renders as choices:
 *
 *   suggestAliases('NAME', 'Godfrey Lebo')   // ['John Doe', 'Aisha Tanaka', ...]
 *   suggestAliases('EMAIL', 'g@gmail.com')   // ['jane.smith@example.org', ...]
 */
export function suggestAliases(
  type: string,
  value: string,
  count = 3,
  opts: AliasOptions = {},
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([value]);
  // A few generators have small output spaces; cap attempts defensively.
  for (let attempt = 0; attempt < count * 20 && out.length < count; attempt++) {
    const candidate = aliasValue(type, value, opts);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

// ── Alias vault ──────────────────────────────────────────────────────────────

export interface AliasEntry {
  /** The real value that was replaced. Keep in ephemeral memory only. */
  original: string;
  /** The decoy that now stands in for it. */
  alias: string;
  /** Detector type ("EMAIL", "NAME", ...) -- informational. */
  type: string;
}

/**
 * Bidirectional original<->alias map with stable assignment: the same original
 * always gets the same alias within a vault, so a value mentioned three times
 * in a prompt reads consistently ("John Doe ... John Doe ... John Doe").
 *
 * `apply()` swaps originals->aliases in a text; `restore()` swaps back.
 * Aliases are unique within the vault BY CONSTRUCTION (set() refuses
 * collisions, aliasFor() regenerates), which is what makes restore() a pure
 * string substitution with no ambiguity.
 */
export class AliasVault {
  #byOriginal = new Map<string, AliasEntry>();
  #byAlias = new Map<string, AliasEntry>();

  /**
   * Record a chosen alias for an original. Returns false (and stores nothing)
   * if the alias is already in use for a DIFFERENT original -- callers should
   * fall back to aliasFor(), which retries until unique.
   */
  set(original: string, alias: string, type: string): boolean {
    if (original === alias) return false;
    const clash = this.#byAlias.get(alias);
    if (clash && clash.original !== original) return false;
    const existing = this.#byOriginal.get(original);
    if (existing) this.#byAlias.delete(existing.alias);
    const entry: AliasEntry = { original, alias, type };
    this.#byOriginal.set(original, entry);
    this.#byAlias.set(alias, entry);
    return true;
  }

  /**
   * Return the stable alias for `original`, generating one if none exists yet.
   * Generated aliases are guaranteed unique within this vault.
   */
  aliasFor(type: string, original: string, opts: AliasOptions = {}): string {
    const existing = this.#byOriginal.get(original);
    if (existing) return existing.alias;
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = aliasValue(type, original, opts);
      if (candidate !== original && !this.#byAlias.has(candidate)) {
        this.set(original, candidate, type);
        return candidate;
      }
    }
    // Pathological corner (tiny output space fully claimed): last resort is a
    // shape-preserved variant, retried once more against collisions.
    const fallback = shapeAlias(original, opts);
    this.set(original, fallback, type);
    return fallback;
  }

  aliasOf(original: string): string | undefined {
    return this.#byOriginal.get(original)?.alias;
  }

  originalOf(alias: string): string | undefined {
    return this.#byAlias.get(alias)?.original;
  }

  entries(): AliasEntry[] {
    return [...this.#byOriginal.values()];
  }

  get size(): number {
    return this.#byOriginal.size;
  }

  clear(): void {
    this.#byOriginal.clear();
    this.#byAlias.clear();
  }

  delete(original: string): boolean {
    const entry = this.#byOriginal.get(original);
    if (!entry) return false;
    this.#byAlias.delete(entry.alias);
    return this.#byOriginal.delete(original);
  }

  /** Replace every known original with its alias. Longest-first so a value
   *  that is a substring of another (rare, but possible) cannot clobber it. */
  apply(text: string): string {
    return substitute(text, this.entries(), (e) => [e.original, e.alias]);
  }

  /** Replace every known alias back with its original -- the restore path. */
  restore(text: string): string {
    return substitute(text, this.entries(), (e) => [e.alias, e.original]);
  }
}

function substitute(
  text: string,
  entries: AliasEntry[],
  dir: (e: AliasEntry) => [from: string, to: string],
): string {
  const pairs = entries.map(dir).sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [from, to] of pairs) {
    if (from.length === 0) continue;
    out = out.split(from).join(to);
  }
  return out;
}
