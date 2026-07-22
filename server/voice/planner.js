import { createKeyRotator, normalizeApiKeys } from "../../apiKeyRotator.js";

const EXECUTION_ROUTING_SYSTEM_PROMPT = `You are the execution routing brain of an AI-powered web automation assistant. Your task is to match a natural-language command to the best interactive element or system action on the screen and declare exactly one action to take.

Rules:
1. Target Element Matching:
   - Prefer direct matches by visible text, aria-label, id, placeholder, or class tokens that clearly map to the command.
   - If several elements share the same label, use their contextText (surrounding parent container header/title text), spatial coordinates, and surrounding hierarchy to choose the element in the requested visual group.
   - Use fuzzy semantic equivalence for intent phrasing (e.g., "go to checkout" matching cart, checkout, proceed to pay, or payment links).
   - Use project context/description as a strong signal about site structure, target user journey, and likely actions.
   - Use last conversational context to disambiguate repeated commands (e.g., "click the second button" after a previous click) and to get to know the user's preferences and intent.

2. Action Rules & Parameter Mapping:
   - CLICK: Set target to element CSS selector.
   - TYPE: Set target to element selector, value to the text to type.
   - CLEAR_INPUT: Set target to input/textarea element selector.
   - SELECT_OPTION: Set target to dropdown/select element selector, value to the option name/value.
   - HOVER / FOCUS / HIGHLIGHT_ELEMENT: Set target to element selector.
   - READ_TEXT: Set target to the specific element containing text to read, or null for general reading.
   - SCROLL: Set target to null (or specific scrollable container), direction to "up" or "down", amount to scroll distance in pixels (e.g., 400 or 600).
   - ZOOM: Set target to null, direction to "in", "out", or "reset", amount to scale factor (e.g., 1.25 for in, 0.8 for out, 1.0 for reset).
   - PRESS_KEY: Set target to focused element selector or null, value to key name (e.g., "Enter", "Escape", "Tab").
   - NAVIGATE: Set target to null, value to target URL or path.
   - GO_BACK / GO_FORWARD / RELOAD / SUMMARIZE_PAGE: Set target to null.

3. Layout & Fallbacks:
   - If the target element is off-screen (Y < 0 or Y > viewport height), set scrollRequired to true.
   - Emit exactly ONE action per turn.
   - If no element or system action plausibly matches the instruction, set action to "NONE", confidence to 0, target to null, and explain why in reasoning.

Output Format:
Return strict JSON only matching this schema. Unused fields for a given action MUST be set to null:
{"action":"CLICK|SCROLL|TYPE|ZOOM|GO_BACK|GO_FORWARD|RELOAD|NAVIGATE|PRESS_KEY|SELECT_OPTION|CLEAR_INPUT|HOVER|HIGHLIGHT_ELEMENT|FOCUS|READ_TEXT|SUMMARIZE_PAGE|NONE","target":"CSS selector or null","value":"string or null","direction":"up|down|in|out|reset|null","amount":600,"scrollRequired":false,"confidence":0.0,"reasoning":"short explanation"}`;

const EXECUTION_ROUTING_SYNONYMS = {
  checkout: [
    "checkout",
    "proceed to pay",
    "pay",
    "payment",
    "complete purchase",
    "finish order",
  ],
  cart: ["cart", "basket", "bag", "my cart"],
  add: ["add", "buy", "place", "put in", "include"],
  open: ["open", "launch", "go to", "visit"],
  submit: ["submit", "send", "confirm", "complete"],
  signup: ["signup", "register", "create account", "join", "get started"],
  login: ["login", "log in", "sign in", "access account"],
  search: ["search", "find", "look for", "explore"],
  help: ["help", "support", "assistance", "contact us"],
  scroll: ["scroll", "move", "down", "up", "top", "bottom"],
  zoom: ["zoom", "magnify", "scale", "enlarge", "shrink"],
  navigate: ["navigate", "go to", "open the", "visit"],
  back: ["go back", "previous page", "back page", "back"],
  forward: ["go forward", "next page", "forward page", "forward"],
  reload: ["reload", "refresh", "hard refresh"],
  summarize: ["summarize", "summary", "what is on this page"],
  read: ["read", "read out", "tell me", "show me"],
  type: ["type", "fill", "write", "enter", "input"],
  clear: ["clear", "erase", "delete", "remove"],
  select: ["select", "choose", "pick", "option"],
  hover: ["hover", "mouse over", "focus on"],
  highlight: ["highlight", "focus", "emphasize"],
  press: ["press", "hit", "key", "keyboard"],
  none: ["none", "no action", "do nothing", "not sure"],
};

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRotatedApiKeyFromEnv(envVarName, options = {}) {
  const configuredKeys = normalizeApiKeys(
    options[envVarName] || process.env[envVarName] || "",
  );

  if (configuredKeys.length <= 1) {
    return configuredKeys[0] || "";
  }

  if (!globalThis.__voiceApiKeyRotators) {
    globalThis.__voiceApiKeyRotators = {};
  }

  if (!globalThis.__voiceApiKeyRotators[envVarName]) {
    globalThis.__voiceApiKeyRotators[envVarName] =
      createKeyRotator(configuredKeys);
  }

  return String(globalThis.__voiceApiKeyRotators[envVarName]()).trim();
}

