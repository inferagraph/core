// Data-layer entry point. Safe to import from server-side environments
// (Next.js RSC, Node) without dragging in React. Use this from data-only
// consumers to avoid evaluating React module-top-level code such as
// React.createContext during import.

// Types
export type {
  NodeId,
  EdgeId,
  EraDefinition,
  TimeRange,
  NodeAttributes,
  EdgeAttributes,
  NodeData,
  EdgeData,
  GraphData,
  Vector3,
  FilterPredicate,
  KeywordSearchResult,
  MessageRole,
  LLMMessage,
  AIQueryResult,
  NodeStyle,
  NodeRenderFn,
  NodeRenderState,
  NodeComponentProps,
  NodeRenderConfig,
  TooltipData,
  TooltipRenderFn,
  TooltipComponentProps,
  TooltipConfig,
  LayoutMode,
  LayoutOptions,
  InferaGraphConfig,
  Plugin,
  PluginContext,
  SerializedGraph,
  SerializedGraphMetadata,
  ContentData,
  PaginationOptions,
  PaginatedResult,
  DataFilter,
} from './types.js';

// Store
export { GraphStore } from './store/GraphStore.js';
export { Node } from './store/Node.js';
export { Edge } from './store/Edge.js';
export { QueryEngine } from './store/QueryEngine.js';
export { FilterEngine } from './store/FilterEngine.js';
export { SearchEngine } from './store/SearchEngine.js';
export { Indexer } from './store/Indexer.js';
export { exportGraph, importGraph } from './store/Serializer.js';
export { TimelineEngine } from './store/TimelineEngine.js';
export { ClusterEngine } from './store/ClusterEngine.js';
export type { Cluster } from './store/ClusterEngine.js';

// AI
export {
  AIEngine,
  buildPredicateFromSpec,
  isKeywordShape,
  parseFilterSpec,
  parseToolCall,
} from './ai/AIEngine.js';
export type { AIEngineConfig } from './ai/AIEngine.js';
export type {
  LLMProvider,
  CompleteOptions,
  StreamOptions,
  LLMStreamEvent,
  LLMToolDefinition,
} from './ai/LLMProvider.js';
export { mockLLMProvider, deterministicVector } from './ai/MockLLMProvider.js';
export type { MockLLMProvider, MockEmbedSource } from './ai/MockLLMProvider.js';
export type { ChatEvent, ChatOptions, FilterSpec } from './ai/ChatEvent.js';
export type { SearchResult } from './ai/SearchResult.js';
export {
  contentHash,
  cosineSimilarity,
} from './ai/Embedding.js';
export type {
  Vector,
  EmbedOptions,
  EmbeddingMeta,
  EmbeddingRecord,
  EmbeddingStore,
  SimilarHit,
} from './ai/Embedding.js';
export { inMemoryEmbeddingStore } from './ai/InMemoryEmbeddingStore.js';
export { inMemoryInferredEdgeStore } from './ai/InferredEdge.js';
export type {
  InferredEdge,
  InferredEdgeSource,
  InferredEdgeStore,
} from './ai/InferredEdge.js';
export { computeGraphInferences } from './ai/inference/graph.js';
export type {
  GraphInferenceCandidate,
  GraphInferenceOptions,
  GraphInferenceSignal,
} from './ai/inference/graph.js';
export { computeEmbeddingInferences } from './ai/inference/embedding.js';
export type {
  EmbeddingInferenceCandidate,
  EmbeddingInferenceContext,
} from './ai/inference/embedding.js';
export {
  buildLLMInferencePrompt,
  computeLLMInferences,
} from './ai/inference/llm.js';
export type {
  LLMInferenceCandidate,
  LLMInferenceContext,
} from './ai/inference/llm.js';
export { mergeInferences } from './ai/inference/merge.js';
export type { MergeOptions } from './ai/inference/merge.js';
export type { ComputeInferredEdgesOptions } from './ai/AIEngine.js';
export { SchemaInspector, embeddingText } from './ai/SchemaInspector.js';
export type {
  SchemaSummary,
  SchemaAttribute,
  SchemaAttributeType,
  SchemaInspectorConfig,
} from './ai/SchemaInspector.js';
export {
  inProcessTransport,
  httpTransport,
} from './ai/Transport.js';
export type {
  Transport,
  InProcessTransportConfig,
  HttpTransportConfig,
} from './ai/Transport.js';
export { ContextBuilder } from './ai/ContextBuilder.js';
export { IntentParser } from './ai/IntentParser.js';
export { ResponseHandler } from './ai/ResponseHandler.js';

