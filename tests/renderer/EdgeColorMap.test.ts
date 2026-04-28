import { describe, it, expect } from 'vitest';
import {
  EdgeColorMap,
  DEFAULT_EDGE_COLOR,
} from '../../src/renderer/EdgeColorMap.js';
import {
  blendEdgeColors,
  mixHexColors,
} from '../../src/renderer/blendEdgeColors.js';
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

const ctx = (sourceColor = '#000000', targetColor = '#000000') => ({
  sourceColor,
  targetColor,
});

describe('EdgeColorMap', () => {
  describe('default palette (auto-assignment)', () => {
    const map = new EdgeColorMap();

    it('returns a deterministic color via FNV-1a hashing', () => {
      const expected = DEFAULT_PALETTE_32[
        hashStringToIndex('father_of', DEFAULT_PALETTE_32.length)
      ];
      expect(map.resolve(edge('father_of'), ctx())).toBe(expected);
    });

    it('returns the same color across calls for the same type', () => {
      const a = map.resolve(edge('married_to'), ctx());
      const b = map.resolve(edge('married_to'), ctx());
      expect(a).toBe(b);
    });

    it('returns colors from the default palette', () => {
      expect(DEFAULT_PALETTE_32).toContain(map.resolve(edge('mother_of'), ctx()));
    });
  });

  describe('explicit edgeColors map', () => {
    it('uses edgeColors when type matches', () => {
      const m = new EdgeColorMap({
        edgeColors: { father_of: '#ff00ff' },
      });
      expect(m.resolve(edge('father_of'), ctx())).toBe('#ff00ff');
    });

    it('edgeColors wins over auto-assignment', () => {
      const m = new EdgeColorMap({
        edgeColors: { father_of: '#ff00ff' },
      });
      const auto = DEFAULT_PALETTE_32[
        hashStringToIndex('father_of', DEFAULT_PALETTE_32.length)
      ];
      expect(m.resolve(edge('father_of'), ctx())).not.toBe(auto);
    });

    it('falls through to auto when edgeColors does not have the type', () => {
      const m = new EdgeColorMap({
        edgeColors: { father_of: '#ff00ff' },
      });
      const expected = DEFAULT_PALETTE_32[
        hashStringToIndex('mother_of', DEFAULT_PALETTE_32.length)
      ];
      expect(m.resolve(edge('mother_of'), ctx())).toBe(expected);
    });
  });

  describe('colorFn override', () => {
    it('colorFn wins over edgeColors and palette', () => {
      const m = new EdgeColorMap({
        colorFn: () => '#000000',
        edgeColors: { father_of: '#ff00ff' },
      });
      expect(m.resolve(edge('father_of'), ctx())).toBe('#000000');
    });

    it('falls through to edgeColors when colorFn returns undefined', () => {
      const m = new EdgeColorMap({
        colorFn: () => undefined,
        edgeColors: { father_of: '#ff00ff' },
      });
      expect(m.resolve(edge('father_of'), ctx())).toBe('#ff00ff');
    });

    it('passes the EdgeColorContext through to colorFn', () => {
      const seen: Array<{ sourceColor: string; targetColor: string }> = [];
      const m = new EdgeColorMap({
        colorFn: (_e, c) => {
          seen.push({ sourceColor: c.sourceColor, targetColor: c.targetColor });
          return undefined;
        },
      });
      m.resolve(edge('father_of'), {
        sourceColor: '#aabbcc',
        targetColor: '#112233',
      });
      expect(seen).toEqual([{ sourceColor: '#aabbcc', targetColor: '#112233' }]);
    });

    it('without colorFn falls through to the existing resolution chain', () => {
      const m = new EdgeColorMap({
        edgeColors: { father_of: '#ff00ff' },
      });
      // No colorFn — context is ignored, edgeColors wins.
      expect(
        m.resolve(edge('father_of'), { sourceColor: '#000000', targetColor: '#ffffff' }),
      ).toBe('#ff00ff');
    });

    it('legacy single-arg call still resolves via the default context', () => {
      // Backward-compat: callers that pre-date the context can still call
      // resolve(edge) and get a sensible answer (default ctx is fed in).
      const m = new EdgeColorMap({ edgeColors: { father_of: '#ff00ff' } });
      expect(m.resolve(edge('father_of'))).toBe('#ff00ff');
    });
  });

  describe('custom palette', () => {
    it('cycles when there are more types than palette colors', () => {
      const palette = ['#aaaaaa', '#bbbbbb'];
      const m = new EdgeColorMap({ palette });
      for (let i = 0; i < 5; i++) {
        expect(palette).toContain(m.resolve(edge(`rel-${i}`), ctx()));
      }
    });

    it('empty palette returns the default color', () => {
      const m = new EdgeColorMap({ palette: [] });
      expect(m.resolve(edge('mystery'), ctx())).toBe(DEFAULT_EDGE_COLOR);
    });

    it('honors a custom defaultColor', () => {
      const m = new EdgeColorMap({ palette: [], defaultColor: '#cccccc' });
      expect(m.resolve(edge('mystery'), ctx())).toBe('#cccccc');
    });
  });

  describe('hover resolution', () => {
    it('returns a brightened version of the resting color', () => {
      const m = new EdgeColorMap();
      const e = edge('father_of');
      const resting = m.resolve(e, ctx());
      expect(m.resolveHover(e, ctx())).toBe(brighten(resting, 0.25));
    });

    it('honors a custom hoverBrightness', () => {
      const m = new EdgeColorMap({ hoverBrightness: 0.5 });
      const e = edge('father_of');
      expect(m.resolveHover(e, ctx())).toBe(brighten(m.resolve(e, ctx()), 0.5));
    });
  });

  describe('introspection', () => {
    it('getPalette exposes the active palette', () => {
      const m = new EdgeColorMap();
      expect(m.getPalette()).toBe(DEFAULT_PALETTE_32);
    });
  });
});

