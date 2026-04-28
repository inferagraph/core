import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PALETTE_32,
  hashStringToIndex,
  autoColor,
  brighten,
} from '../../src/renderer/palette.js';

describe('palette', () => {
  describe('DEFAULT_PALETTE_32', () => {
    it('contains exactly 32 colors', () => {
      expect(DEFAULT_PALETTE_32.length).toBe(32);
    });

    it('every entry is a 6-digit lowercase hex string', () => {
      for (const c of DEFAULT_PALETTE_32) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it('every entry is unique', () => {
      const set = new Set(DEFAULT_PALETTE_32);
      expect(set.size).toBe(DEFAULT_PALETTE_32.length);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(DEFAULT_PALETTE_32)).toBe(true);
    });
  });

  describe('hashStringToIndex', () => {
    it('is deterministic — same input → same index', () => {
      expect(hashStringToIndex('person', 32)).toBe(hashStringToIndex('person', 32));
      expect(hashStringToIndex('father_of', 32)).toBe(hashStringToIndex('father_of', 32));
    });

    it('returns an integer in [0, modulo)', () => {
      for (const t of ['person', 'place', 'event', 'father_of', 'married_to', '']) {
        const i = hashStringToIndex(t, 32);
        expect(Number.isInteger(i)).toBe(true);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(32);
      }
    });

    it('handles modulo=0 by returning 0', () => {
      expect(hashStringToIndex('anything', 0)).toBe(0);
    });

    it('different strings generally produce different indices (sanity)', () => {
      // Not a strict guarantee, but with 32 buckets and 6 distinct types
      // we should see at least 3 distinct indices.
      const indices = new Set<number>();
      for (const t of ['person', 'place', 'clan', 'group', 'event', 'item']) {
        indices.add(hashStringToIndex(t, 32));
      }
      expect(indices.size).toBeGreaterThanOrEqual(3);
    });
  });

  describe('autoColor', () => {
    it('returns a color from the palette', () => {
      const c = autoColor('person', DEFAULT_PALETTE_32);
      expect(DEFAULT_PALETTE_32).toContain(c);
    });

    it('is deterministic', () => {
      expect(autoColor('person', DEFAULT_PALETTE_32)).toBe(
        autoColor('person', DEFAULT_PALETTE_32),
      );
    });

    it('cycles when there are more types than palette colors', () => {
      const palette = ['#aaaaaa', '#bbbbbb', '#cccccc'];
      const seen = new Set<string>();
      // Ask for 33 distinct types — every one must resolve to one of the 3.
      for (let i = 0; i < 33; i++) {
        seen.add(autoColor(`type-${i}`, palette));
      }
      for (const c of seen) {
        expect(palette).toContain(c);
      }
    });

    it('empty palette returns a fallback string', () => {
      const c = autoColor('person', []);
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  describe('brighten', () => {
    it('amount=0 leaves the color unchanged (lowercased)', () => {
      expect(brighten('#3b82f6', 0)).toBe('#3b82f6');
    });

    it('amount=1 returns white', () => {
      expect(brighten('#000000', 1)).toBe('#ffffff');
      expect(brighten('#3b82f6', 1)).toBe('#ffffff');
    });

    it('amount=0.25 lifts a black 25 % toward white', () => {
      expect(brighten('#000000', 0.25)).toBe('#404040');
    });

    it('returns the input unchanged for malformed hex', () => {
      expect(brighten('not-a-color', 0.5)).toBe('not-a-color');
    });

    it('clamps amount to [0, 1]', () => {
      expect(brighten('#000000', -0.5)).toBe('#000000');
      expect(brighten('#000000', 2)).toBe('#ffffff');
    });
  });
});
