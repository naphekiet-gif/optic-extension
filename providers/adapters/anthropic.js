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
import { stripCodeFences, validateGraph } from '../shared/parsing.js';

// ---------------------------------------------------------------------------
// Anthropic request constants
// ---------------------------------------------------------------------------

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 4096;

// System prompt: instructs Claude to emit the v1.0 parse contract. The panel
// and validation layer depend on this exact contract; coordinate any changes
// here with providers/shared/parsing.js and the panel renderer.
const SYSTEM_PROMPT = `You are a system architecture parser. Given a free-text description of a software system, output ONLY a single JSON object — no preamble, no commentary, no markdown code fences — that describes the system per the v1.0 parse contract schema.

# Schema

{
  "version": "1.0",
  "system": {
    "name": "string",
    "summary": "string, max 240 chars"
  },
  "nodes": [
    {
      "id": "string, snake_case, matches ^[a-z0-9_]+$",
      "label": "string, max 40 chars, human-readable name",
      "type": "one of: ui, service, database, external, auth, infra",
      "zone": "one of: frontend, backend, data, external, auth, infra",
      "tech": "string, max 60 chars, real technical identifier from the user's code",
      "description": "string, max 200 chars, Optic's plain-English explanation",
      "terms": [
        { "term": "string, max 40 chars", "definition": "string, max 240 chars" }
      ]
    }
  ],
  "edges": [
    {
      "from": "node id",
      "to": "node id",
      "direction": "one of: one_way, two_way",
      "external": "boolean, optional",
      "label": "string, max 30 chars, optional"
    }
  ]
}

Required per node: id, label, type, zone. Expected but optional: tech, description, terms.
Required per edge: from, to, direction. Optional: external, label.

# Rules

Respond with only the JSON object. No markdown, no backticks, no preamble.

## Enums (use only these exact strings; do not introduce new values)

type: ui, service, database, external, auth, infra
zone: frontend, backend, data, external, auth, infra

## The three text jobs per node

These are not three versions of the same string — each has a different job:

- "label" is a short human-friendly name for the node card. Example: "Payment Service".
- "tech" is the real technical identifier from the user's code or configuration — endpoint, runtime, vendor, version, file path. Example: "POST /api/pay · Node".
- "description" is Optic's own plain-English explanation of what the component does, written in a calm and slightly warm voice, max 200 chars. Example: "Validates the cart, creates an order record, and hands the charge off to Stripe."

## The terms array

For each node, identify up to 3 genuinely technical terms that a smart non-coder reader of the description would not know (examples: webhook, OAuth, cron, WebSocket, REST API, embeddings, session). For each, provide a one-sentence plain-English definition under 240 chars.

- Only define a term on its first occurrence in the system.
- Skip the terms array entirely if no genuinely technical terms appear in the node's description.
- Do not over-define. Common words like "database" or "API" do not need definitions. The threshold is: would a smart non-engineer need this explained?

## Zones (prefer fewer, grouped)

The six zones (frontend, backend, data, external, auth, infra) are the canonical set. Do not invent finer subcategories. If the description implies many small services, group them into one zone rather than spreading them across new ones. Cap zones at 6 in any output — the panel cannot legibly display more than 6 zones at once.

## type vs zone

"type" says what kind of component this is. "zone" says where it lives in the system architecture. These are usually the same for canonical cases (a Postgres database has type "database" and zone "data") but can differ — a self-hosted Redis cache could have type "database" and zone "backend". When in doubt, type follows the physical kind; zone follows the architectural role.

## Accuracy

Be accurate and conservative. Only include components that are explicitly mentioned or strongly implied by the description. Do not invent components, integrations, or data flows that aren't supported by the text. Every edge's "from" and "to" MUST reference an existing node "id".

## System block

Always include "system.name" (the application's name, inferred from context if not stated explicitly) and "system.summary" (a single sentence describing what the system does, max 240 chars, written in the same calm warm voice as descriptions).

## Version

Always include "version": "1.0" as the top-level field. This is fixed.

# Example

A valid response for a small e-commerce app called "ShopFlow":

{
  "version": "1.0",
  "system": {
    "name": "ShopFlow",
    "summary": "A small e-commerce app that handles product checkout, stores customer orders, and processes payments via Stripe."
  },
  "nodes": [
    {
      "id": "checkout_page",
      "label": "Checkout Page",
      "type": "ui",
      "zone": "frontend",
      "tech": "Next.js · /checkout",
      "description": "The page where the customer reviews their cart and submits payment details."
    },
    {
      "id": "payment_service",
      "label": "Payment Service",
      "type": "service",
      "zone": "backend",
      "tech": "POST /api/pay · Node",
      "description": "Validates the cart, creates an order record, and hands the charge off to Stripe."
    },
    {
      "id": "orders_db",
      "label": "Orders Database",
      "type": "database",
      "zone": "data",
      "tech": "Postgres",
      "description": "Stores one row per customer order with line items, totals, and payment status."
    },
    {
      "id": "stripe",
      "label": "Stripe",
      "type": "external",
      "zone": "external",
      "tech": "stripe.com · v2024-06-20",
      "description": "Processes the card charge and notifies the backend by webhook when the payment settles.",
      "terms": [
        {
          "term": "webhook",
          "definition": "A webhook is an automatic message one system sends to another when something happens — Stripe pings the backend after a card is charged."
        }
      ]
    },
    {
      "id": "auth_service",
      "label": "Auth Service",
      "type": "auth",
      "zone": "auth",
      "tech": "NextAuth · OAuth",
      "description": "Identifies the signed-in customer so the checkout knows whose cart to charge.",
      "terms": [
        {
          "term": "OAuth",
          "definition": "OAuth is a standard way one app lets users sign in using their account from another app, like 'Sign in with Google.'"
        }
      ]
    }
  ],
  "edges": [
    { "from": "checkout_page", "to": "payment_service", "direction": "one_way", "label": "submit payment" },
    { "from": "payment_service", "to": "orders_db", "direction": "one_way", "label": "write order" },
    { "from": "payment_service", "to": "stripe", "direction": "one_way", "external": true, "label": "charge card" }
  ]
}

Output the JSON object and nothing else.`;

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

  // 7) Five-gate v1.0 parse contract validation (schema, integrity,
  //    coherence, bounds, sanity). Throws ProviderError on any failure.
  return validateGraph(graph);
}

// ---------------------------------------------------------------------------
// Export — conforms to the ProviderAdapter contract in ../interface.js.
// ---------------------------------------------------------------------------

export const anthropicAdapter = {
  name: 'anthropic',
  displayName: 'Anthropic Claude',
  generateGraph
};
