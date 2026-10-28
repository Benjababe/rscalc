/**
 * Minimal HTML table extraction for the wiki's `Special:Bucket` special pages.
 *
 * The Bucket extension serves structured wiki data as an HTML table. Both the
 * shop catalogue (`bucket=storeline`) and the map data (`bucket=map`) parse it
 * the same way, so the fragile part — entity decoding and cell splitting — lives
 * here once. Callers must address columns by header name, never by index, so an
 * upstream reorder fails loudly instead of shifting every value by one field.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/** Visible text of an HTML fragment, with entities decoded and tags stripped. */
export function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TableRow {
  header: boolean;
  cells: string[];
}

/** Extract rows, remembering which ones were `<th>` header rows. */
export function extractRows(html: string): TableRow[] {
  const rows: TableRow[] = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const inner = rowMatch[1] ?? '';
    const isHeader = /<th[\s>]/i.test(inner);
    const cellPattern = /<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(inner)) !== null) {
      cells.push(cellText(cellMatch[2] ?? ''));
    }
    if (cells.length > 0) rows.push({ header: isHeader, cells });
  }

  return rows;
}

/** Map a header row's names to their column index, lowercased. */
export function headerIndex(header: TableRow): Map<string, number> {
  const index = new Map<string, number>();
  header.cells.forEach((name, i) => index.set(name.toLowerCase(), i));
  return index;
}

/**
 * Read one cell by header name. Missing columns and short rows both yield '',
 * so the caller decides whether that is `null` or a schema violation.
 */
export function cellByHeader(
  cells: string[],
  index: Map<string, number>,
  name: string,
): string {
  const position = index.get(name);
  return position === undefined ? '' : (cells[position] ?? '');
}
