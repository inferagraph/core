import type { EdgeColorFn } from './EdgeColorMap.js';

/**
 * Built-in {@link EdgeColorFn} that returns the linear-RGB midpoint of
 * the two connected nodes' resolved colors.
 *
 * If both endpoints share a color, the result is that color (same hex
 * back). If they differ, the result is the RGB midpoint — a visually
 * intuitive blend useful for graphs where the relationship type is less
 * semantically interesting than which two regions of the data the edge
 * connects.
 *
 * Usage:
 * ```tsx
 * import { blendEdgeColors } from '@inferagraph/core';
 * <InferaGraph edgeColorFn={blendEdgeColors} ... />
 * ```
 */
export const blendEdgeColors: EdgeColorFn = (_edge, { sourceColor, targetColor }) =>
  mixHexColors(sourceColor, targetColor, 0.5);

/**
 * Linear-RGB mix of two hex colours. `t` is the weight applied to the
 * SECOND colour — `t=0` returns `a`, `t=1` returns `b`, `t=0.5` (the
 * default) is the midpoint.
 *
 * Inputs may be six-digit hex with or without a leading `#`. Anything
 * else (including `rgb(...)` strings or short-form `#abc`) returns `a`
 * unchanged — this is a small utility, not a full CSS colour parser.
 */
export function mixHexColors(a: string, b: string, t: number = 0.5): string {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return a;
  const mix = (x: number, y: number) => Math.round(x * (1 - t) + y * t);
  return `#${[mix(ra.r, rb.r), mix(ra.g, rb.g), mix(ra.b, rb.b)]
    .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0'))
    .join('')}`;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f0-9]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}
