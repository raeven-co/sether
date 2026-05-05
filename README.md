# Sether

> **Hides personal data from your AI before it ships to OpenAI / Anthropic.**
>
> Named for the Hebrew *sether* (סֵתֶר) — the hiding place. Psalm 32:7.

A streaming redaction layer between your app and any LLM provider. Detects
sensitive data, replaces it with stable tokens before requests leave your
boundary, restores tokens transparently in the response. Three lines of
TypeScript.

**Status: `0.1.0-alpha`** — pre-release. API may change before 1.0.

A product of [Raeven, Inc.](https://raeven.co).

## What it solves

If your app sends a customer email to OpenAI, that's a [GDPR Article 28](https://gdpr-info.eu/art-28-gdpr/)
sub-processor exposure. Credit cards trigger PCI DSS scope. Health-related
identifiers trigger HIPAA. The first GDPR enforcement actions tied to AI
flows started landing in 2025; the EU AI Act phases in through 2026-2027.

Sether intercepts these before they leave your infrastructure, logs every
redaction event with the specific regulation it satisfies, and restores
tokens transparently in the response.

## What's in alpha (today)

### Detectors shipping in 0.1.0-alpha

| Detector | Method | Notes |
|---|---|---|
| `EMAIL` | Regex (`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`) | RFC 5321-style local part. ASCII-only — does not match IDN/Unicode emails. |
| `PHONE` | [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js) | International phone parsing. |
| `CC` | Bounded regex + Luhn check | 13-19 digit numbers passing Luhn. ReDoS-safe. |
| `SSN` | Regex + SSA invalid-prefix blacklist | Rejects area `000`, `666`, and `9XX` (ITIN range). Rejects group `00`. Rejects serial `0000`. |
| `IPV4` | Strict octet-bounded regex | 0-255 per octet. No leading zeros. |
| `IPV6` | Candidate regex + structural validator | **Known limitation:** does not match `::1` (length below candidate-min). Does not match IPv4-in-IPv6 mixed form (`::ffff:192.0.2.1`). |
| `IBAN` | Regex + mod-97 checksum | Validates against ISO 13616. |

### What's NOT in 0.1.0-alpha (coming in 0.2 / Pro tier)

- **Secrets pack** — AWS / OpenAI / Anthropic / GitHub / Slack / Stripe keys, JWTs, generic high-entropy strings
- **NER detectors** — names, organizations, addresses (lazy-loaded ONNX model)
- **Drop-in middlewares** — Express, fetch wrapper, OpenAI/Anthropic SDK wrappers
- **JSON-stream mode** — SSE-aware tokenization for LLM streaming responses
- **Pluggable vault backends** — Redis, Postgres beyond the in-memory LRU
- **Compliance reports** mapped to specific SOC 2 / GDPR / HIPAA controls (Pro hosted tier)
- **Audit log persistence + export** to SIEM (Pro hosted tier)

### Verified properties

- **Streaming-safe:** chunk-boundary fix verified by property-based tests (redact↔restore identity over arbitrary chunk partitions, 50+ random runs per CI)
- **ReDoS-safe:** every regex literal scanned by `safe-regex2` in CI; 22 patterns checked, 0 unsafe
- **TypeScript strict mode:** no `any`, no implicit types
- **Dual build:** ESM + CJS, ~10KB each
- **CI:** Node 18 / 20 / 22 matrix; lint, typecheck, format, regex-safety, test, build

## Install

```bash
npm install @raeven-co/sether
```

## Quick start (stream API)

```ts
import { Sether } from '@raeven-co/sether';
import { Readable } from 'node:stream';

const sether = new Sether();

// Outgoing — your request to the LLM
const userInput = Readable.from(['my email is alice@example.com']);
const safeForLLM = userInput.pipe(sether.redact());
// → "my email is <EMAIL_xxxx-xxxx>"

// Incoming — restore tokens in the LLM's response
const llmResponse = Readable.from(['Confirmation sent to <EMAIL_xxxx-xxxx>']);
const safeForUser = llmResponse.pipe(sether.restore());
// → "Confirmation sent to alice@example.com"
```

## Choose specific detectors

```ts
import { Sether, emailDetector, ssnDetector } from '@raeven-co/sether';

// Only redact email + SSN; leave other PII alone
const sether = new Sether({
  detectors: [emailDetector, ssnDetector],
});
```

## Custom vault (persistence beyond in-memory)

```ts
import { Sether, type Vault } from '@raeven-co/sether';

class RedisVault implements Vault {
  // implement set / get / has / delete / size / clear backed by Redis
}

const sether = new Sether({ vault: new RedisVault(redisClient) });
```

## Honest limitations

This is alpha software. Known gaps documented above. Specific items you
should know before deploying:

- **Email detection is ASCII-only.** Internationalized email addresses
  (with non-Latin local parts) won't match. Will be addressed in 0.2.
- **IPv6 `::1` (loopback) is not detected.** Candidate regex requires 4+
  characters. Acceptable for redaction (loopback is not customer PII)
  but flag in audit logs if it matters.
- **Credit card regex is permissive.** It matches anything 13-23
  characters long with digits/spaces/dashes, then validates Luhn. False
  positives in dense numeric content are possible (mitigated by Luhn but
  not eliminated).
- **No NER yet.** If you need name / organization / address detection,
  wait for 0.2 or use a separate NER pipeline upstream.
- **No production benchmarks committed yet.** Throughput claims will
  follow benchmarks-vs-Microsoft-Presidio in 0.2.

## Roadmap to 1.0.0

- [x] Chunk-boundary safe streaming Transform
- [x] Property-based tests proving redact↔restore identity
- [x] safe-regex2 enforcement in CI
- [x] Dual ESM + CJS build
- [x] Detector pack: email, phone, CC, SSN, IPv4, IPv6, IBAN
- [ ] Detector pack: secrets (AWS, OpenAI, Anthropic, GitHub, Slack, Stripe, JWT)
- [ ] Detector pack: ONNX-based NER for names / orgs
- [ ] JSON-stream mode for SSE/JSON LLM streams
- [ ] Drop-in middlewares (Express, fetch, OpenAI SDK, Anthropic SDK)
- [ ] Pluggable vault backends (Redis, Postgres adapters)
- [ ] Benchmarks vs Microsoft Presidio (committed in repo)
- [ ] Migration guide from `redact-ai-stream` 1.x

## License

MIT © Godfrey Lebo / Raeven, Inc.

## Reporting security issues

Email `security@raeven.co` (or `godfrey@raeven.co` until DNS propagates).
Do not file public GitHub issues for security findings.
