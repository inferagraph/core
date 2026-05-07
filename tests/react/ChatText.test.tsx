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

describe('ChatText citations', () => {
  it('passes [[token]] to the renderCitation callback', () => {
    const renderCitation = vi.fn((token: string) => <span data-cite>{token}</span>);
    render(
      <ChatText text="Hello [[adam]] world" renderCitation={renderCitation} />,
    );
    expect(renderCitation).toHaveBeenCalledTimes(1);
    expect(renderCitation).toHaveBeenCalledWith('adam');
  });

  it('renders [[token]] as literal text when renderCitation is omitted', () => {
    const { container } = render(<ChatText text="Hello [[adam]] world" />);
    expect(container.textContent ?? '').toContain('[[adam]]');
  });

  it('renders citation alongside markdown', () => {
    const renderCitation = (token: string) => (
      <a href={`/person/${token}`}>{token}</a>
    );
    const { container } = render(
      <ChatText
        text="**Hello** [[adam]] world"
        renderCitation={renderCitation}
      />,
    );
    expect(container.querySelector('strong')).not.toBeNull();
    expect(container.querySelector('strong')).toHaveTextContent('Hello');
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', '/person/adam');
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
