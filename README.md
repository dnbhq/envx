# envx - cross-runtime environment variable helper

`envx` is an ESM utility for checking, validating, normalizing, and loading environment variables with no runtime dependencies.

## Features

- Runtime support for Node.js, Deno, and Bun.
- Validation types: `string`, `int`/`integer`, `number`, `boolean`.
- Constraint checks: `pattern`, `minLength`, `maxLength`, `choices`, and custom `validate` callback.
- Optional strict booleans (`true`/`false` only) or flexible boolean parsing (`true/false/1/0/yes/no/y/n/on/off`).
- Default values and optional/required semantics via `getEnvVar`.
- `.env` file loading with support for multiple files, user-home expansion (`~`), and optional override behavior.
- Global configuration controls for verbose logging, default env file paths, trimming, and exit behavior.
- CLI for one-off validation/lookup in Node/Bun environments.

## Installation

```bash
npm install @davidsneighbour/envx
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

> Note: `coerceTypes` is currently part of the public config shape but coercion behavior is driven by per-call `type` options.

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

Returns validated/coerced value, default, or `undefined` when optional and missing.

```ts
const port = getEnvVar("PORT", { type: "int", default: 3000 });
const debug = getEnvVar("DEBUG", { type: "boolean", required: false });
```

### `loadEnv({ paths?, override? })`

Loads key/value entries from one or more `.env`-style files.

```ts
await loadEnv({ paths: ["~/.env", ".env.local", ".env"], override: false });
```

`loadEnv` behavior details:

- Ignores blank lines and comment lines beginning with `#`.
- Reads `KEY=value` pairs.
- Trims keys and values.
- Supports surrounding single/double quotes for values.
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
- `--pattern`: regex pattern (`text` or `/pattern/flags`)
- `--default`: fallback value
- `--boolean-strict`: enforce `true|false` only
- `--help`: show usage

## Runtime Notes

- **Node.js / Bun**: uses `process.env`; `exitOnError` can call `process.exit(1)`.
- **Deno**: uses `Deno.env`; requires `--allow-env` and `--allow-read` for `loadEnv`.
- **Fallback/unknown runtime**: uses in-memory map for get/set behavior.
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
- The CLI prints resolved values to stdout by design; do not use it where stdout is persisted for secrets.

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

## License

[MIT License](LICENSE.md)
