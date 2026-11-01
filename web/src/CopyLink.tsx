/**
 * Copy the current URL — which, after `viewState.ts`, carries the filters,
 * mode and sort — to the clipboard so a view can be shared.
 *
 * The label doubles as feedback ("Copied" / "Copy failed") because a silent
 * clipboard write leaves the player unsure whether anything happened.
 */

import { useEffect, useRef, useState } from "react";

const RESET_MS = 1500;

export function CopyLink(): JSX.Element {
  const [label, setLabel] = useState("Copy link");
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    let next = "Copy link";
    try {
      // Absent in insecure contexts and some embedded browsers.
      if (navigator.clipboard === undefined) throw new Error("no clipboard");
      await navigator.clipboard.writeText(window.location.href);
      next = "Copied";
    } catch {
      next = "Copy failed";
    }

    setLabel(next);
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLabel("Copy link"), RESET_MS);
  }

  return (
    <button
      type="button"
      className="copy-link"
      onClick={() => void copy()}
      title="Copy a link to this exact view: filters, mode and sort"
    >
      <span aria-live="polite">{label}</span>
    </button>
  );
}
