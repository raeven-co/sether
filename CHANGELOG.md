# Changelog

## 0.1.2 — 2026-05-13

Patch release: documentation accuracy for npm readers; no API or runtime changes.

### Fixed

- **README** “Why this exists” no longer states that the OSS library logs every
  redaction against specific regulations — that belongs to the Pro / hosted
  roadmap. The library’s scope is streaming redact / restore in your process.

### Changed

- **README** token-vault section: clarifies that this package does not send streams
  to Raeven; removes wording that implied a gateway ships in this release.

---

## 0.1.1 — 2026-05-13

Patch release: documentation and marketing alignment; no breaking API changes.

### Changed

- `package.json` `homepage` now includes the live marketing sandbox fragment:
  <https://setherai.vercel.app/#sandbox>.

### Notes

- Runtime behaviour matches `0.1.0`. Upgrade is safe for all existing integrations.

---

## 0.1.0 — 2026-05-11

First stable release. API is now locked; no breaking changes before 1.0.

### Changed

- Version promoted from `0.1.0-alpha.2` to `0.1.0` — tagged `latest` on npm.
  `npm install @raeven-co/sether` now installs this release without `@alpha`.
- `homepage` in `package.json` updated to <https://setherai.vercel.app>.
- README status updated from pre-release to stable; duplicate/stale URLs removed.

### Fixed

- **`MemoryVault.size()` now prunes expired entries before counting.** Previously
  the raw `Map.size` was returned, which included TTL-expired entries that had
  not yet been lazily evicted. This inflated the reported count and could
  trigger premature LRU eviction of valid entries when close to `maxEntries`.

### Migration

None — fully backward-compatible with `0.1.0-alpha.2`.

---

## 0.1.0-alpha.2 — 2026-05-11

Documentation pass. No code changes — fully API-compatible with `0.1.0-alpha.1`.

### Changed

- **README rewritten for clarity.** Restructured around: *why → install →
  60-second quickstart → built-in detectors → vault → streaming safety →
  limitations → roadmap*. Added an end-to-end round-trip example showing
  `redact → restore` identity in one snippet.
- **Live sandbox link added at the top of the README** — readers can paste
  text and see redaction in their browser before installing. The sandbox
  runs the same detection engine; production users install the package.
- **Stat corrections.** README previously claimed *46 tests* and *22
  regex patterns* — actual numbers are *47 tests* and *21 patterns*
  (verified by `npm test` and `npm run check:regex` in CI).

### Updated URLs

- `package.json` `homepage` now points to
  <https://sether.raevenmarket.com.ng> (primary marketing domain).
  <https://setherai.vercel.app> remains live as a mirror.
- README, SECURITY policy, and changelog link the same pair of URLs.

### Migration notes

None — fully backward-compatible.

## 0.1.0-alpha.1 — 2026-05-04

Documentation + minor detector fixes. No breaking API changes.

### Fixed

- **Credit-card regex** no longer eats the leading space before a card
  number. The previous regex `\b[\d -]{13,23}` allowed the match to start
  with a space (since space is in the character class and `\b` permitted
  the transition). New regex `\b\d[\d -]{12,22}` requires the first
  matched character to be a digit. Functionally equivalent (Luhn check
  was always the source of truth) but makes redacted output read cleanly
  ("paid with `<CC_...>` from" instead of "paid with`<CC_...>` from").
  Added a regression test.

### Documentation

- README tagline updated from *"...before it ships to OpenAI / Anthropic"*
  to *"...before it ships to any LLM provider"* — reflects that the OSS
  is provider-agnostic. Added an explicit "Works with" section listing
  OpenAI, Anthropic, Cohere, Mistral, Gemini, Bedrock, Azure OpenAI,
  Together, Groq, Ollama, and self-hosted fine-tunes.
- `package.json` `homepage` field temporarily points to the live Vercel
  preview URL until the `sether.ai` domain is registered.

### Migration

None — fully backward-compatible with `0.1.0-alpha.0`.

## 0.1.0-alpha.0 — 2026-04-25 → 2026-05-02

Initial alpha. Successor to `redact-ai-stream` 1.x. Pre-release; API may
change before 1.0.

### Added

- **Streaming Transform with chunk-boundary safety.** Holds back trailing
  N bytes (default 256) so PII patterns crossing chunk boundaries are
  still detected. Property-based tests prove redact↔restore identity over
  arbitrary chunk partitions (50+ random runs per CI).
- **Detector framework** with pluggable detector packs.
- **Basic detector pack** (`@raeven-co/sether/detectors/basic`):
  - `EMAIL` — RFC 5321-style regex (ASCII-only)
  - `PHONE` — libphonenumber-js for international parsing
  - `CC` — bounded regex with Luhn validation; ReDoS-safe
  - `SSN` — regex with SSA invalid-prefix blacklist (000, 666, 9XX, group 00, serial 0000)
  - `IPV4` — strict per-octet 0-255 validation
  - `IPV6` — candidate regex + structural validator (note: `::1` not detected; see limitations)
  - `IBAN` — regex with ISO 13616 mod-97 checksum
- **`MemoryVault`** with LRU eviction + TTL.
- **`Sether` class** as public entry point with `.redact()` and `.restore()`
  Transform streams.
- **Dual ESM + CJS build** via tsup, ~10 KB each.
- **CI:** Node 18 / 20 / 22 matrix · ESLint flat config (typescript-eslint
  9.x) · Prettier · `safe-regex2` ReDoS scanner over all regex literals
  in `src/`.
- **Test suite:** 46 tests across 4 files (vault, detectors, stream,
  property-based).

### Documented limitations (pre-1.0)

- Email detection is ASCII-only; will not match IDN/Unicode local parts
- IPv6 detector skips `::1` (candidate min length is 4 chars)
- IPv6 detector does not match IPv4-in-IPv6 mixed form (`::ffff:192.0.2.1`)
- No name / organization / address detection (NER ships in 0.2)
- No secrets-pack detector yet (AWS/OpenAI/Anthropic/etc. — ships in 0.2)
- No drop-in middlewares yet (Express / fetch / OpenAI SDK wrappers — 0.2)
- No JSON-stream awareness (treats SSE / JSON streams as plain text — 0.2)
- No production benchmarks committed yet (vs Presidio comparison — 0.2)

### Migration from `redact-ai-stream` 1.x

A migration guide will be published before 1.0.0. For 1.x users:
- v1 had a critical chunk-boundary bug (PII split across chunks leaked
  unredacted). v2 fixes this — verified by property-based tests.
- v1's email regex contained `[A-Z|a-z]` (literal `|` char in TLD class).
  v2 corrects this to `[A-Za-z]`.
- v1's credit card and IBAN regexes had nested quantifier ReDoS surfaces.
  v2 uses single bounded character classes with post-match validation.
- v1's `tokenMap` was `public` and unbounded. v2 uses a private vault
  interface with LRU + TTL by default.