function getCommandKeywords(transcript) {
  const tokens = normalizeText(transcript).split(/\s+/);
  const stopWords = new Set([
    "the",
    "and",
    "to",
    "my",
    "for",
    "a",
    "an",
    "on",
    "of",
    "with",
    "in",
    "into",
    "go",
    "click",
    "type",
    "scroll",
    "add",
    "open",
    "select",
    "submit",
    "please",
    "now",
  ]);
  return [
    ...new Set(
      tokens.filter((token) => token.length > 2 && !stopWords.has(token)),
    ),
  ];
}

function getSemanticSignals(transcript) {
  const normalizedTranscript = normalizeText(transcript);
  return Object.entries(EXECUTION_ROUTING_SYNONYMS)
    .filter(([, variants]) =>
      variants.some((variant) => normalizedTranscript.includes(variant)),
    )
    .map(([canonical]) => canonical);
}

function extractProductHint(transcript) {
  const normalizedTranscript = normalizeText(transcript);
  const match = normalizedTranscript.match(/\b(product|item)\s+([a-z0-9]+)\b/);
  if (!match) return null;
  return `${match[1]} ${match[2]}`.trim();
}

function getScrollAmount(transcript) {
  return /a bit|little|small/i.test(transcript) ? 400 : 600;
}

function extractNavigationTarget(transcript) {
  const explicitUrl = transcript.match(/https?:\/\/[^\s]+/i)?.[0];
  if (explicitUrl) return explicitUrl;

  const namedTarget = transcript.match(
    /(?:go to|navigate to|open|visit|go to the|open the)\s+(?:the\s+)?([a-z0-9./_-]+(?:\s+[a-z0-9./_-]+)*)/i,
  );
  if (namedTarget?.[1]) {
    const normalizedTarget = namedTarget[1].trim().replace(/\s+/g, "-");
    return normalizedTarget.startsWith("/")
      ? normalizedTarget
      : `/${normalizedTarget}`;
  }

  return "/";
}

function extractPressedKey(transcript) {
  const normalizedTranscript = normalizeText(transcript);
  if (/escape|esc/i.test(normalizedTranscript)) return "Escape";
  if (/tab/i.test(normalizedTranscript)) return "Tab";
  if (/space|spacebar/i.test(normalizedTranscript)) return " ";
  if (/backspace/i.test(normalizedTranscript)) return "Backspace";
  if (/delete/i.test(normalizedTranscript)) return "Delete";
  if (/arrow up|up arrow/i.test(normalizedTranscript)) return "ArrowUp";
  if (/arrow down|down arrow/i.test(normalizedTranscript)) return "ArrowDown";
  if (/arrow left|left arrow/i.test(normalizedTranscript)) return "ArrowLeft";
  if (/arrow right|right arrow/i.test(normalizedTranscript))
    return "ArrowRight";
  if (/enter|return/i.test(normalizedTranscript)) return "Enter";
  return "Enter";
}

function extractTypedValue(transcript) {
  const quotedMatch = transcript.match(
    /(?:type|enter|fill|write)[^\n]*?["']([^"']+)["']/i,
  );
  if (quotedMatch?.[1]) return quotedMatch[1].trim();

  const emailMatch = transcript.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (emailMatch?.[0]) return emailMatch[0];

  const trailingMatch = transcript.match(
    /(?:as|with|for|into)\s+([a-z0-9\s@._-]+)/i,
  );
  if (trailingMatch?.[1]) return trailingMatch[1].trim();

  return "hello@example.com";
}

