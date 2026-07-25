import test from "node:test";
import assert from "node:assert/strict";
import {
  buildActionPlan,
  buildRuleBasedActionPlan,
  normalizeActionPlan,
} from "../server/voice/planner.js";

test("buildRuleBasedActionPlan maps navigation and keyboard actions", () => {
  const backPlan = buildRuleBasedActionPlan("go back to the previous page", []);
  assert.equal(backPlan.action, "GO_BACK");
  assert.equal(backPlan.confidence, 0.95);

  const reloadPlan = buildRuleBasedActionPlan("refresh this page", []);
  assert.equal(reloadPlan.action, "RELOAD");
  assert.equal(reloadPlan.confidence, 0.95);

  const keyPlan = buildRuleBasedActionPlan("press enter", []);
  assert.equal(keyPlan.action, "PRESS_KEY");
  assert.equal(keyPlan.value, "Enter");
});

test("normalizeActionPlan accepts the new action verbs", () => {
  const normalized = normalizeActionPlan({
    action: "HOVER",
    target: "#products",
    confidence: 0.88,
    reasoning: "matched hover intent",
  });

  assert.equal(normalized.action, "HOVER");
  assert.equal(normalized.target, "#products");
  assert.equal(normalized.confidence, 0.88);
});
test("buildRuleBasedActionPlan maps read and summarize actions", () => {
  const readPlan = buildRuleBasedActionPlan("read the total amount", []);
  assert.equal(readPlan.action, "READ_TEXT");

  const summarizePlan = buildRuleBasedActionPlan("summarize this page", []);
  assert.equal(summarizePlan.action, "SUMMARIZE_PAGE");
});

test("buildRuleBasedActionPlan preserves a concise summary phrase", () => {
  const summaryAction = buildRuleBasedActionPlan("summarize this page", []);
  const summaryPhrase = summaryAction.ttsContext || summaryAction.reasoning;

  assert.equal(summaryAction.action, "SUMMARIZE_PAGE");
  assert.match(summaryPhrase, /brief|summary|page/i);
});

test("buildRuleBasedActionPlan uses project context for project questions", () => {
  const plan = buildRuleBasedActionPlan("what is my project about", [], {
    projectConfig: {
      projectName: "Acme Commerce",
      websiteDescription: "A storefront for selling handmade goods",
    },
  });

  assert.equal(plan.action, "RESPOND");
  assert.match(plan.message, /Acme Commerce|handmade goods/i);
});

test("buildRuleBasedActionPlan introduces itself with project context", () => {
  const plan = buildRuleBasedActionPlan("introduce yourself", [], {
    projectConfig: {
      projectName: "Acme Commerce",
      websiteDescription: "A storefront for selling handmade goods",
    },
  });

  assert.equal(plan.action, "RESPOND");
  assert.match(plan.message, /automation agent|Acme Commerce/i);
});

test("buildRuleBasedActionPlan prefers a visible nav link over a fabricated route", () => {
  const plan = buildRuleBasedActionPlan("go to products page", [
    {
      element: "a",
      text: "Products",
      selector: "#nav-products",
      contextText: "Navigation",
      position: { x: 10, y: 10, width: 80, height: 24 },
    },
    {
      element: "a",
      text: "Contact",
      selector: "#nav-contact",
      contextText: "Navigation",
      position: { x: 10, y: 40, width: 80, height: 24 },
    },
  ]);

  assert.equal(plan.action, "CLICK");
  assert.equal(plan.target, "#nav-products");
});

test("buildActionPlan tries the LLM first for short commands", async () => {
  const originalFetch = global.fetch;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalGroqKey = process.env.GROQ_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.GROQ_API_KEY;

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              '{"action":"CLICK","target":"#home","confidence":0.95,"reasoning":"matched home link"}',
          },
        },
      ],
    }),
  });

  try {
    const plan = await buildActionPlan("go home", [], {});
    assert.equal(plan.action, "CLICK");
    assert.equal(plan.target, "#home");
  } finally {
    global.fetch = originalFetch;
    if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAIKey;
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;
  }
});

test("buildActionPlan uses an OpenAI-style API key when available", async () => {
  const originalFetch = global.fetch;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalGroqKey = process.env.GROQ_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.GROQ_API_KEY;

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              '{"action":"CLICK","target":"#contact","confidence":0.95,"reasoning":"matched contact link"}',
          },
        },
      ],
    }),
  });

  try {
    const plan = await buildActionPlan("go to contact", [], {});
    assert.equal(plan.action, "CLICK");
    assert.equal(plan.target, "#contact");
    assert.equal(plan.confidence, 0.95);
  } finally {
    global.fetch = originalFetch;
    if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAIKey;
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;
  }
});

test("buildActionPlan retries with a fallback model when the first provider model fails", async () => {
  const originalFetch = global.fetch;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalGroqKey = process.env.GROQ_API_KEY;
  const originalGroqModel = process.env.GROQ_CHAT_MODEL;
  process.env.OPENAI_API_KEY = "";
  process.env.GROQ_API_KEY = "test-groq-key";
  process.env.GROQ_CHAT_MODEL = "openai/gpt-oss-120b";

  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    if (calls === 1) {
      return {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({ error: { message: "model not found" } }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"action":"CLICK","target":"#support","confidence":0.93,"reasoning":"matched support link"}',
            },
          },
        ],
      }),
    };
  };

  try {
    const plan = await buildActionPlan("go to support", [], {});
    assert.equal(plan.action, "CLICK");
    assert.equal(plan.target, "#support");
    assert.ok(calls >= 2);
  } finally {
    global.fetch = originalFetch;
    if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAIKey;
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;
    if (originalGroqModel === undefined) delete process.env.GROQ_CHAT_MODEL;
    else process.env.GROQ_CHAT_MODEL = originalGroqModel;
  }
});
