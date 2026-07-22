// Normalizes API keys from an array or comma-separated string into a clean array of strings.
function normalizeApiKeys(apiKeys) {
  if (Array.isArray(apiKeys)) {
    return apiKeys.map((key) => String(key ?? "").trim()).filter(Boolean);
  }

  if (typeof apiKeys === "string") {
    return apiKeys
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
  }

  return [];
}

/**
 * Creates a function that returns the next API key in a round-robin cycle.
 *
 * @param {string[]|string} apiKeys - Array of API keys or a comma-separated string
 * @returns {function(): string} Function that returns the next API key in sequence
 */
function createKeyRotator(apiKeys) {
  const normalizedKeys = normalizeApiKeys(apiKeys);
  if (normalizedKeys.length === 0) {
    throw new Error("An array with at least one API key is required.");
  }

  let index = 0;

  return function getNextKey() {
    const key = normalizedKeys[index];
    index = (index + 1) % normalizedKeys.length;
    return key;
  };
}

/**
 * Creates a custom fetch wrapper that automatically attaches a rotated API key to request headers.
 *
 * @param {string[]|string} apiKeys - Array of API keys or a comma-separated string
 * @param {Object} [config] - Configuration options
 * @param {string} [config.headerName='Authorization'] - The HTTP header key for the API key
 * @param {function(string): string} [config.formatter] - Optional function to format the key (e.g., Bearer token)
 * @returns {function(string, Object=): Promise<Response>} Custom fetch function
 */
function createRotatedFetch(apiKeys, config = {}) {
  const normalizedKeys = normalizeApiKeys(apiKeys);
  if (normalizedKeys.length === 0) {
    throw new Error("An array with at least one API key is required.");
  }

  const { headerName = "Authorization", formatter = (key) => `Bearer ${key}` } =
    config;

  let index = 0;

  return async function rotatedFetch(url, options = {}) {
    const key = normalizedKeys[index];
    index = (index + 1) % normalizedKeys.length;

    const headers = {
      ...(options.headers || {}),
      [headerName]: formatter ? formatter(key) : key,
    };

    return fetch(url, {
      ...options,
      headers,
    });
  };
}

/**
 * ES6 Generator function that endlessly yields API keys in a round-robin sequence.
 *
 * @param {string[]|string} apiKeys - Array of API keys or a comma-separated string
 * @yields {string} The next API key
 */
function* apiKeyGenerator(apiKeys) {
  const normalizedKeys = normalizeApiKeys(apiKeys);
  if (normalizedKeys.length === 0) {
    throw new Error("An array with at least one API key is required.");
  }

  let index = 0;
  while (true) {
    yield normalizedKeys[index];
    index = (index + 1) % normalizedKeys.length;
  }
}

/**
 * Class implementation for managing rotated API keys with status/logging support.
 */
class KeyRotatorManager {
  /**
   * @param {string[]|string} apiKeys - Array of API keys or a comma-separated string
   */
  constructor(apiKeys) {
    const normalizedKeys = normalizeApiKeys(apiKeys);
    if (normalizedKeys.length === 0) {
      throw new Error("An array with at least one API key is required.");
    }
    this.apiKeys = [...normalizedKeys];
    this.currentIndex = 0;
  }

  /**
   * Returns the next API key and advances the pointer.
   * @returns {string}
   */
  getKey() {
    const key = this.apiKeys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
    return key;
  }

  /**
   * Peek at the active key without advancing the cycle.
   * @returns {string}
   */
  peekKey() {
    return this.apiKeys[this.currentIndex];
  }

  /**
   * Total number of keys currently configured.
   * @returns {number}
   */
  get size() {
    return this.apiKeys.length;
  }
}

const apiKeyRotatorExports = {
  createKeyRotator,
  createRotatedFetch,
  apiKeyGenerator,
  KeyRotatorManager,
  normalizeApiKeys,
};

export {
  createKeyRotator,
  createRotatedFetch,
  apiKeyGenerator,
  KeyRotatorManager,
  normalizeApiKeys,
};
export default apiKeyRotatorExports;

if (typeof module !== "undefined" && module.exports) {
  module.exports = apiKeyRotatorExports;
}
