import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { FilterEngine } from '../../src/store/FilterEngine.js';
import { TimelineEngine } from '../../src/store/TimelineEngine.js';
import type { EraDefinition } from '../../src/types.js';

const TEST_ERAS: EraDefinition[] = [
  { name: 'Creation', startYear: -4000, endYear: -2100, description: 'Creation through the Flood' },
  { name: 'Patriarchs', startYear: -2100, endYear: -1800, description: 'Abraham, Isaac, Jacob' },
  { name: 'Exodus', startYear: -1800, endYear: -1400, description: 'Egypt, Exodus, Wilderness' },
  { name: 'Judges', startYear: -1400, endYear: -1050, description: 'Conquest and Judges period' },
  { name: 'United Kingdom', startYear: -1050, endYear: -930, description: 'Saul, David, Solomon' },
  { name: 'Divided Kingdom', startYear: -930, endYear: -586, description: 'Israel and Judah' },
  { name: 'Exile', startYear: -586, endYear: -538, description: 'Babylonian captivity' },
  { name: 'Return', startYear: -538, endYear: -400, description: 'Return and rebuilding' },
  { name: 'Intertestamental', startYear: -400, endYear: -5, description: 'Between the testaments' },
  { name: 'New Testament', startYear: -5, endYear: 100, description: 'Life of Christ and early church' },
];

function createTestStore(): GraphStore {
  const store = new GraphStore();
  store.loadData({
    nodes: [
      { id: 'adam', attributes: { name: 'Adam', type: 'person', era: 'Creation' } },
      { id: 'eve', attributes: { name: 'Eve', type: 'person', era: 'Creation' } },
      { id: 'abraham', attributes: { name: 'Abraham', type: 'person', era: 'Patriarchs' } },
      { id: 'isaac', attributes: { name: 'Isaac', type: 'person', era: 'Patriarchs' } },
      { id: 'moses', attributes: { name: 'Moses', type: 'person', era: 'Exodus' } },
      { id: 'david', attributes: { name: 'David', type: 'person', era: 'United Kingdom' } },
      { id: 'jesus', attributes: { name: 'Jesus', type: 'person', era: 'New Testament' } },
      { id: 'eden', attributes: { name: 'Eden', type: 'place' } }, // no era
    ],
    edges: [],
  });
  return store;
}

