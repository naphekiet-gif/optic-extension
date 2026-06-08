// providers/shared/parsing.js
//
// Reusable response-handling utilities shared by every provider adapter:
//   - stripCodeFences: markdown-fence stripping for model output that wraps
//     JSON in ``` despite being instructed not to.
//   - validateGraph: the v1.0 parse contract's five-gate validation pipeline
//     (schema, integrity, coherence, bounds, sanity).
//
// Deep schema enforcement lives here, in the provider layer, so that every
// adapter produces the same validated shape regardless of which model
// generated it.

import { ProviderError } from './errors.js';

// ---------------------------------------------------------------------------
// v1.0 parse contract constants
// ---------------------------------------------------------------------------

const VALID_TYPES      = ['ui', 'service', 'database', 'external', 'auth', 'infra'];
const VALID_ZONES      = ['frontend', 'backend', 'data', 'external', 'auth', 'infra'];
const VALID_DIRECTIONS = ['one_way', 'two_way'];

const VALID_TYPE_SET      = new Set(VALID_TYPES);
const VALID_ZONE_SET      = new Set(VALID_ZONES);
const VALID_DIRECTION_SET = new Set(VALID_DIRECTIONS);

const ID_PATTERN = /^[a-z0-9_]+$/;
const MAX_ZONES = 6;

// Canonical type → zone mapping. Used by gateCoherence (currently a no-op
// in v1.5 — see comment on that function). v2's "warn but render" UX will
// surface non-canonical pairings as soft warnings using this table.
const CANONICAL_TYPE_ZONE = {
  ui: 'frontend',
  service: 'backend',
  database: 'data',
  external: 'external',
  auth: 'auth',
  infra: 'infra'
};

// ---------------------------------------------------------------------------
// Code-fence stripping (unchanged from previous version)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// validateGraph: the five-gate pipeline
// ---------------------------------------------------------------------------

/**
 * Run the v1.0 parse contract's five validation gates against a parsed
 * graph object. Throws a ProviderError with category 'validation' on the
 * first gate failure, with a message identifying which gate failed and why.
 * Returns the graph unchanged on success.
 *
 * Gates, in order:
 *   1. Schema     — structural / type / enum / length checks.
 *   2. Integrity  — every edge from/to references an existing node id.
 *   3. Coherence  — type/zone canonical mapping (NO-OP in v1.5).
 *   4. Bounds     — at most 6 distinct zones across all nodes.
 *   5. Sanity     — at least one node present (named for the readable msg).
 *
 * @param {unknown} graph
 * @returns {object} the graph, unchanged
 */
export function validateGraph(graph) {
  gateSchema(graph);
  gateIntegrity(graph);
  gateCoherence(graph);
  gateBounds(graph);
  gateSanity(graph);
  return graph;
}

// ---------------------------------------------------------------------------
// Gate 1 — Schema
// ---------------------------------------------------------------------------

function gateSchema(graph) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new ProviderError(
      'Gate 1 (schema): parsed value is not an object.',
      'validation'
    );
  }
  if (graph.version !== '1.0') {
    throw new ProviderError(
      `Gate 1 (schema): version must equal "1.0", got ${JSON.stringify(graph.version)}.`,
      'validation'
    );
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length < 1) {
    throw new ProviderError(
      'Gate 1 (schema): nodes must be a non-empty array.',
      'validation'
    );
  }
  if (!Array.isArray(graph.edges)) {
    throw new ProviderError(
      'Gate 1 (schema): edges must be an array.',
      'validation'
    );
  }
  // `system` is optional structurally; if present it must be an object.
  if (graph.system !== undefined && graph.system !== null) {
    if (typeof graph.system !== 'object' || Array.isArray(graph.system)) {
      throw new ProviderError(
        'Gate 1 (schema): system must be an object when present.',
        'validation'
      );
    }
  }

  graph.nodes.forEach((node, i) => validateNode(node, i));
  graph.edges.forEach((edge, i) => validateEdge(edge, i));
}

