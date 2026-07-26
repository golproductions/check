#!/usr/bin/env node
// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
// One command to release. One input. Every version string derived from it.
//
//   npm run release -- 3.5.0
//   npm run release -- patch|minor|major
//
// Publishing by hand is what broke this twice. Two VERSION constants and a
// package.json meant three chances to bump two of them: 3.3.8 shipped a hook
// reporting 2.1.0, and 3.4.0 shipped an MCP server announcing 3.3.9. Both were
// found after publishing, by asking the artifact.
//
// So the version is no longer typed anywhere. It is written once here and
// stamped into every file, the same way release.yml does it from a git tag.
// Then prepublishOnly rebuilds and refuses to publish if any of them disagree.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PKG = join(ROOT, "package.json");
const STAMPED = ["src/index.js", "src/mcp.js"];

const arg = process.argv[2];
if (!arg) {
  console.error("usage: npm run release -- <version|patch|minor|major>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(PKG, "utf8"));
const cur = pkg.version;

function bump(v, kind) {
  const [a, b, c] = v.split(".").map(Number);
  if (kind === "major") return `${a + 1}.0.0`;
  if (kind === "minor") return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}
const next = /^\d+\.\d+\.\d+$/.test(arg) ? arg
  : ["patch", "minor", "major"].includes(arg) ? bump(cur, arg)
  : null;
if (!next) { console.error(`not a version or bump keyword: ${arg}`); process.exit(1); }

// Refuse to reuse a version that is already on the registry. npm rejects it
// anyway, but after the build, which wastes the run and reads like a failure.
const res = await fetch("https://registry.npmjs.org/" + pkg.name.replace("/", "%2f"), {
  signal: AbortSignal.timeout(20000),
}).then(r => r.json()).catch(() => null);
if (res && res.versions && res.versions[next]) {
  console.error(`${pkg.name}@${next} is already published. Pick a higher version.`);
  process.exit(1);
}
if (res && res["dist-tags"]) console.log(`registry latest: ${res["dist-tags"].latest}`);

console.log(`${cur} -> ${next}\n`);

pkg.version = next;
writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log("  stamped  package.json");

for (const rel of STAMPED) {
  const p = join(ROOT, rel);
  const before = readFileSync(p, "utf8");
  const after = before.replace(/const VERSION = "[^"]*";/, `const VERSION = "${next}";`);
  if (before === after) { console.error(`  FAILED   ${rel} has no VERSION const to stamp`); process.exit(1); }
  writeFileSync(p, after, "utf8");
  console.log("  stamped  " + rel);
}

// Build and run the gates now, so a bad release fails here rather than
// half-way through `npm publish`.
console.log("\nbuilding and checking...\n");
for (const [label, args] of [
  ["build", ["build.mjs"]],
  ["version-lock", ["test/version-lock.mjs"]],
  ["upgrade-path", ["test/upgrade-path.mjs"]],
]) {
  const r = spawnSync(process.execPath, args.map(a => join(ROOT, a)), { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  const out = ((r.stdout || "") + (r.stderr || "")).trim().split("\n").pop();
  if (r.status !== 0) {
    console.error(`  FAILED   ${label}\n${(r.stdout || "") + (r.stderr || "")}`);
    process.exit(1);
  }
  console.log(`  ok       ${label}   ${out}`);
}

console.log(`\n${pkg.name}@${next} is staged and every version string agrees.`);
console.log("\nnext:  npm publish");
console.log("then:  npm run verify        (asks the registry and live production)");
