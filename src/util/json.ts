/**
 * Typed JSON file loading.
 *
 * Every read of `data/*.json` goes through here so that a missing or malformed
 * artifact produces one actionable message ("run pnpm build:data") instead of a
 * raw SyntaxError from deep inside a script.
 */

import { readFile } from 'fs/promises';
import type { z } from 'zod';

/**
 * Read, parse and schema-validate a JSON file.
 *
 * The parse is inside `try` so a corrupt artifact cannot escape as an
 * unhandled `SyntaxError`.
 */
export async function readJsonFile<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    throw new Error(
      `Cannot read ${path}. Generate the data first: pnpm build:data`,
      { cause },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `${path} is not valid JSON. Regenerate it: pnpm build:data`,
      { cause },
    );
  }

  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      `${path} does not match the expected schema:\n${result.error.message}`,
    );
  }

  return result.data;
}
