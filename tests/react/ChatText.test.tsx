import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ChatText } from '../../src/react/ChatText.js';

/**
 * Library-side chat-text rendering. The host should hand off the raw
 * assistant text + a `renderCitation` callback; the library handles
 * markdown parse + sanitize + node assembly. The host's responsibility
 * narrows to CSS styling + slug/label/type resolution.
 */

afterEach(() => {
  cleanup();
});

describe('ChatText markdown rendering', () => {
  it('renders **bold** as <strong>', () => {
    const { container } = render(
      <ChatText text="The **Garden of Eden** was paradise." />,
    );
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong).toHaveTextContent('Garden of Eden');
    expect(container.textContent ?? '').not.toContain('**');
  });

  it('renders *italic* as <em>', () => {
    const { container } = render(
      <ChatText text="A truly *radiant* place." />,
    );
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em).toHaveTextContent('radiant');
  });

  it('renders backtick-wrapped code as <code>', () => {
    const { container } = render(
      <ChatText text="The slug is `garden-of-eden`." />,
    );
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code).toHaveTextContent('garden-of-eden');
  });
});

describe('ChatText citations (0.12.0 wire — `[[token|matched-text]]`)', () => {
  it('passes (token, matchedText) to the renderCitation callback', () => {
    const renderCitation = vi.fn((token: string, matched: string) => (
      <span data-cite>{matched}</span>
    ));
    render(
      <ChatText
        text="Hello [[adam|Adam]] world"
        renderCitation={renderCitation}
      />,
    );
    expect(renderCitation).toHaveBeenCalledTimes(1);
    expect(renderCitation).toHaveBeenCalledWith('adam', 'Adam');
  });

  it('renders the matched text as plain text when renderCitation is omitted', () => {
    const { container } = render(<ChatText text="Hello [[adam|Adam]] world" />);
    const txt = container.textContent ?? '';
    expect(txt).toContain('Hello');
    expect(txt).toContain('Adam');
    expect(txt).toContain('world');
    // The wire token must not appear in the rendered text.
    expect(txt).not.toContain('[[');
    expect(txt).not.toContain(']]');
  });

  it('renders citation alongside markdown', () => {
    const renderCitation = (token: string, matched: string) => (
      <a href={`/person/${token}`}>{matched}</a>
    );
    const { container } = render(
      <ChatText
        text="**Hello** [[adam|Adam]] world"
        renderCitation={renderCitation}
      />,
    );
    expect(container.querySelector('strong')).not.toBeNull();
    expect(container.querySelector('strong')).toHaveTextContent('Hello');
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', '/person/adam');
    expect(link).toHaveTextContent('Adam');
  });

  it('preserves the model casing per match (matched text wins over the token)', () => {
    const renderCitation = (token: string, matched: string) => (
      <a href={`/person/${token}`}>{matched}</a>
    );
    const { container } = render(
      <ChatText
        text="adam [[adam|adam]] and Adam [[adam|Adam]] and ADAM [[adam|ADAM]]"
        renderCitation={renderCitation}
      />,
    );
    const links = Array.from(container.querySelectorAll('a'));
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveTextContent('adam');
    expect(links[1]).toHaveTextContent('Adam');
    expect(links[2]).toHaveTextContent('ADAM');
  });

  it('does NOT match bare `[[slug]]` tokens (no pipe = not a citation)', () => {
    // 0.12.0 dropped backwards compatibility for the bare-slug wire
    // shape. Tokens without the `|matched-text` segment fall through
    // to plain markdown and render as literal text.
    const renderCitation = vi.fn((token: string, matched: string) => (
      <a href={`/x/${token}`}>{matched}</a>
    ));
    const { container } = render(
      <ChatText text="Hello [[adam]] world" renderCitation={renderCitation} />,
    );
    expect(renderCitation).not.toHaveBeenCalled();
    expect(container.textContent ?? '').toContain('[[adam]]');
  });
});

describe('ChatText sanitization', () => {
  it('strips <script> tags', () => {
    const { container } = render(
      <ChatText text="Hello <script>alert(1)</script> there." />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<script>');
  });

  it('escapes raw <script> rather than executing or passing through', () => {
    const { container } = render(
      <ChatText text="Watch out: <script>alert(1)</script> ok?" />,
    );
    // No live script element.
    expect(container.querySelector('script')).toBeNull();
    // The rendered HTML must not contain a literal <script> open tag.
    expect(container.innerHTML).not.toContain('<script>');
    // The user-visible text should still mention the escaped marker so the
    // model's intent ("here is the markup the user typed") is preserved.
    expect(container.textContent ?? '').toContain('alert(1)');
  });

  it('neutralizes <img onerror> payloads', () => {
    const { container } = render(
      <ChatText text='Look: <img src=x onerror=alert(1)> here.' />,
    );
    // The dangerous element must not exist as a real DOM node.
    const img = container.querySelector('img');
    expect(img).toBeNull();
    // No live `<img` open-tag substring in HTML — escaped form (`&lt;img`)
    // is fine because it renders as plain text, not as a real element.
    expect(container.innerHTML).not.toContain('<img');
    // The escaped payload should be visible as plain text, not as an
    // active attribute on any element.
    const allElements = Array.from(container.querySelectorAll('*'));
    for (const el of allElements) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.toLowerCase()).not.toMatch(/^on/);
      }
    }
  });
});

