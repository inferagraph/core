# @inferagraph/core

AI-powered knowledge graph platform with WebGL visualization.

InferaGraph is a self-contained platform that holds graph data, performs AI reasoning via LLM, and renders interactive 3D visualizations. The consuming application is a thin shell that feeds data and displays results.

## Features

- 3D force-directed graph visualization (WebGL/Three.js)
- Built-in graph store with query, filter, and search
- AI-powered Q&A via RAG (retrieval-augmented generation)
- LLM provider plugins (Anthropic, OpenAI, Azure AI Foundry)
- CSS-themable overlays and controls
- React integration
- Two modes: 3D globe graph + 2D family tree

## Installation

```bash
pnpm add @inferagraph/core
```

## LLM Providers

Install a provider plugin for AI features:

```bash
pnpm add @inferagraph/anthropic-provider  # Claude
pnpm add @inferagraph/openai-provider     # OpenAI / Azure OpenAI
pnpm add @inferagraph/azure-foundry-provider  # Azure AI Foundry
```

## License

MIT
