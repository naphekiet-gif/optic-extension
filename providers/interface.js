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
 * A plain-English glossary entry attached to a node. Optic uses these to
 * help non-technical readers decode genuinely technical terms that appear
 * in a node's description (e.g. webhook, OAuth, cron). A term is only
 * defined on the first node where it occurs in the system.
 *
 * @typedef {Object} Term
 * @property {string} term        Short technical term, max 40 chars.
 * @property {string} definition  Plain-English one-sentence definition, max 240 chars.
 */

/**
 * A single node in the v1.0 parse contract. Required: id, label, type,
 * zone. Expected but optional: tech, description, terms.
 *
 * `type` vs `zone`: `type` is the physical kind of component (ui, service,
 * database, …); `zone` is the architectural location (frontend, backend,
 * data, …). The pair is usually canonical (a Postgres database is
 * type=database, zone=data) but can legitimately differ — a self-hosted
 * Redis cache might be type=database, zone=backend.
 *
 * @typedef {Object} GraphNode
 * @property {string} id                                                   Snake_case identifier, matches ^[a-z0-9_]+$.
 * @property {string} label                                                Human-readable name for the node card, max 40 chars.
 * @property {('ui'|'service'|'database'|'external'|'auth'|'infra')} type  Physical kind of component.
 * @property {('frontend'|'backend'|'data'|'external'|'auth'|'infra')} zone Architectural zone the node belongs to.
 * @property {string} [tech]                                               Real technical identifier from the user's code (e.g. "POST /api/pay · Node"), max 60 chars.
 * @property {string} [description]                                        Optic's plain-English explanation of what the component does, max 200 chars.
 * @property {Term[]} [terms]                                              Up to 3 glossary entries for genuinely technical terms in the description.
 */

/**
 * A directed (or bidirectional) connection between two nodes. Required:
 * from, to, direction. Optional: external, label.
 *
 * @typedef {Object} GraphEdge
 * @property {string} from                       id of the source node (must match an existing GraphNode.id).
 * @property {string} to                         id of the target node (must match an existing GraphNode.id).
 * @property {('one_way'|'two_way')} direction   Edge directionality.
 * @property {boolean} [external]                True if this edge crosses an external / third-party boundary.
 * @property {string} [label]                    Short label for what flows along this edge, max 30 chars.
 */

/**
 * Optional system-level metadata describing the whole graph. When present,
 * both fields are expected.
 *
 * @typedef {Object} SystemInfo
 * @property {string} name      The application's name (inferred from context if not stated explicitly).
 * @property {string} summary   One-sentence summary of what the system does, max 240 chars.
 */

/**
 * The top-level v1.0 parse contract object — emitted by every adapter and
 * consumed by the panel renderer.
 *
 * @typedef {Object} Graph
 * @property {'1.0'} version          Always the literal string "1.0" in v1.5.
 * @property {SystemInfo} [system]    Optional system-level metadata.
 * @property {GraphNode[]} nodes      Array of nodes; at least 1 element.
 * @property {GraphEdge[]} edges      Array of edges (may be empty).
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
