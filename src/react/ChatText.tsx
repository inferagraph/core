import * as React from 'react';
import { Marked, type Token, type Tokens } from 'marked';

/**
 * 0.12.0 wire format: `[[token|matched-text]]`. Both segments REQUIRED.
 * Tokens lacking the `|matched-text` portion are NOT recognized — they
 * fall through and render as plain text. Per project memory
 * `feedback_no_backcompat_in_inferagraph`, the old bare-`[[slug]]` shape
 * is gone; hosts upgrading from 0.11.x adopt the new shape on
 * consumption.
 *
 * 0.12.1 registers this as a marked inline extension so citations land
 * inside the token tree (no pre-pass splitter). That fixes
 * `**[[slug|text]]**` and friends — emphasis around a citation now
 * produces a correct AST instead of orphan `**` markers.
 */
const CITATION_TOKENIZER = /^\[\[([a-z0-9][a-z0-9_-]*)\|([^\]]+)\]\]/i;

/**
 * Custom citation token. Marked's typings don't know about this so we
 * declare it locally; we narrow with a `type === 'citation'` check on
 * the generic token before reading `slug`/`matched`.
 */
interface CitationToken {
  type: 'citation';
  raw: string;
  slug: string;
  matched: string;
}

/**
 * Per-instance markdown renderer. Two extensions are registered:
 *
 *   1. The `citation` inline tokenizer above — recognizes the wire
 *      format inside any inline context (text, emphasis, link text,
 *      etc.). Codespans (`` `like this` ``) intentionally do NOT
 *      tokenize their contents, so `` `[[slug|text]]` `` renders as
 *      literal text inside `<code>`.
 *
 *   2. An `html` renderer override that escapes raw HTML rather than
 *      passing it through. This makes marked itself a sanitizer (no DOM
 *      parser dependency required) and lets the library run cleanly
 *      under Node-side SSR / serverless function runtimes that
 *      previously crashed when `isomorphic-dompurify` pulled `jsdom` →
 *      `html-encoding-sniffer` → `@exodus/bytes` (ESM-only).
 *
 * We instantiate `Marked` rather than calling `marked.use(...)` so we do
 * NOT mutate the shared global `marked` singleton — consumers using the
 * default `marked` export elsewhere are unaffected.
 */
const safeMarked = new Marked({
  extensions: [
    {
      name: 'citation',
      level: 'inline',
      start(src: string): number | undefined {
        const idx = src.indexOf('[[');
        return idx < 0 ? undefined : idx;
      },
      tokenizer(src: string): CitationToken | undefined {
        const match = CITATION_TOKENIZER.exec(src);
        if (!match) return undefined;
        return {
          type: 'citation',
          raw: match[0],
          slug: match[1],
          matched: match[2],
        };
      },
    },
  ],
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
  /**
   * The streamed assistant text. May contain markdown and the 0.12.0
   * citation wire format `[[token|matched-text]]` — both segments
   * required.
   */
  text: string;
  /**
   * Callback to render a citation token. The library passes both the
   * citation token (slug / id) and the model's exact matched text so the
   * host can render `<a href={`/<type>/${slug}`}>{matchedText}</a>` —
   * the model's casing wins.
   *
   * When omitted, the library renders `matchedText` verbatim — useful
   * for previews; consumers should always provide this in production
   * to wire up the click target.
   */
  renderCitation?: (token: string, matchedText: string) => React.ReactNode;
  /** Optional className applied to the wrapping element. Lets the host theme. */
  className?: string;
}

/**
 * Render an assistant chat message. Lexes `text` with marked's inline
 * lexer (citation extension registered), then walks the resulting token
 * tree, converting each marked token to a React node. Citation tokens
 * call `renderCitation`; raw HTML is escaped (no live elements ever
 * reach the rendered output).
 *
 * Library responsibility: parse + sanitize + emit React nodes.
 * Host responsibility: CSS styling + citation-link wiring.
 */
export function ChatText(props: ChatTextProps): React.ReactElement {
  const { text, renderCitation, className } = props;
  const tokens = safeMarked.Lexer.lexInline(text, safeMarked.defaults);
  const nodes = renderTokens(tokens, renderCitation, 'r');
  return <span className={className ?? 'ig-chat-text'}>{nodes}</span>;
}

/** Type-guard for the custom citation token. */
function isCitationToken(token: Token): token is CitationToken {
  return (
    (token as { type?: string }).type === 'citation' &&
    typeof (token as Partial<CitationToken>).slug === 'string' &&
    typeof (token as Partial<CitationToken>).matched === 'string'
  );
}

/**
 * Walk a flat list of marked inline tokens, returning a React node array.
 * `keyPrefix` namespaces React keys per recursion level so sibling
 * subtrees don't collide.
 */
function renderTokens(
  tokens: readonly Token[],
  renderCitation: ChatTextProps['renderCitation'],
  keyPrefix: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    out.push(renderToken(tokens[i], renderCitation, `${keyPrefix}-${i}`));
  }
  return out;
}

