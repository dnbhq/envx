#!/usr/bin/env node
import { configureDefaults, getEnvVar } from "../envx.ts";

type ArgMap = Record<string, string | boolean>;

function parseArgs(argv: string[]): ArgMap {
  const out: ArgMap = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const key = a.slice(2);
      // next token (if any) that isn't a flag belongs to this key
      // we'll look ahead using an iterator approach:
      // simpler: rely on process.argv slice with indices here:
      // BUT since we used for..of, we can't look ahead easily.
      // So re-implement with a classic loop for safety.
    }
  }
  // classic loop (robust against "possibly undefined")
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function toRegExp(input?: string | boolean): RegExp | undefined {
  if (!input || typeof input !== "string") return undefined;
  try {
    if (input.startsWith("/") && input.lastIndexOf("/") > 0) {
      const last = input.lastIndexOf("/");
      return new RegExp(input.slice(1, last), input.slice(last + 1));
    }
    return new RegExp(input);
  } catch {
    return undefined;
  }
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const name = (args["var"] as string) || (args["name"] as string);

  if (!name || args["help"]) {
    console.log(
      [
        "Usage: envx --var NAME [--type string|int|number|boolean] [--pattern PATTERN] [--default VALUE]",
        "       [--boolean-strict]",
        "",
        "Examples:",
        "  envx --var API_KEY --type string --pattern '^[A-Za-z0-9_-]{16,}$'",
        "  envx --var DEBUG --type boolean --boolean-strict"
      ].join("\n")
    );
    process.exit(2);
  }

  const type = (args["type"] as string) || undefined;
  const pattern = toRegExp(args["pattern"]);
  const defv = (args["default"] as string) ?? undefined;
  const booleanStrict = !!args["boolean-strict"];

  if (booleanStrict) configureDefaults({ booleanStrict: true });

  try {
    // Build options object conditionally to satisfy exactOptionalPropertyTypes
    const opts: any = { };
    if (type) opts.type = type as any;
    if (pattern) opts.pattern = pattern;
    if (defv !== undefined) opts.default = defv;
    if (booleanStrict) opts.booleanStrict = true;

    const val = getEnvVar(name, opts);
    if (val === undefined) {
      console.error("undefined");
      process.exit(1);
    }
    process.stdout.write(String(val) + "\n");
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? String(e);
    console.error(msg);
    process.exit(1);
  }
})();
