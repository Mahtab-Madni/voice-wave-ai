(function (global) {
  class DOMHandler {
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

    /**
     * Optimizes long, generated CSS selector chains.
     * Prioritizes concise structural targets over complex parent chains.
     */
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

    /**
     * Converts coordinate decimals to integers and simplifies object keys.
     */
    minimizePosition(position) {
      if (!position) return undefined;
      return {
        x: Math.round(position.x || 0),
        y: Math.round(position.y || 0),
        w: Math.round(position.width || position.w || 0),
        h: Math.round(position.height || position.h || 0),
      };
    }

    /**
     * Traverses upward from an element selector to locate contextual text strings
     * within parent cards, fieldsets, or list items.
     */
    getParentContextText(selector) {
      if (typeof document === "undefined" || !selector) return "";
      try {
        const el = document.querySelector(selector);
        if (!el) return "";

        // Find common card/group container wrappers
        const container = el.closest(
          ".card, .card-1, .card-2, [class*='card'], section, fieldset, li, item",
        );
        if (container) {
          // Grab only header text or group identifiers within that component to keep payload tiny
          const header = container.querySelector(
            "h1, h2, h3, h4, label, .title",
          );
          if (header && header.innerText) {
            return header.innerText;
          }
          // Fallback to bounded character snippet of parent if no explicit heading
          return container.innerText.slice(0, 40);
        }
      } catch (e) {
        // Safe fallback if invalid selector matching occurs
      }
      return "";
    }

    prepareContext(elements = [], options = {}) {
      // Deep copy or clean map array to prevent reference pollution bugs
      const context = Array.isArray(elements) ? elements : [];

      const safeElements = context
        .filter((entry) => {
          if (!entry) return false;

          // 1. Pre-filter by Visibility
          const pos = entry.position;
          if (pos) {
            const w = pos.width || pos.w || 0;
            const h = pos.height || pos.h || 0;
            // Filter out collapsed or hidden DOM nodes
            if (w <= 0 || h <= 0) return false;
          }
          return true;
        })
        .slice(0, options.maxElements || this.maxElements)
        .map((entry) => {
          const targetId = entry?.id || undefined;

          // CRITICAL FIX: Explicitly keep a reference to the original raw selector
          // before any modification happens, avoiding mutation cross-contamination.
          const originalFullSelector = entry?.selector;

          // Preserve the parser-generated context first; only fall back to a parent-label lookup if needed.
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
            // Inject the surrounding visual group text safely
            contextText: parentLabel
              ? this.truncateText(parentLabel, 140)
              : undefined,
            // 2. Selector Shortening is safe because we map onto a fresh object layout
            selector: this.shortenSelector(originalFullSelector, targetId),
            id: targetId,
            role: entry?.role || undefined,
            // 3. Coordinate Simplification
            position: this.minimizePosition(entry?.position),
          };
        });

      const serialized = JSON.stringify(safeElements);
      if (
        serialized.length <= (options.maxPayloadBytes || this.maxPayloadBytes)
      ) {
        return safeElements;
      }

      // Fallback Strategy: Reduce density and slice array
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
          contextText: entry.contextText, // Maintain across fallback
          selector: entry?.selector || null,
          id: entry?.id || undefined,
          role: entry?.role || undefined,
          position: entry?.position || undefined,
        }));
    }
  }

  global.DOMHandler = DOMHandler;
  global.AccessibilityDOMHandler = DOMHandler;
})(typeof window !== "undefined" ? window : globalThis);
