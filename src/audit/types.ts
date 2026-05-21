// ─────────────────────────────────────────────────────────────────────────────
//  Audit event schema
//
//  Every redaction emits one AuditEvent. The OSS package provides:
//   - the type contract (this file)
//   - a console reference writer (./console.ts)
//
//  The hosted Pro tier ingests these events into D1/Postgres for retention,
//  compliance reporting, and SIEM export. The schema is the same on both
//  sides so customers can promote from local-only to hosted without
//  reshaping events.
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditEvent {
  /** ISO-8601 UTC, e.g. "2026-05-21T12:34:56.789Z" */
  timestamp: string;
  /** Optional tenant correlation id (multi-tenant deployments). */
  tenantId?: string;
  /** Optional request id (e.g. an inbound HTTP request id). */
  requestId?: string;
  /** Detector type that produced the match, e.g. "EMAIL" or "OPENAI_KEY". */
  detector: string;
  /** Length of the original value (the value itself is never logged). */
  valueLength: number;
  /** The token that replaced the value in the redacted stream. */
  token: string;
  /** What was done with the match. Currently always "REDACTED". */
  action: 'REDACTED' | 'RESTORED';
  /** Optional destination metadata (which LLM provider received the stream). */
  destination?: string;
  /**
   * Compliance-control mappings. Sether's basic + secrets packs ship with
   * default mappings to GDPR / SOC2 / HIPAA / EU AI Act / NDPA. Custom
   * detectors can supply their own.
   */
  regulationMappings?: RegulationMapping[];
}

export interface RegulationMapping {
  framework: 'GDPR' | 'SOC2' | 'HIPAA' | 'EU_AI_ACT' | 'NDPA' | 'CCPA' | 'PCI_DSS' | 'ISO_27001' | 'OWASP_LLM' | 'OWASP_AGENTIC';
  reference: string; // e.g. "Art. 28", "CC6.7", "§164.312", "§10"
}

export interface AuditSink {
  /** Receive one AuditEvent. Implementations decide where it goes. */
  write(event: AuditEvent): void | Promise<void>;
}

// Default regulation mappings per detector type. Keep this lean — every entry
// here must be defensible against the actual regulation text.
export const DEFAULT_REGULATION_MAPPINGS: Readonly<Record<string, ReadonlyArray<RegulationMapping>>> = {
  EMAIL: [
    { framework: 'GDPR', reference: 'Art. 28' },
    { framework: 'SOC2', reference: 'CC6.7' },
  ],
  PHONE: [
    { framework: 'GDPR', reference: 'Art. 28' },
    { framework: 'SOC2', reference: 'CC6.7' },
  ],
  CC: [
    { framework: 'PCI_DSS', reference: 'Req. 3.4' },
    { framework: 'SOC2', reference: 'CC6.7' },
  ],
  SSN: [
    { framework: 'GDPR', reference: 'Art. 9' },
    { framework: 'HIPAA', reference: '§164.514' },
  ],
  IPV4: [{ framework: 'GDPR', reference: 'Recital 30' }],
  IPV6: [{ framework: 'GDPR', reference: 'Recital 30' }],
  IBAN: [
    { framework: 'PCI_DSS', reference: 'Req. 3.4' },
    { framework: 'GDPR', reference: 'Art. 28' },
  ],
  AWS_KEY: [
    { framework: 'SOC2', reference: 'CC6.1' },
    { framework: 'ISO_27001', reference: 'A.9.4.3' },
  ],
  OPENAI_KEY: [{ framework: 'SOC2', reference: 'CC6.1' }],
  ANTHROPIC_KEY: [{ framework: 'SOC2', reference: 'CC6.1' }],
  GITHUB_PAT: [{ framework: 'SOC2', reference: 'CC6.1' }],
  SLACK_TOKEN: [{ framework: 'SOC2', reference: 'CC6.1' }],
  STRIPE_KEY: [
    { framework: 'PCI_DSS', reference: 'Req. 3.5' },
    { framework: 'SOC2', reference: 'CC6.1' },
  ],
  JWT: [{ framework: 'SOC2', reference: 'CC6.1' }],
  HIGH_ENTROPY: [{ framework: 'SOC2', reference: 'CC6.1' }],
};
