import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import type {
  GraphData,
  LayoutMode,
  NodeData,
  NodeId,
  NodeRenderConfig,
  NodeComponentProps,
  TooltipConfig,
  TooltipComponentProps,
} from '../types.js';
import { GraphProvider, useGraphContext, type SlugResolver } from './GraphProvider.js';
import { createReactNodeRenderFn, createReactTooltipRenderFn } from './ReactNodeRenderer.js';
import { SceneController } from '../renderer/SceneController.js';
import type { NodeColorFn } from '../renderer/NodeColorResolver.js';
import type { EdgeColorFn } from '../renderer/EdgeColorMap.js';
import type { EdgeLabelMap } from '../utils/aggregateEdges.js';
import type { LLMProvider } from '../ai/LLMProvider.js';
import type { CacheProvider } from '../cache/lruCache.js';
import type { ChatEvent } from '../ai/ChatEvent.js';
import type { EmbeddingStore } from '../ai/Embedding.js';
import { inProcessTransport, type Transport } from '../ai/Transport.js';
import { ChatContext, type InferaGraphChatContext } from './chatContext.js';
import { useInferaGraphNeighbors } from './useInferaGraphNeighbors.js';

export interface InferaGraphProps {
  data?: GraphData;
  layout?: LayoutMode;
  nodeRender?: NodeRenderConfig;
  tooltip?: TooltipConfig;
  /** Pool of colors for deterministic auto-assignment. */
  palette?: readonly string[];
  /** Explicit type → color map for nodes. */
  nodeColors?: Record<string, string>;
  /** Function override for nodes. */
  nodeColorFn?: NodeColorFn;
  /** Explicit relationship-type → color map for edges. */
  edgeColors?: Record<string, string>;
  /** Function override for edges. */
  edgeColorFn?: EdgeColorFn;
  /**
   * Incoming-edge label map for the default tooltip's natural-language
   * description (e.g. `{ father_of: 'Son of', mother_of: 'Son of' }`).
   * Ignored when `tooltip.renderTooltip` / `tooltip.component` is supplied.
   */
  incomingEdgeLabels?: EdgeLabelMap;
  /**
   * Outgoing-edge label map for the default tooltip's natural-language
   * description (e.g. `{ father_of: 'Father of' }`).
   */
  outgoingEdgeLabels?: EdgeLabelMap;
  /**
   * Domain-agnostic visibility predicate. When supplied, only nodes for
   * which the predicate returns `true` are rendered; edges whose source
   * OR target node is filtered out are hidden too.
   *
   * The same predicate applies in **every** visualization mode — graph,
   * tree, and any future mode (geospatial / timeline / chord / etc.).
   * Filter changes are applied as in-place visibility toggles on the
   * existing GPU buffers — there's no mesh teardown, no rebuild, and
   * no layout recompute. Hidden nodes keep their layout positions, so
   * unhiding restores the prior frame instantly.
   *
   * Default: no filter (every node visible).
   */
  filter?: (node: NodeData) => boolean;
  /**
   * Tree-mode option: edge types that the hierarchical tidy-tree layout
   * treats as parent -> child. Default `['parent_of']` — set to your
   * domain's vocabulary (`['manages']` for org charts, `['supplies']`
   * for supply chains, `['is_a']` for taxonomies, `['cites']` for
   * citation graphs, etc.). Has no effect in graph mode.
   */
  parentEdgeTypes?: string[];
  /**
   * Tree-mode option: edge types that pair two nodes at the same depth
   * so they appear adjacent and share children. Default `[]` (no
   * pairing). Has no effect in graph mode.
   */
  pairedEdgeTypes?: string[];
  /**
   * LLM provider for AI features (NLQ filtering today; chat / search / highlight
   * land in later phases). The host imports a provider package and passes a
   * configured INSTANCE here. The host never invokes the LLM directly —
   * InferaGraph owns the entire LLM lifecycle.
   *
   * Omitted = AI features are unavailable; the explicit `filter` predicate
   * still works.
   */
  llm?: LLMProvider;
  /**
   * Cache provider for LLM responses. Defaults to NO CACHING when omitted, so
   * tests + small demos don't accidentally retain old responses. Pass
   * `lruCache()` (built-in) or `@inferagraph/redis-cache-provider` for
   * production. The cache is wiped automatically when the LLM provider
   * instance changes.
   *
   * Also acts as the **Tier 2** embedding storage when `embeddingStore` is
   * not supplied AND the configured `llm` provider implements `embed()` —
   * embeddings are persisted in the cache and similarity is computed
   * in-memory at query time.
   */
  cache?: CacheProvider;
  /**
   * Optional dedicated {@link EmbeddingStore} (Tier 3 of the embedding
   * progression). When supplied, AIEngine uses the store's vector-native
   * `similar()` for semantic search. The default in-process implementation
   * ships as `inMemoryEmbeddingStore()`; persistent stores live in their
   * own packages.
   *
   * Tier mapping at runtime:
   *   - omit both → keyword search only.
   *   - `cache` only + provider with `embed()` → Tier 2.
   *   - `embeddingStore` + provider with `embed()` → Tier 3.
   */
  embeddingStore?: EmbeddingStore;
  /**
   * Natural-language query that the LLM compiles into a filter predicate.
   * Combined with the explicit `filter` prop via AND: the developer-set
   * `filter` runs first (proactive scope), then `query` narrows within that
   * scope. Requires `llm`. An empty / undefined `query` is a no-op.
   */
  query?: string;
  /**
   * Optional explicit chat {@link Transport}. Wins over the implicit
   * "build an in-process transport from `llm`" path. Use this to wire
   * an HTTP transport (Next.js `/api/chat` proxy) so the LLM + cache
   * stay server-side.
   */
  transport?: Transport;
  /**
   * Toggle visibility of the Phase 5 inferred-edge overlay (dashed
   * lines between nodes the AI inference pipeline thinks are related).
   * Defaults to `false` (overlay hidden) so the explicit graph reads
   * cleanly out of the box. Hosts opt in either by setting this to
   * `true` or by handing the LLM a `set_inferred_visibility` chat
   * tool call.
   *
   * The actual inferred edges are computed by
   * `aiEngine.computeInferredEdges()` and pushed to the renderer
   * separately — toggling this prop only shows/hides whatever has
   * already been computed.
   */
  showInferredEdges?: boolean;
  /**
   * Host-facing chat callback. Called with `text` and `done` events
   * only — tool calls (`apply_filter` / `highlight` / `focus` /
   * `annotate`) are dispatched silently to the renderer.
   *
   * The host writes its own chat UI on top of this callback (input
   * box, message log, conversation pane). InferaGraph owns the
   * streaming / tool-routing logistics.
   */
  onChat?: (event: ChatEvent) => void;
  /**
   * Phase 6 — slug → nodeId resolver. When supplied, hooks like
   * {@link useInferaGraphContent} translate the input through this
   * resolver before calling into the {@link DataAdapter}. Hosts that
   * route by raw UUIDs can omit it.
   */
  slugResolver?: SlugResolver;
  /**
   * Phase 6 — soft cap on the number of nodes retained in the store.
   * When exceeded, the {@link MemoryManager} evicts the oldest
   * non-protected nodes. `undefined` (default) disables the cap.
   */
  maxNodes?: number;
  /**
   * Phase 6 — fired when the user clicks a node body. The host typically
   * opens a detail dialog. Receives the canonical NodeId (post-slug
   * resolution) and the node's data snapshot.
   *
   * NOT fired for clicks on the "+" affordance — those go through
   * {@link onExpandRequest} instead.
   */
  onNodeClick?: (nodeId: NodeId, node: NodeData) => void;
  /**
   * Phase 6 — fired when the user clicks the "+" hover affordance on a
   * node. Receives the canonical NodeId. The host typically calls
   * `useInferaGraphNeighbors().expand(nodeId)`. When omitted, the
   * library installs a default handler that fires the built-in
   * `expand(nodeId)` dispatch.
   */
  onExpandRequest?: (nodeId: NodeId) => void;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Optional children rendered inside the InferaGraph subtree. Useful
   * for hosts that want to embed components that consume
   * {@link useInferaGraphChat} or other hooks that depend on the
   * InferaGraph context. Children render OUTSIDE the WebGL canvas
   * (after the `.ig-container` div) — they're for host-owned chrome /
   * chat UI, not for in-canvas rendering.
   */
  children?: React.ReactNode;
}

