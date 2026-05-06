// Umbrella entry point — re-exports the data layer, the renderer
// layer, and the React layer.
//
// Server-side consumers (e.g. Next.js RSC) should import the data layer
// directly from '@inferagraph/core/data' to avoid evaluating React
// module-top-level code such as React.createContext, AND to avoid
// transitively loading three.js (the renderer pulls
// `three/examples/jsm/controls/TrackballControls.js`, which is ESM-only
// and unloadable from a CJS environment).

export * from './data.js';
export * from './react.js';

// Renderer (browser-only surface; lives here, NOT in ./data.js).
export { WebGLRenderer } from './renderer/WebGLRenderer.js';
export type { TickCallback } from './renderer/WebGLRenderer.js';
export { SceneController } from './renderer/SceneController.js';
export type {
  SceneControllerOptions,
  CameraSnapshot,
} from './renderer/SceneController.js';
export type {
  VisibilityHost,
  HighlightHost,
  FocusHost,
  AnnotateHost,
  InferredEdgeHost,
} from './renderer/types.js';
export { AnnotationRenderer } from './renderer/AnnotationRenderer.js';
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
export {
  InferredEdgeMesh,
  INFERRED_EDGE_DASH_SIZE,
  INFERRED_EDGE_GAP_SIZE,
  INFERRED_EDGE_ALPHA,
  INFERRED_EDGE_COLOR,
} from './renderer/InferredEdgeMesh.js';
export { LabelRenderer } from './renderer/LabelRenderer.js';
export { CustomNodeRenderer } from './renderer/CustomNodeRenderer.js';
export { Raycaster } from './renderer/Raycaster.js';
export { CameraController } from './renderer/CameraController.js';
export { PulseController, DEFAULT_PULSE_CONFIG } from './renderer/PulseController.js';
export type { PulseConfig, PulseOption } from './renderer/PulseController.js';
export { InteractionManager } from './renderer/InteractionManager.js';
export { ThemeManager } from './renderer/ThemeManager.js';
