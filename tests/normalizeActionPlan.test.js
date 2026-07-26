import test from "node:test";
import assert from "node:assert/strict";
import {
  buildActionPlan,
  normalizeActionPlan,
} from "../server/voice/planner.js";

test("normalizeActionPlan accepts RESPOND and preserves message", () => {
  const normalized = normalizeActionPlan({
    action: "RESPOND",
    message: "This form asks for Name and Email.",
    confidence: 0.72,
  });

  assert.equal(normalized.action, "RESPOND");
  assert.equal(normalized.message, "This form asks for Name and Email.");
  assert.equal(normalized.confidence, 0.72);
});

test("normalizeActionPlan backfills the top-level action from a wrapped plan", () => {
  const normalized = normalizeActionPlan({
    plan: [
      {
        action: "CLICK",
        target: "#cart-button",
        confidence: 0.9,
        reasoning: "Open the cart first.",
      },
      {
        action: "NAVIGATE",
        value: "/checkout",
        confidence: 0.86,
        reasoning: "Continue to the payment page.",
      },
    ],
  });

  assert.equal(normalized.action, "CLICK");
  assert.equal(normalized.plan.length, 2);
  assert.equal(normalized.plan[0].action, "CLICK");
  assert.equal(normalized.plan[1].action, "NAVIGATE");
});

test("buildActionPlan falls back to rule-based planning when the LLM is rate limited", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () =>
      JSON.stringify({
        error: {
          message: "Rate limit reached",
          code: "rate_limit_exceeded",
        },
      }),
  });

  try {
    const plan = await buildActionPlan("scroll down the page", [], {
      groqApiKey: "test-key",
    });

    assert.equal(plan.action, "SCROLL");
    assert.equal(plan.direction, "down");
  } finally {
    global.fetch = originalFetch;
  }
});

test("buildActionPlan recognizes left and right scroll intents", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "SCROLL",
                direction: "right",
                amount: 400,
              }),
            },
          },
        ],
      }),
    json: async () => ({
      choices: [
        {
          message: {
            content: "ok",
          },
        },
      ],
    }),
  });

  try {
    const plan = await buildActionPlan("scroll right a bit", [], {
      groqApiKey: "test-key",
    });

    assert.equal(plan.action, "SCROLL");
    assert.equal(plan.direction, "right");
    assert.equal(plan.amount, 400);
  } finally {
    global.fetch = originalFetch;
  }
});

test("buildActionPlan recognizes scroll to the end and beginning intents", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ action: "SCROLL", value: "end" }),
            },
          },
        ],
      }),
    json: async () => ({
      choices: [
        {
          message: {
            content: "ok",
          },
        },
      ],
    }),
  });

  try {
    const plan = await buildActionPlan("scroll to the end", [], {
      groqApiKey: "test-key",
    });

    assert.equal(plan.action, "SCROLL");
    assert.equal(plan.value, "end");
  } finally {
    global.fetch = originalFetch;
  }
});

test("buildActionPlan uses separate planning and TTS Groq keys", async () => {
  const originalFetch = global.fetch;
  const authHeaders = [];
  global.fetch = async (_url, init = {}) => {
    authHeaders.push(init.headers.Authorization);
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ action: "RESPOND", message: "ok" }),
              },
            },
          ],
        }),
      json: async () => ({
        choices: [
          {
            message: {
              content: "Hello from TTS",
            },
          },
        ],
      }),
    };
  };

  try {
    await buildActionPlan("say hello", [], {
      planningApiKey: "planning-key",
      ttsApiKey: "tts-key",
    });

    assert.deepEqual(authHeaders, ["Bearer planning-key", "Bearer tts-key"]);
  } finally {
    global.fetch = originalFetch;
  }
});
