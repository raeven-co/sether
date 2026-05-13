# Security Policy

## Reporting a vulnerability

If you've found a security vulnerability in Sether, **please do not file a
public GitHub issue**. Instead, report it privately to either:

- **Email:** `security@raeven.co`
- **Backup:** `godfrey@raeven.co`

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

- The Sether hosted SaaS gateway (report via the SaaS dashboard or `security@raeven.co`)
- The marketing site at <https://sether.raevenmarket.com.ng> and its mirror at <https://setherai.vercel.app/#sandbox>
- Issues in upstream dependencies that we don't directly own
- Issues that require physical access to a user's machine
- Theoretical vulnerabilities without a working proof-of-concept

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x (alpha) | ✓ Yes — we'll patch security issues during alpha |
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

## A note on PII handling

Sether's mission is privacy and PII protection. We hold ourselves to a
higher bar:

- Bug reports involving real PII should be redacted before submission
- We will never request live PII to reproduce an issue
- If you accidentally include real data in a report, we'll discard it
  and ask for a synthetic reproduction

Thanks for helping keep Sether's users safe.

— Godfrey Lebo · Raeven, Inc.
