import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { SearchEngine } from '../../src/store/SearchEngine.js';

describe('SearchEngine', () => {
  let store: GraphStore;
  let engine: SearchEngine;

  beforeEach(() => {
    store = new GraphStore();
    engine = new SearchEngine(store);
    store.addNode('1', { name: 'Adam', type: 'person', gender: 'male', aliases: ['First Man'], content: 'The first human created by God' });
    store.addNode('2', { name: 'Eve', type: 'person', gender: 'female', content: 'The first woman' });
    store.addNode('3', { name: 'Eden', type: 'place', tags: ['garden', 'paradise'] });
  });

  it('should find by exact name', () => {
    const results = engine.search('Adam');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].nodeId).toBe('1');
  });

  it('should find by alias', () => {
    const results = engine.search('First Man');
    expect(results.some((r) => r.nodeId === '1')).toBe(true);
  });

  it('should find by tag', () => {
    const results = engine.search('garden');
    expect(results.some((r) => r.nodeId === '3')).toBe(true);
  });

  it('should find by content', () => {
    const results = engine.search('created by God');
    expect(results.some((r) => r.nodeId === '1')).toBe(true);
  });

  it('should sort by relevance', () => {
    const results = engine.search('Adam');
    expect(results[0].score).toBeGreaterThanOrEqual(results[results.length - 1].score);
  });

  it('should return empty for no matches', () => {
    expect(engine.search('xyznonexistent')).toHaveLength(0);
  });
});
