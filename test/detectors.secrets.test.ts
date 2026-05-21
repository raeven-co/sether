import { describe, it, expect } from 'vitest';
import {
  awsAccessKeyDetector,
  openaiKeyDetector,
  anthropicKeyDetector,
  githubPatDetector,
  slackTokenDetector,
  stripeKeyDetector,
  jwtDetector,
  highEntropyDetector,
  secretsDetectors,
} from '../src/detectors/secrets.js';

// ─────────────────────────────────────────────────────────────────────────────
//  IMPORTANT — test-fixture construction discipline
//
//  This file tests a SECRET DETECTOR package. The detectors are designed to
//  match real Slack / OpenAI / GitHub / Stripe / etc. token patterns. If a
//  test fixture in this file is a literal string that pattern-matches a real
//  token, GitHub's push protection (and every other downstream secret
//  scanner) will flag the test fixture as a leaked credential and block the
//  push.
//
//  Rule: NEVER write a complete token-shaped string as a single literal in
//  this file. Always construct token-shaped fixtures from parts at runtime —
//  prefix + body + suffix concatenated, or template literals with computed
//  segments. The runtime value still matches our detector regex; the source
//  code never contains a string a scanner can pattern-match.
//
//  The single exception below is `AKIAIOSFODNN7EXAMPLE` — AWS's officially
//  documented test value, which GitHub's scanner is allowlisted for.
// ─────────────────────────────────────────────────────────────────────────────

// Helpers — build token-shaped strings without ever writing a complete
// real-looking literal in source.
const A = (n: number) => 'A'.repeat(n);
const a = (n: number) => 'a'.repeat(n);
const D = (n: number) => '1'.repeat(n);

// Slack token segments built piecewise. Each fragment alone matches nothing.
function slackBotToken(): string {
  return 'xox' + 'b' + '-' + D(10) + '-' + D(13) + '-' + (A(12) + a(12));
}
function slackNoKindLetter(): string {
  // Deliberately missing the kind letter — should NOT match the detector.
  return 'xox' + '-' + D(10) + '-' + D(13) + '-' + A(24);
}

// OpenAI keys — build with prefix concatenation so the literal never appears.
function openaiLegacyKey(): string {
  // sk- + 35 chars of mixed base64url-ish payload
  return 'sk' + '-' + (A(10) + a(10) + D(10) + 'xyz_-AB');
}
function openaiProjKey(): string {
  return 'sk' + '-' + 'proj' + '-' + (A(10) + a(10) + D(10) + 'xyz_-ABCDEFGHIJ');
}
function openaiSvcAcctKey(): string {
  return 'sk' + '-' + 'svcacct' + '-' + a(40);
}

// AWS ASIA temporary credential — runtime-built.
function asiaTempKey(): string {
  return 'ASIA' + 'Q7HIJKLMNOPQRSTU'; // exactly 16 chars after the 4-char prefix
}

// JWT built from runtime parts. Each segment is base64url-safe by construction;
// the literal in source is split across concatenations.
function fakeJwt(): string {
  const header = 'eyJ' + 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
  const payload = 'eyJ' + 'zdWIiOiIxMjM0NSIsIm5hbWUiOiJUZXN0In0';
  const sig = 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  return header + '.' + payload + '.' + sig;
}

