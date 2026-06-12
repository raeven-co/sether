# Sether

> **Hide personal data from your AI before it reaches any LLM provider.**
>
> Named for the Hebrew *sether* (סֵתֶר) — *the hiding place*. Psalm 32:7.

Sether is a streaming PII-redaction layer that sits between your application
and any LLM API. It detects sensitive data (email, phone, SSN, credit-card,
IBAN, IP addresses), swaps each match for a stable token before the request
leaves your boundary, then restores the original values transparently in
the response.

![Sether redacts PII locally before it reaches the LLM: the input "Hi, this is Amara Okafor — my account email is amara.okafor@acme.com … card 4242 4242 4242 4242 … call me at +1 (415) 555-2671 … SSN 123-45-6789" becomes "Hi, this is &lt;NAME&gt; — my account email is &lt;EMAIL&gt; … card &lt;CC&gt; … &lt;PHONE&gt; … &lt;SSN&gt;". The token vault stays in your infrastructure and restore() swaps the originals back into the reply.](https://raw.githubusercontent.com/raeven-co/sether/main/assets/sether-redaction.png)

*Your app → **Sether** redacts locally → LLM. The token vault stays in your infrastructure; `restore()` swaps the originals back into the reply.*

Three lines of TypeScript to wire it up. Works with **OpenAI, Anthropic,
Cohere, Mistral, Google Gemini, AWS Bedrock, Azure OpenAI, Together,
Groq, Ollama**, your own fine-tunes — anything that speaks HTTP and
streams text. Sether doesn't care who's on the other end; it operates on
the text stream.

**Status:** `0.5.3` — browser-safe `@raeven-co/sether/browser` entry, opt-in identity pack with multilingual labels (names, DOB, passport, address), secrets pack, SSE/JSON-stream mode, audit events, and drop-in middlewares for Express / fetch / OpenAI / Anthropic.
A product of **[Raeven Company LTD](https://admin.raevenmarket.com.ng)**

---

## Why this exists

If your application sends a customer's email, phone number, or any other
PII to an LLM provider, that's a sub-processor disclosure under
[GDPR Article 28](https://gdpr-info.eu/art-28-gdpr/). Credit-card data
pulls you into PCI DSS scope. Health identifiers trigger HIPAA. The first
GDPR enforcement actions tied to AI flows landed in 2025, and the EU AI
Act phases in through 2026–2027.

Sether stops the leak at the boundary: sensitive substrings become stable
tokens before the bytes leave your process, and `restore()` swaps them back
so your application code does not need to branch on redacted text.
Automated per-event regulation tagging and SIEM export are on the **Pro /
hosted roadmap** (see *What's coming* below) — the npm library focuses on
deterministic streaming redaction today.

---

## Try it without installing

The live sandbox runs the same detection engine in your browser — paste
any text, watch the PII tokens get swapped in real time:

- **Live sandbox:** <https://setherai.vercel.app/#sandbox>

The sandbox is a browser-only demonstration of `@raeven-co/sether`. For production, install the package below.

---

## Install

```bash
npm install @raeven-co/sether
```

Requires Node 18+. ESM and CommonJS both supported.

---

## 60-second quickstart

```ts
import { Sether } from '@raeven-co/sether';
import { Readable } from 'node:stream';

const sether = new Sether();

// 1. Outgoing request — pipe through sether.redact() before sending to LLM
const userInput = Readable.from(['my email is alice@example.com']);
const safeForLLM = userInput.pipe(sether.redact());
// → "my email is <EMAIL_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx>"

// 2. LLM response — pipe through sether.restore() before showing the user
const llmResponse = Readable.from([
  'Confirmation sent to <EMAIL_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx>',
]);
const safeForUser = llmResponse.pipe(sether.restore());
// → "Confirmation sent to alice@example.com"
```

The same `Sether` instance shares its vault between `.redact()` and
`.restore()`, which is how the round-trip identity is preserved across
streaming chunks.

### End-to-end round-trip example

```ts
import { Sether } from '@raeven-co/sether';
import { Readable } from 'node:stream';

async function streamToString(stream: NodeJS.ReadableStream) {
  let out = '';
  for await (const chunk of stream) out += chunk.toString();
  return out;
}

const sether = new Sether();
const original = 'Contact alice@example.com or call +1 415 555 2671.';

const redacted = await streamToString(
  Readable.from([original]).pipe(sether.redact()),
);
// → "Contact <EMAIL_...> or call <PHONE_...>."

const restored = await streamToString(
  Readable.from([redacted]).pipe(sether.restore()),
);
// → "Contact alice@example.com or call +1 415 555 2671."

console.log(restored === original); // true
```

---

## Choose specific detectors

By default Sether runs all built-in detectors. Pass an explicit list to
narrow the scope:

```ts
import { Sether, emailDetector, ssnDetector } from '@raeven-co/sether';

const sether = new Sether({
  detectors: [emailDetector, ssnDetector], // only these two
});
```

### Built-in detectors (basic pack)

| Detector | Method | Notes |
| --- | --- | --- |
| `emailDetector` (`EMAIL`) | Regex (`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`) | RFC 5321-style local part. ASCII-only — IDN/Unicode addresses are not matched. |
| `phoneDetector` (`PHONE`) | [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js) | International phone parsing. |
| `creditCardDetector` (`CC`) | Bounded regex + Luhn check | 13–19 digit numbers passing Luhn. ReDoS-safe. |
| `ssnDetector` (`SSN`) | Regex + SSA invalid-prefix blacklist | Rejects area `000`, `666`, and `9XX` (ITIN range), group `00`, serial `0000`. |
| `ipv4Detector` (`IPV4`) | Strict octet-bounded regex | `0–255` per octet, no leading zeros. |
| `ipv6Detector` (`IPV6`) | Candidate regex + in-tree `isIPv6` validator (equivalent to Node's `net.isIPv6`, no `node:net` import) | **Known limit:** `::1` and IPv4-in-IPv6 (`::ffff:192.0.2.1`) not matched. |
| `ibanDetector` (`IBAN`) | Regex + mod-97 checksum | Validates against ISO 13616. |

### Identity pack (opt-in — new in 0.3.0)

Names, dates of birth, passport numbers, and addresses have no
self-validating shape the way an IBAN or credit card does, so a bare regex
for them is a false-positive machine. The identity pack instead uses
**label-anchored** detection: it redacts a value only when it appears with
the label that introduces it (`Name:`, `DOB:`, `Passport No:`, `Address:`),
or — for the few distinctive standalone shapes — a structure strong enough
to keep false positives low (a street line with a house number + suffix, a
UK postcode).

**Multilingual (0.4.0):** labels are recognised in many languages — Latin-script
(`Name:`/`Nom:`/`Nombre:`/`Geburtsdatum:`/`Adresse:`…) plus CJK, Cyrillic, and
Arabic (`名前：`, `Имя:`, `الاسم:`). Value capture is Unicode-aware throughout, so
`Nom: José Müller`, `名前：田中太郎`, and `Имя: Иван Петров` are all redacted.

It is **not** part of `basicDetectors`, so `new Sether()` behaviour is
unchanged. Opt in explicitly:

```ts
import { Sether, basicDetectors, identityDetectors } from '@raeven-co/sether';

const sether = new Sether({
  detectors: [...basicDetectors, ...identityDetectors],
});
```

| Detector | Method | Notes |
| --- | --- | --- |
| `nameDetector` (`NAME`) | Multilingual label/salutation anchor + Unicode-aware capture | Catches labelled names across languages (`Name: 田中太郎`, `Nom: José Müller`, `Имя: Иван Петров`). Does **not** detect unlabelled names in free prose — that's NER (roadmap). |
| `dobDetector` (`DOB`) | Label anchor + calendar & plausibility validation | ISO / numeric / written dates; rejects invalid calendar dates and implausible birth years. |
| `passportDetector` (`PASSPORT`) | Label anchor + format check | 6–9 alphanumerics following a `passport` label; requires at least one digit. |
| `addressDetector` (`ADDRESS`) | Label anchor, street-suffix structure, UK postcode | Labelled address lines, `<number> <words> <Street/Ave/Rd…>`, and UK postcodes. |

**Coverage note:** the identity pack is strongest on *labelled* and
*structured* PII (forms, KYC, RAG documents, support tickets). Free-text
NER for unlabelled names / organisations / locations is on the roadmap as
the separate `@raeven-co/sether-ner` package.

All detectors implement the `Detector` interface — you can write your own
and pass it via the `detectors` option.

```ts
import type { Detector } from '@raeven-co/sether';

const orderIdDetector: Detector = {
  type: 'ORDER_ID',
  detect(text) {
    const matches = [];
    const re = /\bORD-\d{8}\b/g;
    for (const m of text.matchAll(re)) {
      matches.push({ start: m.index!, end: m.index! + m[0].length, value: m[0] });
    }
    return matches;
  },
};
```

---

## Token vault (persistence)

Tokens map back to the original values through a vault. Sether ships with
an in-memory LRU vault (10 000 entries, 1-hour TTL by default). For
production, plug in your own backed by Redis, Postgres, or any KV store
that implements the `Vault` interface.

```ts
import { Sether, type Vault } from '@raeven-co/sether';
import type { Redis } from 'ioredis';

class RedisVault implements Vault {
  constructor(private redis: Redis, private ttlSec = 3600) {}
  set(token: string, value: string): void {
    void this.redis.set(token, value, 'EX', this.ttlSec);
  }
  async get(token: string): Promise<string | undefined> {
    return (await this.redis.get(token)) ?? undefined;
  }
  // …has, delete, size, clear
}
```

The vault stays in **your** process (or your own backing store if you
implement `Vault`). **This package does not phone home** — streams are not
sent to Raeven. A future optional hosted gateway will be documented
separately.

---

## Streaming safety

Sether's redact stream holds back `safeDistanceBytes` (default `256`) at
the tail of each chunk, so a PII pattern crossing a chunk boundary is
still detected on the next chunk arrival. The restore stream applies the
same principle to incoming tokens.

This is verified by property-based tests that partition arbitrary text at
random chunk boundaries and assert the redact→restore round-trip is
identity (50+ random partitions per CI run).

If you stream very large tokens (custom detectors with long values), bump
`safeDistanceBytes`:

```ts
const sether = new Sether({ safeDistanceBytes: 1024 });
```

---

## What's verified in this release

- **Streaming-safe:** chunk-boundary round-trip proven by property-based tests
- **ReDoS-safe:** all regex literals scanned by `safe-regex2` in CI (146 patterns, 0 unsafe)
- **TypeScript strict mode:** no `any`, no implicit types
- **Dual build:** ESM + CJS, ≈ 35 KB each
- **CI matrix:** Node 18 / 20 / 22 — lint, typecheck, format, regex-safety, 134 tests, build
- **MIT licensed** — fork it, audit it, no vendor lock-in

---

## Honest limitations

Known limitations in this release:

- **Email detection is ASCII-only.** IDN/Unicode local parts won't match. Unicode-aware email is on the roadmap.
- **IPv6 `::1` (loopback) is not detected.** Candidate regex requires 4+ chars. Loopback isn't customer PII, but flag it in your audit logs if it matters for your threat model.
- **Credit-card regex is permissive.** Anything 13–23 chars of digits/spaces/dashes is a candidate, then validated by Luhn. False positives in dense numeric content are possible.
- **Names / DOB / passport / address are label-anchored, not free-text NER.** The opt-in identity pack (0.3.0) catches these when they appear with a label or distinctive structure. Unlabelled names / organisations / locations in running prose need the ONNX NER model shipping separately as `@raeven-co/sether-ner`.
- **No production benchmarks yet.** Throughput numbers (vs Microsoft Presidio) will land alongside the NER package.

---

## What's new in 0.3.0

The headline of this release is the **opt-in identity detector pack** —
label-anchored detection for names, dates of birth, passport numbers, and
addresses (documented under [Identity pack](#identity-pack-opt-in--new-in-030)
above). It is **not** part of `basicDetectors`, so `new Sether()` behaves
exactly as it did in 0.2.x — existing installs are unaffected unless they
opt in.

This release also makes `wrapFetch`'s `fetchImpl` **required** — it no longer
falls back to `globalThis.fetch`. That's a small breaking change for anyone
who relied on the implicit fallback; the one-line migration is to pass
`fetchImpl: fetch`. Full notes in the [CHANGELOG](./CHANGELOG.md).

---

## Capabilities: secrets, SSE, middlewares & audit

These shipped in 0.2.0 and are part of the stable API.

### Secrets detector pack (`secretsDetectors`)

Eight new detectors for the credential classes engineers most often leak into prompts:

```ts
import { Sether, basicDetectors, secretsDetectors } from '@raeven-co/sether';

const sether = new Sether({
  detectors: [...basicDetectors, ...secretsDetectors],
});
```

Detectors: `awsAccessKeyDetector`, `openaiKeyDetector`, `anthropicKeyDetector`, `githubPatDetector` (classic + fine-grained), `slackTokenDetector`, `stripeKeyDetector` (live/test/webhook), `jwtDetector`, `highEntropyDetector` (Shannon entropy ≥ 3.5 bits/char).

### SSE / JSON-stream mode

OpenAI / Anthropic streaming responses come back as Server-Sent Events. The SSE-aware stream redacts payloads inside `data:` lines while preserving the `data:` / `event:` / `id:` / `retry:` framing and blank-line separators verbatim.

```ts
import { createSSERedactStream, basicDetectors, MemoryVault } from '@raeven-co/sether';

const vault = new MemoryVault();
openaiResponse.body.pipe(createSSERedactStream({ detectors: basicDetectors, vault }));
```

### Drop-in middlewares

Four ways to wire Sether into an existing app without rewriting handlers:

```ts
// Generic fetch — pass your runtime's fetch explicitly. Sether does not
// reach for globalThis.fetch implicitly (keeps the supply-chain surface
// honest: the caller declares the network capability, not the library).
import { wrapFetch } from '@raeven-co/sether';
const safeFetch = wrapFetch({
  detectors: sether.detectors,
  vault: sether.vault,
  fetchImpl: fetch,        //  Node 18+, or your polyfill / undici / mock
});

// Express
import express from 'express';
import { createExpressMiddleware } from '@raeven-co/sether';
const app = express();
app.use(express.json());
app.use(createExpressMiddleware({ detectors: sether.detectors, vault: sether.vault }));

// OpenAI SDK — bring your own client (Sether never imports `openai`)
import OpenAI from 'openai';
import { wrapOpenAI } from '@raeven-co/sether';
const openai = wrapOpenAI(new OpenAI({ apiKey }), {
  detectors: sether.detectors,
  vault: sether.vault,
});

// Anthropic SDK — bring your own client (Sether never imports `@anthropic-ai/sdk`)
import Anthropic from '@anthropic-ai/sdk';
import { wrapAnthropic } from '@raeven-co/sether';
const anthropic = wrapAnthropic(new Anthropic({ apiKey }), {
  detectors: sether.detectors,
  vault: sether.vault,
});
```

The wrappers are **structurally typed** — Sether never imports `openai` or
`@anthropic-ai/sdk` (not at runtime, not as a type). You pass your own client
instance; any object matching the `chat.completions.create` /
`messages.create` shape works. They are **not** declared as dependencies or
peer dependencies, so Sether's install footprint stays a single package
(`libphonenumber-js`) and its supply-chain surface stays minimal.

### Audit-event schema

Every redaction can emit a structured `AuditEvent` that maps to the regulation it satisfies (GDPR Art. 28, SOC 2 CC6.7, HIPAA §164.312, PCI DSS, etc. — see `DEFAULT_REGULATION_MAPPINGS`). Ship-ready writers:

```ts
import { ConsoleAuditSink, MemoryAuditSink, DEFAULT_REGULATION_MAPPINGS } from '@raeven-co/sether';
```

`ConsoleAuditSink` writes JSONL to stderr. `MemoryAuditSink` accumulates events for tests and the browser sandbox. **The original value is never carried in an event — only its length.** Persistence (Postgres / D1 / SIEM export) lives in the hosted Pro tier; the schema is the same on both sides so promoting from local-only to hosted doesn't reshape events.

### `redactSync(text, { detectors, vault })`

Synchronous one-shot redaction for cases where you have the full text in hand (a JSON field, a log line, an SSE payload) and don't need chunk-boundary buffering. Use `createRedactStream` for input that may span chunk boundaries.

---

## What's coming (next / Pro hosted tier)

- **Free-text NER detectors** — unlabelled names, organisations, and locations in running prose. Ships as a separate `@raeven-co/sether-ner` package to keep the core install lean (avoids the ~30 MB native ONNX runtime). The 0.3.0 identity pack already covers these entities when they are *labelled*; NER extends them to free text.
- **Vault adapters as reference examples** — Redis and Postgres patterns documented in the repo, not bundled (the `Vault` interface already supports BYO).
- **Compliance reports** mapped to SOC 2 / GDPR / HIPAA controls — Pro hosted tier.
- **Audit log persistence + SIEM export** — Pro hosted tier.
- **Benchmarks vs Microsoft Presidio** — alongside the `sether-ner` release.

Track progress: <https://github.com/raeven-co/sether>

---

## Roadmap to 1.0.0

- [x] Chunk-boundary-safe streaming Transform
- [x] Property-based redact↔restore identity tests
- [x] `safe-regex2` enforcement in CI
- [x] Dual ESM + CJS build
- [x] Detector pack: email, phone, CC, SSN, IPv4, IPv6, IBAN
- [x] Detector pack: secrets (AWS, OpenAI, Anthropic, GitHub, Slack, Stripe, JWT)
- [x] JSON-stream mode for SSE / JSON LLM streams
- [x] Drop-in middlewares (Express, fetch, OpenAI SDK, Anthropic SDK)
- [x] Detector pack: identity (label-anchored name / DOB / passport / address)
- [ ] Detector pack: ONNX-based NER for free-text names / orgs / locations (`@raeven-co/sether-ner`)
- [ ] Pluggable vault adapters (Redis, Postgres)
- [ ] Benchmarks vs Microsoft Presidio (committed in repo)
- [ ] Migration guide from `redact-ai-stream` 1.x

---

## License

MIT © Godfrey Lebo / Raeven Company LTD

## Reporting security issues

Email `emorylebo@gmail.com`.
**Do not** file public GitHub issues for security findings. See
[SECURITY.md](./SECURITY.md) for the full policy.

## Links

- **Live sandbox:** <https://setherai.vercel.app/#sandbox>
- **GitHub:** <https://github.com/raeven-co/sether>
- **npm:** <https://www.npmjs.com/package/@raeven-co/sether>
- **Issues:** <https://github.com/raeven-co/sether/issues>
