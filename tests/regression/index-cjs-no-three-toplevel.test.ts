// Regression: production deploy crashed with
//   require() of ES Module
//   /var/task/node_modules/three/examples/jsm/controls/TrackballControls.js
//   from /var/task/node_modules/@inferagraph/core/dist/index.cjs not supported.
//
// Root cause: `src/renderer/CameraController.ts` did a static
// `import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'`,
// which esbuild lowered to a top-level `require()` in the CJS bundle
// (`dist/index.cjs`). Node refuses to require() ESM, so the moment any
// server-side caller `require()`d `@inferagraph/core` (transitively or
// directly) the function crashed at module-load time.
//
// The fix moves the load to a lazy dynamic `import()` inside `attach()`
// / `swapCamera()` (the only call sites). esbuild preserves dynamic
// `import()` as native dynamic ESM import in BOTH the ESM and CJS
// bundles, so the require lifts out of module-load and the renderer
// only pulls TrackballControls when a browser actually attaches.
//
// This regression test guards both invariants.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const indexCjs = resolve(here, '../../dist/index.cjs');
const dataCjs = resolve(here, '../../dist/data.cjs');

describe('dist/index.cjs (skipped when not built)', () => {
  it('does NOT have a top-level `var X = require("three/examples/...")`', () => {
    if (!existsSync(indexCjs)) return; // build artifact gate
    const cjs = readFileSync(indexCjs, 'utf8');
    // The `require()` may legally appear inside a function body (lazy
    // load) — the production bug was strictly a TOP-LEVEL `var X =
    // require('three/examples/...')` evaluated at module-load. Use a
    // multiline-anchored regex so only line-leading top-level decl
    // patterns match (function bodies are indented).
    const topLevelRequireRe =
      /^[ \t]*(?:var|let|const)\s+\w+\s*=\s*require\(["']three\/examples\//gm;
    const matches = [...cjs.matchAll(topLevelRequireRe)];
    expect(matches.map((m) => m[0])).toEqual([]);
  });

  it('does NOT have a naked top-level `require("three/examples/...")`', () => {
    if (!existsSync(indexCjs)) return;
    const cjs = readFileSync(indexCjs, 'utf8');
    const nakedTopRequireRe = /^[ \t]*require\(["']three\/examples\//gm;
    const matches = [...cjs.matchAll(nakedTopRequireRe)];
    expect(matches.map((m) => m[0])).toEqual([]);
  });
});

describe('dist/data.cjs renderer-isolation (regression guard)', () => {
  it('still has zero references to TrackballControls', () => {
    if (!existsSync(dataCjs)) return;
    const cjs = readFileSync(dataCjs, 'utf8');
    expect(cjs).not.toMatch(/TrackballControls/);
    expect(cjs).not.toMatch(/three\/examples\//);
  });
});
