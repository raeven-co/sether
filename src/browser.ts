// Browser-safe entry point.
//
// The package root (`@raeven-co/sether`) imports `node:stream` / `node:crypto`
// for the streaming redact/restore transforms, so it can't be bundled for the
// browser. This entry exports ONLY the pure detection surface — the detector
// packs, their types, and the regulation mappings — with no Node built-ins.
//
// Use it in a browser extension, a client-side sandbox, or any DOM context:
//
//   import { basicDetectors, secretsDetectors, identityDetectors } from '@raeven-co/sether/browser';
//   const matches = [...basicDetectors, ...identityDetectors].flatMap((d) => d.detect(text));
//
// Detection logic is identical to the Node entry — one source of truth, no
// hand-ported copies drifting out of sync.

// Detectors — basic pack
export {
  basicDetectors,
  emailDetector,
  creditCardDetector,
  ssnDetector,
  ipv4Detector,
  ipv6Detector,
  ibanDetector,
  phoneDetector,
  createPhoneDetector,
  createMultiRegionPhoneDetector,
} from './detectors/basic.js';
export type { PhoneDetectorOptions } from './detectors/basic.js';

// Detectors — secrets pack
export {
  secretsDetectors,
  awsAccessKeyDetector,
  openaiKeyDetector,
  anthropicKeyDetector,
  githubPatDetector,
  slackTokenDetector,
  stripeKeyDetector,
  jwtDetector,
  highEntropyDetector,
  labeledApiKeyDetector,
  labeledPasswordDetector,
} from './detectors/secrets.js';

// Alias engine (new in 0.7.0) — realistic decoys + reversible vault
export { aliasValue, suggestAliases, shapeAlias, AliasVault } from './alias.js';
export type { AliasOptions, AliasEntry } from './alias.js';

// Detectors — identity pack (label-anchored name / DOB / passport / address)
export {
  identityDetectors,
  nameDetector,
  dobDetector,
  passportDetector,
  addressDetector,
} from './detectors/identity.js';

// Regulation mappings (pure data) — for compliance-lens UIs.
export { DEFAULT_REGULATION_MAPPINGS } from './audit/types.js';
export type { RegulationMapping } from './audit/types.js';

// Types
export type { Detector, DetectorMatch } from './detectors/types.js';
