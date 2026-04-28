import { describe, it, expect } from 'vitest';
import {
  NodeColorResolver,
  DEFAULT_NODE_COLOR,
} from '../../src/renderer/NodeColorResolver.js';
import {
  DEFAULT_PALETTE_32,
  hashStringToIndex,
  brighten,
} from '../../src/renderer/palette.js';

describe('NodeColorResolver', () => {
  describe('default palette (auto-assignment)', () => {
    const resolver = new NodeColorResolver();

    it('returns a deterministic color for a given type via FNV-1a hashing', () => {
      const expected = DEFAULT_PALETTE_32[hashStringToIndex('person', DEFAULT_PALETTE_32.length)];
      expect(resolver.resolve({ id: 'p', attributes: { type: 'person' } })).toBe(expected);
    });

    it('returns the same color across calls for the same type', () => {
      const a = resolver.resolve({ id: 'a', attributes: { type: 'person' } });
      const b = resolver.resolve({ id: 'b', attributes: { type: 'person' } });
      expect(a).toBe(b);
    });

    it('returns colors from the default 32-color palette', () => {
      const c = resolver.resolve({ id: 'p', attributes: { type: 'place' } });
      expect(DEFAULT_PALETTE_32).toContain(c);
    });

    it('falls back to defaultColor when no type attribute is present', () => {
      // Empty palette guarantees we hit the default-color branch.
      const r = new NodeColorResolver({ palette: [] });
      expect(r.resolve({ id: 'p', attributes: {} })).toBe(DEFAULT_NODE_COLOR);
    });

    it('survives undefined attributes (defensive)', () => {
      expect(
        resolver.resolve({ id: 'p', attributes: undefined as never }),
      ).toBeTypeOf('string');
    });
  });

  describe('explicit type→color map', () => {
    it('uses nodeColors when type matches', () => {
      const r = new NodeColorResolver({
        nodeColors: { person: '#ff00ff' },
      });
      expect(r.resolve({ id: 'p', attributes: { type: 'person' } })).toBe('#ff00ff');
    });

    it('nodeColors wins over auto-assignment', () => {
      const r = new NodeColorResolver({
        nodeColors: { person: '#ff00ff' },
      });
      const auto = DEFAULT_PALETTE_32[
        hashStringToIndex('person', DEFAULT_PALETTE_32.length)
      ];
      expect(r.resolve({ id: 'p', attributes: { type: 'person' } })).not.toBe(auto);
    });

    it('falls through to auto when nodeColors does not have the type', () => {
      const r = new NodeColorResolver({
        nodeColors: { person: '#ff00ff' },
      });
      const expected = DEFAULT_PALETTE_32[
        hashStringToIndex('place', DEFAULT_PALETTE_32.length)
      ];
      expect(r.resolve({ id: 'p', attributes: { type: 'place' } })).toBe(expected);
    });
  });

  describe('explicit attribute.color', () => {
    it('uses attribute.color when no nodeColors entry matches and palette is empty', () => {
      const r = new NodeColorResolver({ palette: [] });
      expect(
        r.resolve({ id: 'p', attributes: { type: 'mystery', color: '#abcdef' } }),
      ).toBe('#abcdef');
    });

    it('nodeColors entry wins over attribute.color', () => {
      const r = new NodeColorResolver({ nodeColors: { person: '#111111' } });
      expect(
        r.resolve({ id: 'p', attributes: { type: 'person', color: '#abcdef' } }),
      ).toBe('#111111');
    });
  });

  describe('colorFn override', () => {
    it('colorFn wins over nodeColors and palette', () => {
      const r = new NodeColorResolver({
        colorFn: () => '#000000',
        nodeColors: { person: '#ff00ff' },
      });
      expect(r.resolve({ id: 'p', attributes: { type: 'person' } })).toBe('#000000');
    });

    it('falls through to nodeColors when colorFn returns undefined', () => {
      const r = new NodeColorResolver({
        colorFn: () => undefined,
        nodeColors: { person: '#ff00ff' },
      });
      expect(r.resolve({ id: 'p', attributes: { type: 'person' } })).toBe('#ff00ff');
    });
  });

  describe('custom palette', () => {
    it('cycles deterministically when there are more types than colors', () => {
      const palette = ['#aaaaaa', '#bbbbbb'];
      const r = new NodeColorResolver({ palette });
      const types = ['type-1', 'type-2', 'type-3', 'type-4', 'type-5'];
      for (const t of types) {
        const got = r.resolve({ id: 't', attributes: { type: t } });
        expect(palette).toContain(got);
      }
    });

    it('empty palette + no other match returns defaultColor', () => {
      const r = new NodeColorResolver({ palette: [] });
      expect(r.resolve({ id: 'p', attributes: { type: 'mystery' } })).toBe(DEFAULT_NODE_COLOR);
    });

    it('honors a custom defaultColor', () => {
      const r = new NodeColorResolver({ palette: [], defaultColor: '#cccccc' });
      expect(r.resolve({ id: 'p', attributes: { type: 'mystery' } })).toBe('#cccccc');
    });
  });

  describe('hover resolution (brightness lift)', () => {
    it('returns a brightened version of the resting color', () => {
      const r = new NodeColorResolver();
      const node = { id: 'p', attributes: { type: 'person' } };
      const resting = r.resolve(node);
      const hover = r.resolveHover(node);
      expect(hover).toBe(brighten(resting, 0.25));
      expect(hover).not.toBe(resting);
    });

    it('honors a custom hoverBrightness', () => {
      const r = new NodeColorResolver({ hoverBrightness: 0.5 });
      const node = { id: 'p', attributes: { type: 'person' } };
      expect(r.resolveHover(node)).toBe(brighten(r.resolve(node), 0.5));
    });

    it('hover lift respects custom palette / nodeColors', () => {
      const r = new NodeColorResolver({ nodeColors: { person: '#000000' } });
      // 25 % toward white: (0,0,0) → (64,64,64) → #404040.
      expect(r.resolveHover({ id: 'p', attributes: { type: 'person' } })).toBe('#404040');
    });
  });

  describe('introspection', () => {
    it('getPalette exposes the active palette', () => {
      const r = new NodeColorResolver();
      expect(r.getPalette()).toBe(DEFAULT_PALETTE_32);
    });
  });
});
