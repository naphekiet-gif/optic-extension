// service-worker.js
// Background service worker for the Optic Chrome extension (Manifest V3).
//
// Responsibilities:
//   1. On install, configure the side panel so that clicking the toolbar action
//      opens it (chrome.sidePanel.setPanelBehavior).
//   2. Listen for messages from the side panel. On
//      { action: "parseSystem", apiKey, description }, route the request
//      through the provider registry to convert the free-text description
//      into a structured graph, and asynchronously return the result.
//
// This file is provider-agnostic. Every provider-specific concern (HTTP
// endpoint, request shape, system prompt, response parsing) lives behind
// providers/registry.js. To add or switch providers, work inside the
// providers/ folder — this file does not need to change.
//
// Security model:
//   - The API key is supplied per-request by the panel (message.apiKey) and
//     handed off to the provider registry. It is not stored, logged, or
//     echoed back to the panel by this worker.

import { generateGraph } from './providers/registry.js';

// ---------------------------------------------------------------------------
// Install hook: open the side panel when the toolbar action is clicked.
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => {
      // The error object here is a Chrome API surface error; it cannot
      // contain the user's API key (the key has never been seen at this
      // point).
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
// parseSystem handler — thin wrapper around the provider registry.
//
// IPC-layer validation (apiKey present, description present) happens here.
// Provider-layer validation (request shape, response parsing, structural
// integrity of the returned graph) happens inside the active adapter.
// ---------------------------------------------------------------------------

/**
 * @param {{ apiKey: string, description: string }} message
 * @returns {Promise<{ nodes: Array, edges: Array }>}
 */
async function handleParseSystem(message) {
  const apiKey = message && message.apiKey;
  const description = message && message.description;

  // Validate inputs locally before invoking the provider. This avoids
  // burning a network request on inputs we already know are bad.
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('Missing API key.');
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new Error('Missing system description.');
  }

  // Route through the registry. Any ProviderError (or other thrown value)
  // propagates up to the listener's .catch above, which converts it to
  // { ok: false, error: <message> } for the panel.
  return generateGraph({ apiKey, description });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Coerce any thrown value into a safe string for the panel. We never include
 * the API key here — the key is not present on any Error/ProviderError we
 * throw, and provider error bodies do not echo the caller's key.
 */
function errorMessage(err) {
  if (err && typeof err.message === 'string') return err.message;
  try { return String(err); } catch { return 'Unknown error.'; }
}
