# Changelog

## 0.2.0 — 2026-05-21

Minor release. Major feature expansion. **No breaking changes to the
0.1.x public API** — every export from 0.1.3 still works the same way.

### Added — Secrets detector pack (`secretsDetectors`)

Eight new detectors covering the most-leaked credential classes in
real-world AI prompts:

- **`awsAccessKeyDetector`** — `AKIA / ASIA / AROA / AIDA` + 16-char base32 tail
- **`openaiKeyDetector`** — `sk-` / `sk-proj-` / `sk-svcacct-` / `sk-admin-` formats
- **`anthropicKeyDetector`** — `sk-ant-api*` / `sk-ant-admin*` published prefixes
- **`githubPatDetector`** — classic (`ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`) + fine-grained (`github_pat_`)
- **`slackTokenDetector`** — `xox[baprs]-` bot/user/app/refresh/workspace tokens
- **`stripeKeyDetector`** — live/test `sk_` / `rk_` / `pk_` + `whsec_` webhook secrets
- **`jwtDetector`** — three-segment base64url header.payload.signature with `eyJ` prefix on both header and payload
- **`highEntropyDetector`** — 32+ char strings with Shannon entropy ≥ 3.5 bits/char (catches HMAC secrets and internally generated API tokens with no published prefix)

All eight ship as a single `secretsDetectors` array for convenience and
follow the existing `Detector` interface. All regex literals scanned by
`safe-regex2` in CI — 0 unsafe across 117 patterns total.

Opt-in by default (the bare `new Sether()` still uses only `basicDetectors`):

```ts
import { Sether, basicDetectors, secretsDetectors } from '@raeven-co/sether';
const sether = new Sether({
  detectors: [...basicDetectors, ...secretsDetectors],
});
```

### Added — SSE / JSON-stream mode (`createSSERedactStream`, `createSSERestoreStream`)

The streaming PII redactor finally understands Server-Sent Events. Field
labels (`data:`, `event:`, `id:`, `retry:`), comment lines, and the
blank-line event separator pass through verbatim — only `data:` payloads
are redacted. The mirror restore stream un-tokenises payloads on the
return path, leaving the SSE frame structure intact.

Round-trip identity proven by tests: any SSE frame → redact → restore
returns the exact original bytes.

```ts
import { createSSERedactStream, basicDetectors, MemoryVault } from '@raeven-co/sether';
const vault = new MemoryVault();
openaiResponse.body.pipe(createSSERedactStream({ detectors: basicDetectors, vault }));
```

### Added — Drop-in middlewares

Four ways to wire Sether into an existing app without rewriting handlers:

- **`wrapFetch({ detectors, vault })`** — drop-in replacement for the
  global `fetch`. Redacts string request bodies before they leave the
  process; restores text response bodies on the way back. Binary bodies
  pass through.
- **`createExpressMiddleware({ detectors, vault })`** — standard
  Express middleware (`(req, res, next) => …`). Redacts `req.body` for
  string and JSON shapes; wraps `res.send` + `res.json` to restore
  outgoing responses. Express is a peer dep — not imported here.
- **`wrapOpenAI(client, { detectors, vault })`** — wraps an `OpenAI`
  client so `chat.completions.create` redacts `messages[].content`
  (string and array-of-parts forms) before the API call and restores
  `choices[].message.content` / `choices[].delta.content` on the way
  back. `openai` is an optional peer dep via `peerDependenciesMeta`.
- **`wrapAnthropic(client, { detectors, vault })`** — wraps an
  `Anthropic` client so `messages.create` redacts the user message content
  plus the top-level `system` prompt (string and array-of-blocks forms)
  and restores `content[]` text blocks on the way back.
  `@anthropic-ai/sdk` is an optional peer dep.

The SDK wrappers are duck-typed — they don't import the SDK packages
themselves, so users who don't use them pay zero install cost.

### Added — Audit event schema (`AuditEvent`, `AuditSink`, sinks)

Foundation for the hosted compliance-reporting tier. The OSS package
ships:

- **`AuditEvent`** — the canonical event shape (timestamp, detector,
  valueLength, token, action, optional tenantId, requestId, destination,
  and regulation mappings). **The original value is never carried in
  the event** — only its length.
- **`AuditSink`** — one-method interface (`write(event)`) that any sink
  can implement.
- **`ConsoleAuditSink`** — JSONL writer to stderr (configurable target,
  optional pretty mode).
- **`MemoryAuditSink`** — accumulates events in memory; useful for
  tests and the in-browser sandbox.
- **`DEFAULT_REGULATION_MAPPINGS`** — every built-in detector type
  pre-mapped to GDPR / SOC 2 / HIPAA / EU AI Act / PCI DSS / ISO 27001 /
  NDPA references. The hosted gateway uses the same map.

