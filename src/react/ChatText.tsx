import * as React from 'react';
import { Marked, type Tokens } from 'marked';

const CITATION_RE = /\[\[([a-z0-9][a-z0-9_-]*)\]\]/gi;

/**
 * Per-instance markdown renderer. Crucially, the `html` renderer is
 * overridden to ESCAPE raw HTML rather than passing it through. This makes
 * marked itself a sanitizer (no DOM parser dependency required) and lets
 * the library run cleanly under Node-side SSR / serverless function
 * runtimes that previously crashed when `isomorphic-dompurify` pulled
 * `jsdom` → `html-encoding-sniffer` → `@exodus/bytes` (ESM-only).
 *
 * We instantiate `Marked` rather than calling `marked.use(...)` so we do
 * NOT mutate the shared global `marked` singleton — consumers using the
 * default `marked` export elsewhere are unaffected.
 */
const safeMarked = new Marked({
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(token.text);
    },
  },
});

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ChatTextProps {
  /** The streamed assistant text (may include markdown + `[[id]]` tokens). */
  text: string;
  /**
   * Callback to render a citation token. Hosts wire their slug/label/type
   * resolvers here. When omitted, the library renders the token verbatim
   * (so `[[adam]]` shows as `[[adam]]` plain-text — useful for previews
   * but consumers should always provide this in production).
   */
  renderCitation?: (token: string) => React.ReactNode;
  /** Optional className applied to the wrapping element. Lets the host theme. */
  className?: string;
}

/**
 * Render an assistant chat message. Splits the text on `[[id]]` citation
 * tokens; runs each non-citation segment through `marked.parseInline()`
 * with raw-HTML escaping; calls `renderCitation` for each token.
 *
 * Library responsibility: parse + sanitize + emit React nodes.
 * Host responsibility: CSS styling + citation-link wiring.
 */
export function ChatText(props: ChatTextProps): React.ReactElement {
  const { text, renderCitation, className } = props;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  // Construct a fresh RegExp per call so concurrent renders don't share
  // the stateful `lastIndex` cursor on the module-level constant.
  const re = new RegExp(CITATION_RE.source, CITATION_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(renderInline(text.slice(last, match.index), key++));
    }
    const token = match[1];
    nodes.push(
      <React.Fragment key={`cite-${key++}`}>
        {renderCitation ? renderCitation(token) : `[[${token}]]`}
      </React.Fragment>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    nodes.push(renderInline(text.slice(last), key++));
  }
  return <span className={className ?? 'ig-chat-text'}>{nodes}</span>;
}

function renderInline(segment: string, key: number): React.ReactNode {
  if (!segment) return null;
  const html = safeMarked.parseInline(segment, { async: false }) as string;
  return <span key={`md-${key}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
