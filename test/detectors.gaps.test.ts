// Regression tests for the 0.7.0 detection-gap fixes: national-format phones
// via multi-region detection, label-anchored API keys/passwords, "born on"
// DOB, and prose-anchored / Commonwealth-suffix addresses. These are the
// real-world prompt shapes that previously slipped through (found via the
// Sether Shield field report, 2026-08).
import { describe, it, expect } from 'vitest';
import { createMultiRegionPhoneDetector } from '../src/detectors/basic.js';
import { labeledApiKeyDetector, labeledPasswordDetector } from '../src/detectors/secrets.js';
import { dobDetector, addressDetector } from '../src/detectors/identity.js';

describe('createMultiRegionPhoneDetector', () => {
  const detector = createMultiRegionPhoneDetector(['US', 'NG', 'GB']);

  it('detects national-format numbers for every configured region', () => {
    expect(detector.detect('call me on 08065786535')).toHaveLength(1);
    expect(detector.detect('my number is 0806 578 6535')).toHaveLength(1);
    expect(detector.detect('call me at (415) 555-2671')).toHaveLength(1);
    expect(detector.detect('my number is 415-555-2671')).toHaveLength(1);
    expect(detector.detect('ring 07911 123456 today')).toHaveLength(1);
  });

  it('still detects international format', () => {
    expect(detector.detect('reach me on +2348065786535')).toHaveLength(1);
  });

  it('de-duplicates a number found by multiple passes', () => {
    const matches = detector.detect('call +1 415 555 2671 now');
    expect(matches).toHaveLength(1);
  });

  it('does not fire on plain prose', () => {
    expect(detector.detect('the meeting is at 3pm on tuesday')).toHaveLength(0);
  });
});

describe('labeledApiKeyDetector', () => {
  it('catches prose-labelled keys below the entropy floor', () => {
    const m = labeledApiKeyDetector.detect('use apikey AbC123xYz789QwE456');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('AbC123xYz789QwE456');
  });

  it('catches "api key is …", "access token:", "client secret ="', () => {
    expect(labeledApiKeyDetector.detect('my api key is Zx9Yw8Vu7Tt6Ss5R')).toHaveLength(1);
    expect(labeledApiKeyDetector.detect('access_token: 9f8e7d6c5b4a3928')).toHaveLength(1);
    expect(labeledApiKeyDetector.detect('client secret = qT4xP0mN8kL2jH6g')).toHaveLength(1);
  });

  it('ignores prose without key-shaped values', () => {
    expect(labeledApiKeyDetector.detect('api key management is important')).toHaveLength(0);
    expect(labeledApiKeyDetector.detect('rotate your api keys regularly please')).toHaveLength(0);
    expect(labeledApiKeyDetector.detect('the access token expired yesterday')).toHaveLength(0);
  });
});

describe('labeledPasswordDetector', () => {
  it('catches "my password is hunter2butlonger"', () => {
    const m = labeledPasswordDetector.detect('my password is hunter2butlonger, keep it safe');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('hunter2butlonger');
  });

  it('strips trailing punctuation', () => {
    const m = labeledPasswordDetector.detect('password: S3cr3t!pass.');
    expect(m[0]?.value).toBe('S3cr3t!pass');
  });

  it('rejects non-secret continuations', () => {
    expect(labeledPasswordDetector.detect('the password is required here')).toHaveLength(0);
    expect(labeledPasswordDetector.detect('my password is wrong again')).toHaveLength(0);
    expect(labeledPasswordDetector.detect('a password is needed to log in')).toHaveLength(0);
  });

  it('requires a separator — bare "password hunter2" stays out', () => {
    expect(labeledPasswordDetector.detect('password hunter2')).toHaveLength(0);
  });
});

describe('dobDetector — "born on"', () => {
  it('catches "I was born on 14/03/1995"', () => {
    const m = dobDetector.detect('I was born on 14/03/1995');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('14/03/1995');
  });

  it('still catches the bare "born" label', () => {
    expect(dobDetector.detect('born 1990-05-12')).toHaveLength(1);
  });
});

describe('addressDetector — prose anchors + Commonwealth suffixes', () => {
  it('catches "I live at …Crescent…"', () => {
    const m = addressDetector.detect('I live at 24 Adetokunbo Ademola Crescent, Wuse 2, Abuja');
    expect(m.length).toBeGreaterThanOrEqual(1);
    expect(m.some((x) => x.value.includes('Adetokunbo Ademola Crescent'))).toBe(true);
  });

  it('catches a standalone crescent street line', () => {
    expect(
      addressDetector.detect('send it to 15 Freedom Crescent tomorrow').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('does not treat verb-shaped words as street suffixes', () => {
    expect(addressDetector.detect('the 3 stores close at 5pm')).toHaveLength(0);
  });

  it('does not fire on NON-POSTAL "address" compounds', () => {
    // Regression: "email address" used to swallow everything to end-of-line
    // as one giant ADDRESS match once the line contained a digit or comma.
    expect(
      addressDetector.detect(
        'my email address is emory@gmail.com, call me on 08065786535. Regards, Godfrey',
      ),
    ).toHaveLength(0);
    expect(addressDetector.detect('IP address: 10.0.0.1 is unreachable')).toHaveLength(0);
    expect(addressDetector.detect('wallet address: 0x12a4 5bc backup, ok')).toHaveLength(0);
    expect(addressDetector.detect('the server address is 192.168.0.1, port 8080')).toHaveLength(0);
  });

  it('still fires on real labelled addresses', () => {
    expect(addressDetector.detect('Address: 12 Marina Road, Lagos').length).toBeGreaterThanOrEqual(1);
    expect(
      addressDetector.detect('shipping address: 4 Elm Street, Springfield').length,
    ).toBeGreaterThanOrEqual(1);
  });
});