function validateNode(node, i) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new ProviderError(
      `Gate 1 (schema): node at index ${i} is not an object.`,
      'validation'
    );
  }

  // Required: id (snake_case, regex-matched)
  if (typeof node.id !== 'string' || node.id.length === 0) {
    throw new ProviderError(
      `Gate 1 (schema): node at index ${i} missing string id.`,
      'validation'
    );
  }
  if (!ID_PATTERN.test(node.id)) {
    throw new ProviderError(
      `Gate 1 (schema): node id ${JSON.stringify(node.id)} does not match ^[a-z0-9_]+$.`,
      'validation'
    );
  }

  // Required: label (≤40 chars)
  if (typeof node.label !== 'string' || node.label.length === 0) {
    throw new ProviderError(
      `Gate 1 (schema): node ${JSON.stringify(node.id)} missing string label.`,
      'validation'
    );
  }
  if (node.label.length > 40) {
    throw new ProviderError(
      `Gate 1 (schema): node ${JSON.stringify(node.id)} label exceeds 40 chars (length ${node.label.length}).`,
      'validation'
    );
  }

  // Required: type (enum)
  if (typeof node.type !== 'string') {
    throw new ProviderError(
      `Gate 1 (schema): node ${JSON.stringify(node.id)} missing string type.`,
      'validation'
    );
  }
  if (!VALID_TYPE_SET.has(node.type)) {
    throw new ProviderError(
      `Gate 1 (schema): node ${JSON.stringify(node.id)} has invalid type ${JSON.stringify(node.type)}; must be one of ${VALID_TYPES.join(', ')}.`,
      'validation'
    );
  }

  // Required: zone (enum)
  if (typeof node.zone !== 'string') {
    throw new ProviderError(
      `Gate 1 (schema): node ${JSON.stringify(node.id)} missing string zone.`,
      'validation'
    );
  }
  if (!VALID_ZONE_SET.has(node.zone)) {
    throw new ProviderError(
      `Gate 1 (schema): node ${JSON.stringify(node.id)} has invalid zone ${JSON.stringify(node.zone)}; must be one of ${VALID_ZONES.join(', ')}.`,
      'validation'
    );
  }

  // Optional: tech (≤60 chars)
  if (node.tech !== undefined && node.tech !== null) {
    if (typeof node.tech !== 'string') {
      throw new ProviderError(
        `Gate 1 (schema): node ${JSON.stringify(node.id)} tech must be a string when present.`,
        'validation'
      );
    }
    if (node.tech.length > 60) {
      throw new ProviderError(
        `Gate 1 (schema): node ${JSON.stringify(node.id)} tech exceeds 60 chars (length ${node.tech.length}).`,
        'validation'
      );
    }
  }

  // Optional: description (≤200 chars)
  if (node.description !== undefined && node.description !== null) {
    if (typeof node.description !== 'string') {
      throw new ProviderError(
        `Gate 1 (schema): node ${JSON.stringify(node.id)} description must be a string when present.`,
        'validation'
      );
    }
    if (node.description.length > 200) {
      throw new ProviderError(
        `Gate 1 (schema): node ${JSON.stringify(node.id)} description exceeds 200 chars (length ${node.description.length}).`,
        'validation'
      );
    }
  }

  // Optional: terms (array of { term, definition })
  if (node.terms !== undefined && node.terms !== null) {
    if (!Array.isArray(node.terms)) {
      throw new ProviderError(
        `Gate 1 (schema): node ${JSON.stringify(node.id)} terms must be an array when present.`,
        'validation'
      );
    }
    node.terms.forEach((term, ti) => validateTerm(term, node.id, ti));
  }
}

function validateTerm(term, nodeId, ti) {
  if (!term || typeof term !== 'object' || Array.isArray(term)) {
    throw new ProviderError(
      `Gate 1 (schema): node ${JSON.stringify(nodeId)} terms[${ti}] is not an object.`,
      'validation'
    );
  }
  if (typeof term.term !== 'string' || term.term.length === 0) {
    throw new ProviderError(
      `Gate 1 (schema): node ${JSON.stringify(nodeId)} terms[${ti}] missing string term.`,
      'validation'
    );
  }
  if (term.term.length > 40) {
    throw new ProviderError(
      `Gate 1 (schema): node ${JSON.stringify(nodeId)} terms[${ti}] term exceeds 40 chars (length ${term.term.length}).`,
      'validation'
    );
  }
  if (typeof term.definition !== 'string' || term.definition.length === 0) {
    throw new ProviderError(
      `Gate 1 (schema): node ${JSON.stringify(nodeId)} terms[${ti}] missing string definition.`,
      'validation'
    );
  }
  if (term.definition.length > 240) {
    throw new ProviderError(
      `Gate 1 (schema): node ${JSON.stringify(nodeId)} terms[${ti}] definition exceeds 240 chars (length ${term.definition.length}).`,
      'validation'
    );
  }
}

