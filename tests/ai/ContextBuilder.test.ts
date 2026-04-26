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

  it('should include configured contextKeys in output', () => {
    const context = builder.buildContext(['1']);
    expect(context).toContain('era: Creation');
    expect(context).toContain('tags: first human');
  });

  describe('custom configuration', () => {
    it('should use custom nameKey and typeKey', () => {
      store.addNode('3', { title: 'Eden', category: 'location' });
      const queryEngine = new QueryEngine(store);
      const customBuilder = new ContextBuilder(store, queryEngine, {
        nameKey: 'title',
        typeKey: 'category',
      });
      const context = customBuilder.buildContext(['3']);
      expect(context).toContain('Eden (location)');
    });

    it('should use custom searchKeys for query matching', () => {
      store.addNode('4', { name: 'Test', description: 'A unique search term' });
      const queryEngine = new QueryEngine(store);
      const customBuilder = new ContextBuilder(store, queryEngine, {
        searchKeys: ['description'],
      });
      const context = customBuilder.buildContextForQuery('unique search term');
      expect(context).toContain('Test');
    });

    it('should use custom contentKey', () => {
      store.addNode('5', { name: 'Doc', type: 'document', body: 'Full document body here' });
      const queryEngine = new QueryEngine(store);
      const customBuilder = new ContextBuilder(store, queryEngine, {
        contentKey: 'body',
      });
      const context = customBuilder.buildContext(['5']);
      expect(context).toContain('Full document body here');
    });

    it('should allow reconfiguration via configure()', () => {
      builder.configure({ contextKeys: ['gender'] });
      const context = builder.buildContext(['1']);
      expect(context).toContain('gender: male');
      // era and tags should no longer be in context
      expect(context).not.toContain('era:');
      expect(context).not.toContain('tags:');
    });
  });
});
