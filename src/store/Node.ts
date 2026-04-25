import type { NodeId, NodeAttributes } from '../types.js';

export class Node {
  readonly id: NodeId;
  private _attributes: NodeAttributes;

  constructor(id: NodeId, attributes: NodeAttributes) {
    this.id = id;
    this._attributes = { ...attributes };
  }

  get attributes(): NodeAttributes {
    return this._attributes;
  }

  getAttribute(key: string): unknown {
    return this._attributes[key];
  }

  setAttribute(key: string, value: unknown): void {
    this._attributes = { ...this._attributes, [key]: value };
  }
}