describe('blendEdgeColors', () => {
  it('returns the source colour verbatim when both endpoints share a colour', () => {
    const result = blendEdgeColors(edge('father_of'), {
      sourceColor: '#3b82f6',
      targetColor: '#3b82f6',
    });
    // Same hex back — round-trip through the mixer is lossless when t=0.5
    // and the inputs are equal.
    expect(result).toBe('#3b82f6');
  });

  it('returns the RGB midpoint when endpoints differ', () => {
    // Pure red + pure blue → purple midpoint.
    expect(
      blendEdgeColors(edge('father_of'), {
        sourceColor: '#ff0000',
        targetColor: '#0000ff',
      }),
    ).toBe('#800080');
  });

  it('pulls each channel toward the other endpoint independently', () => {
    // Pure red + pure green → olive-ish midpoint (#808000).
    expect(
      blendEdgeColors(edge('father_of'), {
        sourceColor: '#ff0000',
        targetColor: '#00ff00',
      }),
    ).toBe('#808000');
  });
});

describe('mixHexColors', () => {
  it('respects the t weight', () => {
    // t=0 returns a, t=1 returns b, t=0.5 is the midpoint.
    expect(mixHexColors('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(mixHexColors('#ff0000', '#0000ff', 1)).toBe('#0000ff');
    expect(mixHexColors('#ff0000', '#0000ff', 0.5)).toBe('#800080');
  });

  it('accepts hex with or without leading #', () => {
    expect(mixHexColors('ff0000', '0000ff')).toBe('#800080');
  });

  it('returns the first input when either side cannot be parsed', () => {
    expect(mixHexColors('#ff0000', 'rgb(0,0,255)')).toBe('#ff0000');
    expect(mixHexColors('not-a-color', '#0000ff')).toBe('not-a-color');
  });
});
