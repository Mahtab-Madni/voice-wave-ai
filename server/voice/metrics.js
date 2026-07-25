function normalizeMetrics(metrics = {}) {
  const safeMetrics = metrics && typeof metrics === "object" ? metrics : {};

  return {
    voiceSessions: Number(safeMetrics.voiceSessions || 0),
    avgConfidence: Number(safeMetrics.avgConfidence || 0),
    executionSuccess: Number(safeMetrics.executionSuccess || 0),
    LLMCalls: Number(safeMetrics.LLMCalls || 0),
  };
}

export function getSessionLifecycle(state = "", session = {}) {
  const normalizedState = String(state || "").toLowerCase();
  const active = Boolean(session?.metricsSessionActive);

  if (normalizedState === "start" && !active) {
    return { shouldStart: true, shouldEnd: false };
  }

  if ((normalizedState === "stop" || normalizedState === "pause") && active) {
    return { shouldStart: false, shouldEnd: true };
  }

  if (normalizedState === "resume" && active) {
    return { shouldStart: false, shouldEnd: false };
  }

  return { shouldStart: false, shouldEnd: false };
}

export function applyMetricsEvent(existingMetrics = {}, event = {}) {
  const metrics = normalizeMetrics(existingMetrics);
  const type = String(event?.type || "").toLowerCase();

  if (type === "session_start") {
    metrics.voiceSessions += 1;
    return metrics;
  }

  if (type === "llm_call") {
    metrics.LLMCalls += 1;
    return metrics;
  }

  if (type === "action_result") {
    const confidence = Number(event?.confidence ?? 0);
    const success = Boolean(event?.success);

    const previousSessions = metrics.voiceSessions || 0;
    const previousAvgConfidence = metrics.avgConfidence || 0;
    const previousSuccess = metrics.executionSuccess || 0;

    const nextCount = previousSessions > 0 ? previousSessions : 1;
    const nextAvgConfidence =
      previousSessions > 0
        ? Number(
            (
              (previousAvgConfidence * previousSessions + confidence * 100) /
              nextCount
            ).toFixed(1),
          )
        : Number((confidence * 100).toFixed(1));

    const nextExecutionSuccess =
      previousSessions > 0
        ? Number(
            (
              (previousSuccess * previousSessions + (success ? 100 : 0)) /
              nextCount
            ).toFixed(1),
          )
        : success
          ? 100
          : 0;

    metrics.avgConfidence = nextAvgConfidence;
    metrics.executionSuccess = nextExecutionSuccess;
  }

  return metrics;
}
