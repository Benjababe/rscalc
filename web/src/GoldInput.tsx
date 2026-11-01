/**
 * The gold field, shared by the three pages.
 *
 * It keeps a draft string while the player types (so "2.5m" is not rewritten
 * mid-keystroke), commits the parsed value upwards only when it parses, and
 * reformats on blur. A preset button that changes the amount from outside
 * rewrites the draft, so the field never shows a stale number.
 */

import { useEffect, useRef, useState } from "react";

import { formatGoldInput, parseGoldInput } from "./money";

export function GoldInput(props: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}): JSX.Element {
  const [draft, setDraft] = useState<string>(() =>
    formatGoldInput(props.value),
  );
  // The last value this field committed or displayed, so an external change
  // (a preset) is distinguishable from the player's own typing.
  const seen = useRef(props.value);

  useEffect(() => {
    if (seen.current !== props.value) {
      seen.current = props.value;
      setDraft(formatGoldInput(props.value));
    }
  }, [props.value]);

  function edit(text: string): void {
    setDraft(text);
    const parsed = parseGoldInput(text);
    if (parsed !== null && parsed !== props.value) {
      seen.current = parsed;
      props.onChange(parsed);
    }
  }

  function blur(): void {
    // An unparseable draft is discarded rather than silently kept on screen.
    setDraft(formatGoldInput(props.value));
  }

  return (
    <input
      className="num wide"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={draft}
      onChange={(event) => edit(event.target.value)}
      onBlur={blur}
      aria-label={props.label ?? "Gold available"}
      title="Type 100k, 2.5m or 150,000,000"
    />
  );
}