describe('TimelineEngine', () => {
  let store: GraphStore;
  let filterEngine: FilterEngine;
  let timeline: TimelineEngine;

  beforeEach(() => {
    store = createTestStore();
    filterEngine = new FilterEngine(store);
    timeline = new TimelineEngine(store, filterEngine, {
      attributeKey: 'era',
      eras: TEST_ERAS,
    });
  });

  describe('no config (defaults)', () => {
    it('should have empty eras when constructed without config', () => {
      const emptyTimeline = new TimelineEngine(store, filterEngine);
      expect(emptyTimeline.getEras()).toHaveLength(0);
    });

    it('should return undefined for getFullRange when no eras configured', () => {
      const emptyTimeline = new TimelineEngine(store, filterEngine);
      expect(emptyTimeline.getFullRange()).toBeUndefined();
    });
  });

  describe('getEras', () => {
    it('should return all 10 configured era definitions', () => {
      const eras = timeline.getEras();
      expect(eras).toHaveLength(10);
      expect(eras[0].name).toBe('Creation');
      expect(eras[9].name).toBe('New Testament');
    });

    it('should return a defensive copy', () => {
      const eras1 = timeline.getEras();
      const eras2 = timeline.getEras();
      expect(eras1).not.toBe(eras2);
    });
  });

  describe('getEra', () => {
    it('should return correct definition for Patriarchs', () => {
      const era = timeline.getEra('Patriarchs');
      expect(era).toBeDefined();
      expect(era!.name).toBe('Patriarchs');
      expect(era!.startYear).toBe(-2100);
      expect(era!.endYear).toBe(-1800);
      expect(era!.description).toBe('Abraham, Isaac, Jacob');
    });

    it('should return undefined for invalid era', () => {
      const era = timeline.getEra('NonExistent');
      expect(era).toBeUndefined();
    });
  });

  describe('getFullRange', () => {
    it('should return start: -4000 and end: 100', () => {
      const range = timeline.getFullRange();
      expect(range).toBeDefined();
      expect(range!.start).toBe(-4000);
      expect(range!.end).toBe(100);
    });
  });

  describe('getNodesByEra', () => {
    it('should return adam and eve for Creation', () => {
      const nodes = timeline.getNodesByEra('Creation');
      expect(nodes).toHaveLength(2);
      expect(nodes).toContain('adam');
      expect(nodes).toContain('eve');
    });

    it('should return empty array for era with no nodes', () => {
      const nodes = timeline.getNodesByEra('Judges');
      expect(nodes).toHaveLength(0);
    });

    it('should return abraham and isaac for Patriarchs', () => {
      const nodes = timeline.getNodesByEra('Patriarchs');
      expect(nodes).toHaveLength(2);
      expect(nodes).toContain('abraham');
      expect(nodes).toContain('isaac');
    });
  });

  describe('getNodesByTimeRange', () => {
    it('should return nodes spanning multiple eras', () => {
      // Range covers Patriarchs (-2100 to -1800) and Exodus (-1800 to -1400)
      const nodes = timeline.getNodesByTimeRange({ start: -2100, end: -1400 });
      expect(nodes).toHaveLength(3);
      expect(nodes).toContain('abraham');
      expect(nodes).toContain('isaac');
      expect(nodes).toContain('moses');
    });

    it('should return all era-tagged nodes when range covers all eras', () => {
      const nodes = timeline.getNodesByTimeRange({ start: -5000, end: 200 });
      // All nodes with an era attribute: adam, eve, abraham, isaac, moses, david, jesus
      expect(nodes).toHaveLength(7);
      expect(nodes).not.toContain('eden'); // eden has no era
    });

    it('should return empty when range matches no eras', () => {
      const nodes = timeline.getNodesByTimeRange({ start: 200, end: 300 });
      expect(nodes).toHaveLength(0);
    });

    it('should handle partial era overlap', () => {
      // Range partially overlaps Creation era (-4000 to -2100)
      const nodes = timeline.getNodesByTimeRange({ start: -3000, end: -2500 });
      expect(nodes).toHaveLength(2);
      expect(nodes).toContain('adam');
      expect(nodes).toContain('eve');
    });
  });

  describe('getErasInRange', () => {
    it('should return overlapping eras', () => {
      const eras = timeline.getErasInRange({ start: -2000, end: -1500 });
      const names = eras.map(e => e.name);
      expect(names).toContain('Patriarchs');
      expect(names).toContain('Exodus');
    });

    it('should return no eras for out-of-range', () => {
      const eras = timeline.getErasInRange({ start: 200, end: 300 });
      expect(eras).toHaveLength(0);
    });

    it('should return all eras for full range', () => {
      const eras = timeline.getErasInRange({ start: -5000, end: 200 });
      expect(eras).toHaveLength(10);
    });
  });

  describe('getEraForYear', () => {
    it('should return Patriarchs for year -2000', () => {
      const era = timeline.getEraForYear(-2000);
      expect(era).toBeDefined();
      expect(era!.name).toBe('Patriarchs');
    });

    it('should return undefined for year outside all eras', () => {
      const era = timeline.getEraForYear(500);
      expect(era).toBeUndefined();
    });

    it('should return Creation for year -4000 (start boundary inclusive)', () => {
      const era = timeline.getEraForYear(-4000);
      expect(era).toBeDefined();
      expect(era!.name).toBe('Creation');
    });

    it('should return Patriarchs for year -2100 (boundary between eras)', () => {
      // -2100 is the start of Patriarchs and end of Creation
      // With >= start and < end, -2100 belongs to Patriarchs
      const era = timeline.getEraForYear(-2100);
      expect(era).toBeDefined();
      expect(era!.name).toBe('Patriarchs');
    });
  });

  describe('getNodesOutsideRange', () => {
    it('should return nodes not in range including those without era', () => {
      // Range covers only Creation
      const outside = timeline.getNodesOutsideRange({ start: -4000, end: -2100 });
      // Inside: adam, eve (Creation)
      // Outside: abraham, isaac, moses, david, jesus (other eras) + eden (no era)
      expect(outside).toHaveLength(6);
      expect(outside).not.toContain('adam');
      expect(outside).not.toContain('eve');
      expect(outside).toContain('eden');
      expect(outside).toContain('abraham');
      expect(outside).toContain('moses');
      expect(outside).toContain('david');
      expect(outside).toContain('jesus');
    });

    it('should return only era-less nodes when range covers all eras', () => {
      const outside = timeline.getNodesOutsideRange({ start: -5000, end: 200 });
      expect(outside).toHaveLength(1);
      expect(outside).toContain('eden');
    });
  });

  describe('getTransition', () => {
    it('should show correct transition from Creation to Patriarchs', () => {
      const transition = timeline.getTransition('Creation', 'Patriarchs');
      expect(transition.disappearing).toHaveLength(2);
      expect(transition.disappearing).toContain('adam');
      expect(transition.disappearing).toContain('eve');
      expect(transition.appearing).toHaveLength(2);
      expect(transition.appearing).toContain('abraham');
      expect(transition.appearing).toContain('isaac');
      expect(transition.persisting).toHaveLength(0);
    });

    it('should show all persisting when transitioning within same era', () => {
      const transition = timeline.getTransition('Creation', 'Creation');
      expect(transition.persisting).toHaveLength(2);
      expect(transition.persisting).toContain('adam');
      expect(transition.persisting).toContain('eve');
      expect(transition.appearing).toHaveLength(0);
      expect(transition.disappearing).toHaveLength(0);
    });

    it('should show correct appearing/disappearing/persisting sets', () => {
      // Add a node that spans both eras for a more interesting test
      store.addNode('noah', { name: 'Noah', type: 'person', era: 'Creation' });

      const transition = timeline.getTransition('Creation', 'Patriarchs');
      expect(transition.disappearing).toHaveLength(3); // adam, eve, noah
      expect(transition.appearing).toHaveLength(2); // abraham, isaac
      expect(transition.persisting).toHaveLength(0);
    });

    it('should handle eras with no nodes gracefully', () => {
      const transition = timeline.getTransition('Judges', 'Exile');
      expect(transition.appearing).toHaveLength(0);
      expect(transition.disappearing).toHaveLength(0);
      expect(transition.persisting).toHaveLength(0);
    });
  });

  describe('configure', () => {
    it('should allow reconfiguring eras at runtime', () => {
      const customTimeline = new TimelineEngine(store, filterEngine);
      expect(customTimeline.getEras()).toHaveLength(0);

      customTimeline.configure({
        attributeKey: 'era',
        eras: [{ name: 'TestEra', startYear: 0, endYear: 100 }],
      });
      expect(customTimeline.getEras()).toHaveLength(1);
      expect(customTimeline.getEras()[0].name).toBe('TestEra');
    });

    it('should work with a custom attributeKey', () => {
      // Use 'period' instead of 'era'
      store.addNode('custom1', { name: 'Custom', type: 'test', period: 'Ancient' });
      const customTimeline = new TimelineEngine(store, filterEngine, {
        attributeKey: 'period',
        eras: [{ name: 'Ancient', startYear: -3000, endYear: -1000 }],
      });
      const nodes = customTimeline.getNodesByEra('Ancient');
      expect(nodes).toContain('custom1');
    });
  });
});
