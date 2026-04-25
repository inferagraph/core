import type { EdgeId, NodeId, EdgeAttributes } from '../types.js';

export class Edge {
  readonly id: EdgeId;
  readonly sourceId: NodeId;
  readonly targetId: NodeId;
  private _attributes: EdgeAttributes;

  constructor(id: EdgeId, sourceId: NodeId, targetId: NodeId, attributes: EdgeAttributes) {
    this.id = id;
    this.sourceId = sourceId;
    this.targetId = targetId;
    this._attributes = { ...attributes };
  }

  get attributes(): EdgeAttributes {
    return this._attributes;
  }
}
