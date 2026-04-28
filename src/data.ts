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
  SearchResult,
  MessageRole,
  LLMMessage,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamChunk,
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
export { AIEngine } from './ai/AIEngine.js';
export { LLMProvider } from './ai/LLMProvider.js';
export { ContextBuilder } from './ai/ContextBuilder.js';
export { IntentParser } from './ai/IntentParser.js';
export { ResponseHandler } from './ai/ResponseHandler.js';

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

// Renderer
export { WebGLRenderer } from './renderer/WebGLRenderer.js';
export type { TickCallback } from './renderer/WebGLRenderer.js';
export { SceneController } from './renderer/SceneController.js';
export type {
  SceneControllerOptions,
  CameraSnapshot,
} from './renderer/SceneController.js';
export {
  NodeColorResolver,
  DEFAULT_NODE_COLOR,
} from './renderer/NodeColorResolver.js';
export type {
  NodeColorFn,
  NodeColorResolverOptions,
} from './renderer/NodeColorResolver.js';
export {
  EdgeColorMap,
  DEFAULT_EDGE_COLOR,
} from './renderer/EdgeColorMap.js';
export type {
  EdgeColorFn,
  EdgeColorContext,
  EdgeColorMapOptions,
} from './renderer/EdgeColorMap.js';
export {
  blendEdgeColors,
  mixHexColors,
} from './renderer/blendEdgeColors.js';
export {
  DEFAULT_PALETTE_32,
  hashStringToIndex,
  autoColor,
  brighten,
} from './renderer/palette.js';
export { NodeMesh } from './renderer/NodeMesh.js';
export { EdgeMesh } from './renderer/EdgeMesh.js';
export { LabelRenderer } from './renderer/LabelRenderer.js';
export { CustomNodeRenderer } from './renderer/CustomNodeRenderer.js';
export { Raycaster } from './renderer/Raycaster.js';
export { CameraController } from './renderer/CameraController.js';
export { PulseController, DEFAULT_PULSE_CONFIG } from './renderer/PulseController.js';
export type { PulseConfig, PulseOption } from './renderer/PulseController.js';
export { InteractionManager } from './renderer/InteractionManager.js';
export { ThemeManager } from './renderer/ThemeManager.js';

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
