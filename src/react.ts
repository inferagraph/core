// React entry point. Requires a React 18+ environment. Importing this
// module evaluates React module-top-level code (e.g. createContext) and is
// therefore unsafe to import from Next.js RSC contexts. Server-side
// consumers should import from '@inferagraph/core/data' instead.

export { InferaGraph } from './react/InferaGraph.js';
export type { InferaGraphProps } from './react/InferaGraph.js';
export { useInferaGraph } from './react/useInferaGraph.js';
export { useInferaGraphChat } from './react/useInferaGraphChat.js';
export type { InferaGraphChatHook } from './react/useInferaGraphChat.js';
export { GraphProvider } from './react/GraphProvider.js';
export { createReactNodeRenderFn, createReactTooltipRenderFn } from './react/ReactNodeRenderer.js';
