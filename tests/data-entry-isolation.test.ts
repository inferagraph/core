// Verifies that the `/data` subpath entry stays server-safe — i.e. it
// does not transitively pull the renderer surface (which imports
// three.js, which imports `three/examples/jsm/controls/TrackballControls.js`,
// which is ESM-only and therefore unloadable from a CJS `data.cjs`).
//
// We assert this at the source level (fast, no build step) and again at
// the dist level when a build is present.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataEntry = resolve(here, '../src/data.ts');
const rootEntry = resolve(here, '../src/index.ts');
const dataCjs = resolve(here, '../dist/data.cjs');

describe('data entry source isolation', () => {
  it('does not re-export anything from the renderer/ directory', () => {
    const src = readFileSync(dataEntry, 'utf8');
    // Every renderer re-export is forbidden — they pull three.js into
    // server consumers and break in Node CJS environments because
    // `three/examples/jsm` is ESM-only.
    const matches = [...src.matchAll(/from ['"]\.\/renderer\//g)];
    expect(matches.map((m) => m.index)).toEqual([]);
  });

  it('does not value-import three.js', () => {
    const src = readFileSync(dataEntry, 'utf8');
    // `import type` is fine (compile-time only); a value-level
    // `import ... from 'three'` is not.
    const valueImports = [
      ...src.matchAll(/^import\s+(?!type\s).*from\s+['"]three/gm),
    ];
    expect(valueImports.length).toBe(0);
  });
});

describe('root entry preserves the renderer surface', () => {
  it('exports the renderer modules that data.ts no longer carries', () => {
    const src = readFileSync(rootEntry, 'utf8');
    // After this fix data.ts no longer carries renderer, so index.ts
    // itself must re-export from ./renderer/*.
    expect(src).toMatch(/from ['"]\.\/renderer\//);
  });

  it('runtime root module still binds the major renderer classes', async () => {
    const root = await import('../src/index.js');
    expect(root.SceneController).toBeDefined();
    expect(root.WebGLRenderer).toBeDefined();
    expect(root.NodeMesh).toBeDefined();
    expect(root.EdgeMesh).toBeDefined();
    expect(root.LabelRenderer).toBeDefined();
    expect(root.CameraController).toBeDefined();
    expect(root.InteractionManager).toBeDefined();
    expect(root.ThemeManager).toBeDefined();
    expect(root.Raycaster).toBeDefined();
    expect(root.AnnotationRenderer).toBeDefined();
    expect(root.PulseController).toBeDefined();
    expect(root.InferredEdgeMesh).toBeDefined();
    expect(root.CustomNodeRenderer).toBeDefined();
  });
});

describe('dist/data.cjs (skipped when not built)', () => {
  it('contains no renderer or three.js references', () => {
    if (!existsSync(dataCjs)) {
      // Build artifact not present — silently pass; the source-level
      // assertions above are the authoritative gate.
      return;
    }
    const cjs = readFileSync(dataCjs, 'utf8');
    // The runtime bug we are guarding against: data.cjs must not
    // require() three.js (transitive ESM-only TrackballControls is
    // what crashes Node in CJS contexts).
    expect(cjs).not.toMatch(/three\/examples\//);
    expect(cjs).not.toMatch(/TrackballControls/);
    expect(cjs).not.toMatch(/require\(["']three["']\)/);
    expect(cjs).not.toMatch(/require\(["']three\//);
    // Renderer module identifiers should not appear as bound
    // exports/classes either (incidental occurrences inside doc
    // comments preserved in the bundle are tolerable).
    expect(cjs).not.toMatch(/\bclass WebGLRenderer\b/);
    expect(cjs).not.toMatch(/\bclass SceneController\b/);
  });
});
