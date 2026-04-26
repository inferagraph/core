/**
 * Join an array of strings with commas and "and" for natural English.
 * - [] → ''
 * - ['A'] → 'A'
 * - ['A', 'B'] → 'A and B'
 * - ['A', 'B', 'C'] → 'A, B, and C'
 */
export function joinNatural(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
