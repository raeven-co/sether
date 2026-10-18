<p align="center">
  <img src="https://raw.githubusercontent.com/raeven-co/sether/main/assets/readme/sether-hero.webp" width="840" alt="Animated illustration: Sether spots an email address in a draft, masks it, swaps it for a realistic decoy, then restores the original when the reply comes back.">
</p>

# Sether

**Keep the context. Protect the details.**

Your AI can help write the email. It doesn't need your actual email address.

Sether is a small, deterministic engine for the boundary between your app and
any model. It finds personal data and secrets in text and swaps them for tokens
or realistic decoys before the text leaves your process. When the reply comes
back, it puts the originals back. It's streaming-safe and JSON-safe, the vault
stays on your side, and the library makes no network calls of its own.

```bash
npm install @raeven-co/sether
```

[Live sandbox](https://sether.raevenmarket.com.ng/sandbox) · [Docs](https://sether.raevenmarket.com.ng/docs) · [Python package](https://pypi.org/project/sether/) · [Changelog](./CHANGELOG.md) · MIT

> Named for the Hebrew *sether* (סֵתֶר), "the hiding place" (Psalm 32:7).
> The name is also the spec.

---

## Why this exists, and why now

**AI got useful by reading the real thing.** Support tickets, logs, CRM rows,
contracts. People paste the whole thing because they want a good answer. The
task needs help. The details hitch a ride.

- 77% of employees who use GenAI paste data into it, and 22% of those pastes
  contain personal or payment-card data
  ([LayerX report, via The Register, Oct 2025](https://www.theregister.com/software/2025/10/07/employees-regularly-paste-company-secrets-into-chatgpt/1274532)).
- Harmonic Security counted 579,113 sensitive-data exposures across 22.5 million
  enterprise AI prompts and uploads in 2025
  ([Harmonic, Jan 2026](https://www.harmonic.security/resources/what-22-million-enterprise-ai-prompts-reveal-about-shadow-ai-in-2025)).
- 92% of organisations that had an AI-related security incident lacked proper AI
  access controls
  ([IBM Cost of a Data Breach 2026](https://newsroom.ibm.com/2026-07-29-ibm-study-one-in-four-malicious-breaches-are-ai-enabled,-costing-companies-6-million-on-average)).

**Agents raised the stakes.** A chatbot reads your data. An agent acts on it: it
updates the CRM, sends the email, files the ticket. The tool needs the real
address back, so one-way masking breaks the workflow, and a workflow that breaks
tends to get switched off. Hiding the value is the easy half. Giving it back
safely is the hard half. We learned that one the honest way: 0.8.0 fixed our
own restore path, where a value restored into tool-call JSON as plain text could
add a `bcc` recipient.

**The rules already apply.**

- An LLM API provider typically acts as your processor, and
  [GDPR Article 28](https://gdpr-info.eu/art-28-gdpr/) expects processors that
  give sufficient guarantees, bound by a contract.
- OWASP lists
  [LLM02:2025 Sensitive Information Disclosure](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/)
  in its Top 10 for LLM applications.
- In Nigeria, the NDPC fined MultiChoice ₦766.2 million in July 2025, citing
  privacy breaches and unlawful cross-border transfers of personal data
  ([ICIR](https://www.icirnigeria.org/ndpc-fines-multichoice-nigeria-%E2%82%A6766-million-over-data-privacy-violations/)).

**Detection is becoming free, and that's good news.**

- [LangChain's PIIMiddleware](https://docs.langchain.com/oss/python/langchain/guardrails) can redact, mask, hash or block.
- [n8n's Guardrails node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.guardrails/) swaps PII for placeholders.
- OpenAI released an open-weight [Privacy Filter](https://huggingface.co/openai/privacy-filter) (Apache-2.0) in April 2026.
- [Presidio](https://github.com/data-privacy-stack/presidio), originally Microsoft's and now community-maintained, is a mature detector.

Sether focuses on the part around detection: deterministic, streaming-safe
replacement, a vault you own, and a restore that can't rewrite your JSON. If you
prefer another detector, plug it in through the `Detector` interface.

---

## How the engine works

<p align="center">
  <img src="https://raw.githubusercontent.com/raeven-co/sether/main/assets/readme/sether-round-trip.webp" width="840" alt="Animated diagram of the SDK round trip: your application's text goes through Sether, which swaps the email for a token or decoy and keeps the mapping in your vault; the model works with the placeholder; the reply comes back through Sether and the original email is restored.">
</p>

A stand-in goes out. The original comes back. Four steps, all in your process:

| Step | What happens | The detail that matters |
| --- | --- | --- |
| **1. Detect** | Detector packs scan the text: emails, phones, cards, SSNs, IPs, IBANs by default; secrets and labelled identity fields when you opt in. | Every detector is deterministic (pattern plus validator: Luhn, mod-97, libphonenumber, SSA rules). The same input gives the same output, and every regex is ReDoS-checked in CI. |
| **2. Replace** | Each match becomes a typed token such as `<EMAIL_9f1c…>`, or a realistic decoy from an `AliasVault`. | The original goes into **your** vault (in-memory LRU by default: 10,000 entries, 1-hour TTL). It never goes into the token or an audit event. |
| **3. Stream** | Redaction runs as a streaming transform, so token-by-token LLM traffic works. | The stream holds back a 256-byte tail (and long secrets up to 8 KB), so a value split across two chunks is still caught. Property-based tests split text at random boundaries and check the round trip. |
| **4. Restore** | Tokens or decoys in the reply are swapped back for the originals. | For JSON (tool calls, JSON mode), `restoreJson` restores value by value and never touches keys. `strict: true` refuses tokens the vault never issued. |

```text
your app ──► detect ──► replace ──► model sees <EMAIL_9f1c…>
   ▲                       │
   │                 your vault (originals)
   │                       │
   └──── restore ◄─────────┴──── reply mentions <EMAIL_9f1c…>
```

## What Sether is, and isn't

- **It is a boundary, not a model.** No ML runs on the hot path, so results are
  reproducible and testable. For free-text names, pair it with
  [`@raeven-co/sether-ner`](https://www.npmjs.com/package/@raeven-co/sether-ner)
  or your own NER.
- **It keeps your context.** The model still gets the task, the structure and a
  stand-in it can reason about. "Draft a welcome email to `<EMAIL_1>`" is still
  a perfectly good prompt.
- **It is inspectable.** MIT, about 60 KB per build, one runtime dependency
  (`libphonenumber-js`), and npm provenance on CI releases. Read it, fork it, audit it.
- **It is honest about misses.** Detection is pattern-based. It will miss
  things it has no pattern for, and dense numbers can trip the card check.
  Review both kinds of error on your own data. [Honest limitations](#honest-limitations) lists the known ones.
- **It isn't a compliance certificate.** It's a technical control you can point
  to, and a record of what it replaced. What you claim to a regulator is still
  your call.

### The Sether family

The same engine runs in five places:

| Where | What |
| --- | --- |
| Your TypeScript app | This package, `@raeven-co/sether` |
| Your Python app | [`sether` on PyPI](https://pypi.org/project/sether/): sync and async streaming, plus httpx, ASGI, WSGI, OpenAI and Anthropic integrations |
| Your browser | [Sether Shield for Chrome](https://chromewebstore.google.com/detail/keknopdmmjbljjjkmmpmkblldeapdjne): detection, masks and restore in AI chat boxes, all local. Decoys, watchlists and custom rules are in Pro. |
| Your editor | [Sether for VS Code](https://marketplace.visualstudio.com/items?itemName=GodfreyLebo.sether): scan, Copy Scrubbed, Paste with Originals Restored |
| Your agent's tool calls | [Gateway Guard](https://github.com/raeven-co/sether-gateway-guard) (beta, self-hosted): an OpenAI-compatible hop that refuses tool calls whose tokens weren't issued in that run |

The animation at the top shows Sether Shield. It's an illustration with fictional data.

---

## Try it without installing

The live sandbox runs the same detection engine in your browser — paste
any text, watch the PII tokens get swapped in real time:

- **Live sandbox:** <https://sether.raevenmarket.com.ng/sandbox>

The sandbox is a browser-only demonstration of `@raeven-co/sether`. For production, install the package below.

---

## Install

```bash
npm install @raeven-co/sether
```

Requires Node 18+. ESM and CommonJS both supported.

**Using Python?** The same engine ships as the [`sether`](https://pypi.org/project/sether/)
package on PyPI (`pip install sether`), with sync + async streaming and
httpx / ASGI / WSGI / OpenAI / Anthropic integrations. Docs:
<https://sether.raevenmarket.com.ng/docs/python>.

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

> **Security: never call `restore()` / `restoreSync()` on serialized JSON**
> (tool-call arguments, JSON-mode replies, JSON response bodies). Restore is
> plain text substitution: an original value containing `"` or `\` can add keys
> to the document or break it. Use `restoreJson` / `restoreJsonValue`, see
> [Never restore serialized JSON as text](#never-restore-serialized-json-as-text).

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

## Never restore serialized JSON as text

`restoreSync`, `createRestoreStream` and `sether.restore()` are **plain text
substitution**: each original value is inserted exactly as it was, unescaped.
If the text is serialized JSON, such as LLM tool-call arguments, a JSON-mode
reply or a JSON response body, an original containing `"` or `\` stops being
data inside a string and becomes part of the document:

```ts
// Tool-call arguments from the model reference a token…
const args = '{"to":"<EMAIL_…>","subject":"Hello <NAME_…>"}';
// …whose original is:  Alice", "bcc": "attacker@example.com
JSON.parse(restoreSync(args, { vault }));
// → { to: 'bob@example.com', subject: 'Hello Alice', bcc: 'attacker@example.com' }
```

Built-in detectors can capture a trailing backslash (`password: hunter2\`),
which breaks the document the same way; custom detectors and vaults filled from
other systems can carry any character. Restore JSON value by value instead:

```ts
import { restoreJson, restoreJsonValue } from '@raeven-co/sether';

// Serialized JSON in, serialized JSON out: each string value is restored and re-escaped.
const safeArgs = restoreJson(toolCall.function.arguments, { vault, strict: true });

// Already parsed, e.g. an Anthropic tool_use block's `input`.
const input = restoreJsonValue(block.input, { vault, strict: true });
```

- Object keys are never restored. Invalid JSON throws `SyntaxError`; there is
  no fallback to text replacement.
- One level at a time: a string value that itself holds serialized JSON is
  restored as plain text, so parse and restore it separately.
- `restoreJson` re-serializes compactly, and integers beyond
  `Number.MAX_SAFE_INTEGER` lose precision through `JSON.parse`. If that
  matters, parse with your own reviver and call `restoreJsonValue`.
- `strict: true` (also accepted by `restoreSync`) throws `UnresolvedTokenError`
  when anything token-shaped would be left in place: an invented or expired
  token, a case-altered copy such as `<email_…>`, or a token in a key. Its
  `tokens` property lists them; restored originals are never included. Without
  `strict`, those pass through silently.
- Strict mode is not authorization. A model can still put a real token in the
  wrong field (the customer's address in `bcc`), so validate tool arguments
  before acting on them.
- `TOKEN_RE` is exported if you need to scan for tokens yourself.

**Sether's own restore paths restore JSON value by value.** They change only
the string values that hold a token and re-encode just those, so every other
byte is kept (formatting, key order, escapes, and integers beyond
`Number.MAX_SAFE_INTEGER`). Object keys are never restored.

- `createSSERestoreStream`: a `data:` payload that parses as JSON (OpenAI and
  Anthropic chunks) is restored value by value, so an original containing `"`,
  `\` or a line break can't change the JSON or break the SSE framing. Other
  payloads (`[DONE]`, plain text) are restored as text, and a line break in an
  original continues it on a new `data: ` line (the client receives it as
  `\n`). Each `data:` line is handled on its own, so a JSON payload split
  across several `data:` lines is restored as text.
- `wrapFetch`: an `event-stream` body is restored per `data:` payload as above.
  A body that parses as JSON is restored value by value, a JSON-typed body that
  doesn't (NDJSON, JSON Lines) line by line, and any other text body as text.
- `createExpressMiddleware`: a string passed to `res.send()` that parses as JSON
  is restored value by value, including the string Express's own `res.json()`
  hands to `res.send()`. Other strings are restored as text. Objects passed to
  `res.json()` / `res.send()` were already restored value by value.
- `wrapOpenAI` / `wrapAnthropic`: when the request asks for JSON output
  (`response_format` `json_object` / `json_schema`, or Anthropic
  `output_config.format` / `output_format` with `json_schema`), the reply's
  content is restored value by value, and left tokenized if it isn't valid
  JSON. Tool-call arguments stay tokenized by default. Set
  `restoreToolArguments: true` to restore non-streaming
  `tool_calls[].function.arguments` and `tool_use.input` value by value, and
  validate them before acting on them.

What is still restored as text:

- **JSON-mode output streamed over SSE.** `createSSERestoreStream` (and
  `wrapFetch` on an event-stream body) keeps each chunk valid, but the
  `delta.content` fragments join into a second JSON document the stream can't
  see, so an original lands in that document unescaped. Don't SSE-restore
  JSON-mode streams: collect the tokenized fragments and call `restoreJson` on
  the assembled text.
- `restoreSync`, `createRestoreStream` and `sether.restore()`, by design.
- `AliasVault.restore()` swaps decoys back by plain substitution too. On JSON,
  apply it to each parsed string value, never to the serialized document.

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
| `phoneDetector` (`PHONE`) | [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js) | Matches numbers written with a country code (`+1 415 555 2671`). For NATIONAL-format numbers (`(415) 555-2671`, `0803 123 4567`) use `createPhoneDetector({ defaultCountry: 'US' })` — see below. |
| `creditCardDetector` (`CC`) | Bounded regex + Luhn check | 13–19 digit numbers passing Luhn. ReDoS-safe. |
| `ssnDetector` (`SSN`) | Regex + SSA invalid-prefix blacklist | Rejects area `000`, `666`, and `9XX` (ITIN range), group `00`, serial `0000`. |
| `ipv4Detector` (`IPV4`) | Strict octet-bounded regex | `0–255` per octet, no leading zeros. |
| `ipv6Detector` (`IPV6`) | Candidate regex + in-tree `isIPv6` validator (equivalent to Node's `net.isIPv6`, no `node:net` import) | **Known limit:** `::1` and IPv4-in-IPv6 (`::ffff:192.0.2.1`) not matched. |
| `ibanDetector` (`IBAN`) | Regex + mod-97 checksum | Validates against ISO 13616. |

#### National-format phone numbers (`createPhoneDetector`)

Without a country hint, libphonenumber can only recognise numbers that carry
an explicit country code — so `+1 415 555 2671` is redacted but `(415) 555-2671`
is not. If your traffic contains national-format numbers for a known region,
swap the default PHONE detector for one built with `createPhoneDetector`
(new in 0.5.7):

```ts
import { Sether, basicDetectors, createPhoneDetector } from '@raeven-co/sether';

const sether = new Sether({
  detectors: [
    ...basicDetectors.filter((d) => d.type !== 'PHONE'),
    createPhoneDetector({ defaultCountry: 'US' }), // or 'NG', 'GB', …
  ],
});
```

`createPhoneDetector()` with no options is exactly the default `phoneDetector`,
so nothing changes unless you opt in.

When your traffic mixes regions (a browser extension, a global chat product),
use `createMultiRegionPhoneDetector` (new in 0.7.0) — one PHONE detector that
runs a libphonenumber pass per region and de-duplicates by span:

```ts
import { createMultiRegionPhoneDetector } from '@raeven-co/sether';

createMultiRegionPhoneDetector(['US', 'GB', 'NG']);
// recognises "(415) 555-2671", "07911 123456", AND "0801 234 5678" in one text
```

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
*structured* PII (forms, KYC, RAG documents, support tickets). For
unlabelled names, organisations and locations in free text, there's the
separate, early [`@raeven-co/sether-ner`](https://www.npmjs.com/package/@raeven-co/sether-ner)
package. It uses a lazy-loaded ONNX model, so the core install stays small.

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
an in-memory LRU vault (10 000 entries, 1-hour TTL by default). You can
implement the `Vault` interface yourself to change eviction, encrypt values
at rest, or namespace tokens per tenant.

```ts
import { Sether, type Vault } from '@raeven-co/sether';

// A custom vault implements the synchronous Vault interface. This one wraps a
// Map and namespaces every token so several tenants can share one store.
class NamespacedVault implements Vault {
  readonly #store = new Map<string, string>();
  readonly #prefix: string;
  constructor(prefix: string) {
    this.#prefix = prefix;
  }
  set(token: string, value: string): void {
    this.#store.set(this.#prefix + token, value);
  }
  get(token: string): string | undefined {
    return this.#store.get(this.#prefix + token);
  }
  has(token: string): boolean {
    return this.#store.has(this.#prefix + token);
  }
  delete(token: string): boolean {
    return this.#store.delete(this.#prefix + token);
  }
  size(): number {
    return this.#store.size;
  }
  clear(): void {
    this.#store.clear();
  }
}

const sether = new Sether({ vault: new NamespacedVault('tenant-42:') });
```

**The `Vault` interface is synchronous.** `restore()` runs inside a Node
streaming `Transform` that substitutes tokens as the bytes flow through, so it
cannot `await` a lookup per token. A store reached over async I/O (Redis,
Postgres) therefore can't be dropped straight into `restore()` — front it with
a synchronous in-process cache that you hydrate before the restore pass, or
keep the vault in-process. A first-class async vault adapter is on the roadmap
(see *What's coming*).

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

**Values longer than `safeDistanceBytes`.** The held-back tail only guarantees
a boundary-crossing match is caught when the whole value fits inside it. A value
longer than `safeDistanceBytes` (256) has not fully arrived when the prefix is
emitted, so no detector matches it yet. As of 0.5.5 the redact stream also holds
back an in-progress *whitespace-free* run — every long secret (a JWT, an API
key) is whitespace-free — up to a bound of `max(safeDistanceBytes × 4, 8192)`
bytes, so such a value is no longer emitted partially across a chunk boundary.
For values larger than that bound, raise `safeDistanceBytes` (the bound scales
with it) or redact complete payloads with `redactSync`:

```ts
const sether = new Sether({ safeDistanceBytes: 4096 }); // e.g. for large JWTs
```

---

## What's verified in this release

- **Streaming-safe:** chunk-boundary round-trip proven by property-based tests
- **ReDoS-safe:** all regex literals scanned by `safe-regex2` in CI (224 patterns, 0 unsafe)
- **TypeScript strict mode:** no `any`, no implicit types
- **Dual build:** ESM + CJS, ≈ 61 KB each
- **CI matrix:** Node 20 / 22 / 24 — lint, typecheck, format, regex-safety, 252 tests, build (the package still runs on Node 18; the test tooling needs 20+)
- **MIT licensed** — fork it, audit it, no vendor lock-in

---

## Honest limitations

Known limitations in this release:

- **Email detection is ASCII-only.** IDN/Unicode local parts won't match. Unicode-aware email is on the roadmap.
- **Phone numbers without a country code are not detected by default.** `+1 415 555 2671` is caught; `(415) 555-2671` alone is not — libphonenumber needs a region to parse national formats. Opt in with `createPhoneDetector({ defaultCountry: 'US' })` (see [Built-in detectors](#built-in-detectors-basic-pack)).
- **IPv6 `::1` (loopback) is not detected.** Candidate regex requires 4+ chars. Loopback isn't customer PII, but flag it in your audit logs if it matters for your threat model.
- **Credit-card regex is permissive.** Anything 13–23 chars of digits/spaces/dashes is a candidate, then validated by Luhn. False positives in dense numeric content are possible.
- **Names / DOB / passport / address are label-anchored, not free-text NER.** The opt-in identity pack (0.3.0) catches these when they appear with a label or distinctive structure. Unlabelled names / organisations / locations in running prose need the ONNX NER model shipping separately as `@raeven-co/sether-ner`.
- **Very large whitespace-free values split across chunk boundaries.** The streaming redactor holds an in-progress value back up to `max(safeDistanceBytes × 4, 8192)` bytes; a single value larger than that bound, split across two chunks, can still be emitted partially. Raise `safeDistanceBytes` or use `redactSync` on complete payloads. See [Streaming safety](#streaming-safety).
- **Restore is text substitution.** `restoreSync` and the restore streams insert originals unescaped. The SSE, fetch, Express and SDK-wrapper paths restore JSON value by value, except JSON-mode output streamed over SSE. Use `restoreJson` for your own JSON; see [Never restore serialized JSON as text](#never-restore-serialized-json-as-text).
- **No production benchmarks yet.** Throughput numbers (vs Microsoft Presidio) will land alongside the NER package.

---

## What's new in 0.8

0.8.0 was a security release. Restoring tokens into **serialized JSON** as text
let an original like `Alice", "bcc": "attacker@example.com` add a key to a tool
call. It's a terrible name and an excellent test case. 0.8 adds:

- `restoreJson` / `restoreJsonValue`, which restore value by value and never restore keys
- `strict: true`, which refuses invented, expired, case-altered or foreign tokens
- JSON-aware restore inside Sether's own SSE, fetch, Express and SDK-wrapper paths
- a fix for the Express middleware keeping a client-sent `"__proto__"` key as the prototype

0.8.1 changes documentation only. Full notes are in the [CHANGELOG](./CHANGELOG.md).

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

Detectors: `awsAccessKeyDetector`, `openaiKeyDetector`, `anthropicKeyDetector`, `githubPatDetector` (classic + fine-grained), `slackTokenDetector`, `stripeKeyDetector` (live/test/webhook), `jwtDetector`, `highEntropyDetector` (Shannon entropy ≥ 3.5 bits/char), and — new in 0.7.0 — `labeledApiKeyDetector` ("my api key is AbC123…", below the entropy floor, no vendor prefix needed) and `labeledPasswordDetector` ("password: hunter2butlonger", with a denylist so "password is required" stays clean).

### Alias engine (new in 0.7.0) — redact by misleading, restore later

Masking hides a value; **aliasing** swaps it for a realistic decoy the LLM
reads naturally, then reverses it on the way back:

```ts
import { AliasVault, suggestAliases } from '@raeven-co/sether'; // also on /browser

suggestAliases('NAME', 'Godfrey Lebo');
// -> ['John Doe', 'Aisha Tanaka', 'Diego Martin']  (distinct, never the original)

const vault = new AliasVault();
const decoyed = vault.apply('My name is Godfrey Lebo (godfrey@real.com)');
// stable per-original: every "Godfrey Lebo" becomes the SAME decoy
const restored = vault.restore(aiReplyEchoingTheDecoy); // real values back

vault.aliasFor('EMAIL', 'godfrey@real.com'); // stable generated decoy
vault.set('Godfrey Lebo', 'John Doe', 'NAME'); // or pick your own
```

Decoys come from officially-reserved fictional ranges wherever one exists, so
they can never collide with a real person's data: US phones `NNN-555-01XX`,
UK `07700 900XXX` (Ofcom), IPv4 in RFC 5737 TEST-NET, IPv6 `2001:db8::/32`,
SSNs in the SSA advertising range, RFC 2606 email domains, Luhn-valid
test-BIN cards. Types with no reserved range (vendor API keys, national IDs,
custom detectors) fall back to shape-preserving randomisation with known
vendor prefixes (`sk-proj-`, `AKIA`, `ghp_`, …) kept intact so the decoy stays
detector-visible. Aliases are unique within a vault by construction, which is
what makes `restore()` an unambiguous string substitution. Randomness is
injectable (`{ rng }`) for deterministic tests.

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

`ConsoleAuditSink` writes JSONL to stderr. `MemoryAuditSink` accumulates events for tests and the browser sandbox. **The original value is never carried in an event — only its length.** Persistence and SIEM export are planned for the hosted gateway (early access, separate from the library). It will use the same event schema, so moving from local-only to hosted won't reshape your events.

### `redactSync(text, { detectors, vault })` / `restoreSync(text, { vault })`

Synchronous one-shot redaction and restoration for cases where you have the full text in hand (a log line, a decoded JSON string value) and don't need chunk-boundary buffering. `restoreSync` is the mirror of `redactSync`: it swaps `<TYPE_…>` tokens back to their originals via the vault, leaving any token with no vault entry untouched (pass `strict: true` to throw `UnresolvedTokenError` instead). For serialized JSON use `restoreJson` — see [Never restore serialized JSON as text](#never-restore-serialized-json-as-text).

```ts
import { redactSync, restoreSync, basicDetectors, MemoryVault } from '@raeven-co/sether';

const vault = new MemoryVault();
const safe = redactSync('email alice@example.com', { detectors: basicDetectors, vault });
// → 'email <EMAIL_…>'
const back = restoreSync(safe, { vault });
// → 'email alice@example.com'
```

Use `createRedactStream` / `createRestoreStream` for input that may span chunk boundaries.

---

## What's coming

- **Free-text NER, maturing.** [`@raeven-co/sether-ner`](https://www.npmjs.com/package/@raeven-co/sether-ner) is out as an early release, kept separate so the core install never carries an ONNX runtime. The identity pack already covers names, DOB, passports and addresses when they're *labelled*; NER extends that to free text.
- **Vault adapters as reference examples.** Redis and Postgres patterns documented in the repo, not bundled. The `Vault` interface already supports bring-your-own.
- **Compliance reports** mapped to SOC 2 / GDPR / HIPAA controls. Planned for the hosted gateway.
- **Audit-log persistence and SIEM export.** Planned for the hosted gateway, which is in early access.
- **Benchmarks against Microsoft Presidio**, alongside a stable `sether-ner`.

The library stays MIT and complete. None of these will take a feature away from it.

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
- [ ] Detector pack: ONNX-based NER for free-text names / orgs / locations (`@raeven-co/sether-ner`, early release out)
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

- **Live sandbox:** <https://sether.raevenmarket.com.ng/sandbox>
- **Docs:** <https://sether.raevenmarket.com.ng/docs>
- **GitHub:** <https://github.com/raeven-co/sether>
- **npm:** <https://www.npmjs.com/package/@raeven-co/sether>
- **PyPI (Python port):** <https://pypi.org/project/sether/> · [docs](https://sether.raevenmarket.com.ng/docs/python)
- **Sether Shield (Chrome):** <https://chromewebstore.google.com/detail/keknopdmmjbljjjkmmpmkblldeapdjne>
- **Sether for VS Code:** <https://marketplace.visualstudio.com/items?itemName=GodfreyLebo.sether>
- **Gateway Guard (beta, self-host):** <https://github.com/raeven-co/sether-gateway-guard>
- **Issues:** <https://github.com/raeven-co/sether/issues>
