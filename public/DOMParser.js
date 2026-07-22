class AccessibilityDOMParser {
  constructor(options = {}) {
    this.maxElements = options.maxElements || 40;
    this.maxTextLength = options.maxTextLength || 120;
    this.maxPayloadBytes = options.maxPayloadBytes || 14000;
    this.maxPreviewChars = options.maxPreviewChars || 80;
    this.handler = options.handler || null;
  }

  collectContext() {
    const elements = [];
    const candidates = document.querySelectorAll(
      "a, button, input, select, textarea, summary, [role], [onclick]",
    );

    for (const candidate of candidates) {
      if (elements.length >= this.maxElements) break;
      if (!this.isTrulyInteractive(candidate)) continue;

      const rect = candidate.getBoundingClientRect();
      const text = this.getElementText(candidate);

      elements.push({
        element: candidate.tagName.toLowerCase(),
        type: candidate.type || undefined,
        text: text.slice(0, this.maxTextLength),
        selector: this.buildUniqueSelector(candidate),
        id: candidate.id || undefined,
        role: candidate.getAttribute("role") || undefined,
        placeholder: candidate.getAttribute("placeholder") || undefined,
        ariaLabel: candidate.getAttribute("aria-label") || undefined,
        title: candidate.getAttribute("title") || undefined,
        name: candidate.getAttribute("name") || undefined,
        inputMode: candidate.getAttribute("inputmode") || undefined,
        contextText: this.getContextText(candidate),
        position: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    }

    const payload = this.handler?.prepareContext
      ? this.handler.prepareContext(elements, {
          maxElements: this.maxElements,
          maxTextLength: this.maxTextLength,
          maxPayloadBytes: this.maxPayloadBytes,
          maxPreviewChars: this.maxPreviewChars,
        })
      : elements;

    return Array.isArray(payload) ? payload : elements;
  }

  isTrulyInteractive(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    // Structural Exclusion
    if (element.closest("script, style, noscript, svg, head")) return false;

    // FIX: Check if the element OR any of its parents are aria-hidden or hidden
    if (
      element.disabled ||
      element.hasAttribute("hidden") ||
      element.closest('[aria-hidden="true"]') // <--- THIS FIXES THE BUG
    ) {
      return false;
    }

    // Layout and Viewport Validation
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;

    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      parseFloat(style.opacity) === 0 ||
      style.pointerEvents === "none"
    ) {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    const role = (element.getAttribute("role") || "").toLowerCase();

    if (tagName === "a" && !element.hasAttribute("href")) return false;
    if (tagName === "input" && element.type === "hidden") return false;

    if (
      (tagName === "div" || tagName === "span" || tagName === "section") &&
      !element.hasAttribute("onclick") &&
      !element.hasAttribute("role")
    ) {
      return false;
    }

    const interactiveTags = [
      "a",
      "button",
      "input",
      "select",
      "textarea",
      "summary",
    ];
    const interactiveRoles = [
      "button",
      "link",
      "menuitem",
      "tab",
      "switch",
      "checkbox",
      "radio",
      "searchbox",
      "textbox",
    ];

    return (
      interactiveTags.includes(tagName) ||
      interactiveRoles.includes(role) ||
      element.hasAttribute("onclick")
    );
  }

  getElementText(element) {
    let text = "";

    if (
      element.tagName.toLowerCase() === "input" &&
      ["submit", "button"].includes(element.type)
    ) {
      text = element.value || "";
    } else {
      text = element.innerText || element.textContent || "";
    }

    text = text.replace(/\s+/g, " ").trim();

    if (!text) {
      text =
        element.getAttribute("aria-label") ||
        element.getAttribute("placeholder") ||
        element.getAttribute("title") ||
        "";
    }

    return text;
  }

  getContextText(element) {
    const scope = element.closest(
      "article, section, form, div, li, tr, td, p, span",
    );
    if (!scope || scope === document.body) {
      return "";
    }

    const pieces = [];
    const heading = scope.querySelector("h1, h2, h3, h4, h5, h6");
    if (heading?.textContent) {
      pieces.push(heading.textContent);
    }

    const scopeText = (scope.textContent || "").replace(/\s+/g, " ").trim();
    if (scopeText) {
      pieces.push(scopeText);
    }

    return pieces.join(" ").slice(0, 220);
  }

  buildUniqueSelector(element) {
    if (element.id) {
      const escapedId = CSS.escape(element.id);
      if (document.querySelectorAll(`#${escapedId}`).length === 1) {
        return `#${element.id}`;
      }
    }

    if (element.getAttribute("data-testid")) {
      const testId = CSS.escape(element.getAttribute("data-testid"));
      return `[data-testid="${testId}"]`;
    }

    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (current.tagName.toLowerCase() === "body") {
        path.unshift("body");
        break;
      }

      let selector = current.tagName.toLowerCase();

      // OPTIMIZATION: If the element has classes, use them to make a cleaner selector!
      if (current.classList.length > 0) {
        const classSelector = Array.from(current.classList)
          .map((c) => `.${CSS.escape(c)}`)
          .join("");
        selector += classSelector;
      }

      const parent = current.parentElement;
      if (parent) {
        // If the selector isn't unique among siblings, add nth-of-type fallback
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName,
        );
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }

      path.unshift(selector);
      current = parent;
    }

    return path.join(" > ");
  }

  buildExecutionPlan(transcript, elements = this.collectContext()) {
    const normalizedTranscript = (transcript || "").toLowerCase().trim();
    if (!normalizedTranscript) {
      return { action: "NONE", target: null, reason: "no transcript" };
    }

    const sortedElements = (elements || []).filter(Boolean).map((entry) => ({
      ...entry,
      textLower: (entry.text || "").toLowerCase(),
    }));

    if (/scroll|move|down|up|top|bottom|page/i.test(normalizedTranscript)) {
      const direction = /down|bottom|page down/i.test(normalizedTranscript)
        ? "down"
        : /up|top|page up/i.test(normalizedTranscript)
          ? "up"
          : "down";
      const amount = /a bit|little|small/i.test(normalizedTranscript)
        ? 240
        : 600;
      return {
        action: "SCROLL",
        direction,
        amount,
        reason: "matched scroll intent",
      };
    }

    if (
      /type|fill|write|enter|input|email|name|password/i.test(
        normalizedTranscript,
      )
    ) {
      const inputTarget =
        sortedElements.find(
          (entry) => entry.element === "input" || entry.element === "textarea",
        ) || sortedElements[0];
      const valueMatch = normalizedTranscript.match(
        /(?:as|with|for|into)\s+([a-z0-9@._-]+)$/i,
      );
      const value = valueMatch ? valueMatch[1] : "hello@example.com";
      return {
        action: "TYPE",
        target: inputTarget?.selector || null,
        value,
        reason: "matched typing intent",
      };
    }

    const directMatch = sortedElements.find((entry) => {
      const textLower = (entry.textLower || "").trim();
      if (!textLower) return false;
      return (
        normalizedTranscript.includes(textLower) ||
        textLower.includes(normalizedTranscript)
      );
    });

    if (directMatch) {
      return {
        action: "CLICK",
        target: directMatch.selector,
        reason: "matched by text",
        confidence: "high",
      };
    }

    const fallback = sortedElements[0];
    return {
      action: fallback ? "CLICK" : "NONE",
      target: fallback?.selector || null,
      reason: fallback
        ? "fallback to first interactive element"
        : "no interactive elements found",
      confidence: "low",
    };
  }

  // buildExecutionPlan(transcript, elements = this.collectContext()) {
  //   const normalizedTranscript = (transcript || "").toLowerCase().trim();
  //   if (!normalizedTranscript) {
  //     return { action: "NONE", target: null, reason: "no transcript" };
  //   }

  //   const sortedElements = (elements || []).filter(Boolean).map((entry) => ({
  //     ...entry,
  //     textLower: (entry.text || "").toLowerCase(),
  //   }));

  //   if (/scroll|move|down|up|top|bottom|page/i.test(normalizedTranscript)) {
  //     const direction = /down|bottom|page down/i.test(normalizedTranscript)
  //       ? "down"
  //       : /up|top|page up/i.test(normalizedTranscript)
  //         ? "up"
  //         : "down";
  //     const amount = /a bit|little|small/i.test(normalizedTranscript)
  //       ? 240
  //       : 600;
  //     return {
  //       action: "SCROLL",
  //       direction,
  //       amount,
  //       reason: "matched scroll intent",
  //     };
  //   }

  //   if (
  //     /type|fill|write|enter|input|email|name|password/i.test(
  //       normalizedTranscript,
  //     )
  //   ) {
  //     const inputTarget =
  //       sortedElements.find(
  //         (entry) => entry.element === "input" || entry.element === "textarea",
  //       ) || sortedElements[0];
  //     const valueMatch = normalizedTranscript.match(
  //       /(?:as|with|for|into)\s+([a-z0-9@._-]+)$/i,
  //     );
  //     const value = valueMatch ? valueMatch[1] : "hello@example.com";
  //     return {
  //       action: "TYPE",
  //       target: inputTarget?.selector || null,
  //       value,
  //       reason: "matched typing intent",
  //     };
  //   }

  //   const directMatch = sortedElements.find((entry) => {
  //     const textLower = (entry.textLower || "").trim();
  //     if (!textLower) return false;
  //     return (
  //       normalizedTranscript.includes(textLower) ||
  //       textLower.includes(normalizedTranscript)
  //     );
  //   });

  //   if (directMatch) {
  //     return {
  //       action: "CLICK",
  //       target: directMatch.selector,
  //       reason: "matched by text",
  //       confidence: "high",
  //     };
  //   }

  //   const fallback = sortedElements[0];
  //   return {
  //     action: fallback ? "CLICK" : "NONE",
  //     target: fallback?.selector || null,
  //     reason: fallback
  //       ? "fallback to first interactive element"
  //       : "no interactive elements found",
  //     confidence: "low",
  //   };
  // }
}

window.AccessibilityDOMParser = AccessibilityDOMParser;
