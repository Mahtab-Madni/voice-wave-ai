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

// Creates a simple key rotator function that returns the next API key in a round-robin fashion.
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

// Creates a fetch wrapper that automatically rotates through API keys for each request.
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

// Generator function that yields API keys in a round-robin fashion.
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

// A class that manages API keys and provides methods to get the next key, peek at the current key, and check the total number of keys.
class KeyRotatorManager {
  // Initializes the key rotator manager with a list of API keys.
  constructor(apiKeys) {
    const normalizedKeys = normalizeApiKeys(apiKeys);
    if (normalizedKeys.length === 0) {
      throw new Error("An array with at least one API key is required.");
    }
    this.apiKeys = [...normalizedKeys];
    this.currentIndex = 0;
  }

  // Returns the next API key in a round-robin fashion and advances the cycle.
  getKey() {
    const key = this.apiKeys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
    return key;
  }

  // Returns the current API key without advancing the cycle.
  peekKey() {
    return this.apiKeys[this.currentIndex];
  }

  // Returns the total number of API keys managed by this instance.
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