describe('awsAccessKeyDetector', () => {
  it('matches AWS docs example AKIAIOSFODNN7EXAMPLE', () => {
    // The one explicit literal we keep — official AWS docs allowlist.
    const m = awsAccessKeyDetector.detect('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('AKIAIOSFODNN7EXAMPLE');
  });

  it('matches ASIA temporary credential prefix', () => {
    const m = awsAccessKeyDetector.detect(`temp creds: ${asiaTempKey()}`);
    expect(m).toHaveLength(1);
  });

  it('does not match lowercase or wrong length', () => {
    expect(awsAccessKeyDetector.detect('AKIAabc')).toHaveLength(0);
    expect(awsAccessKeyDetector.detect('AKIA1234567890ABCDE')).toHaveLength(0);
  });
});

describe('openaiKeyDetector', () => {
  it('matches legacy sk- format', () => {
    const m = openaiKeyDetector.detect(`OPENAI_API_KEY=${openaiLegacyKey()}`);
    expect(m).toHaveLength(1);
  });

  it('matches sk-proj- format', () => {
    const m = openaiKeyDetector.detect(`key ${openaiProjKey()}`);
    expect(m).toHaveLength(1);
  });

  it('matches sk-svcacct- format', () => {
    const m = openaiKeyDetector.detect(openaiSvcAcctKey());
    expect(m).toHaveLength(1);
  });

  it('does not match too-short sk- values', () => {
    expect(openaiKeyDetector.detect('sk-too-short')).toHaveLength(0);
  });
});

describe('anthropicKeyDetector', () => {
  it('matches api03 prefix', () => {
    const m = anthropicKeyDetector.detect(
      'ANTHROPIC_API_KEY=' + 'sk-ant-' + 'api03-' + a(50),
    );
    expect(m).toHaveLength(1);
  });

  it('matches admin01 prefix', () => {
    const m = anthropicKeyDetector.detect('sk-ant-' + 'admin01-' + 'B'.repeat(50));
    expect(m).toHaveLength(1);
  });

  it('does not match without api/admin prefix', () => {
    expect(anthropicKeyDetector.detect('sk-ant-' + a(80))).toHaveLength(0);
  });
});

describe('githubPatDetector', () => {
  it('matches classic ghp_ token', () => {
    const m = githubPatDetector.detect('export GH=' + 'ghp_' + a(36));
    expect(m).toHaveLength(1);
  });

  it('matches OAuth gho_ token', () => {
    const m = githubPatDetector.detect('token ' + 'gho_' + 'B'.repeat(36));
    expect(m).toHaveLength(1);
  });

  it('matches fine-grained github_pat_ token', () => {
    const m = githubPatDetector.detect(
      'GH_FG=' + 'github_pat_' + A(22) + '_' + 'b'.repeat(59),
    );
    expect(m).toHaveLength(1);
  });

  it('does not match wrong-length ghp_', () => {
    expect(githubPatDetector.detect('ghp_abc')).toHaveLength(0);
  });
});

describe('slackTokenDetector', () => {
  it('matches a bot token shape', () => {
    const m = slackTokenDetector.detect(slackBotToken());
    expect(m).toHaveLength(1);
  });

  it('does not match xox without the kind letter', () => {
    expect(slackTokenDetector.detect(slackNoKindLetter())).toHaveLength(0);
  });
});

describe('stripeKeyDetector', () => {
  it('matches sk_live_ key', () => {
    const m = stripeKeyDetector.detect('STRIPE_SK=' + 'sk_' + 'live_' + A(24));
    expect(m).toHaveLength(1);
  });

  it('matches pk_test_ key', () => {
    const m = stripeKeyDetector.detect('pk_' + 'test_' + 'b'.repeat(30));
    expect(m).toHaveLength(1);
  });

  it('matches whsec_ webhook signing secret', () => {
    const m = stripeKeyDetector.detect('STRIPE_WEBHOOK=' + 'whsec_' + 'C'.repeat(40));
    expect(m).toHaveLength(1);
  });

  it('does not match wrong prefix', () => {
    expect(stripeKeyDetector.detect('xk_live_' + a(24))).toHaveLength(0);
  });
});

describe('jwtDetector', () => {
  it('matches a well-formed JWT shape', () => {
    const jwt = fakeJwt();
    const m = jwtDetector.detect(`Authorization: Bearer ${jwt}`);
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe(jwt);
  });

  it('does not match a 2-segment string', () => {
    expect(jwtDetector.detect('eyJabc.eyJdef')).toHaveLength(0);
  });
});

describe('highEntropyDetector', () => {
  it('matches a 40-char mixed-case base64-ish blob', () => {
    // High-entropy by construction; doesn't match any vendor's published key
    // pattern, so no risk of scanner flagging.
    const blob =
      'aB' + D(2) + 'xY' + D(1) + 'zQ' + D(1) + 'mNk' + D(1) + 'vL' + D(1) +
      'pH' + D(1) + 'wRtJfDgEsCvBxMqOnAhUi';
    const m = highEntropyDetector.detect(`secret=${blob}`);
    expect(m).toHaveLength(1);
  });

  it('rejects pure-letter low-entropy strings under the digit gate', () => {
    const m = highEntropyDetector.detect(a(40));
    expect(m).toHaveLength(0);
  });

  it('rejects short strings under 32 chars', () => {
    expect(highEntropyDetector.detect('aB' + D(2) + 'xY' + D(1) + 'zQ' + D(1) + 'm')).toHaveLength(0);
  });

  it('rejects strings with no digits', () => {
    expect(highEntropyDetector.detect('abcdefghijklmnopqrstuvwxyzABCDEFGHIJ')).toHaveLength(0);
  });

  it('rejects strings with no letters', () => {
    expect(highEntropyDetector.detect(D(40))).toHaveLength(0);
  });
});

describe('secretsDetectors aggregate', () => {
  it('exports all 8 detectors', () => {
    expect(secretsDetectors).toHaveLength(8);
  });

  it('detects multiple secret types in a single document', () => {
    const text = `
      AWS_KEY=AKIAIOSFODNN7EXAMPLE
      OPENAI_KEY=${openaiLegacyKey()}
      STRIPE_KEY=${'sk_' + 'live_' + A(24)}
    `;
    const allMatches = secretsDetectors.flatMap((d) => d.detect(text));
    expect(allMatches.length).toBeGreaterThanOrEqual(3);
  });
});
