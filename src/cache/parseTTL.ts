/**
 * Parse a TTL value into a number of milliseconds.
 *
 * Accepts:
 *   - A non-negative number of milliseconds (e.g. `300000`).
 *   - The literal `-1` (number) or the string `'-1'` to indicate "no time limit".
 *   - A string of the form `<number><unit>` where unit is one of:
 *     `m` (minutes), `h` (hours), `d` (days), `w` (weeks).
 *     The unit is case-insensitive (`5M`, `2H` parse identically to `5m`, `2h`).
 *
 * Throws on malformed input — including bare numeric strings (no unit), unknown
 * units (notably `s` for seconds, which is intentionally not supported because
 * cache TTLs at second-granularity are an antipattern), and any negative value
 * other than `-1` / `'-1'`.
 *
 * @returns Number of milliseconds, or `-1` to signal "no time limit".
 */
export function parseTTL(input: number | string): number {
  if (typeof input === 'number') {
    if (input === -1) return -1;
    if (!Number.isFinite(input) || input < 0) {
      throw new Error(`parseTTL: invalid numeric TTL ${input}; expected non-negative ms or -1`);
    }
    return input;
  }

  if (typeof input !== 'string') {
    throw new Error(`parseTTL: expected number or string, got ${typeof input}`);
  }

  const trimmed = input.trim();
  if (trimmed === '-1') return -1;

  const match = /^(\d+)([a-zA-Z])$/.exec(trimmed);
  if (!match) {
    throw new Error(
      `parseTTL: invalid TTL "${input}"; expected "<number><unit>" with unit m/h/d/w (e.g. "5m", "2h", "7d", "1w") or -1`,
    );
  }

  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`parseTTL: invalid TTL "${input}"; numeric component must be non-negative`);
  }

  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    case 'w':
      return value * 7 * 24 * 60 * 60 * 1000;
    default:
      throw new Error(
        `parseTTL: unknown unit "${match[2]}" in "${input}"; supported units: m, h, d, w`,
      );
  }
}
