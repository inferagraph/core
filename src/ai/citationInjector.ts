import type { NodeData } from '../types.js';

/**
 * Insert `[[citationKey]]` tokens into model-generated text after the first
 * occurrence of each entity's title. Used by {@link AIEngine.chat} to make
 * citations a guaranteed property of the chat output rather than relying
 * on the model to remember the system-prompt rule.
 *
 * Algorithm summary (kept deterministic so production gpt-4o-class
 * responses always surface as cited):
 *
 *   - Pick a citation token per node: `[[<value>]]` where `<value>` is
 *     `node.attributes[citationKey]` (string, non-empty) or `node.id`.
 *   - Pick a display title per node via {@link pickTitle} — same precedence
 *     the rest of the engine uses (`name`, then `title`, then `label`,
 *     fall back to `node.id`).
 *   - Process nodes longest-title-first so prefix-overlapping titles
 *     ("Adam" vs. "Adam Smith") inject in the right order — never
 *     break a longer name into `Adam [[adam]] Smith`.
 *   - For each node, find the FIRST whole-word, case-insensitive match
 *     of the title in `text`. Insert the token directly after the matched
 *     span (with a single leading space). Skip the node when the title
 *     is absent OR when the next non-space tokens are already
 *     `[[<token>]]` (the model already cited it).
 *   - Word boundary: standard `\b`. Multi-word titles work because `\b`
 *     anchors only the first and last characters of the regex; interior
 *     whitespace is matched verbatim against the input.
 *
 * @param text  The full assistant text after streaming completes.
 * @param nodes Relevant nodes for this turn (catalog).
 * @param citationKey  Attribute key that names each node's citation token.
 * @returns The text with citations inserted (may equal `text` when nothing changed).
 */
export function injectCitations(
  text: string,
  nodes: ReadonlyArray<NodeData>,
  citationKey: string,
): string {
  if (text.length === 0 || nodes.length === 0) return text;

  // Build the per-node injection plan: { title, token, length }. Longer
  // titles run first so a "Adam Smith" injection happens before "Adam".
  const candidates = nodes
    .map((node) => {
      const attrs = node.attributes ?? {};
      const title = pickTitle(attrs) ?? node.id;
      if (typeof title !== 'string' || title.length === 0) return undefined;
      const raw = attrs[citationKey];
      const token =
        typeof raw === 'string' && raw.length > 0 ? raw : node.id;
      return { title, token };
    })
    .filter(
      (entry): entry is { title: string; token: string } => entry !== undefined,
    )
    .sort((a, b) => b.title.length - a.title.length);

  // Track occupied ranges in the ORIGINAL-text coordinate system. When a
  // shorter title (e.g. "Adam") would match inside the span of a previously
  // injected longer title (e.g. "Adam Smith"), the shorter match is
  // suppressed so we don't break the longer name into
  // `Adam [[adam]] Smith`.
  interface Occupied {
    start: number;
    end: number;
  }
  const occupied: Occupied[] = [];

  // Match against the immutable original-text coordinate system, then
  // rebuild the output once with all accepted insertions applied in
  // left-to-right order. This keeps offset math trivial (no running delta).
  const original = text;
  interface Insertion {
    /** End offset (exclusive) in the original text — token goes here. */
    originalEnd: number;
    text: string;
  }
  const insertions: Insertion[] = [];

  for (const { title, token } of candidates) {
    const regex = buildTitleRegex(title);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(original)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      // Skip matches that fall inside a previously processed longer title.
      const insideLonger = occupied.some(
        (r) => start >= r.start && end <= r.end,
      );
      if (insideLonger) {
        // exec with the `g` flag advances `lastIndex` automatically so the
        // next iteration searches AFTER this match. Without the `g` flag
        // exec restarts from the beginning, which would loop forever.
        continue;
      }
      // Detect "model already cited this entity here" by looking at the
      // text immediately after the match in `original`.
      const after = original.slice(end);
      const expected = `[[${token}]]`;
      const alreadyCited =
        after.startsWith(` ${expected}`) || after.startsWith(expected);
      occupied.push({ start, end });
      if (!alreadyCited) {
        insertions.push({ originalEnd: end, text: ` ${expected}` });
      }
      break;
    }
  }

  insertions.sort((a, b) => a.originalEnd - b.originalEnd);
  if (insertions.length === 0) return original;
  const parts: string[] = [];
  let cursor = 0;
  for (const ins of insertions) {
    parts.push(original.slice(cursor, ins.originalEnd));
    parts.push(ins.text);
    cursor = ins.originalEnd;
  }
  parts.push(original.slice(cursor));
  return parts.join('');
}

/**
 * Internal title precedence helper. MUST stay in sync with the
 * `pickTitleAttribute` helper inside `AIEngine.ts` — both use the same
 * key order so the injected citation always lands on the same display
 * surface the catalog block advertises.
 */
function pickTitle(attrs: Record<string, unknown>): string | undefined {
  for (const key of ['name', 'title', 'label']) {
    const v = attrs[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(s: string): string {
  return s.replace(REGEX_META, '\\$&');
}

/**
 * Build a case-insensitive whole-word regex matching `title` exactly.
 * Multi-word titles work because the boundary anchors only constrain the
 * first and last characters. Whitespace inside the title matches verbatim.
 */
function buildTitleRegex(title: string): RegExp {
  // `g` is required so `regex.exec()` advances `lastIndex` between calls
  // — that lets the matcher fall through to a later match when the first
  // one falls inside an already-occupied range.
  return new RegExp(`\\b${escapeRegex(title)}\\b`, 'gi');
}
