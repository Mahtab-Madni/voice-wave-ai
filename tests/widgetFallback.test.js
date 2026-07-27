import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const widgetSource = readFileSync(
  path.resolve(__dirname, "../public/widget.js"),
  "utf8",
);

function extractFindFallbackActionTarget(source) {
  const start = source.indexOf("function findFallbackActionTarget(actionPlan)");
  assert.notEqual(start, -1, "expected findFallbackActionTarget to be present");

  const braceStart = source.indexOf("{", start);
  assert.notEqual(braceStart, -1, "expected function body to start");

  let depth = 0;
  let end = -1;

  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  assert.notEqual(end, -1, "expected function body to end");
  return source.slice(start, end + 1);
}

function createCandidate(tagName, props = {}) {
  const attributes = new Map();
  const entry = {
    tagName,
    disabled: Boolean(props.disabled),
    innerText: props.innerText || "",
    textContent: props.textContent || props.innerText || "",
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };

  Object.entries(props).forEach(([key, value]) => {
    if (key === "innerText" || key === "textContent" || key === "disabled") {
      return;
    }
    entry.setAttribute(key, value);
  });

  return entry;
}

test("findFallbackActionTarget uses a visible button fallback for CLICK actions", () => {
  const functionSource = `
    function normalizeActionText(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/\\s+/g, " ")
        .trim();
    }
    ${extractFindFallbackActionTarget(widgetSource)}
  `;

  const candidates = [
    createCandidate("button", { innerText: "Submit feedback" }),
    createCandidate("input", { type: "text", placeholder: "Name" }),
  ];

  const context = {
    console: { debug() {}, warn() {} },
    document: {
      querySelectorAll() {
        return candidates;
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(functionSource, context);

  const target = context.findFallbackActionTarget({
    action: "CLICK",
    reasoning: "click the feedback button",
  });

  assert.equal(target, candidates[0]);
});

test("findFallbackActionTarget uses a visible input fallback for TYPE actions", () => {
  const functionSource = `
    function normalizeActionText(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/\\s+/g, " ")
        .trim();
    }
    ${extractFindFallbackActionTarget(widgetSource)}
  `;

  const candidates = [
    createCandidate("button", { innerText: "Send" }),
    createCandidate("textarea", { placeholder: "Add your message" }),
  ];

  const context = {
    console: { debug() {}, warn() {} },
    document: {
      querySelectorAll() {
        return candidates;
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(functionSource, context);

  const target = context.findFallbackActionTarget({
    action: "TYPE",
    reasoning: "type into the message box",
  });

  assert.equal(target, candidates[1]);
});

test("prepareQueuedNavigationResume arms the resume path for stored queued actions", () => {
  const helperStart = widgetSource.indexOf(
    "function prepareQueuedNavigationResume",
  );
  assert.notEqual(
    helperStart,
    -1,
    "expected prepareQueuedNavigationResume to be present",
  );

  const braceStart = widgetSource.indexOf("{", helperStart);
  let depth = 0;
  let end = -1;

  for (let index = braceStart; index < widgetSource.length; index += 1) {
    const char = widgetSource[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  assert.notEqual(
    end,
    -1,
    "expected prepareQueuedNavigationResume body to end",
  );
  const functionSource = widgetSource.slice(helperStart, end + 1);

  const scheduled = [];
  const context = {
    console: { debug() {}, warn() {} },
    window: {
      setTimeout(callback) {
        scheduled.push(callback);
        return 1;
      },
      clearTimeout() {},
    },
    scriptState: { awaitingQueuedNavigationResume: false },
    restorePendingQueuedActions() {
      return [{ action: "CLICK" }];
    },
    clearQueuedNavigationResumeTimer() {},
  };
  vm.createContext(context);
  vm.runInContext(functionSource, context);

  context.prepareQueuedNavigationResume(400);

  assert.equal(context.scriptState.awaitingQueuedNavigationResume, true);
  assert.equal(scheduled.length, 1);
});

test("buildQueuedPlanCompletionMessage returns a completion message for multi-step plans", () => {
  const helperStart = widgetSource.indexOf(
    "function buildQueuedPlanCompletionMessage",
  );
  assert.notEqual(
    helperStart,
    -1,
    "expected buildQueuedPlanCompletionMessage to be present",
  );

  const braceStart = widgetSource.indexOf("{", helperStart);
  let depth = 0;
  let end = -1;

  for (let index = braceStart; index < widgetSource.length; index += 1) {
    const char = widgetSource[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  assert.notEqual(end, -1, "expected completion-message helper body to end");
  const functionSource = widgetSource.slice(helperStart, end + 1);

  const context = {
    console: { debug() {}, warn() {} },
    normalizeQueuedActions(actionPlan) {
      const plan = actionPlan?.plan || actionPlan?.actions || actionPlan?.steps;
      if (Array.isArray(plan)) return plan.filter(Boolean);
      if (actionPlan?.action && actionPlan.action !== "NONE")
        return [actionPlan];
      return [];
    },
  };
  vm.createContext(context);
  vm.runInContext(functionSource, context);

  const message = context.buildQueuedPlanCompletionMessage(
    { plan: [{ action: "CLICK" }, { action: "TYPE" }] },
    [],
  );

  assert.equal(message, "The requested task is complete.");
});

test("shouldResumeListeningAfterQueuedActions stays false when a navigation pause still has queued work", () => {
  const helperStart = widgetSource.indexOf(
    "function shouldResumeListeningAfterQueuedActions",
  );
  assert.notEqual(
    helperStart,
    -1,
    "expected queue-resume helper to be present",
  );

  const braceStart = widgetSource.indexOf("{", helperStart);
  let depth = 0;
  let end = -1;

  for (let index = braceStart; index < widgetSource.length; index += 1) {
    const char = widgetSource[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  assert.notEqual(end, -1, "expected queue-resume helper body to end");
  const functionSource = widgetSource.slice(helperStart, end + 1);

  const context = { console: { debug() {}, warn() {} } };
  vm.createContext(context);
  vm.runInContext(functionSource, context);

  const shouldResume = context.shouldResumeListeningAfterQueuedActions(
    true,
    true,
    false,
  );

  assert.equal(shouldResume, false);
});
