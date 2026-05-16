import { useEffect } from "react";

let overlayCount = 0;

function applyBodyState() {
  if (overlayCount > 0) {
    document.body.dataset.overlayOpen = "true";
  } else {
    delete document.body.dataset.overlayOpen;
  }
}

/**
 * Marks the body with `data-overlay-open` while a modal or full-page drawer
 * is mounted. Lets globally floating UI (e.g. the theme switcher) get out of
 * the way so it does not collide with the overlay's own controls.
 */
export function useBodyOverlay(active: boolean = true): void {
  useEffect(() => {
    if (!active) return;
    overlayCount += 1;
    applyBodyState();
    return () => {
      overlayCount = Math.max(0, overlayCount - 1);
      applyBodyState();
    };
  }, [active]);
}

/**
 * Calls `onEscape` when the user presses the Escape key, while `active`.
 * Used to close modals/drawers via keyboard.
 */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onEscape]);
}
