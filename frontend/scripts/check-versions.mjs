#!/usr/bin/env node
// Fails the build if paired packages drift to different versions in package-lock.json.
// React error #527 (and similar runtime mismatches) happens when react and react-dom
// resolve to different versions in the same bundle. This script catches that before
// the bundle is built.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const lockPath = resolve(__dirname, "..", "package-lock.json");

const PAIRS = [
  // react and react-dom MUST be exactly equal; mismatched versions produce
  // React error #527 at runtime and a blank screen in production.
  { packages: ["react", "react-dom"], match: "exact" },
  // @types/* must agree on major.minor with the runtime to avoid stale typings.
  { packages: ["@types/react", "@types/react-dom"], match: "minor" },
];

function readLock() {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (err) {
    console.error(`[check-versions] cannot read ${lockPath}: ${err.message}`);
    process.exit(1);
  }
}

function resolveVersion(lock, name) {
  const entry = lock.packages?.[`node_modules/${name}`];
  return entry?.version ?? null;
}

function minorOf(version) {
  const [major, minor] = version.split(".");
  return `${major}.${minor}`;
}

const lock = readLock();
const errors = [];

for (const { packages, match } of PAIRS) {
  const versions = packages.map((name) => [name, resolveVersion(lock, name)]);
  const missing = versions.filter(([, v]) => v === null);
  if (missing.length === packages.length) continue; // none installed, skip
  if (missing.length > 0) {
    errors.push(
      `Partial install of paired packages: ${versions
        .map(([n, v]) => `${n}=${v ?? "MISSING"}`)
        .join(", ")}`,
    );
    continue;
  }
  const keys = versions.map(([, v]) => (match === "minor" ? minorOf(v) : v));
  const allEqual = keys.every((k) => k === keys[0]);
  if (!allEqual) {
    errors.push(
      `Version drift (${match}): ${versions
        .map(([n, v]) => `${n}@${v}`)
        .join(" vs ")}`,
    );
  }
}

if (errors.length > 0) {
  console.error("[check-versions] FAIL");
  for (const e of errors) console.error("  - " + e);
  console.error(
    "Run `npm install` after aligning versions in package.json so the lockfile resolves cleanly.",
  );
  process.exit(1);
}

console.log("[check-versions] ok");
