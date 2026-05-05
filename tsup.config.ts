import { defineConfig } from 'tsup';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

// Two-config build:
//
// 1. The data-only entry (`@inferagraph/core/data`) ships without any
//    React directives so that server-side consumers (Next.js RSC, Node
//    workers) can import it from server bundles without triggering the
//    React Server Components client-boundary check.
//
// 2. The React-bearing entries — `@inferagraph/core` (umbrella, which
//    re-exports React things) and `@inferagraph/core/react` (dedicated
//    React entry) — ship with a `'use client';` directive at the top
//    of their bundled output. Without it, Next.js statically prerenders
//    the module and crashes on the first `useRef` / `useState` because
//    no React renderer is mounted server-side. The directive declares
//    a client boundary so Next skips that prerender and treats
//    consumers as client components transitively.
//
// Why post-process via `buildEnd` instead of `banner` or `renderChunk`?
//
//   - `banner` lets esbuild see `'use client';` as a module-level
//     directive and silently strips it ("Module level directives cause
//     errors when bundled" — esbuild warns and drops the banner).
//   - `renderChunk` (a tsup plugin hook) runs BEFORE tsup's built-in
//     tree-shaking plugin, which re-bundles the chunk through Rollup.
//     Rollup strips top-level string-literal directives by default, so
//     a directive prepended in `renderChunk` is gone by the time the
//     file lands on disk.
//   - `buildEnd` fires after all chunks have been written, so we can
//     prepend the directive to the on-disk file and be sure nothing
//     downstream will strip it.
const useClientPlugin = (entryBasenames: string[]) => ({
  name: 'use-client-banner',
  async buildEnd({ writtenFiles }: { writtenFiles: ReadonlyArray<{ name: string }> }) {
    for (const file of writtenFiles) {
      const base = path.basename(file.name);
      // Match e.g. `index.js`, `index.cjs`, `react.js`, `react.cjs`.
      // Skip sourcemaps and any chunked sub-file.
      const match = base.match(/^(.+)\.(c|m)?js$/);
      if (!match) continue;
      const stem = match[1];
      if (!entryBasenames.includes(stem)) continue;

      const filePath = path.resolve(file.name);
      const code = await readFile(filePath, 'utf8');
      // Avoid double-prepending if the directive is already there.
      if (/^['"]use client['"];?/.test(code)) continue;
      await writeFile(filePath, `'use client';\n${code}`, 'utf8');
    }
  },
});

export default defineConfig([
  {
    entry: ['src/data.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom', 'three'],
    treeshake: true,
  },
  {
    entry: ['src/index.ts', 'src/react.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    external: ['react', 'react-dom', 'three'],
    treeshake: true,
    plugins: [useClientPlugin(['index', 'react'])],
  },
]);
