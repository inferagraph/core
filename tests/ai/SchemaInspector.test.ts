import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { SchemaInspector, embeddingText } from '../../src/ai/SchemaInspector.js';
import type { NodeData } from '../../src/types.js';

function nodeFrom(store: GraphStore, id: string): NodeData {
  const n = store.getNode(id);
  if (!n) throw new Error(`missing node ${id}`);
  return { id: n.id, attributes: { ...n.attributes } };
}

describe('SchemaInspector', () => {
  let store: GraphStore;
  let inspector: SchemaInspector;

  beforeEach(() => {
    store = new GraphStore();
    store.addNode('1', {
      name: 'Adam',
      type: 'person',
      gender: 'male',
      era: 'Creation',
      tags: ['founder', 'first-human'],
    });
    store.addNode('2', {
      name: 'Eve',
      type: 'person',
      gender: 'female',
      era: 'Creation',
    });
    store.addNode('3', {
      name: 'Eden',
      type: 'place',
      tags: ['garden'],
      elevation: 100,
    });
    store.addNode('4', {
      name: 'Abraham',
      type: 'person',
      gender: 'male',
      era: 'Patriarchs',
    });
    inspector = new SchemaInspector(store);
  });

  describe('summary()', () => {
    it('reports the number of nodes scanned', () => {
      const s = inspector.summary();
      expect(s.nodeCount).toBe(4);
    });

    it('lists every observed attribute key in insertion order', () => {
      const s = inspector.summary();
      const keys = [...s.attributes.keys()];
      // First-seen order from node 1 (name, type, gender, era, tags) then 3 (elevation).
      expect(keys.slice(0, 5)).toEqual(['name', 'type', 'gender', 'era', 'tags']);
      expect(keys).toContain('elevation');
    });

    it('counts presentIn correctly', () => {
      const s = inspector.summary();
      expect(s.attributes.get('name')!.presentIn).toBe(4);
      expect(s.attributes.get('elevation')!.presentIn).toBe(1);
      expect(s.attributes.get('gender')!.presentIn).toBe(3);
    });

    it('reports cardinality of distinct values', () => {
      const s = inspector.summary();
      // type: person, place
      expect(s.attributes.get('type')!.cardinality).toBe(2);
      // era: Creation, Patriarchs
      expect(s.attributes.get('era')!.cardinality).toBe(2);
      // tags: founder, first-human, garden
      expect(s.attributes.get('tags')!.cardinality).toBe(3);
    });

    it('infers types from observed values', () => {
      const s = inspector.summary();
      expect(s.attributes.get('type')!.type).toBe('string');
      expect(s.attributes.get('elevation')!.type).toBe('number');
      expect(s.attributes.get('tags')!.type).toBe('array');
    });

    it('caps samples at maxSamplesPerAttribute', () => {
      const tiny = new SchemaInspector(store, { maxSamplesPerAttribute: 1 });
      const s = tiny.summary();
      expect(s.attributes.get('type')!.samples).toHaveLength(1);
      expect(s.attributes.get('type')!.cardinality).toBe(2); // cardinality unchanged
    });

    it('respects maxNodesScanned bound', () => {
      const partial = new SchemaInspector(store, { maxNodesScanned: 2 });
      const s = partial.summary();
      expect(s.nodeCount).toBe(2);
      expect(s.attributes.has('elevation')).toBe(false); // node 3 wasn't reached
    });

    it('cachedSummary returns the previously computed result', () => {
      const a = inspector.summary();
      const b = inspector.cachedSummary();
      expect(b).toBe(a);
    });

    it('invalidate() forces recomputation', () => {
      const a = inspector.summary();
      inspector.invalidate();
      const b = inspector.summary();
      expect(b).not.toBe(a);
    });
  });

  describe('embeddingTextFor', () => {
    it('renders the title first, attributes alphabetically', () => {
      const text = inspector.embeddingTextFor(nodeFrom(store, '1'));
      const lines = text.split('\n');
      expect(lines[0]).toBe('Adam');
      // Title (`name`) excluded from the body; remaining keys sorted alphabetically.
      expect(lines.slice(1)).toEqual([
        'era: Creation',
        'gender: male',
        'tags: founder, first-human',
        'type: person',
      ]);
    });

    it('falls back to node id when no title-like attribute is present', () => {
      const node: NodeData = { id: 'unnamed', attributes: { type: 'thing' } };
      const text = embeddingText(node);
      expect(text.split('\n')[0]).toBe('unnamed');
    });

    it('produces the same string regardless of attribute insertion order', () => {
      const a: NodeData = {
        id: '1',
        attributes: { name: 'A', a: '1', b: '2', c: '3' },
      };
      const b: NodeData = {
        id: '1',
        attributes: { c: '3', b: '2', name: 'A', a: '1' },
      };
      expect(embeddingText(a)).toBe(embeddingText(b));
    });

    it('joins array attributes with ", "', () => {
      const node: NodeData = {
        id: '1',
        attributes: { name: 'X', tags: ['a', 'b', 'c'] },
      };
      expect(embeddingText(node)).toContain('tags: a, b, c');
    });

    it('skips empty / null / undefined attribute values', () => {
      const node: NodeData = {
        id: '1',
        attributes: {
          name: 'X',
          empty: '',
          missing: null,
          undef: undefined as unknown as string,
        },
      };
      const text = embeddingText(node);
      expect(text).not.toContain('empty');
      expect(text).not.toContain('missing');
      expect(text).not.toContain('undef');
    });

    it('renders numbers and booleans as strings', () => {
      const node: NodeData = {
        id: '1',
        attributes: { name: 'X', age: 42, alive: true },
      };
      const text = embeddingText(node);
      expect(text).toContain('age: 42');
      expect(text).toContain('alive: true');
    });
  });
});