function matchesFieldHint(entry, transcript) {
  const normalizedTranscript = normalizeText(transcript);
  const hintText = normalizeText(
    [
      entry?.type,
      entry?.placeholder,
      entry?.ariaLabel,
      entry?.title,
      entry?.name,
      entry?.inputMode,
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (!hintText) return false;
  if (/email|mail/.test(normalizedTranscript) && /email|mail/.test(hintText)) {
    return true;
  }
  if (/password/.test(normalizedTranscript) && /password/.test(hintText)) {
    return true;
  }
  if (/name/.test(normalizedTranscript) && /name/.test(hintText)) {
    return true;
  }
  return false;
}

function selectTypingTarget(elements, transcript) {
  const candidates = (elements || []).filter(
    (entry) => entry?.element === "input" || entry?.element === "textarea",
  );

  if (!candidates.length) return null;

  const hintedTarget = candidates.find((entry) =>
    matchesFieldHint(entry, transcript),
  );
  if (hintedTarget) return hintedTarget;

  return (
    candidates.find(
      (entry) => String(entry.type || "").toLowerCase() !== "hidden",
    ) ||
    candidates[0] ||
    null
  );
}

function extractProductPhrase(transcript) {
  const normalizedTranscript = normalizeText(transcript);
  const addPattern =
    /(?:add|buy|place|put in|include)\s+(.+?)\s+(?:to|into)\s+(?:cart|basket|bag|checkout|payment|buy)/i;
  const match = normalizedTranscript.match(addPattern);
  if (match?.[1]) {
    return normalizeText(match[1]).replace(/^(the|a|an)\s+/i, "");
  }

  const simpleProductMatch = normalizedTranscript.match(
    /\b([a-z0-9]+(?:\s+[a-z0-9]+)*)\b/i,
  );
  return simpleProductMatch?.[1] ? normalizeText(simpleProductMatch[1]) : null;
}

function buildProjectContext(projectConfig = {}) {
  const config =
    projectConfig && typeof projectConfig === "object" ? projectConfig : {};
  const parts = [];
  const description = String(
    config.websiteDescription || config.description || "",
  ).trim();

  if (description) parts.push(`Website description: ${description}`);
  const siteCategory = String(
    config.siteCategory || config.category || "",
  ).trim();

  if (siteCategory) parts.push(`Site category: ${siteCategory}`);
  const primaryLanguage = String(
    config.primaryLanguage || config.language || "",
  ).trim();

  if (primaryLanguage) parts.push(`Primary language: ${primaryLanguage}`);
  const activeModel = String(config.activeModel || "").trim();

  if (activeModel) parts.push(`Preferred router model: ${activeModel}`);
  return parts.join(" | ");
}

function resolveActionTargetLabel(actionPlan, elements = []) {
  const targetSelector = actionPlan?.target || actionPlan?.selector || null;
  const targetEntry = Array.isArray(elements)
    ? elements.find((entry) => entry?.selector === targetSelector) || null
    : null;
  const targetText =
    targetEntry?.text ||
    targetEntry?.ariaLabel ||
    targetEntry?.placeholder ||
    targetEntry?.title ||
    targetEntry?.id ||
    null;
  return targetText ? normalizeText(targetText) : null;
}

function buildFallbackTtsContext(transcript, actionPlan, elements = []) {
  const productPhrase = extractProductPhrase(transcript);
  const action = String(actionPlan?.action || "CLICK").toUpperCase();
  const targetLabel = resolveActionTargetLabel(actionPlan, elements);
  const keyLabel = actionPlan?.value || "Enter";

  if (action === "TYPE") {
    return productPhrase
      ? `Typing ${productPhrase} into the requested field.`
      : targetLabel
        ? `Typing into ${targetLabel}.`
        : "Typing the requested information into the field.";
  }

  if (action === "SCROLL") {
    const direction = actionPlan?.direction === "up" ? "up" : "down";
    return `Scrolling ${direction} on the page.`;
  }

  if (action === "GO_BACK" || action === "GO_FORWARD") {
    return action === "GO_BACK"
      ? "Going back to the previous page."
      : "Going forward to the next page.";
  }

  if (action === "RELOAD") {
    return "Refreshing the current page.";
  }

  if (action === "NAVIGATE") {
    return actionPlan?.value
      ? `Opening ${actionPlan.value}.`
      : "Opening the requested page.";
  }

  if (action === "PRESS_KEY") {
    return `Pressing ${keyLabel}.`;
  }

  if (action === "SELECT_OPTION") {
    return targetLabel
      ? `Selecting ${targetLabel}.`
      : "Choosing the requested option.";
  }

  if (action === "CLEAR_INPUT") {
    return targetLabel ? `Clearing ${targetLabel}.` : "Clearing the field.";
  }

  if (action === "HOVER") {
    return targetLabel
      ? `Hovering over ${targetLabel}.`
      : "Hovering over the requested element.";
  }

  if (action === "HIGHLIGHT_ELEMENT" || action === "FOCUS") {
    return targetLabel
      ? `Highlighting ${targetLabel}.`
      : "Highlighting the requested element.";
  }

  if (action === "READ_TEXT") {
    return targetLabel
      ? `Reading ${targetLabel}.`
      : "Reading the requested text.";
  }

  if (action === "SUMMARIZE_PAGE") {
    return "Giving you a brief summary of the page.";
  }

  if (productPhrase) {
    const normalizedProduct = normalizeText(productPhrase);
    return `Adding ${normalizedProduct} to your cart.`;
  }

  if (action === "NONE") {
    return "I could not find a matching action for that request.";
  }

  if (targetLabel) {
    return `Performing the requested action on ${targetLabel}.`;
  }

  return "Performing the requested action.";
}

function buildConversationContextPrompt(conversationContext = "") {
  if (!conversationContext) return "";
  return `Conversation context:\n${conversationContext}\n`;
}

async function generateTtsContext(
  transcript,
  actionPlan,
  elements = [],
  options = {},
) {
  const fallback = buildFallbackTtsContext(transcript, actionPlan, elements);
  const apiKey = getRotatedApiKeyFromEnv("GROQ_API_KEY", {
    GROQ_API_KEY: options.apiKey || options.groqApiKey,
  });
  if (!apiKey) return fallback;

  const baseUrl =
    options.baseUrl ||
    process.env.OPENAI_BASE_URL ||
    "https://api.groq.com/openai/v1";
  const model =
    options.model ||
    process.env.GROQ_CHAT_MODEL ||
    process.env.OPENAI_MODEL ||
    "llama-3.3-70b-versatile";

  try {
    const isSummaryAction =
      String(actionPlan?.action || "").toUpperCase() === "SUMMARIZE_PAGE";
    const systemPrompt = isSummaryAction
      ? `You are a voice assistant summarizing a web page for speech. Write one short, natural sentence that is easy to hear aloud. Keep it under 20 words, sound conversational, and avoid jargon. Return plain text only. Example: "Here’s a brief summary of the page."`
      : `You are a voice assistant. Write a short spoken sentence for a web automation action, keeping it under 20 words. Mention the product name if the user clearly mentioned one. Return plain text only. You can use last conversational context to respond more naturally using prior turns. Make the response conversational, for example:

“I’m adding the iPhone to your cart.”
“Navigating to the requested page.”`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: JSON.stringify({
              transcript,
              action: actionPlan?.action || "CLICK",
              target: actionPlan?.target || null,
              targetText: actionPlan?.reasoning || null,
              conversationContext: buildConversationContextPrompt(
                options.conversationContext || "",
              ),
            }),
          },
        ],
      }),
    });

    if (!response.ok)
      throw new Error(`TTS context generation failed: ${response.status}`);
    const data = await response.json();
    const generated = String(data?.choices?.[0]?.message?.content || "").trim();
    return generated || fallback;
  } catch (error) {
    console.warn("[tts] falling back to deterministic context:", error.message);
    return fallback;
  }
}

