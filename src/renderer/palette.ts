/**
 * Default vibrant palette of 32 colors. Spans the hue wheel with consistent
 * saturation/lightness so every color reads on a dark canvas. Adjacent palette
 * indices are visually distinct enough for at-a-glance differentiation.
 *
 * Used by {@link NodeColorResolver} and {@link EdgeColorMap} to deterministically
 * auto-assign a color to a node or edge type when the consumer hasn't specified
 * an explicit override.
 */
export const DEFAULT_PALETTE_32: readonly string[] = Object.freeze([
  '#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#6366f1', '#f59e0b',
  '#ef4444', '#ec4899', '#14b8a6', '#84cc16', '#f97316', '#a855f7',
  '#eab308', '#0ea5e9', '#22c55e', '#d946ef', '#fb923c', '#34d399',
  '#fbbf24', '#60a5fa', '#c084fc', '#2dd4bf', '#fde047', '#a78bfa',
  '#f43f5e', '#22d3ee', '#bef264', '#facc15', '#5eead4', '#e879f9',
  '#fda4af', '#93c5fd',
] as const);

/**
 * FNV-1a 32-bit hash → palette index. Pure, deterministic: the same input
 * string ALWAYS yields the same index for a given modulo. We use FNV-1a
 * because it is dependency-free, fast, and has good avalanche behavior on
 * short strings — the kinds of strings ('person', 'father_of', etc.) we
 * expect to see as type discriminators.
 */
export function hashStringToIndex(s: string, modulo: number): number {
  if (modulo <= 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) * 16777619;
    h = h >>> 0;
  }
  return h % modulo;
}

/**
 * Resolve a color for `type` via the supplied palette, deterministically.
 * Empty palette returns a safe blue fallback.
 */
export function autoColor(type: string, palette: readonly string[]): string {
  if (palette.length === 0) return '#3b82f6';
  return palette[hashStringToIndex(type, palette.length)];
}

/**
 * Brighten an `#rrggbb` hex color toward white by `amount` (0..1).
 * Used for hover-state tinting so the color resolver doesn't need a
 * second hover palette. `amount=0` → unchanged, `amount=1` → white.
 */
export function brighten(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const value = parseInt(m[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const k = Math.max(0, Math.min(1, amount));
  const lift = (c: number): number => Math.round(c + (255 - c) * k);
  const rr = lift(r).toString(16).padStart(2, '0');
  const gg = lift(g).toString(16).padStart(2, '0');
  const bb = lift(b).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}
