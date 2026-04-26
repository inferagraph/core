/** Unique identifier for a node */
export type NodeId = string;

/** Unique identifier for an edge */
export type EdgeId = string;

/** Node attributes */
export interface NodeAttributes {
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

/** LLM stream chunk */
export interface LLMStreamChunk {
  type: 'text' | 'done' | 'error';
  content: string;
}

/** AI query result */
export interface AIQueryResult {
  answer: string;
  highlightedNodeIds: NodeId[];
  context: string;
}

/**
 * Function that renders a custom node into a DOM container.
 * Returns an optional cleanup function called on removal.
 */
export type NodeRenderFn = (
  container: HTMLElement,
  node: NodeData,
  state: NodeRenderState
) => void | (() => void);

/**
 * State passed to custom node renderers.
 */
export interface NodeRenderState {
  isSelected: boolean;
  isHighlighted: boolean;
}

/**
 * Props interface for React custom node components.
 */
export interface NodeComponentProps {
  node: NodeData;
  isSelected: boolean;
  isHighlighted: boolean;
}

/**
 * Data passed to custom tooltip renderers.
 */
export interface TooltipData {
  type: 'node' | 'edge';
  node?: NodeData;
  edge?: EdgeData;
}

/**
 * Function that renders a custom tooltip into a DOM container.
 * Returns an optional cleanup function called on hide.
 */
export type TooltipRenderFn = (
  container: HTMLElement,
  data: TooltipData
) => void | (() => void);

/**
 * Props interface for React custom tooltip components.
 */
export interface TooltipComponentProps {
  type: 'node' | 'edge';
  node?: NodeData;
  edge?: EdgeData;
}

/**
 * Configuration for custom tooltip rendering.
 */
export interface TooltipConfig {
  /** Framework-agnostic custom renderer function — takes priority over component. */
  renderTooltip?: TooltipRenderFn;
  /** React.ComponentType<TooltipComponentProps> — typed as unknown to avoid React dep in core. */
  component?: unknown;
}

/** How nodes are visually rendered */
export type NodeStyle = 'dot' | 'card' | 'custom';

/** Configuration for node rendering */
export interface NodeRenderConfig {
  /** Visual style: 'dot' (small circle, label outside) or 'card' (rounded rect, label inside) or 'custom' (user-provided renderer). Default: 'dot' */
  style?: NodeStyle;
  /** Card width in world units. Only used when style='card'. Default: 80 */
  cardWidth?: number;
  /** Card height in world units. Only used when style='card'. Default: 36 */
  cardHeight?: number;
  /** Framework-agnostic custom renderer function. Used when style='custom'. */
  renderNode?: NodeRenderFn;
  /** React.ComponentType<NodeComponentProps> — typed as unknown to avoid React dep in core. Used when style='custom'. */
  component?: unknown;
  /** Invisible sphere radius for raycasting. Used when style='custom'. Default: 20 */
  hitboxRadius?: number;
}

/** Layout mode */
export type LayoutMode = 'graph' | 'tree';

/** Layout options */
export interface LayoutOptions {
  /** Whether nodes should animate (float/breathe) or remain static after layout computation. Default varies by layout. */
  animated?: boolean;
}

/** InferaGraph configuration */
export interface InferaGraphConfig {
  container: HTMLElement;
  data?: GraphData;
  layout?: LayoutMode;
  layoutOptions?: LayoutOptions;
  nodeRender?: NodeRenderConfig;
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

/** Serialized graph metadata */
export interface SerializedGraphMetadata {
  exportedAt: string;
  nodeCount: number;
  edgeCount: number;
  [key: string]: unknown;
}

/** Versioned serialized graph */
export interface SerializedGraph {
  version: number;
  nodes: NodeData[];
  edges: EdgeData[];
  metadata: SerializedGraphMetadata;
}

/** Era definition for timeline functionality */
export interface EraDefinition {
  name: string;
  startYear: number;
  endYear: number;
  description?: string;
}

/** Time range for timeline queries */
export interface TimeRange {
  start: number;
  end: number;
}

/** Content data for a node */
export interface ContentData {
  nodeId: NodeId;
  content: string;
  contentType?: string; // 'markdown' | 'html' | 'text'
  metadata?: Record<string, unknown>;
}

/** Pagination options for data queries */
export interface PaginationOptions {
  offset: number;
  limit: number;
}

/** Paginated result wrapper */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

/** Data filter for querying nodes */
export interface DataFilter {
  types?: string[];
  tags?: string[];
  attributes?: Record<string, unknown>;
  search?: string;
}
