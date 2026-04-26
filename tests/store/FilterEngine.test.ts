import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { FilterEngine } from '../../src/store/FilterEngine.js';

describe('FilterEngine', () => {
  let store: GraphStore;
  let engine: FilterEngine;

  beforeEach(() => {
    store = new GraphStore();
    engine = new FilterEngine(store);
    store.addNode('1', { name: 'Adam', type: 'person', gender: 'male', era: 'Creation', tags: ['first human'] });
    store.addNode('2', { name: 'Eve', type: 'person', gender: 'female', era: 'Creation', tags: ['first woman'] });
    store.addNode('3', { name: 'Eden', type: 'place', era: 'Creation', tags: ['garden'] });
  });

  it('should filter by type', () => {
    expect(engine.filterByType('person')).toHaveLength(2);
    expect(engine.filterByType('place')).toHaveLength(1);
  });

  it('should filter by tag', () => {
    expect(engine.filterByTag('first human')).toHaveLength(1);
  });

  it('should filter by custom predicate', () => {
    const result = engine.filter((attrs) => (attrs.name as string).startsWith('A'));
    expect(result).toHaveLength(1);
    expect(result[0].attributes.name).toBe('Adam');
  });

  it('should return filtered node ids', () => {
    const ids = engine.filterIds((attrs) => attrs.type === 'person');
    expect(ids).toHaveLength(2);
  });

  describe('filterByAttribute', () => {
    it('should filter by any attribute key and value', () => {
      expect(engine.filterByAttribute('era', 'Creation')).toHaveLength(3);
      expect(engine.filterByAttribute('gender', 'male')).toHaveLength(1);
      expect(engine.filterByAttribute('gender', 'female')).toHaveLength(1);
    });

    it('should return empty array when no nodes match', () => {
      expect(engine.filterByAttribute('era', 'Modern')).toHaveLength(0);
    });

    it('should work with any attribute key', () => {
      store.addNode('4', { name: 'Test', category: 'research', priority: 'high' });
      expect(engine.filterByAttribute('category', 'research')).toHaveLength(1);
      expect(engine.filterByAttribute('priority', 'high')).toHaveLength(1);
    });
  });

  describe('filterByProperty (alias)', () => {
    it('should behave identically to filterByAttribute', () => {
      const byAttribute = engine.filterByAttribute('type', 'person');
      const byProperty = engine.filterByProperty('type', 'person');
      expect(byAttribute).toEqual(byProperty);
    });
  });

  describe('filterByType delegates to filterByAttribute', () => {
    it('should return same results as filterByAttribute for type', () => {
      const byType = engine.filterByType('person');
      const byAttribute = engine.filterByAttribute('type', 'person');
      expect(byType.map(n => n.id).sort()).toEqual(byAttribute.map(n => n.id).sort());
    });
  });
});