// Helper utility to calculate comprehensive match structural routing priority
function scoreElementRelevance(
  entry,
  normalizedTranscript,
  commandKeywords,
  semanticSignals,
) {
  // 1. ADD entry.contextText into the global layout label pool
  const label = normalizeText(
    [
      entry.text,
      entry.id,
      entry.role,
      entry.element,
      entry.selector,
      entry.placeholder,
      entry.contextText,
    ]
      .filter(Boolean)
      .join(" "),
  );

  const textPieces = [
    label,
    entry.text || "",
    entry.id || "",
    entry.role || "",
    entry.placeholder || "",
    entry.contextText || "",
  ];
  let score = 0;
  let reason = "matched weakly";

  const productHint = extractProductHint(normalizedTranscript);
  if (productHint) {
    const contextText = normalizeText(entry.contextText || "");
    const candidateText = normalizeText(
      [entry.text, entry.id, entry.role, entry.selector]
        .filter(Boolean)
        .join(" "),
    );
    const matchesProductHint =
      contextText.includes(productHint) ||
      candidateText.includes(productHint) ||
      normalizeText(entry.text || "").includes(productHint);

    if (matchesProductHint) {
      score += 9;
      reason = `matched product context: ${productHint}`;
    }
  }

  const isWritingIntent = /type|fill|write|enter|input/i.test(
    normalizedTranscript,
  );
  const isInputElement =
    entry.element === "input" || entry.element === "textarea";
  if (isWritingIntent && isInputElement) {
    score += 3;
  }

  if (commandKeywords.length && label) {
    const overlap = commandKeywords.filter((keyword) =>
      label.includes(keyword),
    ).length;
    score += overlap * 2.5;
    if (overlap > 0) reason = `matched keywords`;
  }

  // 2. NEW CRITICAL ADDITION: Give elements an explicit contextual group relevance boost
  if (entry.contextText && commandKeywords.length) {
    const contextNormalized = normalizeText(entry.contextText);
    const contextOverlap = commandKeywords.filter((keyword) =>
      contextNormalized.includes(keyword),
    ).length;

    if (contextOverlap > 0) {
      score += contextOverlap * 8.0; // Bumped weight up to assert control over structural tags
      reason = `matched within parent context: "${entry.contextText.trim()}"`;
    }
  }

  if (semanticSignals.length && textPieces.some((piece) => piece)) {
    const semanticScore = semanticSignals.filter((signal) =>
      textPieces.some((piece) => normalizeText(piece).includes(signal)),
    ).length;
    score += semanticScore * 2;
  }

  if (
    normalizedTranscript.includes(label) ||
    label.includes(normalizedTranscript)
  ) {
    score += 6;
    reason = "matched direct command";
  }

  if (
    entry.id &&
    commandKeywords.some((keyword) => normalizeText(entry.id).includes(keyword))
  ) {
    score += 3;
  }

  if (entry.text && normalizedTranscript.includes(normalizeText(entry.text))) {
    score += 4;
  }

  return { score, reason };
}