interface InferaGraphInnerProps {
  layout?: LayoutMode;
  nodeRender?: NodeRenderConfig;
  tooltip?: TooltipConfig;
  palette?: readonly string[];
  nodeColors?: Record<string, string>;
  nodeColorFn?: NodeColorFn;
  edgeColors?: Record<string, string>;
  edgeColorFn?: EdgeColorFn;
  incomingEdgeLabels?: EdgeLabelMap;
  outgoingEdgeLabels?: EdgeLabelMap;
  filter?: (node: NodeData) => boolean;
  parentEdgeTypes?: string[];
  pairedEdgeTypes?: string[];
  llm?: LLMProvider;
  cache?: CacheProvider;
  embeddingStore?: EmbeddingStore;
  query?: string;
  transport?: Transport;
  showInferredEdges?: boolean;
  onChat?: (event: ChatEvent) => void;
  onNodeClick?: (nodeId: NodeId, node: NodeData) => void;
  onExpandRequest?: (nodeId: NodeId) => void;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

function InferaGraphInner({
  layout,
  nodeRender,
  tooltip,
  palette,
  nodeColors,
  nodeColorFn,
  edgeColors,
  edgeColorFn,
  incomingEdgeLabels,
  outgoingEdgeLabels,
  filter,
  parentEdgeTypes,
  pairedEdgeTypes,
  llm,
  cache,
  embeddingStore,
  query,
  transport,
  showInferredEdges,
  onChat,
  onNodeClick,
  onExpandRequest,
  className,
  style,
  children,
}: InferaGraphInnerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const { store, aiEngine, isReady } = useGraphContext();
  const neighbors = useInferaGraphNeighbors();
  // Predicate produced by the LLM from the `query` prop. `null` means "no
  // query has been compiled yet" → don't apply anything; an explicit
  // `() => true` means "compiled to match-everything".
  const [queryPredicate, setQueryPredicate] = useState<((node: NodeData) => boolean) | null>(null);

  const resolvedNodeRender = useMemo(() => {
    if (!nodeRender) return undefined;
    if (nodeRender.renderNode) return nodeRender; // renderNode takes priority
    if (nodeRender.component) {
      return {
        ...nodeRender,
        renderNode: createReactNodeRenderFn(nodeRender.component as React.ComponentType<NodeComponentProps>),
      };
    }
    return nodeRender;
  }, [nodeRender]);

  const resolvedTooltip = useMemo(() => {
    if (!tooltip) return undefined;
    if (tooltip.renderTooltip) return tooltip; // renderTooltip takes priority
    if (tooltip.component) {
      return {
        ...tooltip,
        renderTooltip: createReactTooltipRenderFn(tooltip.component as React.ComponentType<TooltipComponentProps>),
      };
    }
    return tooltip;
  }, [tooltip]);

  // Mount the scene controller once on first render. The controller owns the
  // WebGL renderer, layout engine, camera controls, and meshes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const controller = new SceneController({
      store,
      layout: layout ?? 'graph',
      nodeRender: resolvedNodeRender,
      tooltip: resolvedTooltip,
      palette,
      nodeColors,
      nodeColorFn,
      edgeColors,
      edgeColorFn,
      incomingEdgeLabels,
      outgoingEdgeLabels,
      // The construction-time `filter` is the developer-set predicate only;
      // any LLM-derived `queryPredicate` arrives asynchronously and is pushed
      // in via the dedicated `effectiveFilter` effect below.
      filter,
      parentEdgeTypes,
      pairedEdgeTypes,
    });
    controller.attach(container);
    controllerRef.current = controller;

    // Keep the canvas in sync with container size.
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => controller.resize());
      resizeObserver.observe(container);
    }

    return () => {
      resizeObserver?.disconnect();
      controller.detach();
      controllerRef.current = null;
    };
    // The controller mounts exactly once per store. Layout / nodeRender /
    // tooltip changes are pushed in via the effects below so prop changes
    // don't tear down and rebuild the renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // When the store finishes loading initial data, build the meshes.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || !isReady) return;
    controller.syncFromStore();
  }, [isReady]);

  // Push layout-mode changes into the controller without remounting.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setLayout(layout ?? 'graph');
  }, [layout]);

  // Push node-render / tooltip changes.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setNodeRender(resolvedNodeRender);
  }, [resolvedNodeRender]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setTooltip(resolvedTooltip);
  }, [resolvedTooltip]);

  // Push edge-label map changes so consumers can swap relationship phrasing
  // without a full remount. The defaults still apply when undefined.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setIncomingEdgeLabels(incomingEdgeLabels);
  }, [incomingEdgeLabels]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setOutgoingEdgeLabels(outgoingEdgeLabels);
  }, [outgoingEdgeLabels]);

  // Push the LLM provider + cache into the AIEngine. Both are optional; when
  // omitted the engine simply degrades to a no-op for AI-only features. The
  // engine itself handles cache-clear-on-provider-change, so we don't need to
  // dance with effect ordering here.
  useEffect(() => {
    aiEngine.setProvider(llm);
  }, [aiEngine, llm]);

  useEffect(() => {
    aiEngine.setCache(cache);
  }, [aiEngine, cache]);

  // Push the embedding store into the AIEngine. The engine selects its
  // tier (1 / 2 / 3) lazily based on whether cache + embeddingStore are
  // configured AND whether the provider implements `embed()`, so this
  // wiring is purely "hand the dependency in".
  useEffect(() => {
    aiEngine.setEmbeddingStore(embeddingStore);
  }, [aiEngine, embeddingStore]);

  // Compile the natural-language `query` prop into a predicate. We track the
  // current async run with a token so a fast-typed query doesn't race a slow
  // earlier compile and clobber the latest result.
  useEffect(() => {
    const trimmed = query?.trim() ?? '';
    if (!trimmed || !llm) {
      setQueryPredicate(null);
      return;
    }

    let cancelled = false;
    aiEngine
      .compileFilter(trimmed)
      .then((predicate) => {
        if (cancelled) return;
        setQueryPredicate(() => predicate);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[InferaGraph] compileFilter failed:', err);
        if (!cancelled) setQueryPredicate(null);
      });

    return () => {
      cancelled = true;
    };
  }, [aiEngine, llm, query]);

  // Combine the developer-set `filter` predicate (low-level, proactive scope)
  // with the LLM-compiled `queryPredicate` (high-level, user-driven). Per the
  // architecture rules: predicate runs FIRST, NLQ narrows within that scope —
  // so the effective predicate is a logical AND.
  const effectiveFilter = useMemo<((node: NodeData) => boolean) | undefined>(() => {
    if (!filter && !queryPredicate) return undefined;
    if (filter && !queryPredicate) return filter;
    if (!filter && queryPredicate) return queryPredicate;
    const f = filter!;
    const q = queryPredicate!;
    return (node) => f(node) && q(node);
  }, [filter, queryPredicate]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setFilter(effectiveFilter);
  }, [effectiveFilter]);

  // Push inferred-edge overlay visibility into the controller. The
  // controller caches the value internally and replays it onto a
  // freshly-built mesh after layout-mode round-trips, so we don't have
  // to re-fire on every store/layout change — only on prop change.
  // Default `false` matches the prop default + the InferredEdgeMesh
  // default + the Phase 5 plan's "hidden by default" decision.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setInferredEdgeVisibility(showInferredEdges ?? false);
  }, [showInferredEdges]);

  // ---------- Phase 6 — click + expand wiring ----------

  // Stable refs for the host callbacks so the effects below don't have to
  // re-fire when the host accidentally passes a fresh function each render.
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;

  // Push the node-click handler into the controller. The controller fires
  // it ONLY for clicks on a node body — clicks on the "+" affordance go
  // through `setOnExpandRequest` instead.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (typeof controller.setOnNodeClick !== 'function') return;
    if (!onNodeClick) {
      controller.setOnNodeClick(null);
      return;
    }
    controller.setOnNodeClick((nodeId: NodeId) => {
      const node = store.getNode(nodeId);
      if (!node) return;
      onNodeClickRef.current?.(nodeId, {
        id: node.id,
        attributes: node.attributes,
      });
    });
  }, [onNodeClick, store]);

  // Default expand handler: when the host doesn't supply one, fire the
  // built-in `useInferaGraphNeighbors().expand(nodeId)` so the "+"
  // affordance "just works" out of the box.
  const defaultExpandHandler = useCallback(
    (nodeId: NodeId) => {
      void neighbors.expand(nodeId);
    },
    [neighbors],
  );

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (typeof controller.setOnExpandRequest !== 'function') return;
    const handler = onExpandRequest ?? defaultExpandHandler;
    controller.setOnExpandRequest(handler);
    return () => {
      if (typeof controller.setOnExpandRequest === 'function') {
        controller.setOnExpandRequest(null);
      }
    };
  }, [onExpandRequest, defaultExpandHandler]);

  // ---------- Chat: transport selection + dispatch + onChat callback ----------

  // The active chat transport. Explicit `transport` prop wins; otherwise
  // we synthesize an in-process transport from the AIEngine when an LLM
  // is configured. When neither is set, transport stays `null` and
  // `useInferaGraphChat()` throws.
  const activeTransport = useMemo<Transport | null>(() => {
    if (transport) return transport;
    if (!llm) return null;
    return inProcessTransport({ engine: aiEngine });
  }, [transport, llm, aiEngine]);

  // Stable onChat ref so the chat-context callback doesn't re-create
  // every render (which would invalidate `useInferaGraphChat`'s
  // memoised `chat` callback in consumers that keep a long-lived
  // iterator).
  const onChatRef = useRef(onChat);
  onChatRef.current = onChat;

  // Build a chat context value that surfaces the current transport
  // through getters so swapping `transport` mid-flight is transparent
  // to consumers.
  const chatContextValue = useMemo<InferaGraphChatContext>(() => {
    return {
      getTransport: () => {
        if (!activeTransport) return null;
        return {
          chat: (message, opts) => {
            // Wrap the transport so the host's `onChat` callback fires
            // for ALL events (text + done), but tool calls still flow
            // through to the consumer of `useInferaGraphChat`. The hook
            // itself filters tool calls out of its public iterable.
            return interceptTextEvents(
              activeTransport.chat(message, opts),
              (ev) => {
                onChatRef.current?.(ev);
              },
            );
          },
        };
      },
      dispatch: (event: ChatEvent) => {
        const controller = controllerRef.current;
        if (!controller) return;
        switch (event.type) {
          case 'apply_filter':
            controller.setFilter(event.predicate);
            return;
          case 'highlight':
            controller.setHighlight(event.ids);
            return;
          case 'focus':
            controller.focusOn(event.nodeId);
            return;
          case 'annotate':
            controller.annotate(event.nodeId, event.text);
            return;
          case 'set_inferred_visibility':
            // Phase 5: route the LLM's overlay-toggle tool call to
            // the renderer. Subagent A added the ChatEvent variant +
            // `parseToolCall` mapping; Subagent B (this file) wires
            // the dispatch.
            controller.setInferredEdgeVisibility(event.visible);
            return;
          default:
            return;
        }
      },
    };
  }, [activeTransport]);

  return (
    <ChatContext.Provider value={chatContextValue}>
      <div
        ref={containerRef}
        className={`ig-container ${className ?? ''}`}
        style={{ width: '100%', height: '100%', position: 'relative', ...style }}
      />
      {children}
    </ChatContext.Provider>
  );
}

