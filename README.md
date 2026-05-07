# @inferagraph/core

AI-powered knowledge graph platform with WebGL visualization. **v0.9.1** — abstract base class renamed `Datasource` → `DataSource` for camel-case symmetry with sibling storage packages.

InferaGraph is a self-contained platform that holds graph data, performs AI reasoning via LLM, and renders interactive 3D visualizations. The consuming application is a thin shell that feeds data and displays results — it never invokes the LLM directly.

## Features

- 3D force-directed graph visualization (WebGL/Three.js)
- Built-in graph store with query, filter, and search
- Domain-agnostic visibility predicate (uniform across all viz modes — graph, tree, future modes)
- Streaming chat-as-API with tool calls (`apply_filter`, `highlight`, `focus`, `annotate`, `set_inferred_visibility`) auto-dispatched to the renderer
- **Hybrid retrieval** — semantic (`embeddingStore.searchVector`) + keyword + 1-hop graph expansion, weighted-sum merged
- **Cross-encoder rerank** — per-candidate LLM relevance scoring with per-conversation cache, top-K kept
- **Multi-turn conversations** — `ConversationStore` interface; `InMemoryConversationStore` ships in core. Pronoun resolution from prior turn's `retrievedNodeIds`
- **Citation requirement** — model is asked to cite every entity inline as `[[id]]`; the host renders these as clickable links
- **`debug` chat events** — first-class `ChatEvent` member; surfaced via the new `<InferaGraph onDiagnostic>` callback for ops-visibility badges
- **`onToolCallOutcome`** — host callback fired after tool-call dispatch so UIs can render "applied / unknown" badges
- **`GraphIndexer`** — reusable indexing engine; one call (`embedAll`, `computeInferredEdges`, `recomputeInferredEdgesFor`, `reconcile`) handles the whole RAG pipeline. Hosts wire it after data load; library handles the rest
- **`embeddingText({contentKeys})`** — content body now drives the embedding's body (verbatim, no `key:` prefix); attribute metadata becomes the header
- Three-tier embedding progression — keyword search → cache-backed similarity → dedicated `EmbeddingStore` (now with optional `searchVector` for vector-native stores)
- Natural-language `query` prop — predicate compiled at runtime, ANDed with the explicit `filter` prop
- Inferred-edge overlay (RRF over LLM + embeddings + graph signals); toggleable via prop or `set_inferred_visibility` tool call
- Drilldown + node detail — `+` hover affordance, node-click handler, `MemoryManager` LRU eviction
- Pluggable LLM providers (Anthropic, OpenAI, Azure AI Foundry); host-blind core
- React entry point + a separate `data` entry for Next.js RSC contexts
- CSS-themable overlays and controls

## What's new in 0.10.1

- **`httpTransport` now reconstructs `set_inferred_visibility` from the SSE wire.** The event has been a member of the `ChatEvent` union since Phase 5 (inferred-relationship overlay toggle), but `reconstructChatEvent` never grew a case for it, so a server-side route emitting `{ type: 'set_inferred_visibility', visible: ... }` was silently dropped on the client. Clients now receive both `visible: true` and `visible: false` faithfully; payloads with a non-boolean `visible` field are rejected at the boundary just like the other event reconstructors. Pre-existing tech debt; no public API change.

## What's new in 0.10.0

- **Public host-driven dispatch surface (`useInferaGraphCommands`, `useInferaGraphChatContext`).** Until 0.9.5, hosts could only fire visual operations through chat — `useInferaGraphChat()` returned a chat iterator and nothing else. Hosts that wanted to reset highlights when a user clicks "Clear conversation" had to wrap the transport, mint a sentinel chat message, and synthesize an empty-ids `highlight` event by hand. 0.10.0 promotes the renderer's dispatch sink to a public hook. The new `useInferaGraphCommands()` returns a flat semantic facade (`setHighlight`, `focusOn`, `applyFilter`, `setInferredVisibility`, `annotate`, `clearAnnotations`, `resetView`, `clearVisualState`); reach for `useInferaGraphChatContext()` only when you need to dispatch a `ChatEvent` variant the facade doesn't expose. Both hooks throw with a clear message when used outside an `<InferaGraph>` subtree.
- **Three new parameterless `ChatEvent` variants.** `clear_visual_state` (the "fresh canvas" — drops highlights + annotations + filter, snaps the camera home), `reset_view` (camera-home only), and `clear_annotations` (drop every callout). They round-trip over the SSE `httpTransport` wire too, so a server-side route can fire a reset just like a host UI button. Strictly additive — existing `ChatEvent` consumers that exhaustively `switch` should add `default: assertNever(event)` (or accept the additions explicitly).
- **`SceneController.resetView()` + `clearVisualState()`.** New public methods on the controller that compose existing surfaces (`setHighlight(empty)`, `clearAnnotations()`, `setFilter(undefined)`, `cameraController.resetRotation()`). Call them directly from non-React hosts; the React layer maps the new ChatEvents to these methods.