export function buildRuleBasedActionPlan(transcript, elements) {
  const normalizedTranscript = normalizeText(transcript);
  if (!normalizedTranscript) {
    return {
      action: "NONE",
      target: null,
      confidence: 0,
      reasoning: "No transcript available.",
    };
  }

  const commandKeywords = getCommandKeywords(normalizedTranscript);
  const semanticSignals = getSemanticSignals(normalizedTranscript);

  if (/go back|previous page|back page|back/i.test(normalizedTranscript)) {
    return {
      action: "GO_BACK",
      target: null,
      scrollRequired: false,
      confidence: 0.95,
      reasoning: "Matched browser back navigation intent.",
    };
  }

  if (/go forward|next page|forward page|forward/i.test(normalizedTranscript)) {
    return {
      action: "GO_FORWARD",
      target: null,
      scrollRequired: false,
      confidence: 0.95,
      reasoning: "Matched browser forward navigation intent.",
    };
  }

  if (/reload|refresh|hard refresh/i.test(normalizedTranscript)) {
    return {
      action: "RELOAD",
      target: null,
      scrollRequired: false,
      confidence: 0.95,
      reasoning: "Matched reload intent.",
    };
  }

  if (/navigate to|go to|open the|visit/i.test(normalizedTranscript)) {
    return {
      action: "NAVIGATE",
      target: null,
      value: extractNavigationTarget(transcript),
      scrollRequired: false,
      confidence: 0.9,
      reasoning: "Matched navigation intent.",
    };
  }

  if (/press|hit|key/i.test(normalizedTranscript)) {
    const keyName = extractPressedKey(transcript);
    if (
      /enter|escape|tab|space|backspace|delete|arrow/i.test(
        normalizedTranscript,
      )
    ) {
      return {
        action: "PRESS_KEY",
        target: null,
        value: keyName,
        scrollRequired: false,
        confidence: 0.92,
        reasoning: "Matched keyboard shortcut intent.",
      };
    }
  }

  if (/summarize|summary|what is on this page/i.test(normalizedTranscript)) {
    return {
      action: "SUMMARIZE_PAGE",
      target: null,
      value: null,
      scrollRequired: false,
      confidence: 0.9,
      reasoning: "Matched page summarization intent.",
    };
  }

  if (/read|read out|tell me|show me/i.test(normalizedTranscript)) {
    return {
      action: "READ_TEXT",
      target: null,
      value: null,
      scrollRequired: false,
      confidence: 0.9,
      reasoning: "Matched read-text intent.",
    };
  }

  if (/scroll|move|down|up|top|bottom/i.test(normalizedTranscript)) {
    const direction = /down|bottom/i.test(normalizedTranscript)
      ? "down"
      : /up|top/i.test(normalizedTranscript)
        ? "up"
        : "down";
    const amount = getScrollAmount(normalizedTranscript);
    return {
      action: "SCROLL",
      direction,
      amount,
      scrollRequired: false,
      confidence: 0.95,
      reasoning: "Matched global viewport scroll command.",
    };
  }

  if (/zoom|magnify|scale/i.test(normalizedTranscript)) {
    const isOut = /out|smaller|decrease/i.test(normalizedTranscript);
    const isReset = /reset|normal|100%/i.test(normalizedTranscript);

    return {
      action: "ZOOM",
      direction: isReset ? "reset" : isOut ? "out" : "in",
      amount: isReset ? 1.0 : isOut ? 0.8 : 1.25,
      scrollRequired: false,
      confidence: 0.95,
      reasoning: "Matched zoom command intent.",
    };
  }

  let candidates = (elements || [])
    .filter(Boolean)
    .map((entry) => {
      const { score, reason } = scoreElementRelevance(
        entry,
        normalizedTranscript,
        commandKeywords,
        semanticSignals,
      );

      const position = entry.position || {};
      const h = position.height || position.h || 0;
      const scrollRequired =
        (position.y || 0) < 0 ||
        (position.y || 0) + h < 0 ||
        (position.y || 0) > 1400;

      return { ...entry, score, scrollRequired, reasoning: reason };
    })
    .filter((entry) => entry.score > 0);

  if (candidates.length === 0) {
    return {
      action: "NONE",
      target: null,
      confidence: 0,
      scrollRequired: false,
      reasoning: "No interactive element matched command criteria.",
    };
  }

  // --- Start Directional/Spatial Re-Sorting ---
  const hasTop = /top|upper/i.test(normalizedTranscript);
  const hasBottom = /bottom|lower/i.test(normalizedTranscript);
  const hasLeft = /left/i.test(normalizedTranscript);
  const hasRight = /right/i.test(normalizedTranscript);

  candidates.sort((left, right) => {
    // FIX: Contextual Matching Override Check
    // If one candidate belongs explicitly to the matching parent group and the other doesn't, elevate it immediately
    if (left.contextText && right.contextText) {
      const leftCtx = normalizeText(left.contextText);
      const rightCtx = normalizeText(right.contextText);
      const leftMatch = commandKeywords.some((kw) => leftCtx.includes(kw));
      const rightMatch = commandKeywords.some((kw) => rightCtx.includes(kw));
      if (leftMatch && !rightMatch) return -1;
      if (!leftMatch && rightMatch) return 1;
    }

    // 1. Prioritize strict keyword/semantic intent scores first
    if (Math.abs(left.score - right.score) > 0.1) {
      return right.score - left.score;
    }

    // 2. Spatial tie-breaking if relevance scores are identical
    const posA = left.position || {};
    const posB = right.position || {};
    const yA = posA.y || 0;
    const yB = posB.y || 0;
    const xA = posA.x || 0;
    const xB = posB.x || 0;
    const wA = posA.width || posA.w || 0;
    const wB = posB.width || posB.w || 0;

    if (hasTop) return yA - yB;
    if (hasBottom) return yB - yA;
    if (hasLeft) return xA - xB;
    if (hasRight) return xB + wB - (xA + wA);

    return yA - yB;
  });
  // --- End Directional/Spatial Re-Sorting ---

  // --- Start Index-Based Selection Extraction ---
  let bestMatch = candidates[0];
  let strategyExtension = "";

  if (/second|2nd/i.test(normalizedTranscript) && candidates.length > 1) {
    bestMatch = candidates[1];
    strategyExtension = " (Targeted 2nd matching element via index)";
  } else if (/third|3rd/i.test(normalizedTranscript) && candidates.length > 2) {
    bestMatch = candidates[2];
    strategyExtension = " (Targeted 3rd matching element via index)";
  } else if (/last/i.test(normalizedTranscript) && candidates.length > 0) {
    bestMatch = candidates[candidates.length - 1];
    strategyExtension = " (Targeted final matching element via index)";
  }
  // --- End Index-Based Selection Extraction ---

  const inputTarget = selectTypingTarget(elements, normalizedTranscript);
  const selectTarget = (elements || []).find(
    (entry) => entry?.element === "select",
  );
  const isTypeAction =
    /type|fill|write|enter|input|email|name|password/i.test(
      normalizedTranscript,
    ) &&
    Boolean(
      inputTarget ||
      bestMatch.element === "input" ||
      bestMatch.element === "textarea",
    );
  const isSelectAction =
    /select|choose|pick/i.test(normalizedTranscript) && Boolean(selectTarget);
  const isClearInputAction =
    /clear|erase|empty/i.test(normalizedTranscript) &&
    Boolean(
      inputTarget ||
      bestMatch.element === "input" ||
      bestMatch.element === "textarea",
    );
  const isHoverAction = /hover|mouse over|tooltip/i.test(normalizedTranscript);
  const isFocusAction = /focus|highlight|show me where|outline/i.test(
    normalizedTranscript,
  );
  const isReadAction = /read|read out|tell me/i.test(normalizedTranscript);
  const isSummarizeAction = /summarize|summary|what is on this page/i.test(
    normalizedTranscript,
  );

  if (isTypeAction) {
    const resolvedInputTarget = inputTarget || bestMatch;
    const value = extractTypedValue(transcript);

    return {
      action: "TYPE",
      target: resolvedInputTarget?.selector || bestMatch.selector || null,
      value,
      scrollRequired: Boolean(
        resolvedInputTarget?.scrollRequired ?? bestMatch.scrollRequired,
      ),
      confidence: Math.min(
        0.99,
        Math.max(
          0.2,
          0.6 + (resolvedInputTarget?.score ?? bestMatch.score) * 0.1,
        ),
      ),
      reasoning: `Targeted input field via: "${resolvedInputTarget?.reasoning || bestMatch.reasoning}"${strategyExtension}`,
    };
  }

  if (isSelectAction) {
    return {
      action: "SELECT_OPTION",
      target: selectTarget?.selector || bestMatch.selector || null,
      value: extractTypedValue(transcript),
      scrollRequired: Boolean(
        selectTarget?.scrollRequired ?? bestMatch.scrollRequired,
      ),
      confidence: Math.min(
        0.99,
        Math.max(0.2, 0.65 + (selectTarget?.score ?? bestMatch.score) * 0.08),
      ),
      reasoning: `Matched selection control via: ${selectTarget?.reasoning || bestMatch.reasoning}`,
    };
  }

  if (isClearInputAction) {
    const resolvedInputTarget = inputTarget || bestMatch;
    return {
      action: "CLEAR_INPUT",
      target: resolvedInputTarget?.selector || bestMatch.selector || null,
      value: null,
      scrollRequired: Boolean(
        resolvedInputTarget?.scrollRequired ?? bestMatch.scrollRequired,
      ),
      confidence: Math.min(
        0.99,
        Math.max(
          0.2,
          0.7 + (resolvedInputTarget?.score ?? bestMatch.score) * 0.08,
        ),
      ),
      reasoning: `Matched clear-input intent via: ${resolvedInputTarget?.reasoning || bestMatch.reasoning}`,
    };
  }

  if (isHoverAction) {
    return {
      action: "HOVER",
      target: bestMatch.selector || null,
      scrollRequired: Boolean(bestMatch.scrollRequired),
      confidence: Math.min(0.99, Math.max(0.2, 0.7 + bestMatch.score * 0.07)),
      reasoning: `Matched hover intent via: ${bestMatch.reasoning}.${strategyExtension}`,
    };
  }

  if (isFocusAction) {
    return {
      action: "HIGHLIGHT_ELEMENT",
      target: bestMatch.selector || null,
      scrollRequired: Boolean(bestMatch.scrollRequired),
      confidence: Math.min(0.99, Math.max(0.2, 0.7 + bestMatch.score * 0.07)),
      reasoning: `Matched focus or highlight intent via: ${bestMatch.reasoning}.${strategyExtension}`,
    };
  }

  if (isReadAction) {
    return {
      action: "READ_TEXT",
      target: bestMatch.selector || null,
      value: null,
      scrollRequired: Boolean(bestMatch.scrollRequired),
      confidence: Math.min(0.99, Math.max(0.2, 0.7 + bestMatch.score * 0.07)),
      reasoning: `Matched read-text intent via: ${bestMatch.reasoning}.${strategyExtension}`,
    };
  }

  if (isSummarizeAction) {
    return {
      action: "SUMMARIZE_PAGE",
      target: null,
      value: null,
      scrollRequired: false,
      confidence: 0.9,
      reasoning: "Matched page summarization intent.",
    };
  }

  const confidence = Math.min(
    0.99,
    Math.max(0.2, 0.55 + bestMatch.score * 0.12),
  );
  return {
    action: "CLICK",
    target: bestMatch.selector || null,
    scrollRequired: Boolean(bestMatch.scrollRequired),
    confidence,
    reasoning: `Matched candidate with strategy: ${bestMatch.reasoning}.${strategyExtension}`,
  };
}

