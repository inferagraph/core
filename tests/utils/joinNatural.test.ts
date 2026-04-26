import { describe, it, expect } from 'vitest';
import { joinNatural } from '../../src/utils/joinNatural.js';

describe('joinNatural', () => {
  it('should return empty string for empty array', () => {
    expect(joinNatural([])).toBe('');
  });

  it('should return the single item for single-element array', () => {
    expect(joinNatural(['A'])).toBe('A');
  });

  it('should join two items with "and"', () => {
    expect(joinNatural(['A', 'B'])).toBe('A and B');
  });

  it('should join three items with commas and "and"', () => {
    expect(joinNatural(['A', 'B', 'C'])).toBe('A, B, and C');
  });

  it('should join four items with commas and "and"', () => {
    expect(joinNatural(['A', 'B', 'C', 'D'])).toBe('A, B, C, and D');
  });
});
