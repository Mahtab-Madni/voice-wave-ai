(function () {
  if (!window.AccessibilityDOMHandler) {
    class AccessibilityDOMHandler {
      constructor(options = {}) {
        this.maxElements = options.maxElements || 40;
        this.maxTextLength = options.maxTextLength || 120;
        this.maxPayloadBytes = options.maxPayloadBytes || 14000;
        this.maxPreviewChars = options.maxPreviewChars || 80;
      }

      normalizeText(value) {
        return String(value || "")
          .replace(/\s+/g, " ")
          .trim();
      }

      truncateText(value, maxLength = this.maxTextLength) {
        const text = this.normalizeText(value);
        if (!text) return "";
        return text.length > maxLength
          ? `${text.slice(0, Math.max(0, maxLength - 1))}…`
          : text;
      }

      shortenSelector(selector, id) {
        if (!selector) return null;
        if (id) return `#${id}`;

        const testIdMatch = selector.match(
          /\[(data-testid|data-qa|data-cy)="([^"]+)"\]/,
        );
        if (testIdMatch) {
          return `[${testIdMatch[1]}="${testIdMatch[2]}"]`;
        }

        const normalizedSelector = String(selector)
          .replace(/^body\s*>\s*/i, "")
          .replace(/\s+/g, " ")
          .trim();

        if (normalizedSelector.includes(" > ")) {
          const parts = normalizedSelector.split(" > ");
          if (parts.length > 2) {
            return `${parts[parts.length - 2]} > ${parts[parts.length - 1]}`;
          }
          return normalizedSelector;
        }

        return normalizedSelector;
      }

      minimizePosition(position) {
        if (!position) return undefined;
        return {
          x: Math.round(position.x || 0),
          y: Math.round(position.y || 0),
          w: Math.round(position.width || position.w || 0),
          h: Math.round(position.height || position.h || 0),
        };
      }

      getParentContextText(selector) {
        if (typeof document === "undefined" || !selector) return "";
        try {
          const el = document.querySelector(selector);
          if (!el) return "";
          const container = el.closest(
            ".card, .card-1, .card-2, [class*='card'], section, fieldset, li, item",
          );
          if (container) {
            const header = container.querySelector(
              "h1, h2, h3, h4, label, .title",
            );
            if (header && header.innerText) {
              return header.innerText;
            }
            return container.innerText.slice(0, 40);
          }
        } catch (error) {
          console.warn("[voice-widget] parent context lookup failed", error);
        }
        return "";
      }

      prepareContext(elements = [], options = {}) {
        const context = Array.isArray(elements) ? elements : [];
        const safeElements = context
          .filter((entry) => {
            if (!entry) return false;
            const pos = entry.position;
            if (pos) {
              const w = pos.width || pos.w || 0;
              const h = pos.height || pos.h || 0;
              if (w <= 0 || h <= 0) return false;
            }
            return true;
          })
          .slice(0, options.maxElements || this.maxElements)
          .map((entry) => {
            const targetId = entry?.id || undefined;
            const originalFullSelector = entry?.selector;
            const existingContextText = this.normalizeText(entry?.contextText);
            const parentLabel = existingContextText
              ? existingContextText
              : this.getParentContextText(originalFullSelector);

            return {
              ...entry,
              text: this.truncateText(
                entry?.text,
                options.maxTextLength || this.maxTextLength,
              ),
              contextText: parentLabel
                ? this.truncateText(parentLabel, 140)
                : undefined,
              selector: this.shortenSelector(originalFullSelector, targetId),
              id: targetId,
              role: entry?.role || undefined,
              position: this.minimizePosition(entry?.position),
            };
          });

        const serialized = JSON.stringify(safeElements);
        if (
          serialized.length <= (options.maxPayloadBytes || this.maxPayloadBytes)
        ) {
          return safeElements;
        }

        return safeElements
          .slice(
            0,
            Math.max(
              6,
              Math.floor((options.maxElements || this.maxElements) / 2),
            ),
          )
          .map((entry) => ({
            ...entry,
            text: this.truncateText(entry?.text, this.maxPreviewChars),
            contextText: entry.contextText,
            selector: entry?.selector || null,
            id: entry?.id || undefined,
            role: entry?.role || undefined,
            position: entry?.position || undefined,
          }));
      }
    }

    window.AccessibilityDOMHandler = AccessibilityDOMHandler;
    window.DOMHandler = AccessibilityDOMHandler;
  }

  if (!window.AccessibilityDOMParser) {
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

      collectStructuredData() {
        const structured = { tables: [], grids: [] };

        try {
          // Tables
          const tables = Array.from(document.querySelectorAll("table"));
          for (const table of tables) {
            const headers = [];
            const thead = table.querySelector("thead");
            if (thead) {
              const ths = thead.querySelectorAll("th");
              ths.forEach((th) =>
                headers.push(
                  this.truncateText(th.innerText || th.textContent || "", 80),
                ),
              );
            } else {
              const firstRow = table.querySelector("tr");
              if (firstRow) {
                const ths = firstRow.querySelectorAll("th,td");
                ths.forEach((th) =>
                  headers.push(
                    this.truncateText(th.innerText || th.textContent || "", 80),
                  ),
                );
              }
            }

            const rows = [];
            const trs = table.querySelectorAll("tbody tr, tr");

            const parseNumericValue = (raw) => {
              const text = String(raw || "").trim();
              if (!text) return null;

              // percent like 12%
              const percentMatch = text.match(/^\s*([-+]?\d[\d,\.\s]*)%\s*$/);
              if (percentMatch) {
                const num = Number(percentMatch[1].replace(/[ ,]/g, ""));
                return {
                  number: Number.isFinite(num) ? num : null,
                  percent: true,
                  currency: null,
                  raw: text,
                };
              }

              // currency symbol prefix like $12.34
              const currencyMatch = text.match(
                /^(?:\s*)([$€£¥])\s*([-+]?\d[\d,\.]*)/,
              );
              if (currencyMatch) {
                const symbol = currencyMatch[1];
                const num = Number(currencyMatch[2].replace(/,/g, ""));
                return {
                  number: Number.isFinite(num) ? num : null,
                  percent: false,
                  currency: symbol,
                  raw: text,
                };
              }

              // trailing currency code like 12.34 USD
              const currencyCodeMatch = text.match(
                /^\s*([-+]?\d[\d,\.\s]*)\s*(USD|EUR|GBP|AUD|CAD|JPY)\s*$/i,
              );
              if (currencyCodeMatch) {
                const num = Number(currencyCodeMatch[1].replace(/[ ,]/g, ""));
                return {
                  number: Number.isFinite(num) ? num : null,
                  percent: false,
                  currency: currencyCodeMatch[2].toUpperCase(),
                  raw: text,
                };
              }

              // plain number with commas/decimals
              const plainNumMatch = text.match(/^\s*([-+]?\d[\d,\.]*)\s*$/);
              if (plainNumMatch) {
                const num = Number(plainNumMatch[1].replace(/,/g, ""));
                return {
                  number: Number.isFinite(num) ? num : null,
                  percent: false,
                  currency: null,
                  raw: text,
                };
              }

              return null;
            };

            trs.forEach((tr, idx) => {
              const cells = Array.from(tr.querySelectorAll("td,th")).map(
                (cell) => {
                  const txt = this.truncateText(
                    cell.innerText || cell.textContent || "",
                    140,
                  );
                  const parsed = parseNumericValue(txt);
                  return { text: txt, parsed };
                },
              );
              if (cells.length) rows.push({ index: idx, cells });
            });

            structured.tables.push({
              selector: this.buildUniqueSelector(table),
              headers,
              rows,
            });
          }

          // Simple grids / repeated items: find containers with 3+ similar children
          const potentialContainers = Array.from(
            document.querySelectorAll("div,section,ul,ol"),
          );
          for (const container of potentialContainers) {
            const children = Array.from(container.children).filter(
              (c) => c.nodeType === Node.ELEMENT_NODE,
            );
            if (children.length < 3) continue;
            const tagNames = children.map((c) => c.tagName.toLowerCase());
            const mostCommon = tagNames.reduce(
              (acc, t) => ((acc[t] = (acc[t] || 0) + 1), acc),
              {},
            );
            const entries = Object.entries(mostCommon).sort(
              (a, b) => b[1] - a[1],
            );
            if (entries.length && entries[0][1] >= 3) {
              const sampleChildren = children.slice(
                0,
                Math.min(8, children.length),
              );
              const items = sampleChildren.map((child, i) => ({
                index: i,
                text: this.truncateText(
                  child.innerText || child.textContent || "",
                  220,
                ),
                selector: this.buildUniqueSelector(child),
              }));
              structured.grids.push({
                selector: this.buildUniqueSelector(container),
                itemCount: children.length,
                items,
              });
            }
          }
        } catch (err) {
          console.warn("[voice-widget] structured data extraction failed", err);
        }

        return structured;
      }

      isTrulyInteractive(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        if (element.closest("script, style, noscript, svg, head")) return false;
        if (
          element.disabled ||
          element.hasAttribute("hidden") ||
          element.closest('[aria-hidden="true"]')
        ) {
          return false;
        }

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
          if (current.classList.length > 0) {
            const classSelector = Array.from(current.classList)
              .map((c) => `.${CSS.escape(c)}`)
              .join("");
            selector += classSelector;
          }

          const parent = current.parentElement;
          if (parent) {
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

        const sortedElements = (elements || [])
          .filter(Boolean)
          .map((entry) => ({
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
              (entry) =>
                entry.element === "input" || entry.element === "textarea",
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
    }

    window.AccessibilityDOMParser = AccessibilityDOMParser;
  }

  const scriptState = {
    socket: null,
    mediaRecorder: null,
    stream: null,
    recognition: null,
    listening: false,
    sessionActive: false,
    userInitiatedStop: false,
    processing: false,
    suppressFlushOnStop: false,
    latestTranscript: "",
    feedbackTimer: null,
    lastProcessedTranscript: "",
    lastProcessedTranscriptKey: "",
    pendingTranscriptTimer: null,
    silenceTimer: null,
    silenceThreshold: 0.035,
    lastVoiceActivityAt: 0,
    audioContext: null,
    analyser: null,
    analyserBuffer: null,
    audioActivityFrame: null,
    pendingFlushRequest: false,
    mediaMimeType: null,
    chunkFlushTimer: null,
    transcriptDispatchInFlight: new Set(),
    lastSpokenMessageKey: "",
    lastSpokenAt: 0,
    activeAudio: null,
    activePlaybackRequestId: 0,
    lastHandledActionKey: "",
    lastHandledActionAt: 0,
    isExpanded: false,
    initChunk: null,
    initChunkLastSentAt: 0,
  };

  const overlayId = "voice-widget-overlay";
  const triggerId = "voice-widget-trigger";
  const buttonId = "voice-widget-button";
  const closeButtonId = "voice-widget-close-button";
  const labelId = "voice-widget-label";
  const feedbackId = "voice-widget-feedback";
  const styleId = "voice-widget-style";

  const currentScript =
    document.currentScript ||
    Array.from(document.scripts).find((script) =>
      /widget\.js(?:\?.*)?$/.test(script.src),
    );
  const defaultApiUrl = "https://voice-wave-ai-production.up.railway.app";
  const defaultWsUrl = "wss://voice-wave-ai-production.up.railway.app";
  const configuredApiUrl =
    window.__VOICE_WIDGET_API_URL__ ||
    currentScript?.getAttribute("data-api-url") ||
    currentScript?.getAttribute("data-base-url") ||
    defaultApiUrl;
  const configuredWsUrl =
    window.__VOICE_WIDGET_WS_URL__ ||
    currentScript?.getAttribute("data-ws-url") ||
    defaultWsUrl;
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const inferredOrigin = (() => {
    try {
      const scriptUrl = currentScript?.src
        ? new URL(currentScript.src, window.location.href)
        : null;
      return scriptUrl?.origin || "";
    } catch (error) {
      console.warn("[voice-widget] could not infer widget origin", error);
      return "";
    }
  })();
  function normalizeSocketUrl(url) {
    if (!url) return "";
    if (/^ws(s)?:\/\//i.test(url)) return url;
    return url.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  }
  const wsUrl =
    normalizeSocketUrl(
      configuredWsUrl || configuredApiUrl || inferredOrigin || defaultWsUrl,
    ) || defaultWsUrl;

  const domHandler = new window.AccessibilityDOMHandler({ maxElements: 40 });
  const domParser = new window.AccessibilityDOMParser({
    maxElements: 40,
    handler: domHandler,
  });

  const waveMarkSvg = `<svg viewBox="0 0 20 20" style="width: 28px; height: 28px;" fill="currentColor"><rect x="0" y="7" width="2.4" height="6" rx="1.2"/><rect x="4" y="4" width="2.4" height="12" rx="1.2"/><rect x="8" y="1" width="2.4" height="18" rx="1.2"/><rect x="12" y="4" width="2.4" height="12" rx="1.2"/><rect x="16" y="7" width="2.4" height="6" rx="1.2"/></svg>`;
  const closeIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  const micIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mic-svg"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;
  const stopIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stop-svg"><rect width="14" height="14" x="5" y="5" rx="2"/></svg>`;

  function injectWidgetStyles() {
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #${triggerId} {
        position: fixed;
        right: 1.5rem;
        bottom: 1.5rem;
        z-index: 2147483647;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: rgb(0, 0, 0);
        color: #f4f7ff;
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        outline: none;
        transition: transform 0.2s ease, opacity 0.2s ease;
      }

      #${triggerId}:hover {
        transform: scale(1.08);
      }

      #${overlayId} {
        position: fixed;
        right: 1.5rem;
        bottom: 1.5rem;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        width: 220px;
        height: 220px;
        padding: 0.75rem 0.75rem 1rem 0.75rem;
        border-radius: 1.5rem;
        background: rgb(0, 0, 0);
        color: #f4f7ff;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-sizing: border-box;
        transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.2s ease, opacity 0.2s ease;
      }

      #${overlayId}.is-hidden {
        display: none !important;
      }

      #${overlayId} .voice-widget-header {
        width: 100%;
        display: flex;
        justify-content: flex-end;
      }

      #${closeButtonId} {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.7);
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: color 0.2s ease, background 0.2s ease;
      }

      #${closeButtonId}:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.1);
      }

      #${overlayId}.is-listening {
        border-color: rgba(239, 68, 68, 0.4);
        box-shadow: 0 20px 40px rgba(239, 68, 68, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }

      #${overlayId} .voice-widget-orb-container {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        flex: 1;
      }

      #${overlayId} button#${buttonId} {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 90px;
        height: 90px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
        border: 1px solid rgba(255, 255, 255, 0.15);
        cursor: pointer;
        outline: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        transform: translateY(-14px);
        transition: all 0.2s ease;
      }

      #${overlayId} button#${buttonId}:hover {
        transform: translateY(-14px) scale(1.05);
        background: rgba(255, 255, 255, 0.18);
      }

      #${overlayId} button#${buttonId}:active {
        transform: translateY(-14px) scale(0.95);
      }

      #${overlayId}.is-listening button#${buttonId} {
        background: rgba(239, 68, 68, 0.2);
        border-color: rgba(239, 68, 68, 0.5);
        color: #ef4444;
        animation: voice-widget-pulse 1.5s infinite ease-in-out;
      }

      #${overlayId}.is-processing button#${buttonId} {
        background: rgba(59, 130, 246, 0.2);
        border-color: rgba(59, 130, 246, 0.55);
        color: #38bdf8;
        animation: voice-widget-buffer 1.2s infinite ease-in-out;
      }

      @keyframes voice-widget-buffer {
        0% {
          box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4);
        }
        50% {
          box-shadow: 0 0 0 12px rgba(59, 130, 246, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(59, 130, 246, 0);
        }
      }

      #${overlayId} .voice-widget-copy {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      #${overlayId} .voice-widget-pill {
        width: 100%;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 0.75rem;
        padding: 0.4rem 0.6rem;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
      }

      #${feedbackId} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.35rem;
        font-size: 0.75rem;
        line-height: 1.2;
        color: rgba(255, 255, 255, 0.8);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: center;
        width: 100%;
      }

      #${feedbackId} .voice-widget-action-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        font-size: 0.9rem;
      }

      #${feedbackId} .voice-widget-feedback-text {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #${labelId} {
        display: none;
      }

      @keyframes voice-widget-pulse {
        0% {
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
        }
        70% {
          box-shadow: 0 0 0 12px rgba(239, 68, 68, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function getOverlay() {
    return document.getElementById(overlayId);
  }

  function setListeningVisualState(isListening) {
    const overlay = getOverlay();
    if (!overlay) return;
    overlay.classList.toggle("is-listening", Boolean(isListening));

    const button = document.getElementById(buttonId);
    if (button) {
      button.innerHTML = isListening ? stopIconSvg : micIconSvg;
    }
  }

  function expandWidget() {
    scriptState.isExpanded = true;
    const trigger = document.getElementById(triggerId);
    const overlay = getOverlay();
    if (trigger) trigger.style.display = "none";
    if (overlay) overlay.classList.remove("is-hidden");
  }

  function collapseWidget() {
    if (scriptState.listening) {
      stopListening();
    }
    scriptState.isExpanded = false;
    const trigger = document.getElementById(triggerId);
    const overlay = getOverlay();
    if (trigger) trigger.style.display = "flex";
    if (overlay) overlay.classList.add("is-hidden");
  }

  function setFeedback(message, actionPlan = null) {
    const feedback = document.getElementById(feedbackId);
    if (!feedback) return;

    feedback.replaceChildren();
    const icon = document.createElement("span");
    icon.className = "voice-widget-action-icon";

    const text = document.createElement("span");
    text.className = "voice-widget-feedback-text";
    text.textContent = String(message || "").trim() || "Ready";

    feedback.appendChild(icon);
    feedback.appendChild(text);
  }

  function estimateSpeechDurationMs(text) {
    const wordCount = String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    return Math.max(900, wordCount * 250 + 600);
  }

  async function speakReply(text) {
    const message = String(text || "").trim();
    if (!message) return;

    const messageKey = normalizeTranscriptKey(message);
    const now = Date.now();
    const isRepeatMessage =
      Boolean(scriptState.lastSpokenMessageKey) &&
      scriptState.lastSpokenMessageKey === messageKey &&
      now - scriptState.lastSpokenAt < 2200;
    if (isRepeatMessage) {
      return;
    }

    scriptState.lastSpokenMessageKey = messageKey;
    scriptState.lastSpokenAt = now;
    scriptState.activePlaybackRequestId += 1;
    const playbackRequestId = scriptState.activePlaybackRequestId;

    if (scriptState.activeAudio) {
      try {
        scriptState.activeAudio.pause();
      } catch (error) {
        console.warn("[voice-widget] could not stop previous reply", error);
      }
      scriptState.activeAudio = null;
    }

    const finalizePlayback = () => {
      if (
        scriptState.activePlaybackRequestId === playbackRequestId &&
        scriptState.activeAudio
      ) {
        scriptState.activeAudio = null;
      }
    };

    const resolvePlayback = () => {
      finalizePlayback();
    };

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
      });
      if (!response.ok) {
        throw new Error(`TTS request failed with ${response.status}`);
      }
      if (playbackRequestId !== scriptState.activePlaybackRequestId) return;

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      const settlePlayback = () => {
        URL.revokeObjectURL(audioUrl);
        resolvePlayback();
      };
      audio.addEventListener("ended", settlePlayback);
      audio.addEventListener("error", settlePlayback);
      scriptState.activeAudio = audio;
      await audio.play();
      const fallbackDelay = estimateSpeechDurationMs(message);
      window.setTimeout(settlePlayback, fallbackDelay);
    } catch (error) {
      console.warn("[voice-widget] speech synthesis failed", error);
      const fallbackDelay = estimateSpeechDurationMs(message);
      window.setTimeout(resolvePlayback, fallbackDelay);
    }
  }

  function getActionTargetLabel(actionPlan) {
    const targetElement = actionPlan?.target
      ? document.querySelector(actionPlan.target)
      : null;
    if (!targetElement) return "";

    const label =
      targetElement?.getAttribute("aria-label") ||
      targetElement?.getAttribute("placeholder") ||
      targetElement?.getAttribute("title") ||
      targetElement?.name ||
      targetElement?.id ||
      targetElement?.innerText?.trim() ||
      targetElement?.textContent?.trim() ||
      "";

    return String(label || "").trim();
  }

  function getAccessibilitySpeechText(actionPlan) {
    if (!actionPlan || !actionPlan.action) return "";

    if (actionPlan.action === "RESPOND") {
      return actionPlan.message || actionPlan.ttsContext || "";
    }

    if (actionPlan.action === "READ_TEXT") {
      const target = actionPlan.target
        ? document.querySelector(actionPlan.target)
        : null;
      const text =
        target?.innerText?.trim() ||
        target?.textContent?.trim() ||
        target?.getAttribute("aria-label") ||
        target?.getAttribute("title") ||
        "";
      if (text) return String(text).trim();
    }

    if (actionPlan.action === "SUMMARIZE_PAGE") {
      const text = document.body?.innerText?.trim() || "";
      if (text) {
        const preview = String(text).trim();
        return `Summary: ${preview.slice(0, 1400)}`;
      }
    }

    return actionPlan?.ttsContext || "";
  }

  function describeActionPlan(actionPlan) {
    if (!actionPlan || !actionPlan.action || actionPlan.action === "NONE") {
      return "No action matched.";
    }

    const targetLabel = getActionTargetLabel(actionPlan);

    if (actionPlan.action === "SCROLL") {
      const direction = actionPlan.direction === "up" ? "up" : "down";
      const distance = actionPlan.amount || 600;
      return `Scrolling ${direction}${distance <= 400 ? " a bit" : ""}...`;
    }

    if (actionPlan.action === "TYPE") {
      const value = actionPlan.value ? `"${actionPlan.value}"` : "text";
      return targetLabel
        ? `Typing ${value} into ${targetLabel}...`
        : `Typing ${value} into the requested field...`;
    }

    if (actionPlan.action === "ZOOM") {
      const dir = actionPlan.direction || "in";
      return dir === "reset" ? "Resetting zoom level." : `Zooming ${dir}...`;
    }

    if (actionPlan.action === "GO_BACK") {
      return "Going back to the previous page.";
    }

    if (actionPlan.action === "GO_FORWARD") {
      return "Going forward to the next page.";
    }

    if (actionPlan.action === "RELOAD") {
      return "Refreshing the current page.";
    }

    if (actionPlan.action === "NAVIGATE") {
      return actionPlan.value
        ? `Opening ${actionPlan.value}.`
        : "Opening the requested page.";
    }

    if (actionPlan.action === "PRESS_KEY") {
      return `Pressing ${actionPlan.value || "Enter"}.`;
    }

    if (actionPlan.action === "SELECT_OPTION") {
      return targetLabel
        ? `Selecting ${targetLabel}.`
        : "Selecting the requested option.";
    }

    if (actionPlan.action === "CLEAR_INPUT") {
      return targetLabel
        ? `Clearing ${targetLabel}.`
        : "Clearing the requested field.";
    }

    if (actionPlan.action === "HOVER") {
      return targetLabel
        ? `Hovering over ${targetLabel}.`
        : "Hovering over the requested element.";
    }

    if (
      actionPlan.action === "HIGHLIGHT_ELEMENT" ||
      actionPlan.action === "FOCUS"
    ) {
      return targetLabel
        ? `Highlighting ${targetLabel}.`
        : "Highlighting the requested element.";
    }

    if (actionPlan.action === "READ_TEXT") {
      return targetLabel
        ? `Reading ${targetLabel}.`
        : "Reading the requested text.";
    }

    if (actionPlan.action === "SUMMARIZE_PAGE") {
      return "Summarizing the visible page content.";
    }

    if (actionPlan.action === "RESPOND") {
      return actionPlan.message || "Responding with information.";
    }

    if (actionPlan.action === "CLICK") {
      return targetLabel
        ? `Clicking ${targetLabel}...`
        : "Clicking the requested target...";
    }

    return "Executing action...";
  }

  async function announceAction(actionPlan) {
    const defaultMessage = describeActionPlan(actionPlan);
    const message = getAccessibilitySpeechText(actionPlan) || defaultMessage;
    setFeedback(defaultMessage, actionPlan);
    window.clearTimeout(scriptState.feedbackTimer);
    scriptState.feedbackTimer = window.setTimeout(() => {
      setFeedback(scriptState.listening ? "Listening..." : "Ready");
    }, 2200);
    await speakReply(message);
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }

  async function handleActionPlan(actionPlan) {
    const actionKey = `${actionPlan?.action || "NONE"}:${String(
      actionPlan?.ttsContext || actionPlan?.reasoning || "",
    ).trim()}`;
    const now = Date.now();
    const isRepeatAction =
      Boolean(scriptState.lastHandledActionKey) &&
      scriptState.lastHandledActionKey === actionKey &&
      now - scriptState.lastHandledActionAt < 2200;
    if (isRepeatAction) {
      return;
    }

    scriptState.lastHandledActionKey = actionKey;
    scriptState.lastHandledActionAt = now;

    try {
      if (actionPlan.action === "RESPOND") {
        const message = actionPlan.message || actionPlan.ttsContext || "";
        if (message) {
          setFeedback(message, actionPlan);
          try {
            await speakReply(message);
          } catch (error) {
            await speakReply(message);
          }
          await new Promise((resolve) => window.setTimeout(resolve, 400));
        }
        return;
      }

      if (!actionPlan || !actionPlan.action || actionPlan.action === "NONE") {
        const message = actionPlan?.ttsContext || "No matching action.";
        setFeedback(message, actionPlan);
        await speakReply(message);
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        return;
      }

      if (actionPlan.action === "CLARIFY") {
        scriptState.pendingClarify = actionPlan;
        const question =
          actionPlan.message ||
          actionPlan.ttsContext ||
          "Which option do you mean?";
        setFeedback(question, actionPlan);
        await speakReply(question);
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        return;
      }

      await announceAction(actionPlan);
      executeActionPlan(actionPlan);
    } finally {
      if (scriptState.processing) {
        endProcessingCycle();
      }
    }
  }

  function createOverlay() {
    if (document.getElementById(overlayId)) return;

    injectWidgetStyles();

    const trigger = document.createElement("button");
    trigger.id = triggerId;
    trigger.innerHTML = waveMarkSvg;
    trigger.addEventListener("click", expandWidget);
    document.body.appendChild(trigger);

    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.className = "is-hidden";

    const header = document.createElement("div");
    header.className = "voice-widget-header";

    const closeBtn = document.createElement("button");
    closeBtn.id = closeButtonId;
    closeBtn.innerHTML = closeIconSvg;
    closeBtn.title = "Close widget";
    closeBtn.addEventListener("click", collapseWidget);
    header.appendChild(closeBtn);

    const orbContainer = document.createElement("div");
    orbContainer.className = "voice-widget-orb-container";

    const button = document.createElement("button");
    button.id = buttonId;
    button.innerHTML = micIconSvg;
    button.addEventListener("click", toggleListening);
    orbContainer.appendChild(button);

    const copy = document.createElement("div");
    copy.className = "voice-widget-copy";

    const label = document.createElement("span");
    label.id = labelId;
    label.textContent = "Ready";
    copy.appendChild(label);

    const pill = document.createElement("div");
    pill.className = "voice-widget-pill";

    const feedback = document.createElement("div");
    feedback.id = feedbackId;
    feedback.textContent = "Awaiting command.";
    pill.appendChild(feedback);
    copy.appendChild(pill);

    overlay.appendChild(header);
    overlay.appendChild(orbContainer);
    overlay.appendChild(copy);

    document.body.appendChild(overlay);
  }

  function setStatus(message) {
    const label = document.getElementById(labelId);
    if (label) label.textContent = message;
  }

  function getApiBaseUrl() {
    if (window.__VOICE_WIDGET_API_URL__) {
      return window.__VOICE_WIDGET_API_URL__.replace(/\/$/, "");
    }
    return "https://voice-wave-ai-production.up.railway.app";
  }

  if (typeof window.__CURRENT_ZOOM_LEVEL__ === "undefined") {
    window.__CURRENT_ZOOM_LEVEL__ = 1.0;
  }

  function executeActionPlan(actionPlan) {
    if (!actionPlan || !actionPlan.action || actionPlan.action === "NONE") {
      return;
    }

    // Dismiss overlays/popups that could block interactions
    function dismissOverlays() {
      try {
        const overlays = Array.from(
          document.querySelectorAll(
            '[role="dialog"], .cookie, .cookie-consent, .cookie-banner, [data-modal], [data-overlay], [aria-hidden="false"]',
          ),
        );
        for (const overlay of overlays) {
          try {
            // try common close buttons
            const closeSelectors = [
              'button[aria-label*="close"]',
              "button.close",
              "[data-dismiss] button",
              "[data-close]",
              ".close",
              'button[title*="close"]',
            ];
            let closed = false;
            for (const sel of closeSelectors) {
              const btn =
                overlay.querySelector(sel) || document.querySelector(sel);
              if (btn) {
                btn.click();
                closed = true;
                break;
              }
            }
            if (!closed) {
              // try removing element if it's not essential
              const style = window.getComputedStyle(overlay);
              if (style.position === "fixed" || style.position === "absolute") {
                overlay.parentElement?.removeChild(overlay);
              }
            }
          } catch (e) {
            console.warn("[voice-widget] overlay dismissal failed", e);
          }
        }
      } catch (err) {
        console.warn("[voice-widget] dismissOverlays error", err);
      }
    }

    if (actionPlan.action === "CLICK") {
      const target = actionPlan.target
        ? document.querySelector(actionPlan.target)
        : null;
      dismissOverlays();
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.click();
      }
      return;
    }

    if (actionPlan.action === "SCROLL") {
      const direction = actionPlan.direction === "up" ? -1 : 1;
      window.scrollBy({
        top: direction * (actionPlan.amount || 600),
        behavior: "smooth",
      });
      return;
    }

    if (actionPlan.action === "ZOOM") {
      const direction = actionPlan.direction || "in";

      if (direction === "reset") {
        window.__CURRENT_ZOOM_LEVEL__ = 1.0;
      } else if (direction === "out") {
        window.__CURRENT_ZOOM_LEVEL__ = Math.max(
          0.5,
          window.__CURRENT_ZOOM_LEVEL__ - 0.2,
        );
      } else {
        window.__CURRENT_ZOOM_LEVEL__ = Math.min(
          2.5,
          window.__CURRENT_ZOOM_LEVEL__ + 0.2,
        );
      }
      document.body.style.transform = `scale(${window.__CURRENT_ZOOM_LEVEL__})`;
      document.body.style.transformOrigin = "top center";
      return;
    }

    if (actionPlan.action === "TYPE") {
      const target = actionPlan.target
        ? document.querySelector(actionPlan.target)
        : null;
      dismissOverlays();
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        target.focus();
        target.value = actionPlan.value || "";
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    if (actionPlan.action === "GO_BACK") {
      window.history.back();
      return;
    }

    if (actionPlan.action === "GO_FORWARD") {
      window.history.forward();
      return;
    }

    if (actionPlan.action === "RELOAD") {
      window.location.reload();
      return;
    }

    if (actionPlan.action === "NAVIGATE") {
      const targetUrl = actionPlan.value || "/";
      if (typeof targetUrl === "string" && targetUrl.trim()) {
        window.location.assign(targetUrl);
      }
      return;
    }

    if (actionPlan.action === "PRESS_KEY") {
      const key = actionPlan.value || "Enter";
      const target = document.activeElement || document.body;
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
      target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
      return;
    }

    if (actionPlan.action === "SELECT_OPTION") {
      const target = actionPlan.target
        ? document.querySelector(actionPlan.target)
        : null;
      dismissOverlays();
      if (target && target.tagName === "SELECT") {
        target.value = actionPlan.value || target.value;
        target.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    if (actionPlan.action === "CLEAR_INPUT") {
      const target = actionPlan.target
        ? document.querySelector(actionPlan.target)
        : null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        target.value = "";
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    if (actionPlan.action === "HOVER") {
      const target = actionPlan.target
        ? document.querySelector(actionPlan.target)
        : null;
      if (target) {
        target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      }
      return;
    }

    if (
      actionPlan.action === "HIGHLIGHT_ELEMENT" ||
      actionPlan.action === "FOCUS"
    ) {
      const target = actionPlan.target
        ? document.querySelector(actionPlan.target)
        : null;
      if (target) {
        target.focus?.();
        target.style.outline = "3px solid #ffbf47";
        target.style.boxShadow = "0 0 0 3px rgba(255, 191, 71, 0.45)";
        window.setTimeout(() => {
          if (target) {
            target.style.outline = "";
            target.style.boxShadow = "";
          }
        }, 1800);
      }
      return;
    }

    if (actionPlan.action === "READ_TEXT") {
      const speechText = getAccessibilitySpeechText(actionPlan);
      if (speechText) {
        void speakReply(speechText);
      }
      return;
    }

    if (actionPlan.action === "SUMMARIZE_PAGE") {
      const speechText = getAccessibilitySpeechText(actionPlan);
      if (speechText) {
        void speakReply(speechText);
      }
      return;
    }
  }

  function setListeningState(isListening) {
    const overlay = document.getElementById(overlayId);
    if (overlay) overlay.classList.toggle("is-listening", Boolean(isListening));
    setListeningVisualState(isListening);
  }

  function setProcessingState(isProcessing) {
    const overlay = document.getElementById(overlayId);
    if (overlay)
      overlay.classList.toggle("is-processing", Boolean(isProcessing));
  }

  function createMediaRecorderForStream(stream) {
    const preferredMimeType = scriptState.mediaMimeType;
    const mediaRecorder = preferredMimeType
      ? new MediaRecorder(stream, { mimeType: preferredMimeType })
      : new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        // capture initial chunk for later flushes (contains EBML header)
        if (!scriptState.initChunk) {
          try {
            event.data.arrayBuffer().then((ab) => {
              try {
                scriptState.initChunk = ab;
              } catch (e) {}
            });
          } catch (e) {}
        }
        if (
          scriptState.socket &&
          scriptState.socket.readyState === WebSocket.OPEN
        ) {
          scriptState.socket.send(event.data);
        }
      }

      if (scriptState.pendingFlushRequest) {
        scriptState.pendingFlushRequest = false;
        if (
          scriptState.socket &&
          scriptState.socket.readyState === WebSocket.OPEN
        ) {
          scriptState.socket.send(JSON.stringify({ type: "flush-audio" }));
          setStatus("Processing speech...");
        }
      }
    };

    mediaRecorder.onstop = () => {
      if (scriptState.suppressFlushOnStop) {
        return;
      }
      if (
        scriptState.socket &&
        scriptState.socket.readyState === WebSocket.OPEN
      ) {
        scriptState.socket.send(JSON.stringify({ type: "flush-audio" }));
      }
    };

    return mediaRecorder;
  }

  function startMediaRecorder() {
    if (!scriptState.stream || !scriptState.socket) return;
    if (
      scriptState.mediaRecorder &&
      scriptState.mediaRecorder.state === "recording"
    ) {
      return;
    }

    scriptState.mediaRecorder = createMediaRecorderForStream(
      scriptState.stream,
    );
    if (!scriptState.mediaMimeType) {
      scriptState.mediaMimeType = scriptState.mediaRecorder.mimeType;
    }
    if (
      scriptState.socket &&
      scriptState.socket.readyState === WebSocket.OPEN &&
      scriptState.mediaMimeType
    ) {
      scriptState.socket.send(
        JSON.stringify({
          type: "media-type",
          mimeType: scriptState.mediaMimeType,
        }),
      );
    }

    try {
      scriptState.mediaRecorder.start();
    } catch (error) {
      console.error("[voice-widget] failed to start media recorder", error);
      return;
    }

    scriptState.listening = true;
    scriptState.pendingFlushRequest = false;
    scriptState.lastVoiceActivityAt = performance.now();
    startChunkFlushLoop();
    setStatus("Listening");
    setListeningState(true);
    setFeedback("Streaming audio...");
  }

  function pauseAudioCapture() {
    clearSilenceTimer();
    clearChunkFlushTimer();
    stopAudioMonitoring();
    if (
      scriptState.mediaRecorder &&
      scriptState.mediaRecorder.state !== "inactive"
    ) {
      scriptState.suppressFlushOnStop = true;
      try {
        scriptState.mediaRecorder.stop();
      } catch (error) {
        console.warn("[voice-widget] error stopping media recorder", error);
      }
      scriptState.mediaRecorder = null;
      scriptState.suppressFlushOnStop = false;
    }
    scriptState.listening = false;
    setListeningState(false);
  }

  function resumeAudioCapture() {
    if (!scriptState.sessionActive || scriptState.userInitiatedStop) return;
    if (!scriptState.stream) return;
    if (
      scriptState.mediaRecorder &&
      scriptState.mediaRecorder.state === "recording"
    ) {
      return;
    }
    if (!scriptState.audioContext) {
      setupAudioMonitoring(scriptState.stream);
    }
    startMediaRecorder();
  }

  function beginProcessingCycle() {
    if (scriptState.processing) return;
    scriptState.processing = true;
    setProcessingState(true);
    setStatus("Processing command...");
    setFeedback("Processing command...");
    pauseAudioCapture();
  }

  function endProcessingCycle() {
    scriptState.processing = false;
    setProcessingState(false);
    if (scriptState.userInitiatedStop) {
      setStatus("Stopped");
      setFeedback("Stopped listening.");
      return;
    }
    if (scriptState.sessionActive && !scriptState.listening) {
      resumeAudioCapture();
      return;
    }
    setFeedback(scriptState.listening ? "Listening..." : "Ready");
  }

  function normalizeTranscriptKey(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function showActionPlan(actionPlan) {
    void handleActionPlan(actionPlan);
  }

  function submitPendingTranscript(text) {
    if (scriptState.processing) {
      console.debug(
        "[voice-widget] submitPendingTranscript ignored: already processing",
      );
      return;
    }
    if (!text) return;
    const trimmedText = String(text).trim();
    if (!trimmedText) return;
    const transcriptKey = normalizeTranscriptKey(trimmedText);
    if (scriptState.lastProcessedTranscriptKey === transcriptKey) return;

    scriptState.latestTranscript = trimmedText;
    scriptState.lastProcessedTranscript = trimmedText;
    scriptState.lastProcessedTranscriptKey = transcriptKey;
    setStatus(`Heard: ${trimmedText}`);
    setFeedback(`Processing: ${trimmedText}`);

    const rawElements = domParser.collectContext();
    const elements = domHandler.prepareContext(rawElements);
    const structured = domParser.collectStructuredData
      ? domParser.collectStructuredData()
      : { tables: [], grids: [] };
    // If awaiting clarification, attempt to resolve based on transcript
    if (scriptState.pendingClarify) {
      const pending = scriptState.pendingClarify;
      const options = Array.isArray(
        pending.options || pending.choices || pending.clarifyOptions,
      )
        ? pending.options || pending.choices || pending.clarifyOptions
        : pending.clarifyOptions || null;
      if (options && options.length) {
        const lowered = trimmedText.toLowerCase();
        // Try numeric selection
        const numberMatch = trimmedText.match(/\b(\d+)\b/);
        let chosen = null;
        if (numberMatch) {
          const idx = Number(numberMatch[1]) - 1;
          if (options[idx]) chosen = options[idx];
        }
        // Try label matching
        if (!chosen) {
          for (const opt of options) {
            const label = String(
              opt.label || opt.name || opt.text || opt.title || opt.value || "",
            ).toLowerCase();
            if (label && lowered.includes(label)) {
              chosen = opt;
              break;
            }
          }
        }

        if (chosen) {
          // Clear pending
          scriptState.pendingClarify = null;
          setFeedback(
            `Selected: ${chosen.label || chosen.name || chosen.text || chosen.value || "option"}`,
          );
          // If option includes selector, execute it directly
          if (chosen.selector) {
            showActionPlan({
              action: "CLICK",
              target: chosen.selector,
              reason: "clarify selection",
            });
            return;
          }
          // Otherwise, send follow-up to backend with chosen label
          const followup = String(
            chosen.label || chosen.name || chosen.text || chosen.value || "",
          );
          if (followup) {
            if (
              scriptState.socket &&
              scriptState.socket.readyState === WebSocket.OPEN
            ) {
              scriptState.socket.send(
                JSON.stringify({
                  type: "intent",
                  transcript: followup,
                  elements,
                  structured,
                  projectId:
                    currentScript?.getAttribute("data-project-id") || "",
                }),
              );
            } else {
              postIntentToBackend(followup, elements, structured);
            }
            return;
          }
        }
      }
      // If not resolved, continue to send as normal transcript
    }
    beginProcessingCycle();
    if (
      scriptState.socket &&
      scriptState.socket.readyState === WebSocket.OPEN
    ) {
      scriptState.socket.send(
        JSON.stringify({
          type: "intent",
          transcript: trimmedText,
          elements,
          structured,
          projectId: currentScript?.getAttribute("data-project-id") || "",
        }),
      );
    } else {
      postIntentToBackend(trimmedText, elements, structured);
    }
  }

  async function postIntentToBackend(transcript, elements) {
    const endpoint = `${getApiBaseUrl()}/api/process-intent`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          elements,
          structured: domParser.collectStructuredData
            ? domParser.collectStructuredData()
            : { tables: [], grids: [] },
          projectId: currentScript?.getAttribute("data-project-id") || "",
        }),
      });
      const data = await response.json().catch(() => ({}));
      const actionPlan =
        data?.action || domParser.buildExecutionPlan(transcript, elements);
      console.log(
        "[voice-widget] intent execution pipeline data payload:",
        data,
      );
      showActionPlan(actionPlan);
    } catch (error) {
      console.error("[voice-widget] failed to submit intent payload", error);
      endProcessingCycle();
    }
  }

  function openSocket() {
    if (
      scriptState.socket &&
      (scriptState.socket.readyState === WebSocket.OPEN ||
        scriptState.socket.readyState === WebSocket.CONNECTING)
    ) {
      return scriptState.socket;
    }

    if (
      scriptState.socket &&
      scriptState.socket.readyState === WebSocket.CLOSING
    ) {
      try {
        scriptState.socket.close();
      } catch (error) {
        console.warn("[voice-widget] could not close stale socket", error);
      }
    }

    const socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";

    socket.addEventListener("open", () => {
      console.log("[voice-widget] connected to stream runtime:", wsUrl);
      setStatus("Connected");
      socket.send(JSON.stringify({ type: "ready" }));
      if (scriptState.mediaMimeType) {
        console.debug("[voice-widget] sending media mime type on socket open", {
          mediaMimeType: scriptState.mediaMimeType,
        });
        socket.send(
          JSON.stringify({
            type: "media-type",
            mimeType: scriptState.mediaMimeType,
          }),
        );
      }
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data);
          if (payload && payload.type === "welcome") {
            setStatus(payload.message || "Connected");
          } else if (payload && payload.type === "transcript") {
            // Deepgram returns transcript text to the browser first, then the widget
            // re-sends it as an intent payload to the server for planning.
            // Ignore incoming transcripts while processing an existing command so
            // the client does not queue overlapping turns.
            if (scriptState.processing) {
              console.debug(
                "[voice-widget] ignoring websocket transcript while processing",
              );
            } else {
              const transcript = String(payload.text || "").trim();
              setStatus(`Transcribed: ${transcript}`);
              if (transcript) {
                submitPendingTranscript(transcript);
              }
            }
          } else if (payload && payload.type === "drop") {
            console.warn(
              "[voice-widget] server dropped audio:",
              payload.reason,
            );
            // Retry flush after a short backoff to give the recorder time to emit init
            window.setTimeout(() => {
              try {
                flushAudioNow();
              } catch (e) {
                console.warn("[voice-widget] retry flush failed", e);
              }
            }, 300);
          } else if (payload && payload.type === "action") {
            showActionPlan(payload.action);
          }
        } catch (error) {
          console.warn(
            "[voice-widget] non-JSON packet message dropped",
            event.data,
          );
        }
      }
    });

    socket.addEventListener("close", () => {
      setStatus("Socket closed");
    });

    socket.addEventListener("error", (error) => {
      console.error("[voice-widget] socket error", error);
      setStatus("Socket error");
    });

    scriptState.socket = socket;
  }

  function startRecognition() {
    if (
      !("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    ) {
      console.warn(
        "[voice-widget] Web Speech API engine not available in browser native context",
      );
      return;
    }

    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interimText = "";
      let finalText = "";
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          finalText += ` ${transcript}`.trim();
        } else {
          interimText += ` ${transcript}`.trim();
        }
      }
      if (finalText) {
        const text = finalText.trim();
        if (!text) return;
        if (scriptState.processing) {
          console.debug(
            "[voice-widget] recognition finalText ignored: already processing",
          );
          return;
        }
        if (
          scriptState.pendingTranscriptTimer &&
          scriptState.latestTranscript === text
        ) {
          window.clearTimeout(scriptState.pendingTranscriptTimer);
        }
        scriptState.latestTranscript = text;
        setStatus(`Heard: ${text}`);
        if (
          scriptState.socket &&
          scriptState.socket.readyState === WebSocket.OPEN
        ) {
          scriptState.socket.send(
            JSON.stringify({ type: "transcript", text, isFinal: true }),
          );
        }
        window.clearTimeout(scriptState.pendingTranscriptTimer);
        scriptState.pendingTranscriptTimer = window.setTimeout(() => {
          submitPendingTranscript(text);
        }, 650);
      }
      if (interimText) {
        setStatus(`Listening: ${interimText}`);
      }
    };

    recognition.onerror = (event) => {
      setStatus(`Recognition error: ${event.error}`);
    };

    recognition.onend = () => {
      if (scriptState.listening) recognition.start();
    };

    scriptState.recognition = recognition;
    recognition.start();
  }

  function clearSilenceTimer() {
    if (scriptState.silenceTimer) {
      window.clearTimeout(scriptState.silenceTimer);
      scriptState.silenceTimer = null;
    }
  }

  function clearChunkFlushTimer() {
    if (scriptState.chunkFlushTimer) {
      window.clearInterval(scriptState.chunkFlushTimer);
      scriptState.chunkFlushTimer = null;
    }
  }

  function startChunkFlushLoop() {
    clearChunkFlushTimer();

    if (
      !scriptState.mediaRecorder ||
      scriptState.mediaRecorder.state !== "recording"
    ) {
      return;
    }

    scriptState.chunkFlushTimer = window.setInterval(() => {
      if (
        !scriptState.listening ||
        !scriptState.mediaRecorder ||
        scriptState.mediaRecorder.state !== "recording"
      ) {
        clearChunkFlushTimer();
        return;
      }

      try {
        scriptState.mediaRecorder.requestData();
      } catch (error) {
        console.warn(
          "[voice-widget] failed to request media recorder data",
          error,
        );
      }
    }, 700);
  }

  function flushAudioNow() {
    if (!scriptState.listening) return;

    console.debug("[voice-widget] flushAudioNow invoked", {
      pendingFlushRequest: scriptState.pendingFlushRequest,
      mediaRecorderState: scriptState.mediaRecorder?.state,
    });

    if (
      scriptState.mediaRecorder &&
      scriptState.mediaRecorder.state === "recording" &&
      typeof scriptState.mediaRecorder.requestData === "function"
    ) {
      scriptState.pendingFlushRequest = true;
      console.debug("[voice-widget] requesting MediaRecorder data for flush", {
        pendingFlushRequest: scriptState.pendingFlushRequest,
      });
      try {
        // Stop & restart the MediaRecorder to force emission of a fresh init chunk
        // suppressFlushOnStop prevents the onstop handler from sending an extra flush
        scriptState.suppressFlushOnStop = true;
        try {
          scriptState.mediaRecorder.stop();
        } catch (e) {
          console.warn("[voice-widget] mediaRecorder.stop() failed", e);
        }
        scriptState.mediaRecorder = null;

        // Restart shortly after to resume streaming and emit init segment
        setTimeout(() => {
          try {
            startMediaRecorder();
            // allow recorder to initialize before requesting data
            setTimeout(() => {
              try {
                // send cached initChunk if we have it
                const now = Date.now();
                if (
                  scriptState.initChunk &&
                  scriptState.socket &&
                  scriptState.socket.readyState === WebSocket.OPEN &&
                  now - (scriptState.initChunkLastSentAt || 0) > 300
                ) {
                  try {
                    scriptState.socket.send(scriptState.initChunk);
                    scriptState.initChunkLastSentAt = now;
                  } catch (e) {}
                }
                if (
                  scriptState.mediaRecorder &&
                  typeof scriptState.mediaRecorder.requestData === "function"
                ) {
                  scriptState.mediaRecorder.requestData();
                }
              } catch (e) {}
            }, 120);
          } catch (e) {
            console.warn("[voice-widget] restart media recorder failed", e);
          } finally {
            scriptState.suppressFlushOnStop = false;
          }
        }, 80);
        return;
      } catch (error) {
        scriptState.pendingFlushRequest = false;
        console.warn("[voice-widget] failed to request data for flush", error);
      }
    }

    if (
      scriptState.socket &&
      scriptState.socket.readyState === WebSocket.OPEN
    ) {
      console.debug("[voice-widget] sending flush-audio without requestData");
      scriptState.socket.send(JSON.stringify({ type: "flush-audio" }));
      setStatus("Processing speech...");
    }
  }

  function scheduleSilenceFlush() {
    if (!scriptState.listening) return;
    if (scriptState.silenceTimer) return;
    scriptState.silenceTimer = window.setTimeout(() => {
      scriptState.silenceTimer = null;
      if (!scriptState.listening) return;
      flushAudioNow();
    }, 1000);
  }

  function stopAudioMonitoring() {
    if (scriptState.audioActivityFrame) {
      window.cancelAnimationFrame(scriptState.audioActivityFrame);
      scriptState.audioActivityFrame = null;
    }

    if (
      scriptState.audioContext &&
      scriptState.audioContext.state !== "closed"
    ) {
      try {
        scriptState.audioContext.close();
      } catch (error) {
        console.warn("[voice-widget] could not close audio context", error);
      }
    }

    scriptState.audioContext = null;
    scriptState.analyser = null;
    scriptState.analyserBuffer = null;
  }

  function setupAudioMonitoring(stream) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor || !stream) return;

    try {
      const context = new AudioContextCtor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);

      scriptState.audioContext = context;
      scriptState.analyser = analyser;
      scriptState.analyserBuffer = new Uint8Array(analyser.fftSize);
      scriptState.lastVoiceActivityAt = performance.now();

      const monitorAudioActivity = () => {
        if (!scriptState.analyser || !scriptState.analyserBuffer) {
          return;
        }
        if (!scriptState.listening) {
          scriptState.audioActivityFrame =
            window.requestAnimationFrame(monitorAudioActivity);
          return;
        }

        scriptState.analyser.getByteTimeDomainData(scriptState.analyserBuffer);
        let sumSquares = 0;
        for (const value of scriptState.analyserBuffer) {
          const normalized = (value - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const energy = Math.sqrt(
          sumSquares / scriptState.analyserBuffer.length,
        );
        const isVoiceActive = energy > scriptState.silenceThreshold;

        if (isVoiceActive) {
          scriptState.lastVoiceActivityAt = performance.now();
          clearSilenceTimer();
        } else if (
          performance.now() - scriptState.lastVoiceActivityAt >= 1000 &&
          !scriptState.silenceTimer
        ) {
          scheduleSilenceFlush();
        }

        scriptState.audioActivityFrame =
          window.requestAnimationFrame(monitorAudioActivity);
      };

      scriptState.audioActivityFrame =
        window.requestAnimationFrame(monitorAudioActivity);
    } catch (error) {
      console.warn("[voice-widget] could not set up audio monitoring", error);
    }
  }

  function stopRecognition() {
    if (scriptState.pendingTranscriptTimer) {
      window.clearTimeout(scriptState.pendingTranscriptTimer);
      scriptState.pendingTranscriptTimer = null;
    }
    clearSilenceTimer();
    stopAudioMonitoring();
    if (scriptState.recognition) {
      scriptState.recognition.stop();
      scriptState.recognition = null;
    }
  }

  function startListening() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("Microphone API unsupported");
      return;
    }

    scriptState.sessionActive = true;
    scriptState.userInitiatedStop = false;
    scriptState.processing = false;
    openSocket();
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        scriptState.stream = stream;
        setupAudioMonitoring(stream);

        const preferredMimeType =
          typeof MediaRecorder !== "undefined" &&
          MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : undefined;

        scriptState.mediaRecorder = preferredMimeType
          ? new MediaRecorder(stream, { mimeType: preferredMimeType })
          : new MediaRecorder(stream);

        scriptState.mediaMimeType =
          scriptState.mediaRecorder.mimeType || preferredMimeType;
        console.debug("[voice-widget] determined media mime type", {
          mediaMimeType: scriptState.mediaMimeType,
        });
        if (
          scriptState.socket &&
          scriptState.socket.readyState === WebSocket.OPEN &&
          scriptState.mediaMimeType
        ) {
          scriptState.socket.send(
            JSON.stringify({
              type: "media-type",
              mimeType: scriptState.mediaMimeType,
            }),
          );
        }

        scriptState.mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            // capture initial chunk for later flushes
            if (!scriptState.initChunk) {
              try {
                event.data.arrayBuffer().then((ab) => {
                  try {
                    scriptState.initChunk = ab;
                  } catch (e) {}
                });
              } catch (e) {}
            }
            console.debug(
              "[voice-widget] mediaRecorder ondataavailable sending chunk",
              {
                size: event.data.size,
                pendingFlushRequest: scriptState.pendingFlushRequest,
              },
            );
            scriptState.socket.send(event.data);
          }

          if (scriptState.pendingFlushRequest) {
            console.debug(
              "[voice-widget] pendingFlushRequest fulfilled, sending flush-audio",
            );
            scriptState.pendingFlushRequest = false;
            if (
              scriptState.socket &&
              scriptState.socket.readyState === WebSocket.OPEN
            ) {
              scriptState.socket.send(JSON.stringify({ type: "flush-audio" }));
              setStatus("Processing speech...");
            }
          }
        };

        scriptState.mediaRecorder.onstop = () => {
          if (scriptState.suppressFlushOnStop) {
            return;
          }
          if (
            scriptState.socket &&
            scriptState.socket.readyState === WebSocket.OPEN
          ) {
            scriptState.socket.send(JSON.stringify({ type: "flush-audio" }));
          }
        };

        scriptState.mediaRecorder.start();
        // Force an initial dataavailable event so the init EBML header is sent
        try {
          if (typeof scriptState.mediaRecorder.requestData === "function") {
            scriptState.mediaRecorder.requestData();
          }
        } catch (err) {
          console.warn("[voice-widget] requestData after start failed", err);
        }
        scriptState.listening = true;
        scriptState.pendingFlushRequest = false;
        scriptState.lastVoiceActivityAt = performance.now();
        startChunkFlushLoop();
        setStatus("Listening");
        setListeningState(true);
        setFeedback("Streaming audio...");
      })
      .catch((error) => {
        console.error("[voice-widget] microphone access denied", error);
        setStatus("Microphone access denied");
      });
  }

  function stopListening() {
    const transcript = scriptState.latestTranscript.trim();
    const rawElements = domParser.collectContext();
    const elements = domHandler.prepareContext(rawElements);

    scriptState.listening = false;
    scriptState.sessionActive = false;
    scriptState.userInitiatedStop = true;
    scriptState.processing = false;
    setProcessingState(false);
    clearSilenceTimer();
    clearChunkFlushTimer();
    if (scriptState.pendingTranscriptTimer) {
      window.clearTimeout(scriptState.pendingTranscriptTimer);
      scriptState.pendingTranscriptTimer = null;
    }
    if (
      scriptState.mediaRecorder &&
      scriptState.mediaRecorder.state !== "inactive"
    ) {
      scriptState.mediaRecorder.stop();
    }
    if (scriptState.stream) {
      scriptState.stream.getTracks().forEach((track) => track.stop());
      scriptState.stream = null;
    }
    stopRecognition();
    setListeningState(false);

    if (
      scriptState.socket &&
      scriptState.socket.readyState === WebSocket.OPEN
    ) {
      scriptState.socket.close();
    }
    scriptState.socket = null;

    if (transcript) {
      submitPendingTranscript(transcript);
    } else if (elements.length) {
      if (
        scriptState.socket &&
        scriptState.socket.readyState === WebSocket.OPEN
      ) {
        scriptState.socket.send(
          JSON.stringify({
            type: "intent",
            transcript,
            elements,
            projectId: currentScript?.getAttribute("data-project-id") || "",
          }),
        );
      } else {
        postIntentToBackend(transcript, elements);
      }
    }

    setStatus("Stopped");
    setFeedback("Stopped listening.");
  }

  function toggleListening() {
    if (scriptState.listening) {
      stopListening();
      return;
    }
    startListening();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      createOverlay();
      setStatus("Ready");
    });
  } else {
    createOverlay();
    setStatus("Ready");
  }

  window.__VOICE_WIDGET__ = {
    start: startListening,
    stop: stopListening,
    toggle: toggleListening,
    expand: expandWidget,
    collapse: collapseWidget,
  };
})();
