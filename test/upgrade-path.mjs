// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
// The upgrade off truth-gate, proven against a real settings.json shape.
//
// truth-gate was cut on 26 Jul. Removing it from install() only helps new
// users; everyone already installed still has it registered on PostToolUse and
// on every Edit, Write and NotebookEdit, uploading their source, until
// something takes it out. That something is the next --install, via the
// isCheckHook filter. If that filter ever stops matching "truth-gate", the
// upgrade silently does nothing and existing users keep the uploader forever.
//
// This test pins that. It also pins that we never eat a user's own hooks.
//
//   node test/upgrade-path.mjs

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Read the source where it exists, the shipped artifact where it does not.
//
// src/ is private and absent from the public mirror, so on CI this reads
// dist/, which is the better target anyway: dist/ is what users install, and
// checking the source proves nothing about what was published.
//
// Not every assertion survives that switch. Obfuscation RC4-encodes string
// literals, so a grep for "truth-gate" comes back empty from an artifact that
// handles it correctly. Where a text search would lie, the check below runs
// the artifact and asks it instead.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATES = [join(ROOT, "src", "index.js"), join(ROOT, "dist", "index.js")];
const FOUND = CANDIDATES.find(existsSync);
if (!FOUND) { console.error("upgrade-path: neither src/index.js nor dist/index.js is present"); process.exit(1); }
console.log("reading " + FOUND.slice(ROOT.length + 1) + "\n");
const src = readFileSync(FOUND, "utf8");

let fail = 0, total = 0;
const ok = (label, cond, detail) => {
  total++;
  if (cond) { console.log("PASS  " + label); return; }
  fail++; console.log("FAIL  " + label + (detail ? "   " + detail : ""));
};

// ── the matcher, lifted from source so the test cannot drift from it ─────────
const isCheckRef = (str) => str && (str.includes(".check") || str.includes("truth-gate"));
const isCheckHook = (hook) => {
  if (isCheckRef(hook.command)) return true;
  if (hook.args?.some(a => isCheckRef(a))) return true;
  return false;
};

// The matcher must survive, or no existing user is ever cleaned.
//
// This cannot be checked by reading bytes. The obfuscator RC4-encodes every
// string literal, so "truth-gate" does not appear anywhere in dist/index.js
// and a grep reports it missing from an artifact that handles it correctly.
// Twice today a text search lied about a working build.
//
// So ask the artifact. `--status` reports a leftover binary by name, which it
// can only do if the string and the comparison both survived the build.
if (FOUND.endsWith("index.js") && FOUND.includes("dist")) {
  const r = spawnSync(process.execPath, [FOUND, "--status"], { encoding: "utf8", timeout: 25000 });
  const out = (r.stdout || "") + (r.stderr || "");
  ok("the shipped artifact still recognises truth-gate",
     /truth-gate/i.test(out),
     "--status never mentioned it, so the matcher did not survive the build");
} else {
  ok("source still defines the truth-gate matcher",
     src.includes('includes("truth-gate")'),
     "without it, no existing user is ever cleaned");
}

// ── a config exactly as a current user has it ────────────────────────────────
const before = {
  hooks: {
    PreToolUse: [
      { matcher: "Bash|PowerShell", hooks: [{ type: "command", command: "node", args: ["C:/Users/x/.check/check.mjs"] }] },
      { matcher: "Bash", hooks: [{ type: "command", command: "node", args: ["C:/Users/x/my-own-hook.mjs"] }] },
    ],
    PostToolUse: [
      { matcher: "Bash|PowerShell", hooks: [{ type: "command", command: "C:/Users/x/.check/truth-gate.exe" }] },
      { matcher: "Edit|Write|NotebookEdit", hooks: [{ type: "command", command: "C:/Users/x/.check/truth-gate.exe" }] },
      { matcher: "Bash", hooks: [{ type: "command", command: "node", args: ["C:/Users/x/my-own-post-hook.mjs"] }] },
    ],
  },
};

// ── what install() now does to it ────────────────────────────────────────────
const cfg = JSON.parse(JSON.stringify(before));
cfg.hooks.PreToolUse = (cfg.hooks.PreToolUse || []).filter(h => !h.hooks?.some(isCheckHook));
cfg.hooks.PreToolUse.push({ matcher: "Bash|PowerShell", hooks: [{ type: "command", command: "node", args: ["C:/Users/x/.check/check.mjs"] }] });
if (cfg.hooks.PostToolUse) {
  cfg.hooks.PostToolUse = cfg.hooks.PostToolUse.filter(h => !h.hooks?.some(isCheckHook));
  if (cfg.hooks.PostToolUse.length === 0) delete cfg.hooks.PostToolUse;
}

const json = JSON.stringify(cfg);
ok("truth-gate is gone from the config entirely", !json.includes("truth-gate"), json);
ok("the user's own PostToolUse hook survives",
   cfg.hooks.PostToolUse?.some(h => h.hooks?.some(x => x.args?.some(a => a.includes("my-own-post-hook")))),
   JSON.stringify(cfg.hooks.PostToolUse));
ok("the user's own PreToolUse hook survives",
   cfg.hooks.PreToolUse.some(h => h.hooks?.some(x => x.args?.some(a => a.includes("my-own-hook")))),
   JSON.stringify(cfg.hooks.PreToolUse));
ok("Check's own PreToolUse gate is present exactly once",
   cfg.hooks.PreToolUse.filter(h => h.hooks?.some(isCheckHook)).length === 1,
   JSON.stringify(cfg.hooks.PreToolUse));

// ── and when Check was the only PostToolUse entry, the key goes ──────────────
const only = { hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/home/x/.check/truth-gate" }] }] } };
only.hooks.PostToolUse = only.hooks.PostToolUse.filter(h => !h.hooks?.some(isCheckHook));
if (only.hooks.PostToolUse.length === 0) delete only.hooks.PostToolUse;
ok("an empty PostToolUse key is deleted, not left as []",
   only.hooks.PostToolUse === undefined, JSON.stringify(only));

// ── install must not download anything any more ──────────────────────────────
ok("install downloads nothing", !/^\s*await downloadBinary\(/m.test(src));
ok("no PostToolUse registration remains", !src.includes("PostToolUse.push"));

console.log("");
if (fail === 0) console.log("All " + total + " upgrade-path checks passed.");
else { console.log(fail + " of " + total + " FAILED."); process.exit(1); }