## What's new in 0.9.5

- **Tool-call examples in the chat system prompt are now host-agnostic.** The `Examples:` block previously demonstrated `highlight()` / `focus()` calls with literal Bible-Graph slugs (`highlight(["garden-of-eden", "adam", "eve"])`, `focus("noah")`). On UUID-keyed hosts those literals contradicted the catalog rows the model was actually reading and obscured the SHAPE of valid tool-call arguments. The examples now use `<node-id-N>` / `<node-id>` placeholders wrapped in angle brackets so a model reading the prompt understands the call shape without mistaking the placeholder for a real id. Strictly a prompt-content change; no public API surface moves. The slug-shaped citation example (`Cain [[cain]]`) under the `citationKey`-set branch is unchanged — it is intentionally aligned with the catalog's last column per 0.9.4.

## What's new in 0.9.4

- **`citationKey` config aligns the catalog id with the cite-token example.** 0.9.3's strengthened citation prompt instructed the model to cite using the catalog's first column, but the concrete example showed a slug-shaped token (`Cain [[cain]]`) while real catalog rows on UUID-keyed hosts (Bible Graph) carried UUID ids. Tool-use-trained models read the contradiction as "the rule does not match the data" and silently dropped citations for the whole turn. New optional `AIEngineConfig.citationKey` names a node attribute (e.g., `'slug'`) whose value is the citation token. When set, the catalog gains a trailing column carrying that value, and the system prompt instructs the model to cite using the LAST column — adding a note that `highlight()` / `focus()` still take the FIRST (canonical) column. When unset, behavior matches 0.9.3 except the example uses generic `[[node-id-N]]` placeholders so it no longer contradicts UUID-shaped catalog ids. Strictly additive — hosts that don't set `citationKey` see zero behavior change beyond the example wording.

## What's new in 0.9.3

- **Citation requirement strengthened.** The chat system-prompt's "cite every entity using `[[id]]`" instruction is now framed as `CITATIONS — REQUIRED, NOT OPTIONAL`, with a concrete `Cain [[cain]]` example and an `UNCITED, FORBIDDEN` counterexample. Tool-use-trained models read soft "cite" verbs as optional; the harder framing matches the pattern already used for `highlight()` higher in the same prompt and stops models from skipping citations on multi-entity answers.
- **`SceneController.setHighlight` and `focusOn` now return `{ appliedIds, unknownIds }`.** When the LLM dispatches a `highlight()` or `focus()` tool call referencing an id the renderer hasn't seen (model hallucination or stale context), the React layer used to silently swallow the miss. The dispatch path now flows the partition through `onToolCallOutcome`, so hosts can render "tried to highlight `Z` but it isn't in the graph" badges. Existing callers that ignored the void return are unaffected at the call site, but `dispatch` in `InferaGraphChatContext` is now typed `(event) => ToolCallOutcome | undefined` — host adapters that conformed to the previous `void` signature should accept the new return value.

## What's new in 0.9.1

- **`Datasource` → `DataSource` rename (breaking).** The abstract base class exported from `@inferagraph/core` and `@inferagraph/core/data` is now `DataSource` (camel-cased), matching the naming convention used by every sibling storage package (`CosmosDataSource`, `GremlinDataSource`, `SqlDataSource`, `RedisDataSource`, `FileDataSource`, `LogAnalyticsDataSource`). Behavior is unchanged. Hosts that subclass the base directly should rename `extends Datasource` → `extends DataSource` and update their import.

## What's new in 0.9.0

