/**
 * Keyboard shortcut for focusing the search box.
 *
 * The filter box is the primary control now, so it should be reachable without
 * tabbing through the toolbar: `/` focuses it, and so do `Ctrl`+`K` / `Cmd`+`K`.
 *
 * The decision logic is kept as plain functions over a small event shape, so it
 * can be tested without a DOM: whether a shortcut fires depends only on the key,
 * the modifiers, and whether something that accepts typing already has focus.
 */

import { useEffect, useRef, type RefObject } from "react";

/** Elements that already own the keyboard while they are focused. */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Is the event target already a place where the player is typing?
 *
 * Checked structurally rather than with `instanceof HTMLElement` so the rule can
 * be exercised in a node test, and so it still behaves for contenteditable.
 */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  if (typeof element.tagName !== "string") return false;
  return TYPING_TAGS.has(element.tagName.toUpperCase());
}

/** The parts of a `keydown` the shortcut cares about. */
export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: unknown;
}

/**
 * Should this keydown move focus to the search box?
 *
 * `Shift` is allowed for `/` because on most layouts `/` *is* Shift+7; anything
 * with Alt is left to the browser or the window manager.
 */
export function isSearchShortcut(event: ShortcutEvent): boolean {
  if (event.defaultPrevented || event.altKey) return false;
  if (isTypingTarget(event.target)) return false;

  const key = event.key.toLowerCase();
  if (key === "k") return event.ctrlKey || event.metaKey;
  return event.key === "/" && !event.ctrlKey && !event.metaKey;
}

/** Focus the search box on `/` or `Ctrl`/`Cmd`+`K`. */
export function useSearchShortcut(): RefObject<HTMLInputElement> {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!isSearchShortcut(event)) return;
      const input = ref.current;
      if (input === null) return;
      // Suppress the browser's own binding (Cmd+K opens search in some UAs).
      event.preventDefault();
      input.focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return ref;
}
