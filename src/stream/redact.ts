import { Transform, type TransformCallback } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { Detector, DetectorMatch } from '../detectors/types.js';
import type { Vault } from '../vault/types.js';

export interface RedactStreamOptions {
  detectors: readonly Detector[];
  vault: Vault;
  /**
   * Bytes held back from emit on each chunk to ensure no PII pattern can
   * cross a chunk boundary. Default 256.
   */
  safeDistanceBytes?: number;
  /** UUID generator. Override for deterministic tests. */
  uuid?: () => string;
}

interface DetectedMatch extends DetectorMatch {
  detectorType: string;
}

export function createRedactStream(opts: RedactStreamOptions): Transform {
  const safeDistance = opts.safeDistanceBytes ?? 256;
  const uuid = opts.uuid ?? randomUUID;
  let buffer = '';

  return new Transform({
    encoding: 'utf8',
    transform(chunk, _encoding, callback: TransformCallback) {
      try {
        buffer += chunk.toString();
        const result = processChunk(buffer, opts.detectors, opts.vault, uuid, safeDistance, false);
        buffer = result.kept;
        if (result.emitted) this.push(result.emitted);
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (buffer) {
          const result = processChunk(buffer, opts.detectors, opts.vault, uuid, safeDistance, true);
          if (result.emitted) this.push(result.emitted);
          buffer = '';
        }
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}

function processChunk(
  text: string,
  detectors: readonly Detector[],
  vault: Vault,
  uuid: () => string,
  safeDistance: number,
  isFinal: boolean,
): { emitted: string; kept: string } {
  if (isFinal) {
    const matches = detectAll(text, detectors);
    return { emitted: redactRange(text, matches, 0, text.length, vault, uuid), kept: '' };
  }

  if (text.length <= safeDistance) {
    return { emitted: '', kept: text };
  }

  const matches = detectAll(text, detectors);
  let cut = text.length - safeDistance;

  for (const m of matches) {
    if (m.start < cut && m.end > cut) {
      cut = Math.min(cut, m.start);
    }
  }

  if (cut <= 0) {
    return { emitted: '', kept: text };
  }

  const emitted = redactRange(text, matches, 0, cut, vault, uuid);
  return { emitted, kept: text.slice(cut) };
}

function detectAll(text: string, detectors: readonly Detector[]): DetectedMatch[] {
  const all: DetectedMatch[] = [];
  for (const detector of detectors) {
    for (const match of detector.detect(text)) {
      all.push({ ...match, detectorType: detector.type });
    }
  }
  // Sort by start, then by length descending so longest match wins on overlap
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const resolved: DetectedMatch[] = [];
  let lastEnd = -1;
  for (const m of all) {
    if (m.start >= lastEnd) {
      resolved.push(m);
      lastEnd = m.end;
    }
  }
  return resolved;
}

function redactRange(
  text: string,
  matches: DetectedMatch[],
  rangeStart: number,
  rangeEnd: number,
  vault: Vault,
  uuid: () => string,
): string {
  const inRange = matches.filter((m) => m.start >= rangeStart && m.end <= rangeEnd);
  if (inRange.length === 0) return text.slice(rangeStart, rangeEnd);

  let out = '';
  let pos = rangeStart;
  for (const m of inRange) {
    out += text.slice(pos, m.start);
    const token = `<${m.detectorType}_${uuid()}>`;
    vault.set(token, m.value);
    out += token;
    pos = m.end;
  }
  out += text.slice(pos, rangeEnd);
  return out;
}

/**
 * Synchronous one-shot redaction of a complete text fragment.
 *
 * Use when you have the entire text in hand and don't need chunk-boundary
 * buffering — for example, redacting a single SSE payload line, a JSON
 * field, or any other discrete value. Internally this is identical to the
 * `isFinal: true` path of the streaming Transform: detect all matches,
 * resolve overlaps (longest wins), substitute tokens, write to the vault.
 *
 * For streaming input where PII may span chunk boundaries, use
 * `createRedactStream` instead — it adds the safe-distance buffering.
 */
export interface RedactSyncOptions {
  detectors: readonly Detector[];
  vault: Vault;
  /** UUID generator. Override for deterministic tests. */
  uuid?: () => string;
}

export function redactSync(text: string, opts: RedactSyncOptions): string {
  const uuid = opts.uuid ?? randomUUID;
  const matches = detectAll(text, opts.detectors);
  return redactRange(text, matches, 0, text.length, opts.vault, uuid);
}
