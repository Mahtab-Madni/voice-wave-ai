import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMetricsEvent,
  getSessionLifecycle,
} from "../server/voice/metrics.js";

test("applyMetricsEvent increments counters and rolls averages", () => {
  let metrics = {};

  metrics = applyMetricsEvent(metrics, { type: "session_start" });
  assert.equal(metrics.voiceSessions, 1);

  metrics = applyMetricsEvent(metrics, { type: "llm_call" });
  assert.equal(metrics.LLMCalls, 1);

  metrics = applyMetricsEvent(metrics, {
    type: "action_result",
    confidence: 0.88,
    success: true,
  });

  assert.equal(metrics.avgConfidence, 88);
  assert.equal(metrics.executionSuccess, 100);
});

test("getSessionLifecycle only starts a new session on start and ends on stop", () => {
  assert.deepEqual(getSessionLifecycle("start", {}), {
    shouldStart: true,
    shouldEnd: false,
  });

  assert.deepEqual(
    getSessionLifecycle("resume", { metricsSessionActive: true }),
    {
      shouldStart: false,
      shouldEnd: false,
    },
  );

  assert.deepEqual(
    getSessionLifecycle("stop", { metricsSessionActive: true }),
    {
      shouldStart: false,
      shouldEnd: true,
    },
  );
});
