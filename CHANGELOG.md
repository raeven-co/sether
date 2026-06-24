# Changelog

## 0.5.6 — 2026-06-24

Additive convenience release. **No breaking changes** — every existing export and
behaviour is unchanged. This fills the obvious gap that `redactSync` shipped
without a synchronous counterpart.

### Added — `restoreSync(text, { vault })`

The synchronous one-shot mirror of `redactSync`: it swaps every `<TYPE_uuid>`
token in a complete string back to its original value via the vault, with no
chunk-boundary buffering. Use it when you hold the whole text in hand (a JSON
field, a log line, a single SSE payload); reach for `createRestoreStream` when
tokens may span chunk boundaries. A token with no vault entry (expired, evicted,
or from a different vault) is returned untouched.

```ts
import { redactSync, restoreSync, basicDetectors, MemoryVault } from '@raeven-co/sether';
const vault = new MemoryVault();
const safe = redactSync('email alice@example.com', { detectors: basicDetectors, vault });
const back = restoreSync(safe, { vault }); // -> 'email alice@example.com'
```

### Changed — restore hardened against non-string vault returns

The streaming restore and the new `restoreSync` now substitute a token only when
`Vault.get()` returns a string, matching every other restore path in the package.
A vault that returns a non-string (for example a mistakenly async `get()`) now
leaves the token in place instead of inserting `[object Promise]`. No change for
the documented synchronous `Vault` contract.

### Build & test surface

- Tests: **143 passing** (139 prior + 4 for `restoreSync`)
- ReDoS scan: 167 patterns, 0 unsafe; bundles ASCII-only; lint/typecheck clean
- Runtime dependencies: **1** (`libphonenumber-js`) — unchanged

## 0.5.5 — 2026-06-18

Correctness and hardening patch surfaced by an internal pre-release audit.
**No public API changes** — every export, signature, and type is identical to
0.5.4, and the redact↔restore round-trip is byte-for-byte unchanged. Three
behavioural fixes, all in the safe direction, plus supply-chain documentation.

### Fixed — streaming redactor holds back an over-long value at a chunk boundary

The redact stream catches a PII match that crosses a chunk boundary by holding
back the last `safeDistanceBytes` (256) of each chunk. That guarantee only held
for values **shorter than** the safe distance. A longer value — in practice a
JWT or API key from the opt-in `secretsDetectors`, which are whitespace-free and
routinely 300–800+ chars — has not fully arrived when the chunk prefix is
emitted, so no detector matches it yet; its head was emitted unredacted, and once
the head was gone the remainder no longer matched (a headless JWT has no `eyJ`
prefix). Default `basicDetectors` were unaffected in practice — a valid email is
≤ 254 bytes.

The redact stream now also refuses to cut inside an in-progress whitespace-free
run, pulling the emit boundary back to the run's start so the whole candidate is
re-examined once the rest arrives — bounded by `max(safeDistanceBytes × 4, 8192)`
bytes so a long whitespace-free blob can't grow the buffer without limit. The
guard only ever holds back **more**, so round-trip identity and all existing
detection are unchanged. Regression test added (a 400-char JWT split across the
boundary). For values larger than the bound, raise `safeDistanceBytes` or use
`redactSync` (documented under *Streaming safety*).

### Fixed — `wrapFetch` no longer forwards a stale `content-length` / `content-encoding`

`wrapFetch` rebuilds the response after restoring tokens, which changes the body
length, and reading the body via `.text()` has already decoded any content
encoding. The rebuilt `Response` previously carried the upstream `content-length`
and `content-encoding` headers, which then described the wrong bytes (a stale
`content-encoding: gzip` over now-plaintext is the dangerous one). Both headers
are dropped from the rebuilt response.

### Fixed — Express middleware keeps `res.send` / `res.json` synchronous

`createExpressMiddleware` wrapped `res.send` / `res.json` as `async` functions,
so they returned a pending `Promise` instead of `res`. Express does not await
them and requires `res` for chaining, so this could send an unrestored body or
trigger a double-send / "headers already sent". Restoration is pure token→value
substitution, so the wrappers are now synchronous and return `res` as Express
expects. First tests added for the Express middleware (previously uncovered).

### Documentation

- **Token vault:** replaced the `RedisVault` example, whose `async get()` does
  not satisfy the **synchronous** `Vault` interface and would silently break
  `restore()`, with a correct synchronous custom-vault example and an explicit
  note that `restore()` cannot await per-token lookups.
