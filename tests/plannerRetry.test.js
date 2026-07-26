import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetryAndRotation } from "../server/voice/planner.js";

test("fetchWithRetryAndRotation retries transient failures and rotates keys", async () => {
  delete globalThis.__voiceApiKeyRotators;
  process.env.GROQ_AUTOMATION_API_KEY = "key-one,key-two";

  let attempts = 0;
  const seenKeys = [];
  const fetchImpl = async (_url, init = {}) => {
    attempts += 1;
    const authHeader = init?.headers?.Authorization || "";
    const apiKey = authHeader.replace(/^Bearer\s+/i, "");
    seenKeys.push(apiKey);

    if (attempts < 3) {
      return {
        ok: false,
        status: 429,
        text: async () => '{"error":{"message":"Rate limit reached"}}',
      };
    }

    return {
      ok: true,
      status: 200,
      text: async () => '{"choices":[{"message":{"content":"{}"}}]}',
    };
  };

  const result = await fetchWithRetryAndRotation({
    role: "planning",
    options: {},
    url: "https://example.test/chat/completions",
    requestInit: { method: "POST" },
    fetchImpl,
    maxRetries: 2,
    baseDelayMs: 0,
  });

  assert.equal(attempts, 3);
  assert.deepEqual(seenKeys, ["key-one", "key-two", "key-one"]);
  assert.equal(result.apiKey, "key-one");
  assert.equal(
    result.responseText,
    '{"choices":[{"message":{"content":"{}"}}]}',
  );
});
