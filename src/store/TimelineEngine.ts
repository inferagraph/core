import type { EraDefinition, TimeRange, NodeId } from '../types.js';
import type { GraphStore } from './GraphStore.js';
import { FilterEngine } from './FilterEngine.js';

export interface TimelineConfig {
  /** Attribute key that holds the era/time period name on nodes */
  attributeKey: string;
  /** Era definitions provided by the hosting app */
  eras: EraDefinition[];
}

export class TimelineEngine {
  private config: TimelineConfig;
  private readonly filterEngine: FilterEngine;

  constructor(
    _store: GraphStore,
    filterEngine: FilterEngine,
    config?: TimelineConfig,
  ) {
    this.filterEngine = filterEngine;
    this.config = config ?? { attributeKey: 'era', eras: [] };
  }

  configure(config: Partial<TimelineConfig>): void {
    Object.assign(this.config, config);
  }

  /** Get all era definitions */
  getEras(): EraDefinition[] {
    return [...this.config.eras];
  }

  /** Get definition for a specific era */
  getEra(name: string): EraDefinition | undefined {
    return this.config.eras.find((e) => e.name === name);
  }

  /** Get the full time range (min year to max year), undefined if no eras configured */
  getFullRange(): TimeRange | undefined {
    if (this.config.eras.length === 0) return undefined;
    return {
      start: this.config.eras[0].startYear,
      end: this.config.eras[this.config.eras.length - 1].endYear,
    };
  }

  /** Get node IDs that belong to a specific era */
  getNodesByEra(era: string): NodeId[] {
    return this.filterEngine
      .filterByAttribute(this.config.attributeKey, era)
      .map((n) => n.id);
  }

  /** Get node IDs within a time range (matches any era that overlaps the range) */
  getNodesByTimeRange(range: TimeRange): NodeId[] {
    const matchingEras = this.config.eras.filter(
      (e) => e.startYear < range.end && e.endYear > range.start,
    );
    const nodeIds = new Set<NodeId>();
    for (const era of matchingEras) {
      for (const node of this.filterEngine.filterByAttribute(
        this.config.attributeKey,
        era.name,
      )) {
        nodeIds.add(node.id);
      }
    }
    return Array.from(nodeIds);
  }

  /** Get eras that overlap a time range */
  getErasInRange(range: TimeRange): EraDefinition[] {
    return this.config.eras.filter(
      (e) => e.startYear < range.end && e.endYear > range.start,
    );
  }

  /** Get the era for a given year */
  getEraForYear(year: number): EraDefinition | undefined {
    return this.config.eras.find(
      (e) => year >= e.startYear && year < e.endYear,
    );
  }

  /** Get node IDs that are NOT in the given time range (for hiding/fading) */
  getNodesOutsideRange(range: TimeRange): NodeId[] {
    const insideNodes = new Set(this.getNodesByTimeRange(range));
    const outsideNodes: NodeId[] = [];
    const allNodes = this.filterEngine.filter(() => true);
    for (const node of allNodes) {
      if (!insideNodes.has(node.id)) {
        outsideNodes.push(node.id);
      }
    }
    return outsideNodes;
  }

  /** Get transition data between two eras (which nodes appear, disappear, persist) */
  getTransition(
    fromEra: string,
    toEra: string,
  ): {
    appearing: NodeId[];
    disappearing: NodeId[];
    persisting: NodeId[];
  } {
    const fromNodes = new Set(this.getNodesByEra(fromEra));
    const toNodes = new Set(this.getNodesByEra(toEra));

    const appearing: NodeId[] = [];
    const disappearing: NodeId[] = [];
    const persisting: NodeId[] = [];

    for (const id of toNodes) {
      if (fromNodes.has(id)) persisting.push(id);
      else appearing.push(id);
    }
    for (const id of fromNodes) {
      if (!toNodes.has(id)) disappearing.push(id);
    }

    return { appearing, disappearing, persisting };
  }
}