export function InferaGraph(props: InferaGraphProps): React.JSX.Element {
  const {
    data,
    layout,
    nodeRender,
    tooltip,
    palette,
    nodeColors,
    nodeColorFn,
    edgeColors,
    edgeColorFn,
    incomingEdgeLabels,
    outgoingEdgeLabels,
    filter,
    parentEdgeTypes,
    pairedEdgeTypes,
    llm,
    cache,
    embeddingStore,
    query,
    transport,
    showInferredEdges,
    onChat,
    slugResolver,
    maxNodes,
    onNodeClick,
    onExpandRequest,
    className,
    style,
    children,
  } = props;
  return (
    <GraphProvider data={data} slugResolver={slugResolver} maxNodes={maxNodes}>
      <InferaGraphInner
        layout={layout}
        nodeRender={nodeRender}
        tooltip={tooltip}
        palette={palette}
        nodeColors={nodeColors}
        nodeColorFn={nodeColorFn}
        edgeColors={edgeColors}
        edgeColorFn={edgeColorFn}
        incomingEdgeLabels={incomingEdgeLabels}
        outgoingEdgeLabels={outgoingEdgeLabels}
        filter={filter}
        parentEdgeTypes={parentEdgeTypes}
        pairedEdgeTypes={pairedEdgeTypes}
        llm={llm}
        cache={cache}
        embeddingStore={embeddingStore}
        query={query}
        transport={transport}
        showInferredEdges={showInferredEdges}
        onChat={onChat}
        onNodeClick={onNodeClick}
        onExpandRequest={onExpandRequest}
        className={className}
        style={style}
      >
        {children}
      </InferaGraphInner>
    </GraphProvider>
  );
}

/**
 * Wrap a transport's chat stream so a side-effect callback fires for
 * the `text` and `done` events the host cares about. Tool-call events
 * are passed through unchanged so the consumer (`useInferaGraphChat`)
 * can still dispatch them to the renderer.
 *
 * Pure pass-through otherwise — the iterator's order of events is
 * preserved.
 */
async function* interceptTextEvents(
  source: AsyncIterable<ChatEvent>,
  sideEffect: (event: ChatEvent) => void,
): AsyncGenerator<ChatEvent, void, unknown> {
  for await (const ev of source) {
    if (ev.type === 'text' || ev.type === 'done') {
      try {
        sideEffect(ev);
      } catch {
        // Host callbacks must not break the stream.
      }
    }
    yield ev;
  }
}
