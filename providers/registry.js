// providers/registry.js
//
// The single seam the rest of the codebase imports from when it needs to
// generate a graph. Hides which provider is active behind a stable surface.
//
// To add a provider later: write a new adapter under providers/adapters/,
// import it here, and add it to REGISTRY. The active-provider control will
// widen in v2 (per the comment below).

import { anthropicAdapter } from './adapters/anthropic.js';

// Adapter registry. Keys are stable adapter names (matching adapter.name).
const REGISTRY = {
  [anthropicAdapter.name]: anthropicAdapter
};

// ---------------------------------------------------------------------------
// v1.5: the active provider is hardcoded to Anthropic.
//
// The abstraction layer (interface, adapters, shared utilities, this
// registry) exists so that v2 can replace this constant with a user-selectable
// value persisted in chrome.storage.local and surfaced in the panel UI. For
// now the seam is mechanically inert — only one adapter exists in REGISTRY,
// and only this constant decides which adapter runs.
//
// Do not export a setter or any other configuration surface in v1.5. The
// hardcoded constant is the entire control mechanism today.
// ---------------------------------------------------------------------------

const ACTIVE_PROVIDER = 'anthropic';

/**
 * Generate a graph using the currently active provider. The caller never
 * learns which adapter ran.
 *
 * @param {{ apiKey: string, description: string, abortSignal?: AbortSignal }} params
 * @returns {Promise<{ nodes: Array, edges: Array }>}
 */
export async function generateGraph(params) {
  const adapter = REGISTRY[ACTIVE_PROVIDER];
  return adapter.generateGraph(params);
}
