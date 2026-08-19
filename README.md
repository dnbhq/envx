# envx - cross-runtime environment variable helper

`envx` is an ESM utility for checking, validating, normalizing, and loading environment variables with no runtime dependencies.

## Features

- Runtime support for Node.js, Deno, and Bun.
- Validation types: `string`, `int`/`integer`, `number`, `boolean`.
- Constraint checks: `pattern`, `minLength`, `maxLength`, `choices`, and custom `validate` callback.
- Optional strict booleans (`true`/`false` only) or flexible boolean parsing (`true/false/1/0/yes/no/y/n/on/off`).
- Default values and optional/required semantics via `getEnvVar`.
- `.env` file loading with support for multiple files, user-home expansion (`~`), and optional override behaviour.
- Global configuration controls for verbose logging, default env file paths, trimming, and exit behaviour.
- CLI for one-off validation/lookup in Node/Bun environments.

## Installation

```bash
npm install @dnbhq/envx
```

Deno usage is via source import:

```ts
import { getEnvVar } from "./src/envx.ts";
```

## Core Use Cases

- Validate required secrets/config at startup (`checkEnvVar`, `validateEnvVar`).
- Parse runtime config into typed values (`PORT`, feature flags, rate limits).
- Keep one consistent validation strategy across apps and scripts.
- Load local and shared `.env` files without additional dotenv packages.
- Use a command-line check in CI or shell scripts (`npx envx ...`).

## API

### `configureDefaults(overrides)`

Merges global defaults.

```ts
configureDefaults({
  verbose: false,
  exitOnError: false,
  envFilePaths: ["~/.env", ".env"],
  trimValues: true,
  coerceTypes: true,
  booleanStrict: false,
});
```

> Note: `coerceTypes` is currently part of the public config shape but coercion behaviour is driven by per-call `type` options.

### `checkEnvVar(name, options?)`

Ensures presence (and non-empty value unless `allowEmpty: true`). Throws on error.

```ts
checkEnvVar("API_KEY");
checkEnvVar("OPTIONAL_BUT_NOT_EMPTY", { required: false });
```

### `validateEnvVar(name, options?)`

Returns a validated/coerced value or throws.

```ts
const port = validateEnvVar("PORT", { type: "int" });
const envName = validateEnvVar("NODE_ENV", {
  choices: ["development", "test", "production"],
});
const debug = validateEnvVar("DEBUG", { type: "boolean", booleanStrict: true });
```

### `getEnvVar(name, options?)`

Returns validated/coerced value, default, or `undefined` when optional and missing. If `type` is
`"int"`, `"number"`, or `"boolean"` and the supplied `default` can't be coerced to that type, throws
rather than returning an uncoerced value.

```ts
const port = getEnvVar("PORT", { type: "int", default: 3000 });
const debug = getEnvVar("DEBUG", { type: "boolean", required: false });
```

### `loadEnv({ paths?, override? })`

Loads key/value entries from one or more `.env`-style files.

```ts
await loadEnv({ paths: ["~/.env", ".env.local", ".env"], override: false });
```

`loadEnv` behaviour details:

- Ignores blank lines and comment lines beginning with `#`.
- Reads `KEY=value` pairs.
- Trims keys and values.
- Supports surrounding single/double quotes for values.
- Double-quoted values interpret `\n`, `\r`, `\t`, `\\`, and `\"` escape sequences; single-quoted values are literal (no escape processing).
- Content after a value's closing quote is ignored (not appended to the value); a verbose-mode warning is logged when this happens.
- Sets environment values only when missing unless `override: true`.

## CLI

```bash
npx envx --var API_KEY --type string --pattern '^[A-Za-z0-9_-]{16,}$'
npx envx --var PORT --type int --default 8080
npx envx --var DEBUG --type boolean --boolean-strict
```

Arguments:

