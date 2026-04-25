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

  it('should filter by era', () => {
    expect(engine.filterByEra('Creation')).toHaveLength(3);
  });

  it('should filter by gender', () => {
    expect(engine.filterByGender('male')).toHaveLength(1);
    expect(engine.filterByGender('female')).toHaveLength(1);
  });

  it('should filter by custom predicate', () => {
    const result = engine.filter((attrs) => attrs.name.startsWith('A'));
    expect(result).toHaveLength(1);
    expect(result[0].attributes.name).toBe('Adam');
  });

  it('should return filtered node ids', () => {
    const ids = engine.filterIds((attrs) => attrs.type === 'person');
    expect(ids).toHaveLength(2);
  });
});
