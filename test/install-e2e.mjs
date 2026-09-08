// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
// Run the one-liner installer, then USE everything it wired.
//
//   node test/install-e2e.mjs
//
// This is the test that was missing, and its absence is why the --mcp flag
// shipped dead. Every other test asks a component directly. This one asks the
// question a user asks: I ran the install command, does the thing work now.
//
// `--install` writes:
//
//   ~/.check/check.mjs                the gate
//   ~/.check/key                      the fallback key for tools that do not
//                                     pass env to hooks
//   ~/.check/preflight.mjs            fetched from the server on a validated
//                                     install; injects the standing rule and
//                                     a live environment scan on every prompt
//   ~/.claude/settings.json           PreToolUse + UserPromptSubmit hooks
//
// It does NOT write a CLAUDE.md or AGENTS.md file. The standing rule used to
// be duplicated into a project file (a second delivery path alongside the
// live MCP injection); when MCP was cut for the Claude-Code-only pivot, the
// live channel went with it and only the disk copy remained - the opposite
// of the intent. The rule is now delivered exactly once, live, by the
// preflight hook, and never touches a file this test - or a `git status` -
// would ever see.
//
// It never touches your real home directory: HOME and USERPROFILE are pointed
// at a temp sandbox for the duration.

import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "dist", "index.js");
const KEY = process.env.GOL_CLIENT_ID || "";

let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { console.log("PASS  " + label); return; }
  fail++; console.log("FAIL  " + label + (detail ? "\n        " + String(detail).slice(0, 220) : ""));
};

if (!existsSync(ENTRY)) { console.error("dist/index.js not built"); process.exit(1); }
if (!KEY) { console.error("set GOL_CLIENT_ID; the installer validates the key against production"); process.exit(1); }

// ── a sandbox home, so the real one is never touched ─────────────────────────
const HOME = mkdtempSync(join(tmpdir(), "check-install-"));
const env = { ...process.env, HOME, USERPROFILE: HOME, GOL_CLIENT_ID: KEY };

// Simulate a machine that has Claude Code. The installer only wires a hook
// target whose directory already exists.
mkdirSync(join(HOME, ".claude"), { recursive: true });
console.log("sandbox home: " + HOME + "  (with .claude present)\n");

// ── 1. run the one-liner ─────────────────────────────────────────────────────
const install = spawnSync(process.execPath, [ENTRY, "--install", KEY], {
  env, cwd: HOME, encoding: "utf8", timeout: 120000,
});
const installOut = (install.stdout || "") + (install.stderr || "");
ok("the installer exits 0", install.status === 0, "exit " + install.status + "\n" + installOut.slice(0, 300));

// ── 2. what did it actually write? ───────────────────────────────────────────
const hook = join(HOME, ".check", "check.mjs");
ok("wrote the gate to ~/.check/check.mjs", existsSync(hook));
ok("wrote the fallback key", existsSync(join(HOME, ".check", "key")));

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const claude = readJson(join(HOME, ".claude", "settings.json"));
ok("wired Claude Code PreToolUse", !!claude?.hooks?.PreToolUse?.length, JSON.stringify(claude?.hooks || {}).slice(0, 160));
ok("wired Claude Code UserPromptSubmit (preflight)", !!claude?.hooks?.UserPromptSubmit?.length);
ok("did NOT wire a PostToolUse hook", !claude?.hooks?.PostToolUse,
   "truth-gate was cut; PostToolUse carries no exit status and never fires on failure");
ok("no mcpServers.Check entry (MCP was cut for the Claude-Code-only pivot)",
   !claude?.mcpServers?.Check, JSON.stringify(claude?.mcpServers || {}));

// ── 3. USE the gate, exactly as Claude Code invokes it ───────────────────────
function runHook(command) {
  const ev = JSON.stringify({
    hook_event_name: "PreToolUse", tool_name: "Bash",
    tool_input: { command }, cwd: HOME,
  });
  const r = spawnSync(process.execPath, [hook], { input: ev, env, encoding: "utf8", timeout: 60000 });
  let d = null;
  try { d = JSON.parse((r.stdout || "").trim()); } catch {}
  return { decision: d?.hookSpecificOutput?.permissionDecision, reason: d?.hookSpecificOutput?.permissionDecisionReason, code: r.status, raw: r.stdout, err: r.stderr };
}

const good = runHook("git status");
ok("the installed gate allows a real command", good.decision === "allow", JSON.stringify(good).slice(0, 200));
ok("and exits 0, or the verdict is discarded", good.code === 0, "exit " + good.code + " " + (good.err || "").slice(0, 120));