- `--var` / `--name`: environment variable name (required)
- `--type`: `string|int|integer|number|boolean`
- `--pattern`: regex pattern (`text` or `/pattern/flags`), max 200 characters. Must only ever come
  from a trusted source (same caveat as `loadEnv`'s `paths`) — it's compiled directly into a
  `RegExp` with no ReDoS protection beyond the length cap.
- `--default`: fallback value
- `--boolean-strict`: enforce `true|false` only
- `--help`: show usage

## Runtime Notes

- **Node.js / Bun**: uses `process.env`; `exitOnError` can call `process.exit(1)`.
- **Deno**: uses `Deno.env`; requires `--allow-env` and `--allow-read` for `loadEnv`.
- **Fallback/unknown runtime**: uses in-memory map for get/set behaviour.
- **Browser use**: no browser-specific integration is provided.

## Privacy & Safety Review

The codebase was reviewed for environment-secret handling and misuse risks.

### Confirmed protections

- Validation errors identify variable names but do not include raw failing values for type errors, reducing accidental secret leakage in logs.
- `checkEnvVar` and shared failure paths throw errors (fail-fast) and optionally log only the error message.
- `.env` loading is local file based; there is no network I/O.

### Important operational caveats

- Variable names can still be sensitive in some organizations; avoid exposing naming conventions in public logs if that matters.
- `verbose: true` sends error messages to stderr; keep this disabled in high-sensitivity production logs unless required.
- `loadEnv` trusts file content and does not validate key names against a strict schema; validate variables after loading.
- `loadEnv`'s `paths` option must always be developer/deployment-controlled, never derived from user input or request data. `loadEnv` reads whatever local files it's pointed at and sets any key it finds in them into the process/Deno env with no name validation — untrusted `paths` or untrusted file contents are effectively an arbitrary file read + env-variable-injection primitive.
- The CLI prints resolved values to stdout by design; do not use it where stdout is persisted for secrets. Most CI systems do **not** auto-mask arbitrary command output — a value only becomes a masked secret once the pipeline explicitly registers it as one. Without an explicit masking step, a resolved value piped from the CLI into a captured/logged CI step appears in plaintext in the job log:

  ```yaml
  # GitHub Actions: register the value as a masked secret before it's used/logged
  - run: echo "::add-mask::$(npx envx --var API_KEY)"
  ```

  ```yaml
  # GitLab CI: GitLab only masks values known ahead of time, via Settings > CI/CD >
  # Variables with "Mask variable" enabled — it has no runtime "mask this now" step for
  # values computed inside a job. Prefer having the value already set as a masked CI/CD
  # variable rather than resolving it with the CLI and echoing/exporting it in a job.
  ```

  When no equivalent runtime-masking primitive exists for your CI system, avoid running the CLI in a way that puts the resolved value into persisted/captured output at all.
- The CLI's `--pattern` must always be developer/deployment-controlled, never derived from user input or request data. It's compiled directly into a `RegExp` (capped at 200 characters as a defensive measure) with no ReDoS protection beyond that cap, so an untrusted pattern tested against an untrusted value could still hang the process. For direct, developer-invoked CLI usage this is low risk; it matters only if this CLI is ever wrapped by something that accepts a pattern from a less-trusted source.

### Recommended usage pattern

1. `await loadEnv(...)` early in startup.
2. Validate all required values with explicit constraints.
3. Convert booleans in strict mode for production configs where ambiguity is risky.
4. Keep `verbose` off in production unless actively debugging.

## Development

```bash
npm run build
npm test
```

Optional:

```bash
deno test --allow-env --allow-read --allow-write
```

### Node.js version policy

envx follows the **active-latest** Node.js policy: it targets every currently active Node.js
release line (LTS and Current), dropping a line once it reaches end-of-life. The policy is
recorded in [.github/node-version-policy.json](.github/node-version-policy.json) and enforced by
a weekly [check-node-version-policy](.github/workflows/check-node-version-policy.yml) workflow,
which fails when `package.json#engines.node` or the CI matrix drifts from the official
[Node.js release schedule](https://github.com/nodejs/Release).

Check locally with:

```bash
node scripts/check-node-version-policy.mjs --check
```

Apply any needed updates with:

```bash
node scripts/check-node-version-policy.mjs --write
```

## License

[MIT License](LICENSE.md)
