import { describe, it, expect } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { describeNode } from '../../src/utils/describeNode.js';

function seedFamily(): GraphStore {
  const store = new GraphStore();
  store.addNode('abraham', { title: 'Abraham', type: 'person' });
  store.addNode('sarah', { title: 'Sarah', type: 'person' });
  store.addNode('isaac', { title: 'Isaac', type: 'person' });
  store.addNode('jacob', { title: 'Jacob', type: 'person' });
  store.addNode('esau', { title: 'Esau', type: 'person' });
  store.addEdge('e1', 'abraham', 'isaac', { type: 'father_of' });
  store.addEdge('e2', 'sarah', 'isaac', { type: 'mother_of' });
  store.addEdge('e3', 'isaac', 'jacob', { type: 'father_of' });
  store.addEdge('e4', 'isaac', 'esau', { type: 'father_of' });
  return store;
}

describe('describeNode', () => {
  it('returns natural-language descriptions when label maps are supplied', () => {
    const store = seedFamily();

    const result = describeNode(store, 'isaac', {
      incomingLabels: { father_of: 'Son of', mother_of: 'Son of' },
      outgoingLabels: { father_of: 'Father of' },
    });

    expect(result.title).toBe('Isaac');
    expect(result.lines).toContain('Son of Abraham and Sarah');
    expect(result.lines).toContain('Father of Jacob and Esau');
  });

  it('falls back to title-cased edge types when no maps supplied', () => {
    const store = seedFamily();

    const result = describeNode(store, 'isaac');

    expect(result.title).toBe('Isaac');
    // Outgoing → readable label.
    expect(result.lines.some((l) => l.includes('Father Of Jacob and Esau'))).toBe(
      true,
    );
    // Incoming gets the ← prefix so the direction is unambiguous.
    expect(result.lines.some((l) => l.startsWith('← Father Of Abraham'))).toBe(
      true,
    );
    expect(result.lines.some((l) => l.startsWith('← Mother Of Sarah'))).toBe(
      true,
    );
  });

  it('uses the title attribute, falling through to name, label, and id', () => {
    const store = new GraphStore();
    store.addNode('a', { title: 'Alpha' });
    store.addNode('b', { name: 'Beta' });
    store.addNode('c', { label: 'Gamma' });
    store.addNode('d', {});

    expect(describeNode(store, 'a').title).toBe('Alpha');
    expect(describeNode(store, 'b').title).toBe('Beta');
    expect(describeNode(store, 'c').title).toBe('Gamma');
    expect(describeNode(store, 'd').title).toBe('d');
  });

  it('returns an empty lines list when the node has no edges', () => {
    const store = new GraphStore();
    store.addNode('lonely', { title: 'Lonely' });
    expect(describeNode(store, 'lonely')).toEqual({
      title: 'Lonely',
      lines: [],
    });
  });

  it('returns the id with empty lines for an unknown node', () => {
    const store = new GraphStore();
    expect(describeNode(store, 'missing')).toEqual({
      title: 'missing',
      lines: [],
    });
  });

  it('honors a custom getName override', () => {
    const store = seedFamily();
    const result = describeNode(store, 'isaac', {
      outgoingLabels: { father_of: 'Father of' },
      getName: (n) => `[${(n.attributes.title as string) ?? n.id}]`,
    });
    expect(result.lines).toContain('Father of [Jacob] and [Esau]');
  });

  it('honors a custom getTitle override', () => {
    const store = seedFamily();
    const result = describeNode(store, 'isaac', {
      getTitle: () => 'Custom',
    });
    expect(result.title).toBe('Custom');
  });

  it('skips edges whose type is not in the supplied label maps', () => {
    const store = seedFamily();
    const result = describeNode(store, 'isaac', {
      incomingLabels: { mother_of: 'Son of' },
      // father_of intentionally omitted
    });
    expect(result.lines).toEqual(['Son of Sarah']);
  });
});
