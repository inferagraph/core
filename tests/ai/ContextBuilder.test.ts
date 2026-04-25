import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { ContextBuilder } from '../../src/ai/ContextBuilder.js';

describe('ContextBuilder', () => {
  let store: GraphStore;
  let builder: ContextBuilder;

  beforeEach(() => {
    store = new GraphStore();
    const queryEngine = new QueryEngine(store);
    builder = new ContextBuilder(store, queryEngine);
    store.addNode('1', { name: 'Adam', type: 'person', gender: 'male', era: 'Creation', tags: ['first human'] });
    store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
    store.addEdge('e1', '1', '2', { type: 'husband_of' });
  });

  it('should build context for node ids', () => {
    const context = builder.buildContext(['1']);
    expect(context).toContain('Adam');
    expect(context).toContain('person');
    expect(context).toContain('husband_of');
  });

  it('should build context for query', () => {
    const context = builder.buildContextForQuery('Adam');
    expect(context).toContain('Adam');
    expect(context).toContain('Eve');
  });

  it('should return empty for unknown nodes', () => {
    const context = builder.buildContext(['nonexistent']);
    expect(context.trim()).toBe('');
  });
});
