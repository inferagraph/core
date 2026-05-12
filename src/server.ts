// Server-only entry point. Safe to import from server bundles (Next.js
// route handlers, Node, Bun, edge runtimes that support Web Standard
// Request/Response). Holds helpers that wrap an AIEngine with HTTP
// surface — does NOT pull in React or three.js, so it can sit alongside
// `@inferagraph/core/data` without dragging the renderer into a server
// bundle.

export {
  createInferredEdgeRouteHandler,
} from './server/createInferredEdgeRouteHandler.js';
export type {
  CreateInferredEdgeRouteHandlerOptions,
} from './server/createInferredEdgeRouteHandler.js';
