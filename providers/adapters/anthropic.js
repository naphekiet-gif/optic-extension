// providers/adapters/anthropic.js
//
// Anthropic adapter — the only active provider in Optic v1.5. Conforms to
// the ProviderAdapter contract documented in ../interface.js.
//
// Security model:
//   - The Anthropic API key is NEVER hardcoded in this file. It is supplied
//     on every request by the caller (params.apiKey), used only inside the
//     outgoing request header, and discarded when the function returns.
//   - The key is never logged, never persisted by this module, never echoed
//     back to the caller in any thrown error, and never written to the
//     console.

import { ProviderError, categorizeHttpStatus } from '../shared/errors.js';
import { stripCodeFences, validateGraphStructure } from '../shared/parsing.js';

// ---------------------------------------------------------------------------
// Anthropic request constants
// ---------------------------------------------------------------------------

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 4096;

// System prompt: instructs Claude to emit ONLY a JSON object that matches the
// schema below. The panel's graph renderer depends on this exact shape, so
// any change here must be coordinated with the panel code.
const SYSTEM_PROMPT = `You are a system architecture parser. Given a free-text description of a software system, output ONLY a single JSON object — no preamble, no commentary, no markdown code fences — that describes the system as a graph.

The JSON object MUST follow this exact schema:

{
  "nodes": [
    {
      "id": "string (short, unique identifier, snake_case)",
      "label": "string (human-readable name)",
      "type": "one of: frontend, backend, database, external_api, auth, cache, queue, storage, ai_service",
      "description": "string (1-2 sentences describing what this component does)"
    }
  ],
  "edges": [
    {
      "source": "string (id of the source node)",
      "target": "string (id of the target node)",
      "label": "string (what flows along this edge)",
      "type": "one of: request, data, event, webhook, auth"
    }
  ]
}

Rules:
- Be accurate and conservative: only include components that are explicitly mentioned or strongly implied by the description.
- Do not invent components, integrations, or data flows that are not supported by the text.
- Every edge's "source" and "target" MUST reference an existing node "id".
- The "type" of each node and edge MUST be drawn from the lists above; do not introduce new type values.
- Output the JSON object and nothing else.`;

// ---------------------------------------------------------------------------
// generateGraph implementation
// ---------------------------------------------------------------------------

/**
 * Call the Anthropic Messages API and return the parsed, structurally
 * validated graph. Throws a ProviderError on any failure path so the caller
 * can branch on .category.
 *
 * @param {{ apiKey: string, description: string, abortSignal?: AbortSignal }} params
 * @returns {Promise<{ nodes: Array, edges: Array }>}
 */
async function generateGraph(params) {
  const apiKey = params && params.apiKey;
  const description = params && params.description;
  const abortSignal = params && params.abortSignal;

  // 1) Input validation. Defensive — the service worker validates the same
  //    inputs before reaching here, but a future caller of this adapter
  //    (tests, batch tooling) might not.
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new ProviderError('Missing Anthropic API key.', 'validation');
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new ProviderError('Missing system description.', 'validation');
  }

  // 2) Build the request. The API key flows ONLY into the x-api-key header
  //    below; it is not placed anywhere else and never leaves this function.
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: description }
      ]
    }),
    signal: abortSignal
  });

  // 3) Non-OK status — produce a categorised error including the status
  //    code and up to 300 chars of the response body. Anthropic's error
  //    bodies never contain the caller's key, so this slice cannot leak
  //    credentials.
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.text();
      if (body) detail = ` — ${body.slice(0, 300)}`;
    } catch {
      // Body unreadable; carry on with just the status code.
    }
    throw new ProviderError(
      `Anthropic API returned HTTP ${response.status}${detail}`,
      categorizeHttpStatus(response.status)
    );
  }

  // 4) Parse the wrapper response. The Messages API shape is:
  //      { content: [ { type: "text", text: "..." }, ... ], ... }
  const payload = await response.json();
  const textBlock = Array.isArray(payload.content)
    ? payload.content.find((b) => b && b.type === 'text')
    : null;
  if (!textBlock || typeof textBlock.text !== 'string') {
    throw new ProviderError('Anthropic response did not contain a text block.', 'parse');
  }

  // 5) Defensive cleanup: strip markdown code fences in case the model emits
  //    them despite being told not to.
  const cleaned = stripCodeFences(textBlock.text).trim();

  // 6) Parse the inner JSON.
  let graph;
  try {
    graph = JSON.parse(cleaned);
  } catch (err) {
    throw new ProviderError(
      `Could not parse JSON from model response: ${err.message}`,
      'parse'
    );
  }

  // 7) Light structural validation (nodes / edges arrays present).
  return validateGraphStructure(graph);
}

// ---------------------------------------------------------------------------
// Export — conforms to the ProviderAdapter contract in ../interface.js.
// ---------------------------------------------------------------------------

export const anthropicAdapter = {
  name: 'anthropic',
  displayName: 'Anthropic Claude',
  generateGraph
};
