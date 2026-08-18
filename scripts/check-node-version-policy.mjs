#!/usr/bin/env node
// Compares this repo's declared Node.js versions (package.json#engines.node,
// the CI test matrix) against the official Node.js release schedule and the
// policy recorded in .github/node-version-policy.json.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const SCHEDULE_URL =
  "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json";

const PACKAGE_JSON_PATH = path.join(repoRoot, "package.json");
const POLICY_PATH = path.join(repoRoot, ".github/node-version-policy.json");
const CI_WORKFLOW_PATH = path.join(repoRoot, ".github/workflows/ci.yml");

function parseArgs(argv) {
  const args = {
    help: false,
    check: false,
    write: false,
    format: "text",
    verbose: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--check") args.check = true;
    else if (arg === "--write") args.write = true;
    else if (arg === "--verbose") args.verbose = true;
    else if (arg.startsWith("--format=")) args.format = arg.slice("--format=".length);
    else {
      throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`);
    }
  }
  if (!args.check && !args.write) args.check = true; // default action
  return args;
}

function printHelp() {
  console.log(`check-node-version-policy.mjs

Compares declared Node.js versions in this repo against the official Node.js
release schedule and the policy in .github/node-version-policy.json.

Usage:
  node scripts/check-node-version-policy.mjs [--check] [--write] [--format=text|json] [--verbose]

Options:
  --check          Report drift without changing files (default).
  --write          Update package.json engines.node and the CI matrix in place.
  --format=json    Emit machine-readable JSON instead of the friendly summary.
  --verbose        List every file inspected and the values compared.
  --help, -h       Show this help.

Exit codes:
  0  Declarations are current (or --write succeeded).
  1  Declarations are stale (--check) or an error occurred.
`);
}

async function fetchSchedule() {
  const res = await fetch(SCHEDULE_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch Node.js release schedule: HTTP ${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}

function activeMajors(schedule, today) {
  const majors = [];
  for (const [key, info] of Object.entries(schedule)) {
    const major = Number(key.replace(/^v/, ""));
    if (!Number.isInteger(major)) continue;
    const started = info.start && info.start <= today;
    const notEnded = info.end && info.end >= today;
    if (!started || !notEnded) continue;
    const ltsActive = Boolean(info.lts && info.lts <= today);
    majors.push({ major, ltsActive });
  }
  majors.sort((a, b) => a.major - b.major);
  return majors;
}

function expectedMajors(policy, majors) {
  const ltsActive = majors.filter((m) => m.ltsActive).map((m) => m.major);
  const allActive = majors.map((m) => m.major);

  if (policy.packageType === "application") {
    if (policy.policy === "lts") {
      return ltsActive.length ? [Math.max(...ltsActive)] : [];
    }
    return allActive.length ? [Math.max(...allActive)] : [];
  }

  // library
  if (policy.policy === "lts") {
    return policy.includeAllActiveLts
      ? ltsActive
      : ltsActive.length
        ? [Math.max(...ltsActive)]
        : [];
  }

  // active-latest library
  let result = policy.includeAllActiveLts ? [...ltsActive] : ltsActive.length ? [Math.max(...ltsActive)] : [];
  if (policy.includeCurrentForLibraries) {
    const current = allActive.filter((m) => !ltsActive.includes(m));
    result = [...new Set([...result, ...current])];
  }
  return result.sort((a, b) => a - b);
}

function engineRange(majorsList) {
  return majorsList.map((m) => `^${m}.0.0`).join(" || ");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function extractCiMatrix(ciYaml) {
  const match = ciYaml.match(/node-version:\s*\[([^\]]*)\]/);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  let schedule;
  try {
    schedule = await fetchSchedule();
  } catch (err) {
    console.error(`error: ${err.message}`);
    console.error("Retry later, or check network/proxy access to raw.githubusercontent.com.");
    process.exitCode = 1;
    return;
  }

  const policy = await readJson(POLICY_PATH);
  const majors = activeMajors(schedule, today);
  const expected = expectedMajors(policy, majors);
  const expectedRange = engineRange(expected);

  const pkg = await readJson(PACKAGE_JSON_PATH);
  const currentRange = pkg.engines?.node ?? null;

  const ciYaml = await readFile(CI_WORKFLOW_PATH, "utf8");
  const currentMatrix = extractCiMatrix(ciYaml);

  const issues = [];
  if (currentRange !== expectedRange) {
    issues.push({
      file: "package.json",
      field: "engines.node",
      current: currentRange,
      expected: expectedRange,
    });
  }
  const matrixMatches =
    currentMatrix &&
    currentMatrix.length === expected.length &&
    currentMatrix.every((v, i) => v === expected[i]);
  if (!matrixMatches) {
    issues.push({
      file: ".github/workflows/ci.yml",
      field: "matrix.node-version",
      current: currentMatrix,
      expected,
    });
  }

  if (args.verbose) {
    console.error(`Inspected: ${PACKAGE_JSON_PATH}`);
    console.error(`Inspected: ${CI_WORKFLOW_PATH}`);
    console.error(`Inspected: ${POLICY_PATH}`);
    console.error(`Active majors as of ${today}: ${JSON.stringify(majors)}`);
  }

  if (args.write && issues.length > 0) {
    let newPkgText = await readFile(PACKAGE_JSON_PATH, "utf8");
    newPkgText = newPkgText.replace(
      /("node":\s*")([^"]*)(")/,
      (full, pre, _old, post) => `${pre}${expectedRange}${post}`,
    );
    await writeFile(PACKAGE_JSON_PATH, newPkgText);

    let newCiText = ciYaml.replace(
      /node-version:\s*\[[^\]]*\]/,
      `node-version: [${expected.join(", ")}]`,
    );
    await writeFile(CI_WORKFLOW_PATH, newCiText);
  }

  const result = {
    today,
    policy,
    activeMajors: majors,
    expected,
    expectedRange,
    issues,
    written: args.write && issues.length > 0,
  };

  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else if (issues.length === 0) {
    console.log("Node.js version declarations are current.");
    console.log(`Policy: ${policy.policy} (${policy.packageType})`);
    console.log(`Expected engines.node: ${expectedRange}`);
  } else if (args.write) {
    console.log("Updated stale Node.js version declarations:");
    for (const issue of issues) {
      console.log(`- ${issue.file}: ${issue.field} -> ${JSON.stringify(issue.expected)}`);
    }
  } else {
    console.log("Node.js version declarations are stale:");
    for (const issue of issues) {
      console.log(
        `- ${issue.file}: ${issue.field} is ${JSON.stringify(issue.current)}, expected ${JSON.stringify(issue.expected)}`,
      );
    }
    console.log("\nRun with --write to apply, or edit the files manually.");
  }

  if (args.check && issues.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
});