describe('ChatText markdown wrapping a citation (0.12.1)', () => {
  // 0.12.0 split the text on citations FIRST, then ran marked on each
  // non-citation segment. That broke `**[[slug|text]]**` because the
  // splitter handed marked an orphan `**` on each side of the citation.
  // 0.12.1 reworks the parser to register `[[slug|text]]` as a marked
  // inline extension, so the citation lands inside the emphasis token
  // tree and renders correctly.

  const renderCitation = (token: string, matched: string) => (
    <a href={`/person/${token}`}>{matched}</a>
  );

  it('renders **[[slug|text]]** as <strong><a>text</a></strong>', () => {
    const { container } = render(
      <ChatText
        text="Bold-cited: **[[cain|Cain]]** ok."
        renderCitation={renderCitation}
      />,
    );
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    const link = strong?.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', '/person/cain');
    expect(link).toHaveTextContent('Cain');
    // No orphan asterisks survive.
    expect(container.textContent ?? '').not.toContain('**');
  });

  it('renders citation inside *italic* surrounding it', () => {
    const { container } = render(
      <ChatText
        text="*italic [[cain|Cain]] still italic*"
        renderCitation={renderCitation}
      />,
    );
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em).toHaveTextContent('italic Cain still italic');
    const link = em?.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', '/person/cain');
  });

  it('renders nested **bold *italic [[slug|text]]* bold**', () => {
    const { container } = render(
      <ChatText
        text="**bold *italic [[cain|Cain]]* bold**"
        renderCitation={renderCitation}
      />,
    );
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    const em = strong?.querySelector('em');
    expect(em).not.toBeNull();
    const link = em?.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', '/person/cain');
    expect(link).toHaveTextContent('Cain');
    expect(container.textContent ?? '').not.toContain('**');
    // The italic asterisks must also not survive as plain text.
    const visibleText = container.textContent ?? '';
    expect(visibleText).toContain('bold italic Cain bold');
  });

  it('does NOT process citations inside `code` spans (codespan is opaque)', () => {
    const renderCitationSpy = vi.fn(renderCitation);
    const { container } = render(
      <ChatText
        text="The slug is `code with [[cain|Cain]] inside`."
        renderCitation={renderCitationSpy}
      />,
    );
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    // The codespan content survives literally — no citation extraction.
    expect(code?.textContent ?? '').toContain('[[cain|Cain]]');
    // And no anchor was emitted.
    expect(container.querySelector('a')).toBeNull();
    expect(renderCitationSpy).not.toHaveBeenCalled();
  });

  it('handles plain + citation + plain + emphasis (the common shape)', () => {
    const { container } = render(
      <ChatText
        text="Hello [[cain|Cain]] world *radiant* end."
        renderCitation={renderCitation}
      />,
    );
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent('Cain');
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em).toHaveTextContent('radiant');
    expect(container.textContent ?? '').toContain('Hello ');
    expect(container.textContent ?? '').toContain(' world ');
    expect(container.textContent ?? '').toContain(' end.');
  });

  it('handles adjacent citations with text between them', () => {
    const { container } = render(
      <ChatText
        text="[[adam|Adam]] and [[eve|Eve]]"
        renderCitation={renderCitation}
      />,
    );
    const links = Array.from(container.querySelectorAll('a'));
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/person/adam');
    expect(links[0]).toHaveTextContent('Adam');
    expect(links[1]).toHaveAttribute('href', '/person/eve');
    expect(links[1]).toHaveTextContent('Eve');
  });

  it('still escapes raw HTML in input (sanitization preserved)', () => {
    const { container } = render(
      <ChatText
        text="cite [[cain|Cain]] then <script>alert(1)</script>"
        renderCitation={renderCitation}
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<script>');
    // Citation still renders.
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent('Cain');
  });
});

describe('ChatText className', () => {
  it('accepts a className override', () => {
    const { container } = render(
      <ChatText text="Hello" className="custom-class" />,
    );
    const wrapper = container.firstElementChild as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toBe('custom-class');
  });

  it('default className is "ig-chat-text"', () => {
    const { container } = render(<ChatText text="Hello" />);
    const wrapper = container.firstElementChild as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toBe('ig-chat-text');
  });
});
