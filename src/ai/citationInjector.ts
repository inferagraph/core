/**
 * 0.12.0 — citation injector.
 *
 * The wire format is `[[token|matched-text]]`. Both segments are required.
 *
 * Algorithm (single deterministic pass):
 *
 *  1. Strip every existing `[[...]]` occurrence from the input. Any token
 *     the model emits is treated as garbage (the system prompt no longer
 *     asks for citations). Adjacent whitespace introduced by the strip
 *     pass is collapsed to a single space — the title scan then operates
 *     on clean prose.
 *
 *  2. Build a single combined regex with title alternation, longest-first
 *     (so "Adam Smith" matches before "Adam"), case-insensitive, with
 *     `\b` whole-word anchors. JS regex alternation handles thousands of
 *     entries efficiently — adequate for biblegraph scale (~hundreds to
 *     low thousands of nodes). Hosts at 50k+ nodes should revisit with
 *     an indexed approach.
 *
 *  3. Walk every match in left-to-right order. Each match becomes
 *     `[[token|matched]]` where `matched` is the literal text from the
 *     source — preserves the model's casing/article (e.g. "the land of
 *     Nod" stays lowercase article).
 *
 *  4. Every occurrence is rewritten — not just the first.
 *
 *  5. Markdown-safe: `**Cain**` → `**[[cain|Cain]]**` because the regex
 *     matches just the word; emphasis markers stay outside the span.
 *
 *  6. Punctuation-safe: trailing punctuation falls outside `\b` so
 *     `"Cain, who"` → `"[[cain|Cain]], who"`.
 *
 *  7. Idempotent: running the function on its own output is a no-op.
 *     Step 1 strips its own previous tokens; step 3 re-creates them
 *     identically.
 *
 * Per project memory `feedback_no_backcompat_in_inferagraph` — the old
 * `[[slug]]` wire is gone. No fallback path. Hosts upgrading from
 * 0.11.x adopt the new shape on consumption.
 */

/** A `{ token, title }` pair the host wants the engine to cite. */
export interface CitationCandidate {
  /** Citation token (e.g. node.attributes.slug or node.id). */
  token: string;
  /** Display title to match in text (e.g. attributes.name/title/label). */
  title: string;
}

export function injectCitations(
  text: string,
  candidates: ReadonlyArray<CitationCandidate>,
): string {
  if (text.length === 0) return text;

  // 1. Strip every existing `[[...]]` token. Collapses adjacent whitespace
  //    runs the strip introduces (e.g. "Cain [[cain]] slew" → "Cain slew"
  //    not "Cain  slew"). Trailing/leading whitespace adjacent to the
  //    stripped span on a single side is preserved — only the gap left by
  //    the removed token plus its bracketing whitespace is normalized.
  const stripped = stripCitationTokens(text);

  if (candidates.length === 0) return stripped;

  // Filter to usable entries. Skip any candidate missing a token or
  // title — defensive guard against an upstream caller forgetting to
  // filter the source store.
  const usable: CitationCandidate[] = [];
  for (const c of candidates) {
    if (
      typeof c?.token === 'string' &&
      c.token.length > 0 &&
      typeof c?.title === 'string' &&
      c.title.length > 0
    ) {
      usable.push(c);
    }
  }
  if (usable.length === 0) return stripped;

  // 2. Sort candidates longest-title-first so the combined regex matches
  //    the longest possible alternative at any position.
  const sorted = [...usable].sort((a, b) => b.title.length - a.title.length);

  // Map title (lowercased) → token, so we can look up the token for
  // whichever alternative actually matched at a given position.
  // Multiple candidates may share a lowercased title (e.g. two nodes
  // both named "Cain"); the longest-first sort means the first entry
  // is the canonical winner.
  const titleToToken = new Map<string, string>();
  for (const c of sorted) {
    const key = c.title.toLowerCase();
    if (!titleToToken.has(key)) titleToToken.set(key, c.token);
  }

  // 3. Combined regex — `\b(t1|t2|...)\b` case-insensitive, global. Each
  //    title is regex-escaped so meta characters in the title are
  //    treated literally.
  const alternation = sorted.map((c) => escapeRegex(c.title)).join('|');
  const combined = new RegExp(`\\b(?:${alternation})\\b`, 'gi');

  // 4. Walk every match left-to-right and rebuild the output. Done in a
  //    single pass over `stripped` with an explicit cursor so the
  //    offset bookkeeping stays trivial.
  const parts: string[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = combined.exec(stripped)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    // Defend against zero-width regex pathological case (shouldn't
    // happen here because every candidate title is non-empty, but keep
    // the guard so a future change doesn't loop forever).
    if (end === start) {
      combined.lastIndex = end + 1;
      continue;
    }
    const token = titleToToken.get(m[0].toLowerCase());
    if (token === undefined) {
      // No corresponding token (shouldn't happen — every title in the
      // alternation came from a candidate). Fall through and leave the
      // matched span untouched.
      continue;
    }
    if (start > cursor) parts.push(stripped.slice(cursor, start));
    parts.push(`[[${token}|${m[0]}]]`);
    cursor = end;
  }
  if (cursor < stripped.length) parts.push(stripped.slice(cursor));
  return parts.join('');
}

// Match every `[[...]]` token. Captures the inside so the strip step can
// inspect whether the token is in the engine's own `token|matched-text`
// shape (preserve the matched text — keeps the function idempotent on
// its own output) or a bare `slug` shape from the model (drop entirely
// — the model is no longer asked to emit citations and any token it
// emits is garbage).
const STRIP_RE = /\[\[([^\]]*)\]\]/g;

/**
 * Strip pre-existing `[[...]]` occurrences from `text` while preserving
 * idempotency on the injector's own output:
 *
 *   - `[[token|matched-text]]` (engine-emitted) → replaced with the
 *     `matched-text` portion. The next scan pass re-creates the token
 *     identically.
 *   - `[[anything-else]]` (model-emitted, no pipe) → removed entirely.
 *
 * Whitespace adjacent to a fully-removed token collapses so the prose
 * stays clean (`"Cain [[cain]] slew"` → `"Cain slew"`, not
 * `"Cain  slew"`).
 */
function stripCitationTokens(text: string): string {
  if (text.indexOf('[[') === -1) return text;
  const replaced = text.replace(STRIP_RE, (_full, inside: string) => {
    const pipe = inside.indexOf('|');
    if (pipe >= 0) {
      // Engine-shape token — preserve the matched-text segment.
      return inside.slice(pipe + 1);
    }
    return '';
  });
  return replaced.replace(/[ \t]{2,}/g, ' ');
}

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(s: string): string {
  return s.replace(REGEX_META, '\\$&');
}
