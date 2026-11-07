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
 *
 * The signature derives the result from the schema (`z.output<S>`) rather than
 * inferring a free `T` from it. Both read the same, but only this form fails
 * safely: if `zod` does not resolve on a machine (a stale or missing
 * `node_modules`), the schema argument becomes an error type, `z.ZodType<T>`
 * cannot infer `T`, and every caller silently receives `unknown` — a wall of
 * "is of type 'unknown'" errors far from the real cause. With a lookup instead of
 * reverse inference, the same breakage produces one error in this file instead of
 * one per call site.
 */
export async function readJsonFile<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
): Promise<z.output<S>> {
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

  // SAFETY: `safeParse` is reached through `ZodTypeAny`, whose Output is `any`, so
  // the success branch has to be narrowed back to the schema's own output type.
  // The guarantee is zod's own: `success` means the value matched the schema.
  return result.data as z.output<S>;
}
