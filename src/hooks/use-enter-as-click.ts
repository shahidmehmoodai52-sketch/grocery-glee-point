import { useEffect } from "react";

/**
 * Global Enter-key handler so users can act without the mouse.
 *
 * Rules:
 *  - In text inputs: Enter clicks the primary/submit button of the nearest
 *    dialog or form (submit > [data-primary] > last non-cancel button).
 *  - In search inputs: also try [data-first-result] in the document.
 *  - On focused custom-clickable elements (role=button / [data-enter-click]
 *    / tabindex + onclick): Enter triggers click.
 *  - Native buttons/links keep their default browser behavior.
 */
export function useEnterAsClick() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      // @ts-ignore isComposing is standard on KeyboardEvent
      if (e.isComposing) return;

      const t = e.target as HTMLElement | null;
      if (!t) return;

      const tag = t.tagName;
      if (tag === "TEXTAREA") return;
      if ((t as HTMLElement).isContentEditable) return;
      if (tag === "BUTTON" || tag === "A") return;
      if (t.getAttribute("role") === "button") {
        // Native button semantic — let the browser click it (Space/Enter handled)
        // but ensure it fires for div-based role=button:
        if (tag !== "BUTTON") {
          e.preventDefault();
          t.click();
        }
        return;
      }

      if (tag === "INPUT") {
        const input = t as HTMLInputElement;
        const type = (input.type || "text").toLowerCase();
        if (["button", "submit", "checkbox", "radio", "file", "reset", "range", "color"].includes(type)) return;

        const dialog = t.closest('[role="dialog"]') as HTMLElement | null;
        const form = t.closest("form") as HTMLElement | null;
        const scope: HTMLElement = dialog || form || document.body;

        let btn: HTMLButtonElement | null =
          scope.querySelector<HTMLButtonElement>('button[data-primary]:not([disabled])') ||
          scope.querySelector<HTMLButtonElement>('button[type="submit"]:not([disabled])');

        if (!btn && dialog) {
          const btns = Array.from(
            dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
          );
          const candidates = btns.filter(
            (b) => !/^(cancel|close|back|dismiss)$/i.test((b.textContent || "").trim()),
          );
          btn = candidates[candidates.length - 1] || null;
        }

        // Search inputs: prefer the first visible result item
        if (!btn && (type === "search" || input.getAttribute("role") === "searchbox" || input.getAttribute("data-search") !== null)) {
          const first = document.querySelector<HTMLElement>("[data-first-result]");
          if (first) {
            e.preventDefault();
            first.click();
            return;
          }
        }

        if (btn) {
          e.preventDefault();
          btn.click();
        }
        return;
      }

      if (tag === "SELECT") return;

      // Focused custom-clickable element (table row, card, list item)
      const clickable =
        t.hasAttribute("data-enter-click") ||
        (t.tabIndex >= 0 && typeof (t as HTMLElement & { onclick?: unknown }).onclick === "function");
      if (clickable) {
        e.preventDefault();
        t.click();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}
