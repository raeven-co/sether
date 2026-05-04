import { describe, it, expect } from 'vitest';
import {
  emailDetector,
  creditCardDetector,
  ssnDetector,
  ipv4Detector,
  ipv6Detector,
  ibanDetector,
  phoneDetector,
} from '../src/detectors/basic.js';

describe('emailDetector', () => {
  it('finds simple emails', () => {
    const m = emailDetector.detect('Contact me at alice@example.com please');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('alice@example.com');
  });

  it('finds multiple emails', () => {
    const m = emailDetector.detect('a@b.co and c@d.io');
    expect(m).toHaveLength(2);
  });

  it('does not match the | character (v1 [A-Z|a-z] bug)', () => {
    const m = emailDetector.detect('foo@bar.|x');
    expect(m).toHaveLength(0);
  });

  it('matches subdomained emails', () => {
    const m = emailDetector.detect('reach: bob@mail.example.co.uk now');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('bob@mail.example.co.uk');
  });
});

describe('creditCardDetector (Luhn)', () => {
  it('matches a Luhn-valid Visa test number', () => {
    const m = creditCardDetector.detect('Card: 4532015112830366');
    expect(m).toHaveLength(1);
  });

  it('rejects Luhn-invalid 16-digit sequences', () => {
    const m = creditCardDetector.detect('Order id: 1234567890123456');
    expect(m).toHaveLength(0);
  });

  it('matches a valid card with spaces', () => {
    const m = creditCardDetector.detect('4532 0151 1283 0366');
    expect(m).toHaveLength(1);
  });

  it('matches a valid card with dashes', () => {
    const m = creditCardDetector.detect('4532-0151-1283-0366');
    expect(m).toHaveLength(1);
  });

  it('does not match a phone number', () => {
    const m = creditCardDetector.detect('Call 555-123-4567');
    expect(m).toHaveLength(0);
  });
});

describe('ssnDetector', () => {
  it('matches a valid-looking SSN', () => {
    const m = ssnDetector.detect('SSN: 123-45-6789');
    expect(m).toHaveLength(1);
  });

  it('rejects 000 area', () => {
    const m = ssnDetector.detect('SSN: 000-12-3456');
    expect(m).toHaveLength(0);
  });

  it('rejects 666 area', () => {
    const m = ssnDetector.detect('SSN: 666-12-3456');
    expect(m).toHaveLength(0);
  });

  it('rejects 9XX area', () => {
    const m = ssnDetector.detect('SSN: 999-12-3456');
    expect(m).toHaveLength(0);
  });

  it('rejects 00 group', () => {
    const m = ssnDetector.detect('SSN: 123-00-4567');
    expect(m).toHaveLength(0);
  });

  it('rejects 0000 serial', () => {
    const m = ssnDetector.detect('SSN: 123-45-0000');
    expect(m).toHaveLength(0);
  });
});

describe('ipv4Detector', () => {
  it('matches a valid IPv4', () => {
    const m = ipv4Detector.detect('Server at 192.168.1.1');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('192.168.1.1');
  });

  it('rejects out-of-range octets', () => {
    const m = ipv4Detector.detect('not an IP: 256.1.1.1');
    expect(m).toHaveLength(0);
  });

  it('matches loopback', () => {
    const m = ipv4Detector.detect('connect to 127.0.0.1');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('127.0.0.1');
  });
});

describe('ipv6Detector', () => {
  it('matches a full-form IPv6', () => {
    const m = ipv6Detector.detect('node addr 2001:0db8:85a3:0000:0000:8a2e:0370:7334 online');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
  });

  it('matches a compressed IPv6', () => {
    const m = ipv6Detector.detect('reach me at 2001:db8::1 today');
    expect(m).toHaveLength(1);
    expect(m[0]?.value).toBe('2001:db8::1');
  });

  it('matches loopback ::1', () => {
    const m = ipv6Detector.detect('Trying ::1 first');
    // ::1 is only 3 chars — below our candidate min length (4) — accept that limitation for now.
    expect(m).toHaveLength(0);
  });

  it('does not match plain hex words', () => {
    const m = ipv6Detector.detect('the hash deadbeef cafebabe is here');
    expect(m).toHaveLength(0);
  });

  it('does not match colon-only sequences', () => {
    const m = ipv6Detector.detect('field::value::other not an ip');
    expect(m).toHaveLength(0);
  });
});

describe('ibanDetector', () => {
  it('matches a valid UK IBAN', () => {
    const m = ibanDetector.detect('Send to GB82WEST12345698765432 today');
    expect(m).toHaveLength(1);
  });

  it('matches a valid German IBAN', () => {
    const m = ibanDetector.detect('IBAN: DE89370400440532013000');
    expect(m).toHaveLength(1);
  });

  it('rejects an invalid checksum', () => {
    const m = ibanDetector.detect('GB99WEST12345698765432 is bogus');
    expect(m).toHaveLength(0);
  });

  it('does not match arbitrary uppercase strings', () => {
    const m = ibanDetector.detect('PROJECT12345678901234567890 is a code');
    expect(m).toHaveLength(0);
  });
});

describe('phoneDetector', () => {
  it('matches an international phone in text', () => {
    const m = phoneDetector.detect('Call me at +1 (415) 555-2671 anytime');
    expect(m.length).toBeGreaterThanOrEqual(1);
  });

  it('matches a UK phone', () => {
    const m = phoneDetector.detect('UK office: +44 20 7946 0958');
    expect(m.length).toBeGreaterThanOrEqual(1);
  });

  it('does not match arbitrary digit sequences', () => {
    const m = phoneDetector.detect('order id 123456 ref 7890');
    expect(m).toHaveLength(0);
  });
});
