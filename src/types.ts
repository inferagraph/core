/** Unique identifier for a node */
export type NodeId = string;

/** Unique identifier for an edge */
export type EdgeId = string;

/** Node type categories */
export type NodeType = 'person' | 'place' | 'clan' | 'group' | 'event';

/** Gender for person nodes */
export type Gender = 'male' | 'female' | 'unknown';

/** Biblical era */
export type Era =
  | 'Creation'
  | 'Patriarchs'
  | 'Exodus'
  | 'Judges'
  | 'United Kingdom'
  | 'Divided Kingdom'
  | 'Exile'
  | 'Return'
  | 'Intertestamental'
  | 'New Testament';

/** Scripture reference */
export interface ScriptureReference {
  book: string;
  startChapter: number;
  startVerse: number;
  endChapter?: number;
  endVerse?: number;
}

/** Node attributes */
export interface NodeAttributes {
  name: string;
  type: NodeType;
  aliases?: string[];
  gender?: Gender;
  era?: Era;
  references?: ScriptureReference[];
  tags?: string[];
  content?: string;
  [key: string]: unknown;
}

/** Edge attributes */
export interface EdgeAttributes {
  type: string;
  [key: string]: unknown;
}

/** Serialized node data for input */
export interface NodeData {
  id: NodeId;
  attributes: NodeAttributes;
}

/** Serialized edge data for input */
export interface EdgeData {
  id: EdgeId;
  sourceId: NodeId;
  targetId: NodeId;
  attributes: EdgeAttributes;
}

/** Graph data for bulk loading */
export interface GraphData {
  nodes: NodeData[];
  edges: EdgeData[];
}

/** 3D position vector */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/** Filter predicate function */
export type FilterPredicate = (attributes: NodeAttributes) => boolean;

/** Search result */
export interface SearchResult {
  nodeId: NodeId;
  score: number;
  matches: string[];
}

/** LLM message role */
export type MessageRole = 'system' | 'user' | 'assistant';

/** LLM message */
export interface LLMMessage {
  role: MessageRole;
  content: string;
}

/** LLM completion request */
export interface LLMCompletionRequest {
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
}

/** LLM completion response */
export interface LLMCompletionResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** AI query result */
export interface AIQueryResult {
  answer: string;
  highlightedNodeIds: NodeId[];
  context: string;
}

/** Layout mode */
export type LayoutMode = 'graph' | 'tree';

/** InferaGraph configuration */
export interface InferaGraphConfig {
  container: HTMLElement;
  data?: GraphData;
  layout?: LayoutMode;
  theme?: string;
}

/** Plugin interface */
export interface Plugin {
  name: string;
  version: string;
  install(context: PluginContext): void;
  uninstall?(): void;
}

/** Plugin context */
export interface PluginContext {
  graphStore: unknown;
  renderer: unknown;
  aiEngine: unknown;
}
