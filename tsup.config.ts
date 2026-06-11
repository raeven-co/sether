import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/browser.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: 'node18',
  // Emit ASCII-only output: esbuild escapes every non-ASCII code point to
  // \uXXXX in the bundles. The multilingual label regexes (CJK / Cyrillic /
  // Arabic) match identically — same code points — but the shipped .js/.cjs
  // carry no raw non-ASCII or right-to-left characters, which static supply-
  // chain scanners (e.g. Socket.dev) flag as a "Trojan Source" risk.
  esbuildOptions(options) {
    options.charset = 'ascii';
  },
});
