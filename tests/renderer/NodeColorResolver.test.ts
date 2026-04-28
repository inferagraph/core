import { describe, it, expect } from 'vitest';
import {
  NodeColorResolver,
  DEFAULT_NODE_COLOR,
  DEFAULT_NODE_COLOR_PALETTE,
  DEFAULT_NODE_HOVER_COLOR,
  DEFAULT_NODE_HOVER_PALETTE,
} from '../../src/renderer/NodeColorResolver.js';

describe('NodeColorResolver', () => {
  describe('default palette', () => {
    const resolver = new NodeColorResolver();

    it('resolves person to mid-blue', () => {
      expect(resolver.resolve({ id: 'p', attributes: { type: 'person' } }))
        .toBe(DEFAULT_NODE_COLOR_PALETTE.person);
    });

    it('resolves place to teal', () => {
      expect(resolver.resolve({ id: 'p', attributes: { type: 'place' } }))
        .toBe(DEFAULT_NODE_COLOR_PALETTE.place);
    });

    it('resolves clan to orange', () => {
      expect(resolver.resolve({ id: 'p', attributes: { type: 'clan' } }))
        .toBe(DEFAULT_NODE_COLOR_PALETTE.clan);
    });

    it('resolves group to yellow', () => {
      expect(resolver.resolve({ id: 'p', attributes: { type: 'group' } }))
        .toBe(DEFAULT_NODE_COLOR_PALETTE.group);
    });

    it('resolves event to deep-orange', () => {
      expect(resolver.resolve({ id: 'p', attributes: { type: 'event' } }))
        .toBe(DEFAULT_NODE_COLOR_PALETTE.event);
    });

    it('falls back to default colour for unknown types', () => {
      expect(resolver.resolve({ id: 'p', attributes: { type: 'mystery' } }))
        .toBe(DEFAULT_NODE_COLOR);
    });

    it('falls back to default colour for missing type', () => {
      expect(resolver.resolve({ id: 'p', attributes: {} })).toBe(DEFAULT_NODE_COLOR);
    });

    it('falls back to default colour for null attributes', () => {
      // attributes is required by the type, but resolve must be defensive.
      expect(resolver.resolve({ id: 'p', attributes: undefined as never })).toBe(DEFAULT_NODE_COLOR);
    });
  });

  describe('explicit attribute.color', () => {
    it('uses attribute.color when no palette match', () => {
      const resolver = new NodeColorResolver();
      expect(
        resolver.resolve({ id: 'p', attributes: { type: 'mystery', color: '#abcdef' } }),
      ).toBe('#abcdef');
    });

    it('palette match wins over attribute.color', () => {
      const resolver = new NodeColorResolver();
      expect(
        resolver.resolve({ id: 'p', attributes: { type: 'person', color: '#abcdef' } }),
      ).toBe(DEFAULT_NODE_COLOR_PALETTE.person);
    });
  });

  describe('overrides', () => {
    it('colorFn wins over palette', () => {
      const resolver = new NodeColorResolver({
        colorFn: () => '#000000',
      });
      expect(resolver.resolve({ id: 'p', attributes: { type: 'person' } })).toBe('#000000');
    });

    it('custom palette overrides defaults', () => {
      const resolver = new NodeColorResolver({
        palette: { person: '#deadbe' },
      });
      expect(resolver.resolve({ id: 'p', attributes: { type: 'person' } })).toBe('#deadbe');
    });

    it('custom palette merges with defaults rather than replacing', () => {
      const resolver = new NodeColorResolver({
        palette: { custom: '#cafe00' },
      });
      // Custom key resolves
      expect(resolver.resolve({ id: 'p', attributes: { type: 'custom' } })).toBe('#cafe00');
      // Built-in key still resolves
      expect(resolver.resolve({ id: 'p', attributes: { type: 'person' } }))
        .toBe(DEFAULT_NODE_COLOR_PALETTE.person);
    });

    it('custom defaultColor takes effect on unknown types', () => {
      const resolver = new NodeColorResolver({ defaultColor: '#cccccc' });
      expect(resolver.resolve({ id: 'p', attributes: { type: 'mystery' } })).toBe('#cccccc');
    });
  });

  describe('hover resolution', () => {
    const resolver = new NodeColorResolver();

    it('resolves hover for known types', () => {
      expect(resolver.resolveHover({ id: 'p', attributes: { type: 'person' } }))
        .toBe(DEFAULT_NODE_HOVER_PALETTE.person);
      expect(resolver.resolveHover({ id: 'p', attributes: { type: 'event' } }))
        .toBe(DEFAULT_NODE_HOVER_PALETTE.event);
    });

    it('falls back to default hover colour for unknown types', () => {
      expect(resolver.resolveHover({ id: 'p', attributes: { type: 'mystery' } }))
        .toBe(DEFAULT_NODE_HOVER_COLOR);
    });

    it('honors a custom hover palette', () => {
      const r = new NodeColorResolver({
        hoverPalette: { person: '#ff00ff' },
      });
      expect(r.resolveHover({ id: 'p', attributes: { type: 'person' } })).toBe('#ff00ff');
    });
  });
});