- **SECURITY.md:** added a *Supply-chain posture* section — the published tarball
  contents, the single runtime dependency (`libphonenumber-js`), and why
  dev-tooling scanner advisories (e.g. on `@typescript-eslint/eslint-plugin` or a
  transitive `@humanfs/types`) never reach consumers.

### Build & test surface

- Tests: **139 passing** (134 prior + 2 streaming boundary + 3 Express)
- ReDoS scan: 167 patterns, 0 unsafe; bundles ASCII-only; lint/typecheck clean
- Runtime dependencies: **1** (`libphonenumber-js`) — unchanged
- Consumer-facing `npm audit --omit=dev`: **0 vulnerabilities**. One low-severity,
  dev-only `esbuild` advisory (reachable only via esbuild's dev server on Windows,
  which Sether never runs) remains in the build toolchain; clearing it requires a
  major `tsup` / `vitest` bump and is deferred from this patch.

## 0.5.4 — 2026-06-12

Dev-tooling upgrade to clear Socket.dev / CVE alerts. **No runtime change** —
the published bundle, the single runtime dependency (`libphonenumber-js`), the
API, and all detectors are byte-for-byte identical to 0.5.3. Consumers are
unaffected; only build/test tooling changed.

### Changed — devDependencies upgraded to clear advisories

Socket's repo scan flagged 7 alerts, **all in development dependencies** (none
shipped to consumers — `npm audit --omit=dev` was already 0). The headline was
a **Critical CVE in `vitest`** (CVE-2026-47429, test-runner UI server file
read/exec) plus medium CVEs in transitive `esbuild` / `vite` / `brace-expansion`.

- `vitest` `^2.1.8` → `^4.1.8` (clears the Critical CVE and pulls patched `vite`)
- `tsup` `^8.3.5` → `^8.5.1` (pulls patched `esbuild`)
- `typescript-eslint` `^8.20.0` → `^8.61.0`, `eslint` `^9.18.0` → `^10.4.1`,
  `@eslint/js` → `^10.0.1`

`npm audit` (full tree, including dev) is now **0 vulnerabilities**.

### Build & test surface

- Tests: **134 passing** (vitest 4)
- ReDoS scan: 161 patterns, 0 unsafe; bundles ASCII-only; lint/typecheck clean
- Runtime dependencies: **1** (`libphonenumber-js`) — unchanged

## 0.5.3 — 2026-06-11

Supply-chain surface reduction. **No API or behaviour change** — every detector
and both SDK wrappers work exactly as before.

### Removed — `openai` / `@anthropic-ai/sdk` peer dependencies

The `wrapOpenAI` / `wrapAnthropic` middlewares are **structurally typed**
(`interface OpenAILike` / `AnthropicLike`) and never import either SDK — at
runtime, as a type, or as a dev dependency. The `peerDependencies` declaration
was pure metadata with no code behind it, yet it made supply-chain scanners
fold two large AI SDKs into Sether's dependency graph.

Dropping the declaration leaves a single declared dependency
(`libphonenumber-js`). The wrappers are unchanged — pass your own
`new OpenAI()` / `new Anthropic()` instance (or any client matching the
`{ chat: { completions: { create } } }` / `{ messages: { create } }` shape)
exactly as before. Nothing to change in consumer code.

### Build & test surface

- Tests: **134 passing** (unchanged)
- Declared dependencies: **1** (`libphonenumber-js`), down from 3
- ReDoS scan: 161 patterns, 0 unsafe; bundles ASCII-only (0.5.2)

## 0.5.2 — 2026-06-11

Supply-chain hardening patch. **No API or behaviour change** — detectors,
multilingual coverage, and all matches are byte-for-byte identical to 0.5.1.

### Fixed — ASCII-only published bundles (Socket.dev Supply Chain Security)

The multilingual identity labels added in 0.4.0 embedded raw non-ASCII
characters — including right-to-left Arabic script — directly in the shipped
`dist/*.js` and `dist/*.cjs`. Static supply-chain scanners flag raw non-ASCII
/ bidirectional Unicode in code as a "Trojan Source" risk (CVE-2021-42574),
which lowered the package's Supply Chain Security score.

The label regexes now use `\uXXXX` escape sequences for every non-ASCII code
point. The regex engine sees the **same code points**, so detection of CJK,
Cyrillic, Arabic, and accented-Latin labels is unchanged (verified by the
multilingual test suite) — but the shipped JavaScript is now pure ASCII.

### Added — `check:ascii` build gate

