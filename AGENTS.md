# AGENTS.md

This file provides shared guidance for any AI coding agent (Claude Code, Codex, Gemini CLI, etc.)
working in this repository. It is the single source of truth for agent instructions here.

## What this is

`envx` (`@dnbhq/envx`) is a small, dependency-free ESM library for checking, validating,
coercing, and loading environment variables, portable across Node.js, Deno, and Bun. It also ships
a CLI (`envx`) for one-off env var checks in shell scripts / CI.

The entire library is one file: [src/envx.ts](src/envx.ts). The CLI wrapper is
[src/bin/envx.ts](src/bin/envx.ts) and only calls into `envx.ts`'s public API — it has no logic of
its own beyond arg parsing. Don't split `envx.ts` into multiple modules unless asked; the single-file
shape is intentional for a zero-dependency micro-library.

## Commands

```bash
npm run build       # tsc -p tsconfig.json -> dist/ (declaration-only emit is NOT used here; JS is emitted too via tsc, see note below)
npm test            # runs `npm run build` (pretest) then node --test against test/**/*.js
npm run test:watch  # node --test --watch, no rebuild
npm run clean       # rm -rf dist
```

- There is no separate lint/typecheck script; `npm run build` (`tsc`) is both the build and the
  type-check. Run it before trusting any TypeScript change.
- To run a single test, use Node's test runner directly against the built output, e.g.:
  `node --test --test-name-pattern="loadEnv" test/envx.test.js` (rebuild first if `src/envx.ts` changed).
- Tests in [test/envx.test.js](test/envx.test.js) import from `dist/envx.js`, **not** from
  `src/envx.ts`. This means test runs are always against compiled output — a source edit without a
  rebuild will not be reflected. `pretest` handles this automatically for `npm test`.
- Optional Deno test suite (not run by `npm test`): `deno test --allow-env --allow-read --allow-write`,
  configured in [deno.jsonc](deno.jsonc), sourced from [deno.envx.test.ts](deno.envx.test.ts). It
  imports directly from `src/envx.ts` (no build step needed) since Deno runs TypeScript natively.

## Architecture

### Runtime detection (`envAccessor`)

At module load, `src/envx.ts` picks one of three env-var backends via an IIFE, in priority order:
1. Deno (`globalThis.Deno.env`) if present
2. Node/Bun-like (`globalThis.process.env`) if present
3. In-memory `Map` fallback for unknown runtimes (e.g. browsers)

All reads/writes in the rest of the file go through this `envAccessor`, never `process.env` or
`Deno.env` directly. When adding new functionality, keep using `envAccessor.get`/`.set` so runtime
portability is preserved.

### Public API shape

- `configureDefaults(overrides)` — merges into module-level `config` (mutable singleton), affects
  all subsequent calls until changed again. Tests must reset via `configureDefaults({ ...DEFAULTS })`
  after mutating config, since it's shared global state across the test file.
- `checkEnvVar(name, options?)` — presence/non-empty check only, throws `Error` on failure.
- `validateEnvVar(name, options?)` — presence + type coercion + constraints (pattern, min/maxLength,
  choices, custom `validate`), throws on failure. Always calls `checkEnvVar` first.
- `getEnvVar(name, options?)` — like `validateEnvVar` but supports `default` and optional/required
  semantics; delegates to `validateEnvVar` once presence is established.
- `loadEnv({ paths?, override? })` — parses `.env`-style files line by line (no external dotenv dep),
  supports `~` home-expansion, quoted values, and multiple files loaded in order.

### Error handling contract

Validation failures throw `Error` with messages that name the variable and the constraint violated,
but deliberately **never include the raw offending value** — this is a documented security property
(see README "Privacy & Safety Review"). If you touch `fail()` or `checkEnvVar`'s error paths, preserve
this: never interpolate the raw env value into a thrown message.

### `exitOnError` behavior

When `config.exitOnError` is true, failures call `process.exit(1)` — but only when
`envAccessor.runtime === "nodelike"`. This is a deliberate runtime guard; Deno and the in-memory
fallback never call `process.exit`.

## TypeScript config notes

[tsconfig.json](tsconfig.json) enables strict flags beyond `strict: true`, notably
`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Code that builds optional-property
objects conditionally (see `src/bin/envx.ts`'s `opts` construction) works around
`exactOptionalPropertyTypes` by only assigning keys when the value is defined, rather than assigning
`undefined`. Follow the same pattern for new optional fields.

## Workflow

- Work only on `main` unless explicitly told to use a branch.
- Every commit must reference a GitHub issue. If no relevant issue exists, create one first; if one
  already exists, work from it. After the work is done, add a comment to that issue explaining what
  was actually done (not just what was planned).
- Commit after every completed task rather than batching multiple tasks into one commit.

## Distribution

`dist/` is committed-adjacent build output (gitignored, rebuilt by `prepare`/`pretest`) and is what
gets published to npm (`files: ["dist/"]`) and what the CLI binary (`bin.envx`) points at. Never hand-edit
files under `dist/`.
