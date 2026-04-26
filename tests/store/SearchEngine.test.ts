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

  describe('custom searchableKeys', () => {
    it('should search only configured keys', () => {
      const customEngine = new SearchEngine(store, { searchableKeys: ['name'] });
      const results = customEngine.search('garden');
      expect(results).toHaveLength(0); // 'garden' is a tag, not a name
    });

    it('should prioritize earlier keys over later keys', () => {
      store.addNode('4', { name: 'garden', type: 'place', tags: ['special'] });
      const customEngine = new SearchEngine(store, { searchableKeys: ['name', 'tags'] });
      const results = customEngine.search('garden');
      // Node 4 has 'garden' as name (higher priority), node 3 has it as tag (lower priority)
      expect(results[0].nodeId).toBe('4');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('should allow reconfiguration via configure()', () => {
      engine.configure({ searchableKeys: ['type'] });
      const results = engine.search('person');
      expect(results).toHaveLength(2);
    });

    it('should search custom attribute keys', () => {
      store.addNode('5', { name: 'Test', title: 'Important Document', category: 'research' });
      const customEngine = new SearchEngine(store, { searchableKeys: ['title', 'category'] });
      const results = customEngine.search('Important');
      expect(results).toHaveLength(1);
      expect(results[0].nodeId).toBe('5');
    });
  });
});
