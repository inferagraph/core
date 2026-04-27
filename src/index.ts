// Umbrella entry point — re-exports both the data layer and the React layer.
//
// Server-side consumers (e.g. Next.js RSC) should import the data layer
// directly from '@inferagraph/core/data' to avoid evaluating React
// module-top-level code such as React.createContext.

export * from './data.js';
export * from './react.js';
