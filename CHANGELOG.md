# Changelog

## 0.1.0-alpha — 2026-04-25 → 2026-05-02

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
