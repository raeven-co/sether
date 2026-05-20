import { describe, it, expect } from 'vitest';
import { isIPv6 as nodeIsIPv6 } from 'node:net';
import fc from 'fast-check';
import { isIPv6Address } from '../src/detectors/basic.js';

// The validator is meant to replace Node's `net.isIPv6` only for the
// candidate strings produced by the IPv6 detector's candidate regex:
//   /\b[0-9A-Fa-f:]{4,39}\b/g
// i.e. hex digits and ':' only, length 4..39. IPv4-in-IPv6 mixed form
// (`::ffff:192.0.2.1`) is excluded by design — the candidate regex
// can't match dots, and the existing detector documents that limitation.

const HEX_AND_COLON_PATTERN = /^[0-9A-Fa-f:]{4,39}$/;

function nodeReferenceForCandidate(s: string): boolean {
  // Only applicable for the candidate domain. Outside that domain we
  // make no equivalence claim (Node's isIPv6 accepts IPv4-in-IPv6,
  // we deliberately do not).
  return HEX_AND_COLON_PATTERN.test(s) && nodeIsIPv6(s);
}

function ourForCandidate(s: string): boolean {
  return HEX_AND_COLON_PATTERN.test(s) && isIPv6Address(s);
}

describe('isIPv6Address — equivalence with Node net.isIPv6', () => {
  it('accepts well-formed IPv6 strings exactly like Node', () => {
    const accepted = [
      '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      '2001:db8:85a3:0:0:8a2e:370:7334',
      '2001:db8::1',
      '2001:db8::',
      '::1234',
      '::ff00',
      'fe80::1',
      'fe80::',
      'abcd:ef01:2345:6789:abcd:ef01:2345:6789',
    ];
    for (const s of accepted) {
      expect(ourForCandidate(s)).toBe(nodeReferenceForCandidate(s));
      expect(isIPv6Address(s)).toBe(true);
    }
  });

  it('rejects malformed inputs exactly like Node', () => {
    const rejected = [
      '12345::', //  group too long (5 hex chars)
      'fe80::1::2', // two '::'
      'fe80:::1', //  ':::' triple colon
      '1:2:3:4:5:6:7', //  only 7 groups, no '::'
      '1:2:3:4:5:6:7:8:9', //  9 groups, no '::'
      'deadxxxx', //  non-hex chars
      'gggg::1', //  non-hex chars
      ':1:2:3:4:5:6:7', //  leading lone ':'
      '1:2:3:4:5:6:7:', //  trailing lone ':'
    ];
    for (const s of rejected) {
      // For inputs that contain non-hex chars Node will still say false,
      // so equivalence holds for the candidate-domain set.
      expect(ourForCandidate(s)).toBe(nodeReferenceForCandidate(s));
      expect(isIPv6Address(s)).toBe(false);
    }
  });

  it('matches Node for the boundary case `::` (unspecified address)', () => {
    // Below the candidate regex's 4-char minimum, but the validator
    // itself must still match Node's behaviour.
    expect(isIPv6Address('::')).toBe(nodeIsIPv6('::'));
    expect(isIPv6Address('::')).toBe(true);
  });

  it(
    'property: matches Node net.isIPv6 across 4000 fuzzed hex+colon strings (length 4–39)',
    () => {
      fc.assert(
        fc.property(
          fc
            .array(
              fc.constantFrom(
                '0',
                '1',
                '2',
                '3',
                '4',
                '5',
                '6',
                '7',
                '8',
                '9',
                'a',
                'b',
                'c',
                'd',
                'e',
                'f',
                'A',
                'B',
                'C',
                'D',
                'E',
                'F',
                ':',
              ),
              { minLength: 4, maxLength: 39 },
            )
            .map((arr) => arr.join('')),
          (s) => isIPv6Address(s) === nodeIsIPv6(s),
        ),
        { numRuns: 4000 },
      );
    },
  );

  it(
    'property: matches Node net.isIPv6 across 2000 fully random strings (most rejected by both)',
    () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 50 }), (s) => {
          // Outside the candidate domain Node may accept IPv4-in-IPv6
          // (which we don't). Restrict the property to inputs that
          // can't contain dots so equivalence holds.
          if (s.includes('.')) return true;
          return isIPv6Address(s) === nodeIsIPv6(s);
        }),
        { numRuns: 2000 },
      );
    },
  );
});