/**
 * Convert a single marked token to a React node. Unrecognized token
 * types fall back to their `raw` string so nothing the lexer produced is
 * silently dropped.
 */
function renderToken(
  token: Token,
  renderCitation: ChatTextProps['renderCitation'],
  key: string,
): React.ReactNode {
  if (isCitationToken(token)) {
    return (
      <React.Fragment key={`cite-${key}`}>
        {renderCitation
          ? renderCitation(token.slug, token.matched)
          : token.matched}
      </React.Fragment>
    );
  }
  switch (token.type) {
    case 'text': {
      const t = token as Tokens.Text;
      // Inline text tokens may carry a child token list (e.g. when an
      // extension produced sub-tokens). Walk children when present;
      // otherwise emit the literal text.
      if (t.tokens && t.tokens.length > 0) {
        return (
          <React.Fragment key={`txt-${key}`}>
            {renderTokens(t.tokens, renderCitation, key)}
          </React.Fragment>
        );
      }
      return <React.Fragment key={`txt-${key}`}>{t.text}</React.Fragment>;
    }
    case 'escape': {
      const t = token as Tokens.Escape;
      return <React.Fragment key={`esc-${key}`}>{t.text}</React.Fragment>;
    }
    case 'strong': {
      const t = token as Tokens.Strong;
      return (
        <strong key={`strong-${key}`}>
          {renderTokens(t.tokens, renderCitation, key)}
        </strong>
      );
    }
    case 'em': {
      const t = token as Tokens.Em;
      return (
        <em key={`em-${key}`}>
          {renderTokens(t.tokens, renderCitation, key)}
        </em>
      );
    }
    case 'del': {
      const t = token as Tokens.Del;
      return (
        <del key={`del-${key}`}>
          {renderTokens(t.tokens, renderCitation, key)}
        </del>
      );
    }
    case 'codespan': {
      const t = token as Tokens.Codespan;
      // Codespans are opaque — citations inside `code` MUST render
      // literally, never as anchors.
      return <code key={`code-${key}`}>{decodeEntities(t.text)}</code>;
    }
    case 'link': {
      const t = token as Tokens.Link;
      return (
        <a key={`a-${key}`} href={t.href} title={t.title ?? undefined}>
          {renderTokens(t.tokens, renderCitation, key)}
        </a>
      );
    }
    case 'br':
      return <br key={`br-${key}`} />;
    case 'html': {
      const t = token as Tokens.HTML | Tokens.Tag;
      // Sanitization: raw HTML in input is rendered as ESCAPED text,
      // never as a live DOM element. Preserves the 0.10.3 fix that
      // dropped `isomorphic-dompurify`.
      return (
        <React.Fragment key={`html-${key}`}>
          {escapeHtml(t.text)}
        </React.Fragment>
      );
    }
    default: {
      // Unknown token (e.g. image, autolink, ...). marked guarantees a
      // `raw` field; emit it so nothing disappears silently.
      const raw = (token as { raw?: string }).raw;
      if (typeof raw === 'string' && raw.length > 0) {
        return <React.Fragment key={`raw-${key}`}>{raw}</React.Fragment>;
      }
      return null;
    }
  }
}

/**
 * marked's inline lexer occasionally emits `&amp;` / `&lt;` etc. inside
 * codespan `text` (HTML-safe encoding). Reverse those before handing
 * the literal back to React, otherwise the user sees `&amp;` instead of
 * `&` inside code spans.
 */
function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
