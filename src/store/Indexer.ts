import type { NodeId } from '../types.js';
import type { Node } from './Node.js';

export class Indexer {
  private byType = new Map<string, Set<NodeId>>();
  private byTag = new Map<string, Set<NodeId>>();
  private byName = new Map<string, NodeId>();

  addNode(node: Node): void {
    const { type, tags, name } = node.attributes;

    if (!this.byType.has(type)) {
      this.byType.set(type, new Set());
    }
    this.byType.get(type)!.add(node.id);

    if (tags) {
      for (const tag of tags) {
        if (!this.byTag.has(tag)) {
          this.byTag.set(tag, new Set());
        }
        this.byTag.get(tag)!.add(node.id);
      }
    }

    this.byName.set(name.toLowerCase(), node.id);
  }

  removeNode(node: Node): void {
    const { type, tags, name } = node.attributes;
    this.byType.get(type)?.delete(node.id);
    if (tags) {
      for (const tag of tags) {
        this.byTag.get(tag)?.delete(node.id);
      }
    }
    this.byName.delete(name.toLowerCase());
  }

  getByType(type: string): Set<NodeId> {
    return this.byType.get(type) ?? new Set();
  }

  getByTag(tag: string): Set<NodeId> {
    return this.byTag.get(tag) ?? new Set();
  }

  getByName(name: string): NodeId | undefined {
    return this.byName.get(name.toLowerCase());
  }

  clear(): void {
    this.byType.clear();
    this.byTag.clear();
    this.byName.clear();
  }
}