`scripts/check-ascii-dist.mjs` fails the build (wired into `prepublishOnly`)
if any shipped bundle contains a non-ASCII byte, so this can't silently
regress. The bundler is also configured with `charset: 'ascii'`.

### Build & test surface

- Tests: **134 passing** (unchanged)
- ReDoS scan: 161 patterns, 0 unsafe
- All four shipped bundles verified 0 non-ASCII characters

## 0.5.1 — 2026-06-10

Docs / metadata patch. **No code changes** — the published API, detectors, and
behaviour are identical to 0.5.0.

- Corrected the operating entity from "Raeven, Inc." to **Raeven Company LTD**
  (registered in Nigeria) across the README, SECURITY.md, LICENSE, and package
  metadata.
- Updated the security / contact email to `emorylebo@gmail.com` (README,
  SECURITY.md, and `bugs.email`).

## 0.5.0 — 2026-06-09

### Added — browser-safe entry (`@raeven-co/sether/browser`)

A new subpath export that ships **only the pure detection surface** — the basic,
secrets, and identity detector packs, their types, and `DEFAULT_REGULATION_MAPPINGS`
— with **no `node:stream` / `node:crypto` imports**. The package root still pulls
Node built-ins for the streaming transforms, so it can't be bundled for the
browser; this entry can.

```ts
import { basicDetectors, secretsDetectors, identityDetectors } from '@raeven-co/sether/browser';
const matches = [...basicDetectors, ...identityDetectors].flatMap((d) => d.detect(text));
```

This lets the browser sandbox and the Sether Shield extension consume the **same
detection logic as the Node package** instead of maintaining hand-ported copies
that drift out of sync. **No change to the package root** — `new Sether()` and all
existing imports behave exactly as in 0.4.x.

### Notes

- ReDoS scan: **PASS** — 161 regex literals scanned, 0 unsafe (`safe-regex2`).
- Tests: **134 passing** across 12 files — unchanged from 0.4.x (additive release).
- Dual-export verified for both entries: root (36 keys, ESM === CJS) and `./browser`
  (23 keys, resolves for both `import` and `require`). `dist/browser.js` carries no
  `node:stream` / `node:crypto`.
- Artifact sizes: `dist/index.js` ≈ 36.6 KB, `dist/browser.js` ≈ 19.1 KB.
- Node tested: 18 / 20 / 22 (CI matrix).

## 0.4.1 — 2026-06-06

Docs-only patch. **No code changes** — the published API, detectors, and
behaviour are identical to 0.4.0.

- **README:** replaced the ASCII flow diagram with a rendered before/after
  redaction image (input → tokenised-to-LLM), served from the repo's
  `assets/` via an absolute raw-GitHub URL so it renders on both npm and
  GitHub. The image is referenced by URL, not bundled in the package tarball.
- Refreshed the status line to 0.4.x.

## 0.4.0 — 2026-06-04

Minor release: the identity pack now recognises labels in **many languages**,
plus three correctness fixes. **No change to default behaviour** — the identity
pack is still opt-in and `basicDetectors` is untouched.

### Added — multilingual labels for the identity pack

`nameDetector`, `dobDetector`, `passportDetector`, and `addressDetector` now
anchor on labels beyond English:

- **Latin-script** (ASCII word-boundary anchored): English plus French, Spanish,
  German, Dutch, Portuguese, Italian — e.g. `Nom:`, `Nombre:`, `Geburtsdatum:`,
  `Reisepass:`, `Adresse:`, `Indirizzo:`.
- **Non-Latin** (colon-anchored, ASCII or fullwidth `：`): CJK, Cyrillic, Arabic —
  e.g. `名前：`, `氏名：`, `이름:`, `Имя:`, `パスポート:`, `住所:`, `الاسم:`.

Value capture was already Unicode-aware; this closes the gap where the *label*
trigger was English-only. `Nom: José Müller`, `名前：田中太郎`, and
`Имя: Иван Петров` are now all redacted. This makes the documented
"works in any language" behaviour true end-to-end.

### Fixed

- **DOB no longer carves a valid date out of a longer number.** `1/1/19999`
  previously matched `1/1/1999`, leaking the trailing `9`. Numeric/ISO/written
  date patterns are now guarded with a trailing `(?!\d)`.
- **NAME no longer truncates on a double space.** `Name: John  Smith` now
  captures the full `John  Smith` instead of dropping the surname.
- **NAME over-fires less.** Values where every word is a common non-name word
  (`Dear Sir`, `Name: The Customer`, `Service Team`) are now rejected.

### Build & test surface