const bad = runHook("frobnicate --all");
ok("the installed gate denies a fabricated binary", bad.decision === "deny", JSON.stringify(bad).slice(0, 200));
ok("with the shell's own words", /not found/i.test(bad.reason || ""), bad.reason);

// ── 4. USE the preflight hook, exactly as Claude Code invokes it ────────────
// This is the actual delivery path for the standing rule: fetched from the
// server at install (validated key required), run fresh on every prompt, and
// never written into the project. Prove it by running it, not by reading it.
const preflight = join(HOME, ".check", "preflight.mjs");
ok("fetched the preflight hook at install", existsSync(preflight));
if (existsSync(preflight)) {
  const ev = JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "does this work", cwd: HOME });
  const r = spawnSync(process.execPath, [preflight], { input: ev, env, encoding: "utf8", timeout: 30000 });
  let d = null;
  try { d = JSON.parse((r.stdout || "").trim()); } catch {}
  const ctx = d?.additionalContext || "";
  ok("preflight exits 0", r.status === 0, "exit " + r.status + "; " + (r.stderr || "").slice(0, 160));
  ok("preflight injects the standing rule live", ctx.includes("HOW TO ANSWER HERE") && ctx.includes("Never fabricate"),
     "additionalContext length " + ctx.length + ": " + ctx.slice(0, 160));
  ok("preflight also injects the environment scan", ctx.includes("PREFLIGHT ENVIRONMENT SCAN"));
}

// ── 5. the rule is NOT written to a project file ─────────────────────────────
const rule = ["CLAUDE.md", "AGENTS.md"].map(f => join(HOME, f)).find(existsSync);
ok("did NOT write CLAUDE.md or AGENTS.md", !rule, rule ? rule + " exists" : "");

// ── 6. the FREE path, which is the one the website leads with ────────────────
// Everything above passes a key. The site's headline install has no key in it:
//
//     npx @golproductions/check --install
//
// which mints a free client ID first and then validates it, so it makes two
// fetches where the keyed path makes one. That difference crashed it. On
// Node 24 / Windows, force-exiting after more than one fetch aborts:
//
//     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c
//
// The install completed, printed every success line, and exited non-zero. Any
// CI step or `&&` chain saw a failed install. It survived because every test
// here supplied a key, so the free path, the one most users take, was the only
// one never measured.
const FREE = mkdtempSync(join(tmpdir(), "check-install-free-"));
mkdirSync(join(FREE, ".claude"), { recursive: true });
const freeEnv = { ...process.env, HOME: FREE, USERPROFILE: FREE };
delete freeEnv.GOL_CLIENT_ID;

const free = spawnSync(process.execPath, [ENTRY, "--install"], {
  env: freeEnv, cwd: FREE, encoding: "utf8", timeout: 120000,
});
const freeErr = free.stderr || "";
ok("keyless --install exits 0", free.status === 0,
   "exit " + free.status + "; stderr: " + freeErr.trim().slice(0, 180));
ok("keyless --install does not abort the runtime", !/Assertion failed/i.test(freeErr), freeErr.trim().slice(0, 180));
ok("keyless --install mints a free key", existsSync(join(FREE, ".check", "key")),
   "no ~/.check/key written");
// A CLI invocation must not fall through into the hook path. It did, the moment
// the process.exit() calls came out: every command printed its real output and
// then "check: no hook input on stdin" underneath it.
ok("no CLI command falls through to the hook", !/no hook input on stdin/i.test(freeErr), freeErr.trim().slice(0, 180));

for (const flag of ["--status", "--credits", "--help", "--docs"]) {
  const r = spawnSync(process.execPath, [ENTRY, flag], { env, cwd: HOME, encoding: "utf8", timeout: 60000, input: "" });
  ok(flag + " exits 0 and stays out of the hook path",
     r.status === 0 && !/no hook input on stdin|Assertion failed/i.test(r.stderr || ""),
     "exit " + r.status + "; stderr: " + (r.stderr || "").trim().slice(0, 140));
}

// ── clean up ─────────────────────────────────────────────────────────────────
try { rmSync(FREE, { recursive: true, force: true }); } catch {}
try { rmSync(HOME, { recursive: true, force: true }); } catch {}

console.log("");
if (fail === 0) console.log("Everything the one-liner wires up actually works.");
else { console.log(fail + " CHECK(S) FAILED."); process.exit(1); }
