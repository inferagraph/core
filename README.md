# @inferagraph/core

AI-powered knowledge graph platform with WebGL visualization. **v0.6.0** — Phase 6 (drilldown + node detail).

InferaGraph is a self-contained platform that holds graph data, performs AI reasoning via LLM, and renders interactive 3D visualizations. The consuming application is a thin shell that feeds data and displays results — it never invokes the LLM directly.

## Features

- 3D force-directed graph visualization (WebGL/Three.js)
- Built-in graph store with query, filter, and search
- Domain-agnostic visibility predicate (uniform across all viz modes — graph, tree, future modes)
- Streaming chat-as-API with tool calls (`apply_filter`, `highlight`, `focus`, `annotate`, `set_inferred_visibility`) auto-dispatched to the renderer
- Three-tier embedding progression — keyword search → cache-backed similarity → dedicated `EmbeddingStore`
- Natural-language `query` prop — predicate compiled at runtime, ANDed with the explicit `filter` prop
- Inferred-edge overlay (RRF over LLM + embeddings + graph signals); toggleable via prop or `set_inferred_visibility` tool call
- Drilldown + node detail — `+` hover affordance, node-click handler, `MemoryManager` LRU eviction
- Pluggable LLM providers (Anthropic, OpenAI, Azure AI Foundry); host-blind core
- React entry point + a separate `data` entry for Next.js RSC contexts
- CSS-themable overlays and controls

## Installation

```bash
pnpm add @inferagraph/core
```

Two entry points:

- `@inferagraph/core` / `@inferagraph/core/react` — React layer (client-side; touches `React.createContext`)
- `@inferagraph/core/data` — server-safe data layer (RSC, route handlers)

## React component

```tsx
import { InferaGraph } from '@inferagraph/core/react';
import { openaiProvider } from '@inferagraph/openai-provider';

<InferaGraph
  data={data}
  llm={openaiProvider({ apiKey: process.env.OPENAI_KEY! })}
  query="people from the Patriarchs era"
  onNodeClick={(id, node) => openDetailDialog(id, node)}
  onExpandRequest={(id) => /* host can override; default expands neighbors */}
  maxNodes={1000}
/>
```

### Selected props (see `InferaGraphProps` for the full list)

| Prop | Type | Notes |
|---|---|---|
| `data` | `GraphData` | Initial nodes + edges. |
| `layout` | `LayoutMode` | `'graph'` (default) or `'tree'`. |
| `filter` | `(node) => boolean` | Domain-agnostic visibility predicate. Same predicate applies in every viz mode. |
| `query` | `string` | NLQ; LLM compiles to predicate, ANDed with `filter`. Requires `llm`. |
| `llm` | `LLMProvider` | Pre-configured provider instance. Library is host-blind from this point. |
| `cache` | `CacheProvider` | Optional response cache. Default is no cache. |
| `embeddingStore` | `EmbeddingStore` | Optional Tier-3 vector store; default `inMemoryEmbeddingStore()` is exported. |
| `transport` | `Transport` | Override the default in-process chat transport (e.g., HTTP proxy). |
| `showInferredEdges` | `boolean` | Toggle the dashed inferred-edge overlay. Default `false`. |
| `onChat` | `(event) => void` | Receives `text` + `done` events; tool calls dispatch silently to the renderer. |
| `slugResolver` | `SlugResolver` | Phase 6 — translates input slugs to canonical NodeIds for hooks. |
| `maxNodes` | `number` | Phase 6 — soft cap; `MemoryManager` LRU-evicts oldest non-protected nodes. |
| `onNodeClick` | `(id, node) => void` | Phase 6 — fires on node-body clicks (post-slug resolution). |
| `onExpandRequest` | `(id) => void` | Phase 6 — fires on `+` affordance clicks. Default handler calls `useInferaGraphNeighbors().expand(id)`. |
| `nodeColors` / `edgeColors` | `Record<string,string>` | Type → color maps. Function variants via `nodeColorFn` / `edgeColorFn`. |
| `incomingEdgeLabels` / `outgoingEdgeLabels` | `EdgeLabelMap` | Tooltip relationship phrasing maps. |

### Hooks (`@inferagraph/core/react`)

- `useInferaGraph()` — store + AIEngine handles
- `useInferaGraphChat()` — streaming chat iterator
- `useInferaGraphSearch()` — keyword / similarity search
- `useInferaGraphContent(idOrSlug)` — fetch node detail content (uses `slugResolver` if configured)
- `useInferaGraphNeighbors()` — expand / collapse drilldown
- `GraphProvider` — context provider; needed only for advanced multi-instance setups
- `createReactNodeRenderFn` / `createReactTooltipRenderFn` — bridges for custom React node / tooltip components

## DataAdapter contract

Every datasource plugin (and any custom one a host writes) implements seven methods:

```ts
interface DataAdapter {
  getInitialView(config?): Promise<GraphData>;
  getNode(id): Promise<NodeData | undefined>;
  getNeighbors(id, depth?): Promise<GraphData>;
  findPath(fromId, toId): Promise<GraphData>;
  search(query, pagination?): Promise<PaginatedResult<NodeData>>;
  filter(filter, pagination?): Promise<PaginatedResult<NodeData>>;
  getContent(id): Promise<ContentData | undefined>;
}
```

## LLM Providers

Hosts inject **one** provider instance at construction. The library never imports a provider SDK directly — the provider package owns its dependency.

```bash
pnpm add @inferagraph/anthropic-provider     # Claude (+ optional Voyage embeddings)
pnpm add @inferagraph/openai-provider        # OpenAI / Azure OpenAI / OpenRouter / GitHub Models
pnpm add @inferagraph/azure-foundry-provider # Azure AI Foundry catalog
```

Anthropic has no native embeddings endpoint — pass an optional `voyage` config to its provider for embedding support, or mix-and-match (Anthropic for chat + a different provider's `embed`).

## Cache providers

- Built-in `lruCache()` — in-process, default `(maxEntries: 500, ttl: '24h')`.
- `@inferagraph/redis-cache-provider` — Redis-backed for shared / multi-process caches.

The `cache` prop also serves as Tier-2 embedding storage when the configured provider implements `embed()` and no dedicated `embeddingStore` is supplied.

## License

MIT
