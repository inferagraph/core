// Fix 3 (0.9.0): the `@inferagraph/core` and `@inferagraph/core/data`
// entry points must export the SAME nominal types for shared classes —
// `AIEngine`, `GraphStore`, `QueryEngine`, `SearchEngine`, `GraphIndexer`,
// etc. Without this, TypeScript treats two `declare class AIEngine`
// declarations (each carrying private fields) as nominally distinct, so
// `import { AIEngine } from '@inferagraph/core'` and the same import from
// `/data` produce non-assignable types. Consumers (notably the
// `biblegraph` app) hit `Type 'AIEngine' is not assignable to type
// 'AIEngine'` whenever a value crossed the entry boundary.
//
// Root cause: `tsup` was configured as TWO separate build configs (data,
// then index+react). Each config rolls its own `.d.ts`, inlining shared
// classes rather than referencing a shared chunk. After the fix, all
// three entries are built in ONE tsup config so DTS rollup deduplicates
// shared classes into a single chunk file, and the per-entry `.d.ts`
// files re-export from that chunk.
//
// We assert this at the build-artifact level: only ONE of the public
// `.d.ts` files (the chunk) may contain the shared class declaration;
// the other public entries must reference it via a re-export.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, '../dist');

const SHARED_CLASSES = [
  'AIEngine',
  'GraphStore',
  'QueryEngine',
  'SearchEngine',
  'GraphIndexer',
] as const;

describe('dist nominal-type dedup across entry points', () => {
  it('builds dist/ before this test runs (skips if not built)', () => {
    if (!existsSync(distDir)) {
      // Build artifact not present — skip the rest. Locally `pnpm build`
      // before `pnpm test` makes this gate fire.
      return;
    }
    expect(existsSync(join(distDir, 'index.d.ts'))).toBe(true);
    expect(existsSync(join(distDir, 'data.d.ts'))).toBe(true);
  });

  for (const className of SHARED_CLASSES) {
    it(`declares class ${className} at most once across the public .d.ts surface`, () => {
      if (!existsSync(distDir)) return;
      const files = readdirSync(distDir).filter((f) => f.endsWith('.d.ts'));
      const declarations: { file: string; count: number }[] = [];
      const declRegex = new RegExp(`\\bdeclare class ${className}\\b`, 'g');
      for (const f of files) {
        const src = readFileSync(join(distDir, f), 'utf8');
        const matches = src.match(declRegex);
        const count = matches ? matches.length : 0;
        if (count > 0) declarations.push({ file: f, count });
      }
      // Across ALL .d.ts files, the class should be declared exactly
      // once (in a shared chunk file). Multiple declarations = nominal
      // collision.
      const totalDeclarations = declarations.reduce((s, d) => s + d.count, 0);
      expect(totalDeclarations, `class ${className} declared in: ${JSON.stringify(declarations)}`).toBe(1);
    });
  }

  it('runtime: AIEngine imported from index === AIEngine imported from data', async () => {
    const idx = await import('../src/index.js');
    const data = await import('../src/data.js');
    // Source-level reference identity: the index re-exports from data
    // already, so the runtime constructor is the same. The .d.ts
    // dedup test above asserts the type-level surface matches.
    expect(idx.AIEngine).toBe(data.AIEngine);
    expect(idx.GraphStore).toBe(data.GraphStore);
    expect(idx.QueryEngine).toBe(data.QueryEngine);
    expect(idx.SearchEngine).toBe(data.SearchEngine);
    expect(idx.GraphIndexer).toBe(data.GraphIndexer);
  });
});
