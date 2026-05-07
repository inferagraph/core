/**
 * 0.11.0 — deterministic server-side citation injection.
 *
 * Production gpt-4o-class models routinely ignore the system-prompt rule
 * that requires `[[id]]` citation tokens after first-mentioned entities.
 * Soft prompts are not a contract — instead, after the model finishes
 * streaming, the engine scans the assistant text for first occurrences of
 * each `relevantNodes` entity's title and inserts `[[citationKey]]`
 * directly after the matched span. Citations become a guaranteed property
 * of the chat pipeline rather than something the model might forget.
 *
 * Per memory `feedback_tdd_discipline.md` — failing test FIRST.
 */

import { describe, it, expect } from 'vitest';
import { injectCitations } from '../../src/ai/citationInjector.js';
import type { NodeData } from '../../src/types.js';

function node(
  id: string,
  attrs: Record<string, unknown>,
): NodeData {
  return { id, attributes: attrs };
}

describe('injectCitations', () => {
  it('falls back to node.id when the citationKey value is missing', () => {
    const text = 'Cain slew Abel.';
    const nodes: NodeData[] = [
      node('cain-id', { name: 'Cain', type: 'person' }),
      node('abel-id', { name: 'Abel', type: 'person' }),
    ];
    const out = injectCitations(text, nodes, 'slug');
    expect(out).toBe('Cain [[cain-id]] slew Abel [[abel-id]].');
  });

  it('inserts the citation after each first-mentioned entity title', () => {
    const text = 'Cain slew Abel.';
    const nodes: NodeData[] = [
      node('uuid-cain', { name: 'Cain', slug: 'cain', type: 'person' }),
      node('uuid-abel', { name: 'Abel', slug: 'abel', type: 'person' }),
    ];
    const out = injectCitations(text, nodes, 'slug');
    expect(out).toBe('Cain [[cain]] slew Abel [[abel]].');
  });

  it('handles multi-word titles', () => {
    const text = 'Cain was banished to the Land of Nod and dwelt there.';
    const nodes: NodeData[] = [
      node('uuid-cain', { name: 'Cain', slug: 'cain', type: 'person' }),
      node('uuid-nod', {
        name: 'Land of Nod',
        slug: 'land-of-nod',
        type: 'place',
      }),
    ];
    const out = injectCitations(text, nodes, 'slug');
    expect(out).toBe(
      'Cain [[cain]] was banished to the Land of Nod [[land-of-nod]] and dwelt there.',
    );
  });

  it('matches case-insensitively and preserves the original casing', () => {
    const text = 'adam and eve dwelt in the garden.';
    const nodes: NodeData[] = [
      node('uuid-adam', { name: 'Adam', slug: 'adam', type: 'person' }),
      node('uuid-eve', { name: 'Eve', slug: 'eve', type: 'person' }),
    ];
    const out = injectCitations(text, nodes, 'slug');
    expect(out).toBe('adam [[adam]] and eve [[eve]] dwelt in the garden.');
  });

  it('cites only the FIRST occurrence of an entity', () => {
    const text = 'Cain murdered. Cain fled.';
    const nodes: NodeData[] = [
      node('uuid-cain', { name: 'Cain', slug: 'cain', type: 'person' }),
    ];
    const out = injectCitations(text, nodes, 'slug');
    expect(out).toBe('Cain [[cain]] murdered. Cain fled.');
  });

  it('leaves an already-cited entity alone but still cites the others', () => {
    const text = 'Cain [[cain]] slew Abel.';
    const nodes: NodeData[] = [
      node('uuid-cain', { name: 'Cain', slug: 'cain', type: 'person' }),
      node('uuid-abel', { name: 'Abel', slug: 'abel', type: 'person' }),
    ];
    const out = injectCitations(text, nodes, 'slug');
    expect(out).toBe('Cain [[cain]] slew Abel [[abel]].');
  });

  it('skips entities whose title does not appear in the text', () => {
    const text = 'He fled.';
    const nodes: NodeData[] = [
      node('uuid-cain', { name: 'Cain', slug: 'cain', type: 'person' }),
    ];
    const out = injectCitations(text, nodes, 'slug');
    expect(out).toBe('He fled.');
  });

  it('inserts the citation INSIDE markdown emphasis around the title', () => {
    const text = '**Cain** slew his brother.';
    const nodes: NodeData[] = [
      node('uuid-cain', { name: 'Cain', slug: 'cain', type: 'person' }),
    ];
    const out = injectCitations(text, nodes, 'slug');
    expect(out).toBe('**Cain [[cain]]** slew his brother.');
  });

  it('respects word boundaries — does not match inside a longer word', () => {
    const text = 'Caintown was named for him.';
    const nodes: NodeData[] = [
      node('uuid-cain', { name: 'Cain', slug: 'cain', type: 'person' }),
    ];
    const out = injectCitations(text, nodes, 'slug');
    expect(out).toBe('Caintown was named for him.');
  });

  it('prefers longer titles when nodes share a prefix', () => {
    const text = 'Adam Smith, an economist, succeeded Adam.';
    const nodes: NodeData[] = [
      node('uuid-adam', { name: 'Adam', slug: 'adam', type: 'person' }),
      node('uuid-adam-smith', {
        name: 'Adam Smith',
        slug: 'adam-smith',
        type: 'person',
      }),
    ];
    const out = injectCitations(text, nodes, 'slug');
    expect(out).toBe(
      'Adam Smith [[adam-smith]], an economist, succeeded Adam [[adam]].',
    );
  });

  it('returns the input unchanged for empty text or empty nodes array', () => {
    expect(injectCitations('', [], 'slug')).toBe('');
    expect(injectCitations('hello', [], 'slug')).toBe('hello');
    expect(
      injectCitations(
        '',
        [node('uuid-cain', { name: 'Cain', slug: 'cain' })],
        'slug',
      ),
    ).toBe('');
  });

  it('places the citation immediately after the title even when punctuation follows', () => {
    const text = 'Cain, who slew Abel, fled.';
    const nodes: NodeData[] = [
      node('uuid-cain', { name: 'Cain', slug: 'cain', type: 'person' }),
      node('uuid-abel', { name: 'Abel', slug: 'abel', type: 'person' }),
    ];
    const out = injectCitations(text, nodes, 'slug');
    expect(out).toBe('Cain [[cain]], who slew Abel [[abel]], fled.');
  });
});
