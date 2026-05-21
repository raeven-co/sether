import type { Detector, DetectorMatch } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Secrets detector pack
//
//  Detects API keys, access tokens, and high-entropy strings that engineers
//  inadvertently include in LLM prompts, RAG inputs, and tool-call outputs.
//
//  Every regex in this file is a single bounded character class — no nested
//  quantifiers, no backtracking surface. The companion CI scanner
//  (`scripts/check-regex-safety.mjs`, safe-regex2) verifies this on every
//  build.
//
//  Where vendor docs publish official patterns we follow them. Where they
//  don't, we use conservative prefix + length + character-class rules that
//  match real keys without flagging arbitrary base64/hex blobs.
// ─────────────────────────────────────────────────────────────────────────────

function matchAll(text: string, re: RegExp): DetectorMatch[] {
  const matches: DetectorMatch[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, value: m[0] });
  }
  return matches;
}

// AWS Access Key ID — published prefix + fixed length.
// AKIA = long-term user, ASIA = STS temp, AROA = role, AIDA = user identity.
// All resolve to the same 16-char base32 tail.
// Reference: https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html
const AWS_ACCESS_KEY_RE = /\b(AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}\b/g;

export const awsAccessKeyDetector: Detector = {
  type: 'AWS_KEY',
  detect(text) {
    return matchAll(text, AWS_ACCESS_KEY_RE);
  },
};

// OpenAI API keys — three live formats as of 2026:
//   sk-...               (legacy user keys, 48+ chars after prefix)
//   sk-proj-...          (project-scoped keys, longer)
//   sk-svcacct-...       (service-account keys)
// All use base64url-ish characters [A-Za-z0-9_-] after the prefix.
// We require at least 20 chars after the prefix to avoid false positives.
const OPENAI_KEY_RE = /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/g;

export const openaiKeyDetector: Detector = {
  type: 'OPENAI_KEY',
  detect(text) {
    const matches: DetectorMatch[] = [];
    OPENAI_KEY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = OPENAI_KEY_RE.exec(text)) !== null) {
      // Defensive: reject anything that doesn't actually contain the literal
      // "sk-" prefix at the very start of the match (paranoid double-check).
      if (!m[0].startsWith('sk-')) continue;
      matches.push({ start: m.index, end: m.index + m[0].length, value: m[0] });
    }
    return matches;
  },
};

// Anthropic API keys — published prefix `sk-ant-` then `api03-` (or future
// rev), then a 90+ char base64url-ish payload.
// Reference: https://docs.anthropic.com/en/api/getting-started
const ANTHROPIC_KEY_RE = /\bsk-ant-(?:api\d{2}-|admin\d{2}-)[A-Za-z0-9_-]{40,}\b/g;

export const anthropicKeyDetector: Detector = {
  type: 'ANTHROPIC_KEY',
  detect(text) {
    return matchAll(text, ANTHROPIC_KEY_RE);
  },
};

// GitHub Personal Access Tokens — two formats:
//   Classic:        ghp_ + 36 chars base62-ish
//   Fine-grained:   github_pat_ + 22 chars + _ + 59 chars (total 82 after underscore prefix)
//   Plus OAuth (gho_), App user (ghu_), Server-to-server (ghs_), Refresh (ghr_)
//   All classic-style tokens share the same shape.
// Reference: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github
const GITHUB_PAT_CLASSIC_RE = /\bgh[pousr]_[A-Za-z0-9]{36}\b/g;
const GITHUB_PAT_FINEGRAINED_RE = /\bgithub_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}\b/g;

export const githubPatDetector: Detector = {
  type: 'GITHUB_PAT',
  detect(text) {
    return [...matchAll(text, GITHUB_PAT_CLASSIC_RE), ...matchAll(text, GITHUB_PAT_FINEGRAINED_RE)];
  },
};

// Slack tokens — `xox` prefix, then a single character indicating token kind
// (b=bot, p=user, a=app-level, r=refresh, s=workspace), then dash-separated
// numeric and alphanumeric segments. Length varies (60-80 chars typical).
// Reference: https://api.slack.com/authentication/token-types
const SLACK_TOKEN_RE = /\bxox[baprs]-\d{10,12}-\d{10,13}-[A-Za-z0-9]{24,34}\b/g;

export const slackTokenDetector: Detector = {
  type: 'SLACK_TOKEN',
  detect(text) {
    return matchAll(text, SLACK_TOKEN_RE);
  },
};

// Stripe API keys — published prefixes:
//   sk_live_ / sk_test_     restricted/secret keys
//   rk_live_ / rk_test_     restricted keys
//   pk_live_ / pk_test_     publishable keys (still PII — they identify the merchant)
//   whsec_                  webhook signing secrets
// All have 24+ chars base62 payload.
// Reference: https://docs.stripe.com/api/authentication
const STRIPE_KEY_RE = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g;
const STRIPE_WHSEC_RE = /\bwhsec_[A-Za-z0-9]{32,}\b/g;

export const stripeKeyDetector: Detector = {
  type: 'STRIPE_KEY',
  detect(text) {
    return [...matchAll(text, STRIPE_KEY_RE), ...matchAll(text, STRIPE_WHSEC_RE)];
  },
};

// JWT — three base64url segments separated by dots: header.payload.signature.
// Header always starts `eyJ` (base64url of `{"`). Payload also typically
// starts `eyJ`. We require both to keep false-positive rate low.
// Each segment is base64url: [A-Za-z0-9_-]+
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

export const jwtDetector: Detector = {
  type: 'JWT',
  detect(text) {
    return matchAll(text, JWT_RE);
  },
};

// High-entropy generic detector — for keys with no published prefix (HMAC
// secrets, API tokens generated by internal services, etc.).
//
// Strategy: find candidate tokens (32+ char hex or base64-ish), then compute
// Shannon entropy and only flag those above a threshold. Hex max entropy is
// 4 bits/char, base64 is 6 bits/char — we require ≥3.5 bits/char to suppress
// noise from things like SHA-256 hashes of low-cardinality inputs.
//
// Candidate regex is intentionally narrow:
//   - 32+ chars
//   - charset is hex OR base64url
//   - must contain at least one letter AND one digit (rules out pure
//     hex hashes of constants, repeated chars, etc.)
const HIGH_ENTROPY_CANDIDATE = /\b[A-Za-z0-9_-]{32,128}\b/g;

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  let h = 0;
  const len = s.length;
  for (const count of freq.values()) {
    const p = count / len;
    h -= p * Math.log2(p);
  }
  return h;
}

export const highEntropyDetector: Detector = {
  type: 'HIGH_ENTROPY',
  detect(text) {
    const matches: DetectorMatch[] = [];
    HIGH_ENTROPY_CANDIDATE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HIGH_ENTROPY_CANDIDATE.exec(text)) !== null) {
      const candidate = m[0];
      // Skip if obviously not key-shaped: must contain letter AND digit.
      if (!/[A-Za-z]/.test(candidate)) continue;
      if (!/\d/.test(candidate)) continue;
      // Reject low-entropy strings (repeated patterns, hashes of constants).
      if (shannonEntropy(candidate) < 3.5) continue;
      matches.push({ start: m.index, end: m.index + candidate.length, value: candidate });
    }
    return matches;
  },
};

// Convenience export — all secrets detectors in one array.
export const secretsDetectors: readonly Detector[] = [
  awsAccessKeyDetector,
  openaiKeyDetector,
  anthropicKeyDetector,
  githubPatDetector,
  slackTokenDetector,
  stripeKeyDetector,
  jwtDetector,
  highEntropyDetector,
];
