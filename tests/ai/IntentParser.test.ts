import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { IntentParser } from '../../src/ai/IntentParser.js';

describe('IntentParser', () => {
  let store: GraphStore;
  let parser: IntentParser;

  beforeEach(() => {
    store = new GraphStore();
    parser = new IntentParser(store);
    store.addNode('1', { name: 'Adam', type: 'person', gender: 'male', aliases: ['First Man'] });
    store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
  });

  it('should extract node ids by name', () => {
    const ids = parser.extractReferencedNodeIds('Adam was the first human');
    expect(ids).toContain('1');
  });

  it('should extract node ids by alias', () => {
    const ids = parser.extractReferencedNodeIds('The First Man was created');
    expect(ids).toContain('1');
  });

  it('should extract multiple nodes', () => {
    const ids = parser.extractReferencedNodeIds('Adam and Eve lived in Eden');
    expect(ids).toContain('1');
    expect(ids).toContain('2');
  });

  it('should return empty for no matches', () => {
    const ids = parser.extractReferencedNodeIds('No biblical names here');
    expect(ids).toHaveLength(0);
  });
});
