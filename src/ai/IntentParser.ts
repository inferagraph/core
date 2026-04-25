import type { NodeId } from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';

export class IntentParser {
  constructor(private readonly store: GraphStore) {}

  extractReferencedNodeIds(response: string): NodeId[] {
    const nodeIds: NodeId[] = [];
    const allNodes = this.store.getAllNodes();

    for (const node of allNodes) {
      const { name, aliases } = node.attributes;
      if (response.toLowerCase().includes(name.toLowerCase())) {
        nodeIds.push(node.id);
      }
      if (aliases) {
        for (const alias of aliases) {
          if (response.toLowerCase().includes(alias.toLowerCase())) {
            if (!nodeIds.includes(node.id)) {
              nodeIds.push(node.id);
            }
          }
        }
      }
    }

    return nodeIds;
  }
}
