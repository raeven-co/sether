# Security Policy

## Reporting a vulnerability

If you've found a security vulnerability in Sether, **please do not file a
public GitHub issue**. Instead, report it privately to either:

- **Email:** `emorylebo@gmail.com`

GitHub's private security advisories are also acceptable: navigate to the
**Security** tab of this repository and select *"Report a vulnerability."*

### What to include

- A description of the vulnerability
- Steps to reproduce, or a proof-of-concept if you have one
- The affected version(s) of `@raeven-co/sether`
- Any suggested mitigation if you have one
- Your name / handle if you'd like to be credited (optional)

### What we commit to

- **Acknowledgement within 48 hours** of receiving the report
- **Initial triage within 5 business days** with a severity assessment
- **Coordinated disclosure** — we'll work with you on a public-disclosure
  timeline (typically 30-90 days from initial report)
- **Public credit** in the security advisory if you want it

We do not currently run a paid bug-bounty program, but we will publicly
credit valid reporters in our changelog and security advisories.

## What's in scope

- The `@raeven-co/sether` npm package and its dependencies
- The detection regex patterns and validation logic
- The streaming Transform implementation
- The token vault interface and `MemoryVault` reference implementation

## What's out of scope (handled separately)

- The Sether hosted SaaS gateway (report via the SaaS dashboard or `emorylebo@gmail.com`)
- The marketing site at <https://sether.raevenmarket.com.ng> and its mirror at <https://setherai.vercel.app/#sandbox>
- Issues in upstream dependencies that we don't directly own
- Issues that require physical access to a user's machine
- Theoretical vulnerabilities without a working proof-of-concept

## Supported versions

| Version | Supported |
|---|---|
| 0.x (current pre-1.0 line) | ✓ Yes — we patch security issues on the latest 0.x release |
| < 0.1.0 (legacy `redact-ai-stream`) | ✗ No — please upgrade to `@raeven-co/sether` |

Once `1.0.0` ships, we'll commit to supporting the current major version
and one previous major.

## Hardening commitments we follow

The Sether OSS repository follows these practices:

- **Branch protection** on `main` (required PR review, no force push)
- **Org-level 2FA enforcement** on `github.com/raeven-co`
- **`safe-regex2` ReDoS scanner** runs in CI on every commit
- **`npm audit`** run on every CI build
- **Signed npm releases** via GitHub Actions OIDC (provenance attestation)
- **No long-lived secrets** in CI; OIDC token exchange only

## Supply-chain posture

Sether is a privacy tool, so its own supply chain is part of the product. Two
facts make the published package easy to audit:

**1. The published tarball ships only built artifacts and docs.** Per
`package.json` `files`, `npm install @raeven-co/sether` delivers exactly the
`dist/` bundles (ESM + CJS + type declarations), `README.md`, `LICENSE`, and
`CHANGELOG.md`. No source, no tests, no config, no `node_modules`.

**2. There is exactly one runtime dependency.**

```bash
$ npm ls --omit=dev --all
@raeven-co/sether@x.y.z
└── libphonenumber-js@1.x
```

`npm audit --omit=dev` reports `0 vulnerabilities`.

### Dev-tooling advisories do not reach consumers

Supply-chain scanners (Socket.dev, `npm audit`) read the full
`package-lock.json`, which includes the **development** dependency tree
(ESLint, typescript-eslint, tsup, vitest, …). Alerts on those packages — for
example an "obfuscated code" heuristic on `@typescript-eslint/eslint-plugin`,
or a "low adoption" note on a transitive `@humanfs/types` pulled in by ESLint —
concern the build/test toolchain only. They are **not** installed by anyone who
depends on `@raeven-co/sether`: dev dependencies are never fetched by
`npm install <pkg>`, and they are not part of the published `dist/`. We triage
such findings as dev-only rather than disabling the scanner's rules globally —
suppressing, say, the obfuscated-code rule would also blind it to the one
dependency that *does* ship. Anyone can confirm the consumer-facing surface with
the two commands above.

### Bundle-level guarantees

- **ASCII-only bundles.** The shipped `dist/*.js` / `*.cjs` contain no raw
  non-ASCII or bidirectional Unicode (Trojan Source, CVE-2021-42574); enforced
  by `scripts/check-ascii-dist.mjs` on every build.
- **No network capability in `dist/`.** The bundles reference no `fetch`,
  `XMLHttpRequest`, `WebSocket`, or `node:` network module — `wrapFetch` takes
  the caller's `fetch` explicitly; Sether never reaches for a global.
- **ReDoS-scanned.** Every regex literal in `src/` is checked by `safe-regex2`
  in CI.

## A note on PII handling

Sether's mission is privacy and PII protection. We hold ourselves to a
higher bar:

- Bug reports involving real PII should be redacted before submission
- We will never request live PII to reproduce an issue
- If you accidentally include real data in a report, we'll discard it
  and ask for a synthetic reproduction

Thanks for helping keep Sether's users safe.

— Godfrey Lebo · Raeven Company LTD
