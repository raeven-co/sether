#!/usr/bin/env node
/**
 * Verify the published JavaScript bundles contain no non-ASCII characters.
 *
 * Raw non-ASCII — especially right-to-left scripts (the "Trojan Source" class,
 * CVE-2021-42574) — in shipped code is flagged by supply-chain scanners
 * (Socket.dev et al.) and dings the Supply Chain Security score. The bundler is
 * configured with `charset: 'ascii'` (tsup.config.ts) so all non-ASCII code
 * points are emitted as \uXXXX escapes. This guard fails the build if any raw
 * non-ASCII byte slips into a shipped .js/.cjs, so the score can't silently
 * regress.
 *
 * Scans only the executable bundles (what scanners analyse as code). Type
 * declarations and source maps are not executable and are checked separately
 * by the dts build / not shipped as code.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist', import.meta.url).pathname;

let scanned = 0;
let offending = 0;

for (const name of readdirSync(DIST)) {
  if (!/\.(c?js|mjs)$/.test(name)) continue; // executable bundles only
  scanned++;
  const text = readFileSync(join(DIST, name), 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7F]/.test(lines[i])) {
      offending++;
      const col = lines[i].search(/[^\x00-\x7F]/);
      console.error(`NON-ASCII in dist/${name}:${i + 1}:${col + 1}`);
      console.error(`  ${lines[i].slice(Math.max(0, col - 20), col + 30)}`);
    }
  }
}

console.log(`check-ascii-dist: scanned ${scanned} bundle(s), ${offending} non-ASCII line(s).`);
process.exit(offending > 0 ? 1 : 0);