export function normalizeActionPlan(actionPlan) {
  if (!actionPlan || typeof actionPlan !== "object") {
    return {
      action: "NONE",
      target: null,
      confidence: 0,
      reasoning: "No plan returned.",
    };
  }

  const normalizedAction = String(actionPlan.action || "NONE").toUpperCase();
  const allowedActions = [
    "CLICK",
    "SCROLL",
    "TYPE",
    "ZOOM",
    "GO_BACK",
    "GO_FORWARD",
    "RELOAD",
    "NAVIGATE",
    "PRESS_KEY",
    "SELECT_OPTION",
    "CLEAR_INPUT",
    "HOVER",
    "HIGHLIGHT_ELEMENT",
    "FOCUS",
    "READ_TEXT",
    "SUMMARIZE_PAGE",
    "NONE",
  ];
  const action = allowedActions.includes(normalizedAction)
    ? normalizedAction
    : "NONE";

  const confidenceValue =
    typeof actionPlan.confidence === "number"
      ? actionPlan.confidence
      : typeof actionPlan.confidence === "string"
        ? Number(actionPlan.confidence)
        : undefined;

  return {
    action,
    target: actionPlan.target || actionPlan.selector || null,
    value: actionPlan.value || actionPlan.text || null,
    direction: actionPlan.direction || null,
    amount: actionPlan.amount || null,
    scrollRequired: Boolean(actionPlan.scrollRequired),
    confidence:
      typeof confidenceValue === "number" && Number.isFinite(confidenceValue)
        ? Math.max(0, Math.min(0.99, confidenceValue))
        : 0,
    reasoning:
      actionPlan.reasoning || actionPlan.reason || "planning completed",
    ttsContext: actionPlan.ttsContext || null,
  };
}

