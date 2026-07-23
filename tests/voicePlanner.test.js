import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRuleBasedActionPlan,
  normalizeActionPlan,
  summarizeConversationContext,
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

test("summarizeConversationContext keeps the most recent turns", () => {
  const summary = summarizeConversationContext([
    { transcript: "first turn", action: "CLICK", ttsContext: "First" },
    { transcript: "second turn", action: "TYPE", ttsContext: "Second" },
    { transcript: "third turn", action: "RESPOND", ttsContext: "Third" },
  ]);

  assert.match(summary, /third turn/);
  assert.match(summary, /second turn/);
  assert.doesNotMatch(summary, /first turn/);
});