- **Warmup test-noise silenced.** Background `ensureEmbeddings()` failures (typical with stub providers in unit tests) used to print `[InferaGraph AIEngine] ensureEmbeddings failed: ...` / `embed batch failed: ...` to `console.warn`, polluting test output and forcing hosts to spy on the global console. The warmup path now routes failures through the chat diagnostic surface — the next `chat()` call yields a `ChatEvent` of `{type:'debug', phase:'warmup-failed', detail}` and the buffer drains. No `console.warn`, no test-runner clutter; failures still surface to hosts that consume the iterable.
- **Nominal-type collision between `@inferagraph/core` and `@inferagraph/core/data` fixed.** Pre-0.9.0, the two `tsup` configs each produced an independent `declare class AIEngine` (and friends) in their `.d.ts` rollups. Because the class body carries private fields, TypeScript treated them as nominally distinct, so `import { AIEngine } from '@inferagraph/core'` produced a value that was NOT assignable to a slot typed via `@inferagraph/core/data` — and vice versa. Folding all three entries into a single tsup config lets the DTS rollup share one chunk per shared class. **One** `AIEngine` symbol now flows from every entry; the assignability error disappears for `AIEngine`, `GraphStore`, `QueryEngine`, `SearchEngine`, `GraphIndexer`. No source-level import changes are required for consumers that already pick one entry per import — but if you previously worked around the collision with type assertions or aliased imports, you can now drop them.
- **`GraphIndexer.computeInferredEdges` batched-prompt mode.** New optional `inferredEdgeBatchSize` on `GraphIndexerConfig`. Default `1` (preserves the existing one-prompt-per-pair behavior). With `K > 1`, the indexer asks the LLM for K relationship descriptions in a single JSON-array response per batch, dropping `provider.complete` cost from N calls to `ceil(N/K)` on the happy path. Defensive parsing: a malformed batch response (non-JSON, missing `descriptions` array, wrong array length, or call-level error) falls back to per-pair calls for THAT batch only — one bad batch never blocks the whole indexing pass.
- **`InMemoryCacheProvider` ships in core.** New `inMemoryCacheProvider()` factory + `InMemoryCacheProvider` class give tests and short-lived dev workflows a Map-backed implementation with optional opt-in TTL and no size eviction. `lruCache()` remains the production default; `@inferagraph/redis-cache-provider` continues to ship the persistent variant. Wire via the existing `engine.setCache(...)`.
- **`CacheProvider` widened.** `set` now accepts an optional `{ ttlSeconds }` for per-call TTL override; `delete(key)` is added for targeted invalidation (distinct from `clear()`, which still wipes everything). Existing `set(key, value)` callers are unaffected — the third argument is optional. `InMemoryCacheProvider` honors both a construction-time `ttlSeconds` default and per-call overrides via lazy expiry on `get`. `lruCache` accepts the per-call `ttlSeconds` for signature compatibility but ignores it (its TTL policy is fixed at construction); use construction-time `ttl` config instead. External implementations such as `@inferagraph/redis-cache-provider` will satisfy the wider interface in their next bump.

## What's new in 0.8.1

- `httpTransport` now forwards `conversationId` from `ChatOptions` into the request body (`{ message, emitToolCalls, conversationId? }`). Omitted when undefined so server routes that treat "missing" as "generate a fresh id" still behave correctly.
- `useInferaGraphChat().chat(message, { conversationId })` accepts a per-call `conversationId`; the hook forwards it to the active transport so hosts no longer need to bypass the hook to thread conversation memory through their server route.

## What's new in 0.8.0

- `LLMMessage` / `LLMRole` types for structured-roles chat (already in 0.7.x; now stable surface)
- `EmbeddingStore.searchVector?(queryEmbedding, {top, container})` — additive optional method; `InMemoryEmbeddingStore` implements via linear-scan cosine
- `ChatEvent` gains `{type:'debug', phase, detail?, counters?, conversationId?}`
- `AIEngineConfig` gains `embeddingContentKeys`, `chatRerankEnabled`, `chatRerankCandidates`, `chatRerankTopK`, `priorTurnLimit`
- `AIEngine.setConversationStore(store)` + `chat(message, {conversationId})`
- `AIEngine.buildChatMessages` adds an Edges block, an Inferred-relationships block, a pronoun-resolution block (when applicable), and the citation requirement
- `emitWithFallbacks` rewritten as a pure reducer; empty-highlight substitution draws from per-query retrieval, zero-text synthesis grounds in the first retrieved node's content (no more `Showing X, Y, Z` catalog roll-up)
- `<InferaGraph onDiagnostic onToolCallOutcome>` props
- Re-exports: `LLMMessage`, `LLMRole`, `ConversationStore`, `ConversationTurn`, `inMemoryConversationStore`, `SearchVectorHit`, `GraphIndexer`, `GraphIndexerConfig`, `IndexerProgress`, `DEFAULT_EMBEDDING_CONTENT_KEYS`, `EmbeddingTextOptions`, `ToolCallOutcome`

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
