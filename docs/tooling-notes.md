# Tooling notes

Non-obvious environment quirks. Recorded so the next person doesn't lose an hour
to them.

## 1. Prefer bare builtin specifiers (`crypto`, not `node:crypto`)

`src/api/http.ts` imports Node builtins without the protocol prefix:

```ts
import { createHash } from "crypto";
```

Node's ESM resolver matches bare builtin names before consulting `node_modules`,
so this is behaviourally identical to the prefixed form and cannot be shadowed
by an npm package. The prefixed form is otherwise the more explicit choice, and
is what you should reach for in a project without this issue.

Reason: a language server in this environment fails to resolve the prefixed
protocol specifier even when `@types/node` is installed, producing a "cannot find
module" diagnostic against a file `tsc` compiles cleanly.

## 2. `node-linker=hoisted` is required (see `.npmrc`)

pnpm's default install symlinks `node_modules/@types/node` into its
content-addressed store:

```
node_modules/@types/node -> node_modules/.pnpm/@types+node@22.20.5/node_modules/@types/node
```

Tooling that does not follow symlinks then fails to load `@types/node` and
reports every Node builtin import as an unresolved module. `.npmrc` sets
`node-linker=hoisted` so `node_modules/@types/node` is a real directory.

**Do not remove `.npmrc`.**

## 3. `tsc` and `vitest` are the source of truth

The editor-side LSP in this environment is intermittently unavailable and can
replay stale diagnostics recorded before `node_modules` existed. When tooling
disagrees with itself, trust:

```sh
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
```

To prove module resolution without ambiguity:

```sh
npx tsc --noEmit --listFiles | grep "@types/node"
npx tsc --noEmit --traceResolution | grep -i "@types/node"
```

If a diagnostic names a string that no longer appears in the file, it is stale.

### Evicting a stale diagnostic

The diagnostic cache is keyed by file **path** and does not invalidate when the
file content changes. A file that was once analysed while broken can replay the
same error indefinitely, even after the cause is fixed and `tsc` passes.

The fix is to remove and recreate the file:

```sh
rm web/src/main.tsx   # then write it again, even with identical content
```

Observed case: `web/src/main.tsx` was written before `web/src/App.tsx` existed,
producing a genuine `Cannot find module './App'` error. After `App.tsx` was
created, the error kept replaying against content that no longer contained the
import at all. Recreating the file cleared it.

Do **not** rename modules or distort source code to dodge this — recreate the
file instead.

## 4. An auto-formatter rewrites files on write

Files may be reformatted on save (observed: single quotes converted to double
quotes, long expressions reflowed). This is cosmetic. If it becomes noisy, pin
the style in a `biome.json` at the repo root rather than fighting it per-file.
