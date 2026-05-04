#!/usr/bin/env node
/**
 * Scan all .ts source files for regex literals and verify they are not
 * ReDoS-prone using safe-regex2. Fails CI on any unsafe pattern.
 *
 * False positives are tolerated (we only care about correctly-recognized
 * regex literals). False negatives — actual ReDoS bugs sneaking through —
 * are blocking.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import safeRegex from 'safe-regex2';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (name.endsWith('.ts')) {
      yield path;
    }
  }
}

// Match `/pattern/flags` regex literals in TypeScript source.
// Recognizes character classes (so `/` inside `[...]` doesn't terminate).
const REGEX_LITERAL = /\/((?:\\.|\[(?:\\.|[^\]\n])*\]|[^\\/\n])+)\/[gimsuyd]*/g;

let scanned = 0;
let unsafe = 0;

for (const file of walk(SRC)) {
  const content = readFileSync(file, 'utf8');
  let m;
  REGEX_LITERAL.lastIndex = 0;
  while ((m = REGEX_LITERAL.exec(content)) !== null) {
    const pattern = m[1];
    let re;
    try {
      re = new RegExp(pattern);
    } catch {
      // Not actually a valid regex literal; ignore (false positive in scanner)
      continue;
    }
    scanned++;
    if (!safeRegex(re)) {
      console.error(`UNSAFE REGEX in ${relative(ROOT, file)}:\n  /${pattern}/`);
      unsafe++;
    }
  }
}

console.log(`safe-regex2: scanned ${scanned} pattern(s), ${unsafe} unsafe.`);
process.exit(unsafe > 0 ? 1 : 0);
