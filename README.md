# Sether

> **Hide personal data from your AI before it reaches any LLM provider.**
>
> Named for the Hebrew *sether* (סֵתֶר) — *the hiding place*. Psalm 32:7.

Sether is a streaming PII-redaction layer that sits between your application
and any LLM API. It detects sensitive data (email, phone, SSN, credit-card,
IBAN, IP addresses), swaps each match for a stable token before the request
leaves your boundary, then restores the original values transparently in
the response.

```text
   ┌──────────┐    ① raw text + PII    ┌─────────┐    ② tokenised text    ┌─────────┐
   │ Your app │ ─────────────────────▶ │ Sether  │ ─────────────────────▶ │   LLM   │
   │          │ ◀───────────────────── │ (local) │ ◀───────────────────── │ (OpenAI │
   └──────────┘    ④ restored text     └─────────┘    ③ tokenised reply   │  etc.)  │
                                                                          └─────────┘
                                       Token vault stays in YOUR infra.
```

Three lines of TypeScript to wire it up. Works with **OpenAI, Anthropic,
Cohere, Mistral, Google Gemini, AWS Bedrock, Azure OpenAI, Together,
Groq, Ollama**, your own fine-tunes — anything that speaks HTTP and
streams text. Sether doesn't care who's on the other end; it operates on
the text stream.

**Status:** `0.1.0-alpha.2` — pre-release. API may change before 1.0.
A product of **[Raeven, Inc.](https://raeven.co)**

---

## Why this exists

If your application sends a customer's email, phone number, or any other
PII to an LLM provider, that's a sub-processor disclosure under
[GDPR Article 28](https://gdpr-info.eu/art-28-gdpr/). Credit-card data
pulls you into PCI DSS scope. Health identifiers trigger HIPAA. The first
GDPR enforcement actions tied to AI flows landed in 2025, and the EU AI
Act phases in through 2026–2027.

Sether stops the leak at the boundary, logs every redaction event against
the specific regulation it satisfies, and restores tokens transparently
so your application code doesn't change.

---

## Try it without installing

The live sandbox runs the same detection engine in your browser — paste
any text, watch the PII tokens get swapped in real time:

- **Marketing site + live sandbox:** <https://sether.raevenmarket.com.ng>
- **Mirror (Vercel):** <https://setherai.vercel.app>

The sandbox is a browser-only subset of `@raeven-co/sether` for
demonstration. For production, install the package below.

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

### Built-in detectors (0.1.0-alpha)

| Detector | Method | Notes |
| --- | --- | --- |
| `emailDetector` (`EMAIL`) | Regex (`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`) | RFC 5321-style local part. ASCII-only — IDN/Unicode addresses are not matched. |
| `phoneDetector` (`PHONE`) | [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js) | International phone parsing. |
| `creditCardDetector` (`CC`) | Bounded regex + Luhn check | 13–19 digit numbers passing Luhn. ReDoS-safe. |
| `ssnDetector` (`SSN`) | Regex + SSA invalid-prefix blacklist | Rejects area `000`, `666`, and `9XX` (ITIN range), group `00`, serial `0000`. |
| `ipv4Detector` (`IPV4`) | Strict octet-bounded regex | `0–255` per octet, no leading zeros. |
| `ipv6Detector` (`IPV6`) | Candidate regex + Node's native `isIPv6` validator | **Known limit:** `::1` and IPv4-in-IPv6 (`::ffff:192.0.2.1`) not matched. |
| `ibanDetector` (`IBAN`) | Regex + mod-97 checksum | Validates against ISO 13616. |

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

The vault stays in **your** infrastructure. Sether's gateway (when used)
never persists the original PII.

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
- **ReDoS-safe:** all 21 regex literals scanned by `safe-regex2` in CI
- **TypeScript strict mode:** no `any`, no implicit types
- **Dual build:** ESM + CJS, ≈ 10 KB each
- **CI matrix:** Node 18 / 20 / 22 — lint, typecheck, format, regex-safety, 47 tests, build
- **MIT licensed** — fork it, audit it, no vendor lock-in

---

## Honest limitations

This is alpha software. Read before deploying:

- **Email detection is ASCII-only.** IDN/Unicode local parts won't match. Fix lands in 0.2.
- **IPv6 `::1` (loopback) is not detected.** Candidate regex requires 4+ chars. Loopback isn't customer PII, but flag it in your audit logs if it matters for your threat model.
- **Credit-card regex is permissive.** Anything 13–23 chars of digits/spaces/dashes is a candidate, then validated by Luhn. False positives in dense numeric content are possible.
- **No NER yet.** Names, organisations, addresses ship in 0.2 (lazy-loaded ONNX model).
- **No production benchmarks yet.** Throughput numbers (vs Microsoft Presidio) will be committed in 0.2.

---

## What's coming (0.2 / Pro tier)

- Secrets detector pack — AWS / OpenAI / Anthropic / GitHub / Slack / Stripe keys, JWTs, high-entropy strings
- NER detectors — names, organisations, addresses
- Drop-in middlewares — Express, fetch wrapper, OpenAI/Anthropic SDK wrappers
- JSON-stream mode — SSE-aware tokenisation for LLM streaming responses
- Pluggable vault backends — Redis, Postgres adapters
- Compliance reports mapped to SOC 2 / GDPR / HIPAA controls (Pro hosted tier)
- Audit log persistence + SIEM export (Pro hosted tier)

Track progress: <https://github.com/raeven-co/sether>

---

## Roadmap to 1.0.0

- [x] Chunk-boundary-safe streaming Transform
- [x] Property-based redact↔restore identity tests
- [x] `safe-regex2` enforcement in CI
- [x] Dual ESM + CJS build
- [x] Detector pack: email, phone, CC, SSN, IPv4, IPv6, IBAN
- [ ] Detector pack: secrets (AWS, OpenAI, Anthropic, GitHub, Slack, Stripe, JWT)
- [ ] Detector pack: ONNX-based NER for names / orgs
- [ ] JSON-stream mode for SSE / JSON LLM streams
- [ ] Drop-in middlewares (Express, fetch, OpenAI SDK, Anthropic SDK)
- [ ] Pluggable vault adapters (Redis, Postgres)
- [ ] Benchmarks vs Microsoft Presidio (committed in repo)
- [ ] Migration guide from `redact-ai-stream` 1.x

---

## License

MIT © Godfrey Lebo / Raeven, Inc.

## Reporting security issues

Email `security@raeven.co` (or `godfrey@raeven.co` as a backup).
**Do not** file public GitHub issues for security findings. See
[SECURITY.md](./SECURITY.md) for the full policy.

## Links

- **Live sandbox:** <https://sether.raevenmarket.com.ng>
- **Mirror:** <https://setherai.vercel.app>
- **GitHub:** <https://github.com/raeven-co/sether>
- **npm:** <https://www.npmjs.com/package/@raeven-co/sether>
- **Issues:** <https://github.com/raeven-co/sether/issues>