// Cache
export { lruCache } from './cache/lruCache.js';
export type { CacheProvider, CacheConfig } from './cache/lruCache.js';
export { parseTTL } from './cache/parseTTL.js';

// Animation
export { AnimationManager } from './animation/AnimationManager.js';
export { Tween, Easings } from './animation/Tween.js';
export type { EasingFunction, TweenState } from './animation/Tween.js';

// Physics
export { ForceSimulation } from './physics/ForceSimulation.js';
export { BarnesHut } from './physics/BarnesHut.js';
export { CoulombForce } from './physics/forces/CoulombForce.js';
export { SpringForce } from './physics/forces/SpringForce.js';
export { CenteringForce } from './physics/forces/CenteringForce.js';
export { DampingForce } from './physics/forces/DampingForce.js';

// Layouts
export { LayoutEngine } from './layouts/LayoutEngine.js';
export { ForceLayout3D } from './layouts/ForceLayout3D.js';
export { TreeLayout } from './layouts/TreeLayout.js';
export { LayoutRegistry } from './layouts/LayoutRegistry.js';

// Renderer surface intentionally NOT re-exported from this entry.
// `/data` is the server-safe entry point: it must not transitively
// load the renderer modules, because they import three.js, which in
// turn imports `three/examples/jsm/controls/TrackballControls.js` —
// an ESM-only module that Node refuses to require() from a CJS bundle.
// Browser consumers can reach the renderer surface via the root entry
// `@inferagraph/core` (see src/index.ts).

// Overlay
export { TooltipOverlay } from './overlay/TooltipOverlay.js';
export { DetailPanel } from './overlay/DetailPanel.js';
export { ChatPanel } from './overlay/ChatPanel.js';
export { OverlayManager } from './overlay/OverlayManager.js';
export { Minimap } from './overlay/Minimap.js';
export type { MinimapConfig, ViewportRect } from './overlay/Minimap.js';

// Modes
export { GraphMode } from './modes/GraphMode.js';
export { TreeMode } from './modes/TreeMode.js';
export { ModeManager } from './modes/ModeManager.js';
export { SelectionManager } from './modes/SelectionManager.js';
export type { SelectionRect, SelectionMode } from './modes/SelectionManager.js';
export { BatchOperations } from './modes/BatchOperations.js';
export { KeyboardManager } from './modes/KeyboardManager.js';
export type { KeyBinding, KeyAction, KeyboardContext } from './modes/KeyboardManager.js';

// Export
export { ExportEngine } from './export/ExportEngine.js';
export type { ExportOptions, NodePosition, EdgePosition } from './export/ExportEngine.js';

// Data
export type { DataAdapter, DataAdapterConfig } from './data/DataAdapter.js';
export { StaticDataAdapter } from './data/StaticDataAdapter.js';
export { DataManager } from './data/DataManager.js';
export { Datasource } from './data/Datasource.js';
export { MemoryManager } from './data/MemoryManager.js';
export type {
  MemoryManagedStore,
  MemoryManagedAIEngine,
} from './data/MemoryManager.js';

// Plugins
export { PluginInterface } from './plugins/PluginInterface.js';
export { PluginManager } from './plugins/PluginManager.js';

// Utils
export {
  joinNatural,
  aggregateEdges,
  resolveEdgeLabel,
  describeNode,
} from './utils/index.js';
export type {
  EdgeLabelMap,
  EdgeLabelValue,
  AggregatedEdge,
  DescribeNodeOptions,
  NodeDescription,
} from './utils/index.js';
