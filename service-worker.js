// service-worker.js
// Background service worker for the Optic Chrome extension (Manifest V3).
//
// Responsibilities:
//   1. On install, configure the side panel so that clicking the toolbar action
//      opens it (chrome.sidePanel.setPanelBehavior).
//   2. Listen for messages from the side panel. When the panel sends
//      { action: "parseSystem", apiKey, description }, call the Anthropic
//      Messages API to convert the free-text system description into a
//      structured graph (nodes + edges), and asynchronously return the result.
//
// Security model:
//   - The Anthropic API key is NEVER hardcoded in this file. It is supplied
//     on every request by the panel (message.apiKey), used only inside the
//     outgoing request header, and discarded when the request handler returns.
//   - The key is never logged, never persisted by this worker, never echoed
//     back to the panel in any response, and never written to the console.

// ---------------------------------------------------------------------------
// Constants
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
// Install hook: open the side panel when the toolbar action is clicked.
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => {
      // The error object here is a Chrome API surface error; it cannot contain
      // the user's API key (the key has never been seen at this point).
      console.error('[Optic] Failed to configure side panel behaviour:', err);
    });
});

// ---------------------------------------------------------------------------
// Message router: handle requests from the side panel.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.action === 'parseSystem') {
    // Run the async handler. We must return `true` SYNCHRONOUSLY below so
    // Chrome keeps the message channel open until sendResponse is invoked.
    handleParseSystem(message)
      .then((graph) => sendResponse({ ok: true, graph }))
      .catch((err) => sendResponse({ ok: false, error: errorMessage(err) }));
    return true;
  }
  // Any other action: return nothing → channel closes immediately, sender
  // receives `undefined`. We do not silently swallow unknown actions; the
  // panel should only send actions it knows this worker handles.
});

// ---------------------------------------------------------------------------
// parseSystem handler
// ---------------------------------------------------------------------------

/**
 * Call the Anthropic Messages API and return the parsed graph object.
 * Throws on missing inputs, HTTP errors, missing response fields, or JSON
 * parse failures. All thrown errors are caught at the message-listener
 * boundary and converted into { ok: false, error } responses for the panel.
 *
 * @param {{ apiKey: string, description: string }} message
 * @returns {Promise<{ nodes: Array, edges: Array }>}
 */
async function handleParseSystem(message) {
  const apiKey = message && message.apiKey;
  const description = message && message.description;

  // Validate inputs locally before making a network call. This avoids burning
  // a request on something we already know will fail.
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('Missing Anthropic API key.');
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new Error('Missing system description.');
  }

  // Build the request. The API key flows ONLY into the x-api-key header
  // below; it is not placed anywhere else and never leaves this function.
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
    })
  });

  // Non-OK status: produce a clear error including the status code, and
  // (best-effort) include up to 300 chars of the response body so the panel
  // can show a useful message. Anthropic's error bodies never contain the
  // caller's key, so this slice cannot leak credentials.
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.text();
      if (body) detail = ` — ${body.slice(0, 300)}`;
    } catch {
      // Body unreadable; carry on with just the status code.
    }
    throw new Error(`Anthropic API returned HTTP ${response.status}${detail}`);
  }

  // Parse the wrapper response. The Messages API shape is:
  //   { content: [ { type: "text", text: "..." }, ... ], ... }
  const payload = await response.json();
  const textBlock = Array.isArray(payload.content)
    ? payload.content.find((b) => b && b.type === 'text')
    : null;
  if (!textBlock || typeof textBlock.text !== 'string') {
    throw new Error('Anthropic response did not contain a text block.');
  }

  // Defensive cleanup: strip markdown code fences in case the model emits
  // them despite being told not to.
  const cleaned = stripCodeFences(textBlock.text).trim();

  // Parse the inner JSON.
  let graph;
  try {
    graph = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse JSON from model response: ${err.message}`);
  }

  // Light structural validation. Deep schema enforcement (type enums, edge
  // referential integrity) belongs in the panel, which owns the rendering.
  if (!graph || typeof graph !== 'object' ||
      !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('Model response did not contain nodes and edges arrays.');
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip ```lang ... ``` or ``` ... ``` markdown fences from a string.
 * Returns the inner content if a fence is detected, otherwise the original
 * string (trimmed).
 */
function stripCodeFences(text) {
  let s = String(text).trim();
  // Remove opening fence with optional language tag.
  s = s.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '');
  // Remove closing fence.
  s = s.replace(/\n?```\s*$/, '');
  return s;
}

/**
 * Coerce any thrown value into a safe string for the panel. We never include
 * the API key here — the key is not present on any Error we throw, and
 * Anthropic's error bodies do not echo the caller's key.
 */
function errorMessage(err) {
  if (err && typeof err.message === 'string') return err.message;
  try { return String(err); } catch { return 'Unknown error.'; }
}
