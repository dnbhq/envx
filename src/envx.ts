/**
 * envx — Cross-runtime environment variable helper (Node, Deno, Bun)
 * ESM-only. No external dependencies.
 */

export type EnvxConfig = {
  verbose: boolean;
  exitOnError: boolean;        // Node/Bun only
  envFilePaths: string[];      // used by loadEnv() when called without args
  trimValues: boolean;
  coerceTypes: boolean;
  booleanStrict: boolean;      // Q3: true => only 'true'|'false' accepted for booleans
};

const DEFAULT_CONFIG: EnvxConfig = {
  verbose: false,
  exitOnError: false,
  envFilePaths: [],
  trimValues: true,
  coerceTypes: true,
  booleanStrict: false
};

let config: EnvxConfig = { ...DEFAULT_CONFIG };

/** Internal environment accessor (Node/Bun via process.env, Deno via Deno.env) */
const envAccessor = (() => {
  const isDeno = typeof (globalThis as any).Deno !== "undefined" && !!(globalThis as any).Deno?.env;
  if (isDeno) {
    const DenoObj = (globalThis as any).Deno;
    return {
      get(name: string): string | undefined {
        return DenoObj.env.get(name) ?? undefined;
      },
      set(name: string, value: string): void {
        DenoObj.env.set(name, value);
      },
      runtime: "deno" as const
    };
  }
  const hasProcess = typeof (globalThis as any).process !== "undefined" && !!(globalThis as any).process?.env;
  if (hasProcess) {
    const proc = (globalThis as any).process;
    return {
      get(name: string): string | undefined {
        const v = proc.env[name];
        return v === undefined ? undefined : String(v);
      },
      set(name: string, value: string): void {
        proc.env[name] = value;
      },
      runtime: "nodelike" as const
    };
  }
  const tmp = new Map<string, string>();
  return {
    get(name: string): string | undefined {
      return tmp.get(name);
    },
    set(name: string, value: string): void {
      tmp.set(name, value);
    },
    runtime: "unknown" as const
  };
})();

export const DEFAULTS = Object.freeze({ ...DEFAULT_CONFIG });

export function configureDefaults(overrides: Partial<EnvxConfig> = {}): void {
  config = { ...config, ...overrides };
}

export type ValidateOptions = {
  type?: "string" | "int" | "integer" | "number" | "boolean";
  pattern?: RegExp;
  minLength?: number;
  maxLength?: number;
  choices?: Array<string | number | boolean> | ((v: unknown) => boolean);
  validate?: (v: unknown) => boolean;
  booleanStrict?: boolean; // per-call override of global strictness
};

export type CheckOptions = {
  required?: boolean;
  allowEmpty?: boolean;
  message?: string;
};

/** Ensure var exists (non-empty unless allowEmpty). Throws on failure. */
export function checkEnvVar(name: string, options: CheckOptions = {}): true {
  const { required = true, allowEmpty = false, message } = options;
  const raw = envAccessor.get(name);

  if (!required) return true;

  const missing = raw === undefined || raw === null;
  const empty = typeof raw === "string" && !allowEmpty && raw.trim() === "";

  if (missing || empty) {
    const errMsg =
      message ??
      (missing
        ? `Environment variable "${name}" is not defined.`
        : `Environment variable "${name}" is empty.`);
    if (config.verbose) console.error(errMsg);
    if (config.exitOnError && (envAccessor as any).runtime === "nodelike") {
      try {
        (globalThis as any).process?.exit?.(1);
      } catch { /* ignore */ }
    }
    throw new Error(errMsg);
  }
  return true;
}

function toBooleanStrict(raw: string, useStrict: boolean): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (useStrict) {
    if (v === "true") return true;
    if (v === "false") return false;
    return undefined;
  }
  if (["true", "1", "yes", "y", "on"].includes(v)) return true;
  if (["false", "0", "no", "n", "off"].includes(v)) return false;
  return undefined;
}