export async function buildActionPlan(transcript, elements, options = {}) {
  const normalizedTranscript = normalizeText(transcript);
  const commandKeywords = getCommandKeywords(normalizedTranscript);
  const semanticSignals = getSemanticSignals(normalizedTranscript);

  const scoredElements = (elements || []).map((el) => {
    const { score } = scoreElementRelevance(
      el,
      normalizedTranscript,
      commandKeywords,
      semanticSignals,
    );

    const visibilityBonus =
      el.position?.y >= 0 && el.position?.y <= 1080 ? 0.5 : 0;

    return { ...el, relevanceScore: score + visibilityBonus };
  });

  const optimizedElements = scoredElements
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .map(({ relevanceScore, ...el }) => el)
    .slice(0, 20);

  const fallback = buildRuleBasedActionPlan(transcript, elements);
  const apiKey = getRotatedApiKeyFromEnv("GROQ_API_KEY", {
    GROQ_API_KEY: options.apiKey,
  });
  if (!apiKey) return fallback;

  const model =
    options.model ||
    process.env.OPENAI_MODEL ||
    process.env.GROQ_CHAT_MODEL ||
    "gpt-4o-mini";
  const baseUrl =
    options.baseUrl ||
    process.env.OPENAI_BASE_URL ||
    (process.env.OPENAI_API_KEY
      ? "https://api.openai.com/v1"
      : "https://api.groq.com/openai/v1");

  const projectContext = buildProjectContext(
    options.projectConfig || options.projectContext || options.context || {},
  );
  const conversationContext = String(options.conversationContext || "").trim();

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXECUTION_ROUTING_SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              transcript,
              elements: optimizedElements,
              projectContext,
              conversationContext:
                buildConversationContextPrompt(conversationContext),
            }),
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`LLM request failed: ${response.status}`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "{}";
    const parsedActionPlan =
      typeof content === "string" ? JSON.parse(content) : content;
    const normalizedActionPlan = normalizeActionPlan(parsedActionPlan);
    const ttsContext = await generateTtsContext(
      transcript,
      normalizedActionPlan,
      elements,
      { apiKey, baseUrl, model, projectContext, conversationContext },
    );
    return {
      ...normalizedActionPlan,
      ttsContext,
    };
  } catch (error) {
    console.warn("[llm] falling back to rule-based planner:", error.message);
    const ttsContext = await generateTtsContext(
      transcript,
      fallback,
      elements,
      { apiKey, baseUrl, model, projectContext, conversationContext },
    );
    return {
      ...fallback,
      ttsContext,
    };
  }
}
