// providers/shared/errors.js
//
// Categorised error type used across the provider layer. Adapters throw
// ProviderError so callers (panel.js, future telemetry, future retry logic)
// can branch on the .category field instead of regex-matching message text.

/**
 * Categories:
 *   'auth'         — bad / missing / revoked API key (HTTP 401/403).
 *   'rate_limit'   — too many requests (HTTP 429).
 *   'network'      — transport-level failure or 5xx upstream error.
 *   'parse'        — provider response could not be parsed.
 *   'validation'   — caller-side input invalid, or returned graph malformed.
 *   'unknown'      — anything else.
 *
 * The message field is safe to display to the user. Adapters MUST NOT include
 * the API key or any other credential in the message under any code path.
 */
export class ProviderError extends Error {
  constructor(message, category = 'unknown') {
    super(message);
    this.name = 'ProviderError';
    this.category = category;
  }
}

/**
 * Map an HTTP status code to a ProviderError category. Used by adapters when
 * their upstream call returns a non-OK response.
 *
 * @param {number} status
 * @returns {('auth'|'rate_limit'|'network'|'unknown')}
 */
export function categorizeHttpStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500 && status < 600) return 'network';
  return 'unknown';
}