Persistence, SIEM export (Splunk / Datadog / Logpush), and time-windowed
compliance reports live in the hosted Pro tier — not in OSS — but the
event shape and reference sink are stable contracts.

### Added — Public `redactSync(text, { detectors, vault })` helper

Synchronous one-shot redaction for cases where you have the full text in
hand and don't need chunk-boundary buffering (e.g. a single SSE payload,
a JSON field, a log line). Functionally identical to the `isFinal: true`
path of the streaming Transform — same detection, same vault writes.
Use `createRedactStream` instead when input may span chunk boundaries.

### Build & test surface

- Tests: **101 passing** (was 52 in 0.1.3 → +49 new tests across
  secrets, SSE, fetch, OpenAI wrapper, Anthropic wrapper, audit)
- Build size: CJS **28.07 KB** (was 11.78 KB), ESM **27.22 KB** (was
  11.47 KB). +~16 KB for all the new modules combined.
- ReDoS scan: **117 patterns, 0 unsafe** (was 23 — most new patterns
  are bounded single-class regexes in the secrets pack)
- The 0.1.3 supply-chain win is preserved: still no `require('net')`
  or any network-module reference in the published bundle.

### Migration

None. The 0.1.x API is unchanged. 0.2.0 is a drop-in upgrade.

To opt into the new pieces:

```ts
// New: include secrets detection
import { Sether, basicDetectors, secretsDetectors } from '@raeven-co/sether';
const sether = new Sether({
  detectors: [...basicDetectors, ...secretsDetectors],
});

// New: drop-in middleware for an OpenAI client
import OpenAI from 'openai';
import { wrapOpenAI } from '@raeven-co/sether';
const openai = wrapOpenAI(new OpenAI({ apiKey }), {
  detectors: sether.detectors,
  vault: sether.vault,
});
```

### Deferred to 0.3 / Pro hosted tier

Capture-now-for-context list — these were on the 0.2 wishlist but
deliberately not bundled here:

- **NER detectors** (names, organisations, addresses) — needs
  `onnxruntime-node` (~30 MB native binary) + a model file. Will ship
  as a separate package `@raeven-co/sether-ner` to keep the core OSS
  install lean.
- **Pluggable Redis / Postgres vault adapters** — bundling these would
  add ~10 MB of optional deps. The `Vault` interface already supports
  BYO adapters; the README now includes adapter pattern examples.
- **Compliance reports** (time-windowed PDF/CSV mapped to SOC 2 / GDPR /
  HIPAA controls) — aggregates over an audit-event store. Lives in the
  Cloudflare Workers hosted tier.
- **Audit log persistence + SIEM export** — same: needs a database +
  scheduled jobs. Hosted-tier feature. The audit-event schema we
  shipped here is what makes the hosted side possible.

---

## 0.1.3 — 2026-05-16

Patch release: supply-chain hardening. No public API change, no behavior
change for any consumer. Drop-in safe upgrade from 0.1.2.

### Changed

- **IPv6 validator brought in-tree.** Replaced the single `import { isIPv6 }
  from 'node:net'` in `src/detectors/basic.ts` with an equivalent in-tree
  validator. The previous import caused supply-chain scanners (e.g.
  Socket.dev) to flag the published bundle as "accesses the network,"
  even though `net.isIPv6` is a pure synchronous string validator and
  no socket is ever opened. The new validator removes the `require('net')`
  line from the published `dist/index.cjs` entirely.
- **Equivalence proven by property-based tests.** Added
  `test/ipv6.equivalence.test.ts`: 5 tests including two property-based
  fuzz runs that compare the new validator against Node's `net.isIPv6`
  across **6000+ randomly generated inputs** (hex+colon strings and
  fully random Unicode strings). Tests pass — behavior is provably
  identical to Node's implementation for the candidate domain the IPv6
  detector operates on.
- **`sideEffects: false`** declared in `package.json` — explicit
  tree-shaking signal for bundlers; no side effects on import.
- **`funding` field** added pointing at GitHub Sponsors.
- **`bugs.email`** added (`security@raeven.co`) so vulnerability
  reporters can find the right inbox quickly.

### Build & test surface

- Tests: **52 passing** (up from 47 — 5 new equivalence tests).
- Build size: CJS 11.78 KB, ESM 11.47 KB (+~1.2 KB each for the inline
  validator — fair trade for removing a flagged dependency).
- ReDoS scan: 23 patterns, 0 unsafe (was 21 — new patterns are bounded
  character classes in the validator).

### Migration

None. Public API is unchanged. The `IPV6` detector continues to match
exactly the same set of inputs it matched in 0.1.x.

---

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