function parseIntStrict(s: string): number | undefined {
  const t = s.trim();
  if (!/^[+-]?\d+$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isInteger(n) ? n : undefined;
}

function parseNumberStrict(s: string): number | undefined {
  const n = Number(s.trim());
  return Number.isNaN(n) ? undefined : n;
}

function fail(name: string, reason: string): never {
  const msg = `Environment variable "${name}" ${reason}.`;
  if (config.verbose) console.error(msg);
  if (config.exitOnError && (envAccessor as any).runtime === "nodelike") {
    try {
      (globalThis as any).process?.exit?.(1);
    } catch { /* ignore */ }
  }
  throw new Error(msg);
}

/** Validate var and return coerced value. Throws on failure. */
export function validateEnvVar(
  name: string,
  options: ValidateOptions = {}
): string | number | boolean {
  checkEnvVar(name, { required: true, allowEmpty: false });
  const raw0 = envAccessor.get(name)!;
  const raw = config.trimValues ? raw0.trim() : raw0;

  const t = options.type ?? "string";
  const useStrict = options.booleanStrict ?? config.booleanStrict;

  let value: string | number | boolean = raw;

  if (t === "boolean") {
    const b = toBooleanStrict(raw, useStrict);
    if (b === undefined) fail(name, "expected a boolean");
    value = b;
  } else if (t === "int" || t === "integer") {
    const n = parseIntStrict(raw);
    if (n === undefined) fail(name, "expected an integer");
    value = n;
  } else if (t === "number") {
    const n = parseNumberStrict(raw);
    if (n === undefined) fail(name, "expected a number");
    value = n;
  } // string remains as-is (trimmed if enabled)

  if (options.pattern) {
    const s = typeof value === "string" ? value : String(raw);
    if (!options.pattern.test(s)) fail(name, `does not match pattern ${String(options.pattern)}`);
  }

  if (typeof value === "string") {
    if (options.minLength !== undefined && value.length < options.minLength) {
      fail(name, `must have at least ${options.minLength} characters`);
    }
    if (options.maxLength !== undefined && value.length > options.maxLength) {
      fail(name, `must have no more than ${options.maxLength} characters`);
    }
  }

  if (options.choices) {
    const choices = options.choices;
    let ok = false;
    if (Array.isArray(choices)) {
      ok = choices.includes(value as any);
    } else if (typeof choices === "function") {
      try { ok = !!choices(value); } catch { ok = false; }
    }
    if (!ok) {
      if (Array.isArray(choices)) fail(name, `must be one of [${choices.join(", ")}]`);
      fail(name, "failed allowed-values check");
    }
  }

  if (options.validate) {
    let ok = false;
    try { ok = !!options.validate(value); } catch { ok = false; }
    if (!ok) fail(name, "failed custom validation");
  }

  return value;
}

/** Get value with default/optional semantics + validation/coercion. */
export function getEnvVar(
  name: string,
  options: ValidateOptions & { default?: unknown; required?: boolean } = {}
): string | number | boolean | undefined {
  const raw = envAccessor.get(name);
  const missing = raw === undefined || raw === null;
  const empty = typeof raw === "string" && raw.trim() === "";

  const hasDefault = Object.prototype.hasOwnProperty.call(options, "default");
  const required = options.required !== undefined ? options.required : !hasDefault;

  if ((missing || empty) && !required) {
    if (hasDefault) {
      const def = options.default as unknown;
      const useStrict = options.booleanStrict ?? config.booleanStrict;

      if (options.type === "boolean") {
        if (typeof def === "boolean") return def;
        const b = toBooleanStrict(String(def), useStrict);
        return b === undefined ? (def as any) : b;
      }
      if (options.type === "int" || options.type === "integer") {
        if (typeof def === "number" && Number.isInteger(def)) return def;
        const n = parseIntStrict(String(def));
        return n === undefined ? (def as any) : n;
      }
      if (options.type === "number") {
        if (typeof def === "number") return def;
        const n = parseNumberStrict(String(def));
        return n === undefined ? (def as any) : n;
      }
      return typeof def === "string" && config.trimValues ? def.trim() : (def as any);
    }
    return undefined;
  }

  return validateEnvVar(name, options);
}

/** Read file content safely; returns undefined on error or missing. */
async function readTextFileSafe(p: string): Promise<string | undefined> {
  if (envAccessor.runtime === "deno") {
    try {
      return await (globalThis as any).Deno.readTextFile(p);
    } catch {
      return undefined;
    }
  }
  try {
    const fs = await import("node:fs/promises");
    try { await fs.access(p); } catch { return undefined; }
    return await fs.readFile(p, { encoding: "utf8" });
  } catch {
    return undefined;
  }
}

function expandHome(p: string): string {
  if (!p.startsWith("~")) return p;
  const home =
    ((globalThis as any).Deno?.env?.get?.("HOME")) ??
    (globalThis as any).process?.env?.HOME ??
    (globalThis as any).process?.env?.USERPROFILE ??
    "";
  if (!home) return p.replace(/^~/, "");
  const needsSep = !home.endsWith("/") && !home.endsWith("\\");
  const rest = p.slice(1);
  const sep = rest.startsWith("/") || rest.startsWith("\\") ? "" : "/";
  return home + (needsSep ? sep : "") + rest;
}

/** Load .env-like files; returns loaded key->value map. */
export async function loadEnv(
  options: { paths?: string | string[]; override?: boolean } = {}
): Promise<Record<string, string>> {
  let paths: string[] = [];
  if (options.paths) paths = Array.isArray(options.paths) ? options.paths.slice() : [options.paths];
  else if (config.envFilePaths.length) paths = config.envFilePaths.slice();
  else paths = [".env"];

  const override = !!options.override;
  const loaded: Record<string, string> = {};

  for (let fp of paths) {
    const path = expandHome(fp);
    const content = await readTextFileSafe(path);
    if (!content) continue;

    const lines = content.split(/\r?\n/);
    for (const line0 of lines) {
      const line = line0.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      if (!key) continue;
      let val = line.slice(idx + 1);
      // strip surrounding quotes
      val = (val ?? "").trim();
      if (val.startsWith('"') || val.startsWith("'")) {
        const q = val[0] as '"' | "'";
        const end = val.indexOf(q, 1);
        if (end > 0) {
          const inner = val.slice(1, end);
          const rest = val.slice(end + 1).trim(); // keep trailing content like \n
          val = inner + rest;
        }
      }

      if (override || envAccessor.get(key) === undefined) {
        envAccessor.set(key, val);
      }
      loaded[key] = val;
    }
  }
  return loaded;
}
