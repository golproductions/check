// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
// Run the one-liner installer, then USE everything it wired.
//
//   node test/install-e2e.mjs
//
// This is the test that was missing, and its absence is why the --mcp flag
// shipped dead. Every other test asks a component directly. This one asks the
// question a user asks: I ran the install command, does the thing work now.
//
// `--install` writes more than a hook. It writes:
//
//   ~/.check/check.mjs                the gate
//   ~/.check/key                      the fallback key for tools that do not
//                                     pass env to hooks
//   ~/.claude/settings.json           PreToolUse hook + env
//   ~/.gemini/settings.json           BeforeTool hook
//   ~/.cursor/hooks.json              beforeShellExecution
//   mcpServers.Check in five configs  npx @golproductions/check --mcp
//   CLAUDE.md or AGENTS.md            the anti-fabrication rule
//
// READING those entries proves nothing. The MCP entry read perfectly and was
// dead on arrival, because reading `npx @golproductions/check --mcp` cannot
// tell you that the process exits before it can answer. So this file RUNS
// what the installer wrote, the way the editor that reads it would.
//
// It never touches your real home directory: HOME and USERPROFILE are pointed
// at a temp sandbox for the duration.

import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

// Simulate a machine that HAS these editors. The installer only wires a hook
// target whose directory already exists, which is right: it should not invent
// a Claude Code config on a machine without Claude Code. An empty sandbox
// therefore gets no hook, and a test that expected one was measuring its own
// setup rather than the product. (MCP targets differ: they create their own
// directories, so a bare sandbox still gets ~/.aws/amazonq and ~/.codeium.)
for (const d of [".claude", ".gemini", ".cursor"]) mkdirSync(join(HOME, d), { recursive: true });
console.log("sandbox home: " + HOME + "  (with .claude, .gemini, .cursor present)\n");

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
ok("did NOT wire a PostToolUse hook", !claude?.hooks?.PostToolUse,
   "truth-gate was cut; PostToolUse carries no exit status and never fires on failure");

// ── 3. USE the gate, exactly as Claude Code invokes it ───────────────────────
// This is the part that matters. The config above could be perfect and the
// hook still dead.
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

// ── 4. USE the MCP entry, exactly as the editor that reads it would ──────────
// The installer writes { command: "npx", args: ["@golproductions/check", "--mcp"] }.
// npx would fetch the PUBLISHED package, so the local equivalent is run here:
// same flag, same entry point, which is precisely what was broken.
const mcpEntry = claude?.mcpServers?.Check
  || readJson(join(HOME, ".codeium", "windsurf", "mcp_config.json"))?.mcpServers?.Check
  || readJson(join(HOME, ".continue", "config.json"))?.mcpServers?.Check;
ok("wrote an MCP server entry", !!mcpEntry, JSON.stringify(Object.keys(claude || {})));
if (mcpEntry) {
  ok("the MCP entry invokes --mcp", (mcpEntry.args || []).includes("--mcp"), JSON.stringify(mcpEntry));
}

const mcp = await new Promise((resolve) => {
  const child = spawn(process.execPath, [ENTRY, "--mcp"], { stdio: ["pipe", "pipe", "pipe"], env });
  let out = "", err = "";
  let settled = false;
  const done = (v) => { if (settled) return; settled = true; clearTimeout(t); try { child.kill(); } catch {} resolve(v); };
  const t = setTimeout(() => done({ out, err, why: "timed out" }), 25000);
  child.stdout.on("data", (d) => { out += d; if (/"tools"\s*:\s*\[/.test(out)) done({ out, err }); });
  child.stderr.on("data", (d) => { err += d; });
  child.on("close", (c) => done({ out, err, why: "exited " + c }));
  const send = (o) => { try { child.stdin.write(JSON.stringify(o) + "\n"); } catch {} };
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "install-e2e", version: "1" } } });
  setTimeout(() => {
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  }, 900);
});
ok("the wired MCP server answers initialize", /"serverInfo"/.test(mcp.out),
   mcp.why + (mcp.err ? "; " + mcp.err.trim().slice(0, 140) : ""));
ok("and stays alive to serve tools/list", /"tools"\s*:\s*\[/.test(mcp.out),
   "a server that answers initialize then dies is what shipped for weeks");

// ── 5. the rule file ─────────────────────────────────────────────────────────
const rule = ["CLAUDE.md", "AGENTS.md"].map(f => join(HOME, f)).find(existsSync);
ok("wrote the anti-fabrication rule", !!rule, "expected CLAUDE.md or AGENTS.md in cwd");
if (rule) {
  ok("the rule says what it should", /Never fabricate/i.test(readFileSync(rule, "utf8")));
}

// ── clean up ─────────────────────────────────────────────────────────────────
try { rmSync(HOME, { recursive: true, force: true }); } catch {}

console.log("");
if (fail === 0) console.log("Everything the one-liner wires up actually works.");
else { console.log(fail + " CHECK(S) FAILED."); process.exit(1); }
