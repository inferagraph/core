import { GraphStore } from './GraphStore.js';
import type { SerializedGraph } from '../types.js';

export function exportGraph(store: GraphStore): string {
  return JSON.stringify(store.toJSON(), null, 2);
}

export function importGraph(store: GraphStore, json: string): void {
  const data = JSON.parse(json) as SerializedGraph;
  store.fromJSON(data);
}
