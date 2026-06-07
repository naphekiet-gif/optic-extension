// providers/shared/parsing.js
//
// Reusable response-handling utilities shared by every provider adapter:
// markdown-fence stripping and lightweight structural validation. Deep
// schema enforcement (type enums, edge referential integrity) deliberately
// stays out of this layer — it belongs in the panel renderer.

import { ProviderError } from './errors.js';

/**
 * Strip ```lang ... ``` or ``` ... ``` markdown fences from a string.
 * Returns the inner content if a fence is detected, otherwise the trimmed
 * original. Defensive cleanup for models that wrap JSON in fences despite
 * being instructed not to.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripCodeFences(text) {
  let s = String(text).trim();
  // Remove opening fence with optional language tag.
  s = s.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '');
  // Remove closing fence.
  s = s.replace(/\n?```\s*$/, '');
  return s;
}

/**
 * Confirm a parsed object has Array `nodes` and Array `edges`. Throws a
 * ProviderError with category 'validation' if not. Returns the graph
 * unchanged on success.
 *
 * @param {unknown} graph
 * @returns {{ nodes: Array, edges: Array }}
 */
export function validateGraphStructure(graph) {
  if (!graph || typeof graph !== 'object' ||
      !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new ProviderError(
      'Model response did not contain nodes and edges arrays.',
      'validation'
    );
  }
  return graph;
}