function validateEdge(edge, i) {
  if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
    throw new ProviderError(
      `Gate 1 (schema): edge at index ${i} is not an object.`,
      'validation'
    );
  }

  // Required: from, to (strings — id existence checked in gateIntegrity)
  if (typeof edge.from !== 'string' || edge.from.length === 0) {
    throw new ProviderError(
      `Gate 1 (schema): edge at index ${i} missing string from.`,
      'validation'
    );
  }
  if (typeof edge.to !== 'string' || edge.to.length === 0) {
    throw new ProviderError(
      `Gate 1 (schema): edge at index ${i} missing string to.`,
      'validation'
    );
  }

  // Required: direction (enum)
  if (typeof edge.direction !== 'string') {
    throw new ProviderError(
      `Gate 1 (schema): edge at index ${i} missing string direction.`,
      'validation'
    );
  }
  if (!VALID_DIRECTION_SET.has(edge.direction)) {
    throw new ProviderError(
      `Gate 1 (schema): edge at index ${i} has invalid direction ${JSON.stringify(edge.direction)}; must be one of ${VALID_DIRECTIONS.join(', ')}.`,
      'validation'
    );
  }

  // Optional: external (boolean)
  if (edge.external !== undefined && edge.external !== null) {
    if (typeof edge.external !== 'boolean') {
      throw new ProviderError(
        `Gate 1 (schema): edge at index ${i} external must be boolean when present.`,
        'validation'
      );
    }
  }

  // Optional: label (≤30 chars)
  if (edge.label !== undefined && edge.label !== null) {
    if (typeof edge.label !== 'string') {
      throw new ProviderError(
        `Gate 1 (schema): edge at index ${i} label must be a string when present.`,
        'validation'
      );
    }
    if (edge.label.length > 30) {
      throw new ProviderError(
        `Gate 1 (schema): edge at index ${i} label exceeds 30 chars (length ${edge.label.length}).`,
        'validation'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Gate 2 — Integrity
// ---------------------------------------------------------------------------

function gateIntegrity(graph) {
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    if (!nodeIds.has(edge.from)) {
      throw new ProviderError(
        `Gate 2 (integrity): edge at index ${i} references unknown source id ${JSON.stringify(edge.from)}.`,
        'validation'
      );
    }
    if (!nodeIds.has(edge.to)) {
      throw new ProviderError(
        `Gate 2 (integrity): edge at index ${i} references unknown target id ${JSON.stringify(edge.to)}.`,
        'validation'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Gate 3 — Coherence (NO-OP IN v1.5)
// ---------------------------------------------------------------------------

function gateCoherence(graph) {
  // v1.5: this gate is intentionally a no-op pass-through.
  //
  // The canonical type→zone mapping (see CANONICAL_TYPE_ZONE at the top of
  // this file) is:
  //   ui → frontend, service → backend, database → data,
  //   external → external, auth → auth, infra → infra.
  //
  // Non-canonical pairings are LEGITIMATE and must be allowed. The canonical
  // example: a self-hosted Redis cache is type=database / zone=backend,
  // because the physical kind is "database" but the architectural role is
  // backend infrastructure.
  //
  // This gate exists as a named slot in the pipeline so v2 can wire its
  // "warn but render" UX here without restructuring the validation flow.
  // In v2, coherence checks will produce soft warnings surfaced to the user
  // but will still never throw.
  //
  // Touched so the file reads as intentional rather than incomplete:
  void graph;
  void CANONICAL_TYPE_ZONE;
}

// ---------------------------------------------------------------------------
// Gate 4 — Bounds
// ---------------------------------------------------------------------------

function gateBounds(graph) {
  const zones = new Set();
  for (const node of graph.nodes) {
    zones.add(node.zone);
  }
  if (zones.size > MAX_ZONES) {
    throw new ProviderError(
      `Gate 4 (bounds): graph contains ${zones.size} distinct zones, which exceeds the legible bound of ${MAX_ZONES} for the side panel surface.`,
      'validation'
    );
  }
}

// ---------------------------------------------------------------------------
// Gate 5 — Sanity
// ---------------------------------------------------------------------------

function gateSanity(graph) {
  // Gate 1 also rejects empty nodes arrays, but reasserted here as its own
  // named gate so the failure message reads as a sanity check rather than a
  // schema violation.
  if (!Array.isArray(graph.nodes) || graph.nodes.length < 1) {
    throw new ProviderError(
      'Gate 5 (sanity): the parsed graph contained no nodes.',
      'validation'
    );
  }
}
