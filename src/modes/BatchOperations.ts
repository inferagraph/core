import type { NodeId } from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';
import type { QueryEngine } from '../store/QueryEngine.js';
import type { SelectionManager } from './SelectionManager.js';

export class BatchOperations {
  constructor(
    private readonly store: GraphStore,
    private readonly queryEngine: QueryEngine,
    private readonly selection: SelectionManager
  ) {}

  /** Delete all selected nodes and their edges */
  deleteSelected(): number {
    const selected = this.selection.getSelected();
    let count = 0;
    for (const nodeId of selected) {
      if (this.store.hasNode(nodeId)) {
        this.store.removeNode(nodeId);
        count++;
      }
    }
    this.selection.clearSelection();
    return count;
  }

  /** Get the subgraph of selected nodes */
  getSelectedSubgraph(): { nodeIds: NodeId[]; edgeIds: string[] } {
    const selected = this.selection.getSelected();
    return this.queryEngine.getSubgraph(Array.from(selected));
  }

  /** Get all selected node IDs as array */
  getSelectedIds(): NodeId[] {
    return Array.from(this.selection.getSelected());
  }

  /** Check if there's any selection */
  hasSelection(): boolean {
    return this.selection.count > 0;
  }

  /** Select all provided node IDs */
  selectAllNodes(nodeIds: NodeId[]): void {
    this.selection.selectMany(nodeIds, 'replace');
  }
}