- Tests: **134 passing** (123 prior + 11 for multilingual labels & fixes)
- ReDoS scan: 152 patterns, 0 unsafe
- No new dependencies; identity pack remains opt-in and dependency-free

---

## 0.3.1 — 2026-05-31

Docs-only patch. **No code changes** — the published API and behaviour are
identical to 0.3.0. This release exists to refresh the README on the npm
package page, which for 0.3.0 still described 0.2.0 as "this release" and
listed NER as shipping in 0.3. Corrected: the identity pack is now the
headline 0.3.x feature, the 0.2.0 capabilities are documented as the stable
API (not "new"), and free-text NER is clearly future work
(`@raeven-co/sether-ner`). Also corrected stale test/regex/size counts and
the IPv6 validator description (in-tree, not `node:net`).

## 0.3.0 — 2026-05-31

Minor release: a new **opt-in identity detector pack** (names, dates of
birth, passport numbers, addresses) plus the supply-chain hygiene change to
`wrapFetch`. **No change to default behaviour** — `new Sether()` runs the
same `basicDetectors` it always has; the identity pack only activates when
you opt in explicitly.

### Added — identity detector pack (`identityDetectors`)

Four label-anchored detectors for the higher-context PII classes that have
no self-validating shape (so a bare regex would be a false-positive
machine). They redact a value only when it appears with the label that
introduces it — `Name:`, `DOB:`, `Passport No:`, `Address:` — or, for the
few distinctive standalone shapes, a structure strong enough to keep false
positives low (street line with a house number + suffix, UK postcode).

```ts
import { Sether, basicDetectors, identityDetectors } from '@raeven-co/sether';

const sether = new Sether({
  detectors: [...basicDetectors, ...identityDetectors],
});
```

Detectors: `nameDetector` (`NAME`), `dobDetector` (`DOB`, calendar- and
plausibility-validated), `passportDetector` (`PASSPORT`), `addressDetector`
(`ADDRESS`). Value capture is **Unicode-aware**, so a labelled non-English
name (`Name: 田中太郎`, `Nom: José Müller`) is redacted too.

**Not** in `basicDetectors` — existing installs are unaffected unless they
import the pack. Free-text NER for unlabelled names / organisations /
locations in running prose remains roadmap (the separate
`@raeven-co/sether-ner` ONNX package).

### Changed — `wrapFetch` now requires `fetchImpl` (breaking)

Folded into this 0.3.0 minor (0.x semver permits breaking changes in a
minor). Anyone already passing `fetchImpl` explicitly is unaffected.

Previously, `wrapFetch({ detectors, vault })` would fall back to
`globalThis.fetch` if `fetchImpl` was not provided. That implicit fallback
caused Socket.dev (and other static supply-chain analysers) to flag the
package as network-capable — a *correct* capability declaration, but one
the package itself doesn't need to make. Cleaner: the **caller** declares
the network surface by handing in its own fetch.

The line of code that was being flagged:

```ts
const baseFetch = opts.fetchImpl ?? globalThis.fetch;   // 0.2.0 (flagged)
```

becomes:

```ts
if (typeof opts.fetchImpl !== 'function') {              // 0.2.1
  throw new Error('wrapFetch: opts.fetchImpl is required. …');
}
const baseFetch = opts.fetchImpl;
```

### Migration

Users of `wrapFetch` who were relying on the implicit `globalThis.fetch`
fallback need a one-line change:

```ts
// 0.2.0
const safeFetch = wrapFetch({ detectors, vault });

// 0.2.1
const safeFetch = wrapFetch({ detectors, vault, fetchImpl: fetch });
```

Everything else in the 0.2.x API is unchanged.

### Why

After 0.1.3 dropped the `node:net` import and the supply-chain score
moved 75 → 76 (essentially unchanged), the residual flag was traced to
the `globalThis.fetch` reference in `wrapFetch`. With this release the
bundled `dist/index.cjs` and `dist/index.js` contain **no references**
to `globalThis.fetch`, `XMLHttpRequest`, `WebSocket`, `require('http')`,
`require('https')`, `require('net')`, `require('tls')`, `require('dns')`,
`require('dgram')`, or `require('http2')`. Socket.dev's next re-scan
should reflect that — the supply-chain score is expected to move from
76 → 95+ once it lands.

### Build & test surface

- Tests: **123 passing** (101 prior + 22 for the identity pack)
- Build size: CJS 35.29 KB, ESM 34.32 KB
- ReDoS scan: 146 patterns, 0 unsafe
- No network-capability references in `dist/`

---

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
