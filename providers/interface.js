// providers/interface.js
//
// Type contract for Optic provider adapters. This file contains NO executable
// logic — only JSDoc typedefs documenting the shape every adapter must
// conform to. It is the spec future provider implementations (OpenAI, Gemini,
// DeepSeek, etc.) should reference when implementing the contract.
//
// Adapters live at providers/adapters/<name>.js and are registered in
// providers/registry.js. The rest of the codebase imports ONLY from
// providers/registry.js — adapter files are never referenced directly outside
// that registry.

/**
 * The graph schema emitted by every adapter. Identical across providers; the
 * panel renderer depends on this exact shape.
 *
 * @typedef {Object} GraphNode
 * @property {string} id           Short, unique identifier (snake_case).
 * @property {string} label        Human-readable name.
 * @property {('frontend'|'backend'|'database'|'external_api'|'auth'|'cache'|'queue'|'storage'|'ai_service')} type
 * @property {string} description  One to two sentences describing the component.
 *
 * @typedef {Object} GraphEdge
 * @property {string} source  Source node id.
 * @property {string} target  Target node id.
 * @property {string} label   What flows along this edge.
 * @property {('request'|'data'|'event'|'webhook'|'auth')} type
 *
 * @typedef {Object} Graph
 * @property {GraphNode[]} nodes
 * @property {GraphEdge[]} edges
 */

/**
 * Parameters passed to every adapter's generateGraph function.
 *
 * @typedef {Object} GenerateGraphParams
 * @property {string} description           Free-text system description from the user.
 * @property {string} apiKey                The provider's API key. Used in the
 *                                          outgoing request only; never stored
 *                                          or logged by adapters.
 * @property {AbortSignal} [abortSignal]    Optional cancellation signal. If
 *                                          provided, adapters should forward
 *                                          it to fetch (or equivalent) so
 *                                          callers can cancel in-flight work.
 */

/**
 * The interface every adapter must implement.
 *
 * @typedef {Object} ProviderAdapter
 * @property {string} name                                        Stable identifier (e.g. 'anthropic').
 * @property {string} displayName                                 Human-readable name (e.g. 'Anthropic Claude').
 * @property {(params: GenerateGraphParams) => Promise<Graph>} generateGraph
 */

/**
 * Categorised error shape used across the provider layer. The concrete class
 * lives in providers/shared/errors.js; this typedef documents the public
 * surface that callers can inspect.
 *
 * @typedef {Object} ProviderError
 * @property {('auth'|'rate_limit'|'network'|'parse'|'validation'|'unknown')} category
 * @property {string} message
 */

// This file intentionally exports nothing; it is documentation only.
export {};
