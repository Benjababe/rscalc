/**
 * Reading a wiki template's parameters.
 *
 * Every parser in `src/api/` addresses a template **by key**, never by position
 * (`AGENTS.md`). The trap this module exists for: a template may be written across
 * several lines or entirely on one, and both shapes occur on the same wiki —
 *
 *   {{Skilling success chart|label=Cerulean twitch catch chance|showbefore=no
 *    |label1=Cerulean twitch|low1=82|high1=380|req1=11}}
 *
 *   {{Skilling success chart|label=Monkfish fishing chance|showbefore=no
 *    |label1=Raw monkfish|low1=48|high1=90|req1=62}}
 *
 * Splitting on newlines therefore reads only the parameters that happen to start a
 * line, which silently loses the whole option group on an inline template. The
 * split here is on a **top-level pipe**: a `|` inside a nested `{{...}}` (a
 * `{{plink|Box trap}}` in a `trap=` field) or a `[[...]]` link belongs to the
 * value, not to the next parameter.
 */

/** Index just past the `}}` that closes the template opening at `start`, or -1. */
function templateEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2);
    if (pair === '{{') {
      depth += 1;
      i += 1;
    } else if (pair === '}}') {
      depth -= 1;
      i += 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The body (everything between `{{` and `}}`) of the first template with one of
 * the given names, or null when the page has none.
 *
 * The name is compared literally (case-insensitively) after the `{{` and any
 * whitespace. No pattern is built from the name: a dynamic `RegExp` is the one
 * thing in these parsers that could be talked into matching something else, and
 * there are only a handful of template names.
 */
export function templateBody(text: string, names: readonly string[]): string | null {
  const wanted = names.map((name) => name.toLowerCase());
  for (let at = text.indexOf('{{'); at >= 0; at = text.indexOf('{{', at + 2)) {
    let nameAt = at + 2;
    while (nameAt < text.length && /\s/.test(text[nameAt] ?? '')) nameAt += 1;
    const rest = text.slice(nameAt, nameAt + 64).toLowerCase();
    const found = wanted.find(
      (name) =>
        rest.startsWith(name) && !/[a-z0-9_]/.test(rest.charAt(name.length)),
    );
    if (found === undefined) continue;
    const end = templateEnd(text, at);
    if (end < 0) continue;
    return text.slice(at + 2, end - 2);
  }
  return null;
}

/** Split a template body on top-level `|` characters. */
function topLevelSegments(body: string): string[] {
  const segments: string[] = [];
  let current = '';
  let templateDepth = 0;
  let linkDepth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const pair = body.slice(i, i + 2);
    if (pair === '{{') {
      templateDepth += 1;
      current += pair;
      i += 1;
      continue;
    }
    if (pair === '}}') {
      templateDepth = Math.max(0, templateDepth - 1);
      current += pair;
      i += 1;
      continue;
    }
    if (pair === '[[') {
      linkDepth += 1;
      current += pair;
      i += 1;
      continue;
    }
    if (pair === ']]') {
      linkDepth = Math.max(0, linkDepth - 1);
      current += pair;
      i += 1;
      continue;
    }
    const char = body[i];
    if (char === '|' && templateDepth === 0 && linkDepth === 0) {
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

/**
 * Key -> value for a template body. The first occurrence of a key wins, which is
 * how MediaWiki renders a duplicated parameter.
 *
 * The leading segment is the template name (`Skilling success chart`), so it never
 * looks like a `key=value` pair and is skipped by the shape check.
 */
export function templateParams(body: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const segment of topLevelSegments(body)) {
    const match = /^\s*([a-z0-9_ ]+?)\s*=\s*([\s\S]*)$/i.exec(segment);
    if (match === null) continue;
    const key = (match[1] ?? '').trim().toLowerCase();
    if (key === '' || params.has(key)) continue;
    params.set(key, (match[2] ?? '').trim());
  }
  return params;
}

/** The parameters of the first template matching any of `names`. */
export function firstTemplateParams(
  text: string,
  names: readonly string[],
): Map<string, string> | null {
  const body = templateBody(text, names);
  return body === null ? null : templateParams(body);
}
