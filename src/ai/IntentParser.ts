import type { NodeId } from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';

export interface IntentParserConfig {
  /** Attribute key for node name */
  nameKey: string;
  /** Attribute key for aliases array */
  aliasesKey: string;
}

export class IntentParser {
  private config: IntentParserConfig;

  constructor(
    private readonly store: GraphStore,
    config?: Partial<IntentParserConfig>,
  ) {
    this.config = {
      nameKey: config?.nameKey ?? 'name',
      aliasesKey: config?.aliasesKey ?? 'aliases',
    };
  }

  configure(config: Partial<IntentParserConfig>): void {
    Object.assign(this.config, config);
  }

  extractReferencedNodeIds(response: string): NodeId[] {
    const nodeIds: NodeId[] = [];
    const allNodes = this.store.getAllNodes();
    const lowerResponse = response.toLowerCase();

    for (const node of allNodes) {
      const name = node.attributes[this.config.nameKey];
      if (typeof name === 'string' && lowerResponse.includes(name.toLowerCase())) {
        nodeIds.push(node.id);
        continue;
      }

      const aliases = node.attributes[this.config.aliasesKey];
      if (Array.isArray(aliases)) {
        let found = false;
        for (const alias of aliases) {
          if (
            typeof alias === 'string' &&
            lowerResponse.includes(alias.toLowerCase())
          ) {
            if (!nodeIds.includes(node.id)) {
              nodeIds.push(node.id);
            }
            found = true;
            break;
          }
        }
        if (found) continue;
      }
    }

    return nodeIds;
  }
}
