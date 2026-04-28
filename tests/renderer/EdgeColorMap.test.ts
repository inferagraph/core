import { describe, it, expect } from 'vitest';
import {
  EdgeColorMap,
  DEFAULT_EDGE_COLOR,
} from '../../src/renderer/EdgeColorMap.js';
import {
  DEFAULT_PALETTE_32,
  hashStringToIndex,
  brighten,
} from '../../src/renderer/palette.js';

const edge = (type: string) => ({
  id: 'e',
  sourceId: 's',
  targetId: 't',
  attributes: { type },
});

describe('EdgeColorMap', () => {
  describe('default palette (auto-assignment)', () => {
    const map = new EdgeColorMap();

    it('returns a deterministic color via FNV-1a hashing', () => {
      const expected = DEFAULT_PALETTE_32[
        hashStringToIndex('father_of', DEFAULT_PALETTE_32.length)
      ];
      expect(map.resolve(edge('father_of'))).toBe(expected);
    });

    it('returns the same color across calls for the same type', () => {
      const a = map.resolve(edge('married_to'));
      const b = map.resolve(edge('married_to'));
      expect(a).toBe(b);
    });

    it('returns colors from the default palette', () => {
      expect(DEFAULT_PALETTE_32).toContain(map.resolve(edge('mother_of')));
    });
  });

  describe('explicit edgeColors map', () => {
    it('uses edgeColors when type matches', () => {
      const m = new EdgeColorMap({
        edgeColors: { father_of: '#ff00ff' },
      });
      expect(m.resolve(edge('father_of'))).toBe('#ff00ff');
    });

    it('edgeColors wins over auto-assignment', () => {
      const m = new EdgeColorMap({
        edgeColors: { father_of: '#ff00ff' },
      });
      const auto = DEFAULT_PALETTE_32[
        hashStringToIndex('father_of', DEFAULT_PALETTE_32.length)
      ];
      expect(m.resolve(edge('father_of'))).not.toBe(auto);
    });

    it('falls through to auto when edgeColors does not have the type', () => {
      const m = new EdgeColorMap({
        edgeColors: { father_of: '#ff00ff' },
      });
      const expected = DEFAULT_PALETTE_32[
        hashStringToIndex('mother_of', DEFAULT_PALETTE_32.length)
      ];
      expect(m.resolve(edge('mother_of'))).toBe(expected);
    });
  });

  describe('colorFn override', () => {
    it('colorFn wins over edgeColors and palette', () => {
      const m = new EdgeColorMap({
        colorFn: () => '#000000',
        edgeColors: { father_of: '#ff00ff' },
      });
      expect(m.resolve(edge('father_of'))).toBe('#000000');
    });

    it('falls through to edgeColors when colorFn returns undefined', () => {
      const m = new EdgeColorMap({
        colorFn: () => undefined,
        edgeColors: { father_of: '#ff00ff' },
      });
      expect(m.resolve(edge('father_of'))).toBe('#ff00ff');
    });
  });

  describe('custom palette', () => {
    it('cycles when there are more types than palette colors', () => {
      const palette = ['#aaaaaa', '#bbbbbb'];
      const m = new EdgeColorMap({ palette });
      for (let i = 0; i < 5; i++) {
        expect(palette).toContain(m.resolve(edge(`rel-${i}`)));
      }
    });

    it('empty palette returns the default color', () => {
      const m = new EdgeColorMap({ palette: [] });
      expect(m.resolve(edge('mystery'))).toBe(DEFAULT_EDGE_COLOR);
    });

    it('honors a custom defaultColor', () => {
      const m = new EdgeColorMap({ palette: [], defaultColor: '#cccccc' });
      expect(m.resolve(edge('mystery'))).toBe('#cccccc');
    });
  });

  describe('hover resolution', () => {
    it('returns a brightened version of the resting color', () => {
      const m = new EdgeColorMap();
      const e = edge('father_of');
      const resting = m.resolve(e);
      expect(m.resolveHover(e)).toBe(brighten(resting, 0.25));
    });

    it('honors a custom hoverBrightness', () => {
      const m = new EdgeColorMap({ hoverBrightness: 0.5 });
      const e = edge('father_of');
      expect(m.resolveHover(e)).toBe(brighten(m.resolve(e), 0.5));
    });
  });

  describe('introspection', () => {
    it('getPalette exposes the active palette', () => {
      const m = new EdgeColorMap();
      expect(m.getPalette()).toBe(DEFAULT_PALETTE_32);
    });
  });
});
