import { describe, it, expect } from 'vitest';
import { parseTTL } from '../../src/cache/parseTTL.js';

describe('parseTTL', () => {
  describe('valid input', () => {
    it('parses minute strings', () => {
      expect(parseTTL('5m')).toBe(5 * 60 * 1000);
      expect(parseTTL('1m')).toBe(60 * 1000);
    });

    it('parses hour strings', () => {
      expect(parseTTL('2h')).toBe(2 * 60 * 60 * 1000);
      expect(parseTTL('24h')).toBe(24 * 60 * 60 * 1000);
    });

    it('parses day strings', () => {
      expect(parseTTL('7d')).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('parses week strings', () => {
      expect(parseTTL('1w')).toBe(7 * 24 * 60 * 60 * 1000);
      expect(parseTTL('2w')).toBe(2 * 7 * 24 * 60 * 60 * 1000);
    });

    it('treats unit letters case-insensitively', () => {
      expect(parseTTL('5M')).toBe(parseTTL('5m'));
      expect(parseTTL('2H')).toBe(parseTTL('2h'));
      expect(parseTTL('7D')).toBe(parseTTL('7d'));
      expect(parseTTL('1W')).toBe(parseTTL('1w'));
    });

    it('passes through non-negative ms numbers unchanged', () => {
      expect(parseTTL(0)).toBe(0);
      expect(parseTTL(300_000)).toBe(300_000);
      expect(parseTTL(1)).toBe(1);
    });

    it('returns -1 for the no-limit sentinel (number form)', () => {
      expect(parseTTL(-1)).toBe(-1);
    });

    it('returns -1 for the no-limit sentinel (string form)', () => {
      expect(parseTTL('-1')).toBe(-1);
    });

    it('trims surrounding whitespace on string input', () => {
      expect(parseTTL('  5m  ')).toBe(5 * 60 * 1000);
      expect(parseTTL('  -1  ')).toBe(-1);
    });
  });

  describe('invalid input', () => {
    it('throws on bare numeric strings (no unit)', () => {
      expect(() => parseTTL('5')).toThrow();
    });

    it('throws on unsupported unit "s" (seconds)', () => {
      expect(() => parseTTL('5s')).toThrow();
    });

    it('throws on unsupported unit "y" (years)', () => {
      expect(() => parseTTL('1y')).toThrow();
    });

    it('throws on negative non-(-1) string TTLs', () => {
      expect(() => parseTTL('-5m')).toThrow();
      expect(() => parseTTL('-2h')).toThrow();
    });

    it('throws on negative non-(-1) numeric TTLs', () => {
      expect(() => parseTTL(-2)).toThrow();
      expect(() => parseTTL(-100)).toThrow();
    });

    it('throws on NaN / Infinity', () => {
      expect(() => parseTTL(Number.NaN)).toThrow();
      expect(() => parseTTL(Number.POSITIVE_INFINITY)).toThrow();
    });

    it('throws on empty string', () => {
      expect(() => parseTTL('')).toThrow();
    });

    it('throws on garbage input', () => {
      expect(() => parseTTL('abc')).toThrow();
      expect(() => parseTTL('5mm')).toThrow();
      expect(() => parseTTL('m5')).toThrow();
    });

    it('throws when given a non-number / non-string', () => {
      // @ts-expect-error -- intentionally bad input
      expect(() => parseTTL(null)).toThrow();
      // @ts-expect-error -- intentionally bad input
      expect(() => parseTTL(undefined)).toThrow();
      // @ts-expect-error -- intentionally bad input
      expect(() => parseTTL({})).toThrow();
    });
  });
});
