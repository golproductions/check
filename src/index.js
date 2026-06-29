#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream, chmodSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, arch } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const VERSION = "3.1.0";
const BINARY_VERSION = "3.0.0";
const API = "https://triage.golproductions.com/preflight";
const CDN = "https://pub-e55366a7f5994be9be04f0e205179f4a.r2.dev/releases";
const CLIENT_ID = process.env.GOL_CLIENT_ID || "";

function getClientId() {
  if (CLIENT_ID) return CLIENT_ID;
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".claude", "settings.json"), "utf8"));
    return cfg.env?.GOL_CLIENT_ID || "";
  } catch { return ""; }
}

async function validateKey(key) {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GOL-CLIENT-ID": key, "User-Agent": "c/" + VERSION },
      body: JSON.stringify({ command: "echo check-install-verify", cwd: process.cwd(), v: VERSION }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { valid: true, expired: false };
    let body = {};
    try { body = await res.json(); } catch {}
    const expired = /expir/i.test(body.reason || body.error || body.message || "");
    return { valid: false, expired };
  } catch {
    return { valid: false, expired: false };
  }
}

async function downloadBinary(dest) {
  const os = platform() === "win32" ? "win" : platform() === "darwin" ? "macos" : "linux";
  const cpu = arch() === "arm64" ? "arm64" : "x64";
  const ext = os === "win" ? ".exe" : "";
  const url = `${CDN}/truth-gate-v${BINARY_VERSION}-${os}-${cpu}${ext}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  if (os !== "win") try { chmodSync(dest, 0o755); } catch {}
}

async function install() {
  const key = process.argv[3] || process.env.GOL_CLIENT_ID || "";

  if (!key || key === "your_key") {
    console.log("\n  Check requires a valid Client ID to install.\n");
    console.log("  Get your key (free): https://golproductions.com/check\n");
    console.log("  Then run:");
    console.log("  npx @golproductions/check --install YOUR_KEY\n");
    process.exit(1);
  }

  const result = await validateKey(key);
  if (!result.valid) {
    if (result.expired) {
      console.log("\n  Your Client ID has expired: " + key);
      console.log("\n  Renew your key at: https://golproductions.com/check\n");
    } else {
      console.log("\n  Invalid Client ID: " + key);
      console.log("\n  Get a valid key at: https://golproductions.com/check\n");
    }
    process.exit(1);
  }

  console.log("\n  Key verified. Installing Check...\n");

  const home = homedir();
  let installed = 0;

  const scriptSrc = readFileSync(new URL(import.meta.url), "utf8");
  const hooksDir = join(home, ".check");
  mkdirSync(hooksDir, { recursive: true });
  const scriptPath = join(hooksDir, "check.mjs");
  writeFileSync(scriptPath, scriptSrc, "utf8");

  const ext = platform() === "win32" ? ".exe" : "";
  const binaryPath = join(hooksDir, "truth-gate" + ext);
  await downloadBinary(binaryPath);

  const mcpEntry = { command: "npx", args: ["@golproductions/check", "--mcp"], env: { GOL_CLIENT_ID: key } };

  const targets = [
    {
      name: "Claude Code",
      dir: join(home, ".claude"),
      file: "settings.json",
      config: (existing) => {
        existing.hooks = existing.hooks || {};
        existing.hooks.PreToolUse = [{
          matcher: "Bash|PowerShell",
          hooks: [{ type: "command", command: "node", args: [scriptPath] }]
        }];
        existing.hooks.PostToolUse = [
          { matcher: "Bash|PowerShell", hooks: [{ type: "command", command: binaryPath }] },
          { matcher: "Edit|Write|NotebookEdit", hooks: [{ type: "command", command: binaryPath }] }
        ];
        existing.env = existing.env || {};
        existing.env.GOL_CLIENT_ID = key;
        return existing;
      }
    },
    {
      name: "Gemini CLI / Antigravity",
      dir: join(home, ".gemini"),
      file: "settings.json",
      config: (existing) => {
        existing.hooks = existing.hooks || {};
        existing.hooks.BeforeTool = existing.hooks.BeforeTool || [];
        const hooks = existing.hooks.BeforeTool;
        if (!hooks.find(h => h.hooks?.some(hh => hh.name === "check-gate"))) {
          hooks.push({
            matcher: ".*",
            hooks: [{ type: "command", command: "node " + scriptPath, name: "check-gate" }]
          });
        }
        return existing;
      }
    },
    {
      name: "Cursor",
      dir: join(home, ".cursor"),
      file: "hooks.json",
      config: (existing) => {
        existing.version = existing.version || 1;
        existing.hooks = existing.hooks || {};
        existing.hooks.beforeShellExecution = [{
          command: "node " + scriptPath
        }];
        return existing;
      }
    },
    {
      name: "Homebase",
      dir: join(home, ".homebase"),
      file: "hooks.json",
      config: (existing) => {
        existing.hooks = existing.hooks || {};
        existing.hooks.PreToolUse = [{
          matcher: "Bash|PowerShell",
          hooks: [{ type: "command", command: "node", args: [scriptPath] }]
        }];
        existing.hooks.PostToolUse = [
          { matcher: "Bash|PowerShell", hooks: [{ type: "command", command: binaryPath }] }
        ];
        existing.env = existing.env || {};
        existing.env.GOL_CLIENT_ID = key;
        return existing;
      }
    },
    {
      name: "Windsurf (MCP)",
      dir: join(home, ".codeium", "windsurf"),
      file: "mcp_config.json",
      config: (existing) => {
        existing.mcpServers = existing.mcpServers || {};
        existing.mcpServers.Check = mcpEntry;
        return existing;
      }
    },
    {
      name: "Continue (MCP)",
      dir: join(process.cwd(), ".continue", "mcpServers"),
      file: "check.json",
      config: () => {
        return { mcpServers: { Check: mcpEntry } };
      }
    },
    {
      name: "Amazon Q Developer (MCP)",
      dir: join(home, ".aws", "amazonq"),
      file: "mcp.json",
      config: (existing) => {
        existing.mcpServers = existing.mcpServers || {};
        existing.mcpServers.Check = { type: "stdio", ...mcpEntry };
        return existing;
      }
    },
    {
      name: "Roo Code (project MCP)",
      dir: join(process.cwd(), ".roo"),
      file: "mcp.json",
      config: (existing) => {
        existing.mcpServers = existing.mcpServers || {};
        existing.mcpServers.Check = mcpEntry;
        return existing;
      }
    },
    {
      name: "Project MCP (shared)",
      dir: process.cwd(),
      file: ".mcp.json",
      config: (existing) => {
        existing.mcpServers = existing.mcpServers || {};
        existing.mcpServers.Check = mcpEntry;
        return existing;
      }
    }
  ];

  const mcpTargets = ["Windsurf (MCP)", "Continue (MCP)", "Amazon Q Developer (MCP)", "Roo Code (project MCP)", "Project MCP (shared)"];

  let hasClaude = false;
  for (const t of targets) {
    const isMcp = mcpTargets.includes(t.name);
    if (!isMcp && !existsSync(t.dir)) continue;
    if (isMcp) mkdirSync(t.dir, { recursive: true });
    const filepath = join(t.dir, t.file);
    let existing = {};
    try { existing = JSON.parse(readFileSync(filepath, "utf8")); } catch {}
    const updated = t.config(existing);
    writeFileSync(filepath, JSON.stringify(updated, null, 2) + "\n", "utf8");
    installed++;
    if (t.name === "Claude Code") hasClaude = true;
  }

  if (installed === 0) {
    mkdirSync(join(home, ".claude"), { recursive: true });
    const filepath = join(home, ".claude", "settings.json");
    let existing = {};
    try { existing = JSON.parse(readFileSync(filepath, "utf8")); } catch {}
    const updated = targets[0].config(existing);
    writeFileSync(filepath, JSON.stringify(updated, null, 2) + "\n", "utf8");
    hasClaude = true;
  }

  const checkRule = "Never fabricate, hallucinate, or invent values. If you don't have it, say you don't have it. No fake keys, no fake IDs, no fake paths, no fake URLs. If unsure, ask. Never guess and present it as fact.";
  const ruleFile = hasClaude ? "CLAUDE.md" : "AGENTS.md";
  const rulePath = join(process.cwd(), ruleFile);
  try {
    const existing = existsSync(rulePath) ? readFileSync(rulePath, "utf8") : "";
    if (!existing.includes("Never fabricate")) {
      const prefix = existing.length > 0 ? existing.trimEnd() + "\n\n" : "";
      writeFileSync(rulePath, prefix + checkRule + "\n", "utf8");
    }
  } catch {}

  console.log(`\nSafe travels wanderer..\n`);
  process.exit(0);
}

function isCheckRef(str) {
  return str && (str.includes(".check") || str.includes("truth-gate"));
}

function isCheckHook(hook) {
  if (isCheckRef(hook.command)) return true;
  if (hook.args?.some(a => isCheckRef(a))) return true;
  return false;
}

async function uninstall() {
  const home = homedir();
  let removed = 0;

  console.log("\n  Removing Check...\n");

  const hookTargets = [
    {
      name: "Claude Code",
      path: join(home, ".claude", "settings.json"),
      clean: (cfg) => {
        if (cfg.hooks?.PreToolUse) {
          cfg.hooks.PreToolUse = cfg.hooks.PreToolUse.filter(h => !h.hooks?.some(isCheckHook));
          if (cfg.hooks.PreToolUse.length === 0) delete cfg.hooks.PreToolUse;
        }
        if (cfg.hooks?.PostToolUse) {
          cfg.hooks.PostToolUse = cfg.hooks.PostToolUse.filter(h => !h.hooks?.some(isCheckHook));
          if (cfg.hooks.PostToolUse.length === 0) delete cfg.hooks.PostToolUse;
        }
        if (cfg.hooks && Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
        if (cfg.env) {
          delete cfg.env.GOL_CLIENT_ID;
          if (Object.keys(cfg.env).length === 0) delete cfg.env;
        }
        return cfg;
      }
    },
    {
      name: "Gemini CLI",
      path: join(home, ".gemini", "settings.json"),
      clean: (cfg) => {
        if (cfg.hooks?.BeforeTool) {
          cfg.hooks.BeforeTool = cfg.hooks.BeforeTool.filter(h => !h.hooks?.some(hh => hh.name === "check-gate"));
          if (cfg.hooks.BeforeTool.length === 0) delete cfg.hooks.BeforeTool;
          if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
        }
        return cfg;
      }
    },
    {
      name: "Cursor",
      path: join(home, ".cursor", "hooks.json"),
      clean: (cfg) => {
        if (cfg.hooks?.beforeShellExecution) {
          cfg.hooks.beforeShellExecution = cfg.hooks.beforeShellExecution.filter(h => !isCheckRef(h.command));
          if (cfg.hooks.beforeShellExecution.length === 0) delete cfg.hooks.beforeShellExecution;
          if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
        }
        return cfg;
      }
    },
    {
      name: "Homebase",
      path: join(home, ".homebase", "hooks.json"),
      clean: (cfg) => {
        if (cfg.hooks?.PreToolUse) {
          cfg.hooks.PreToolUse = cfg.hooks.PreToolUse.filter(h => !h.hooks?.some(isCheckHook));
          if (cfg.hooks.PreToolUse.length === 0) delete cfg.hooks.PreToolUse;
        }
        if (cfg.hooks?.PostToolUse) {
          cfg.hooks.PostToolUse = cfg.hooks.PostToolUse.filter(h => !h.hooks?.some(isCheckHook));
          if (cfg.hooks.PostToolUse.length === 0) delete cfg.hooks.PostToolUse;
        }
        if (cfg.hooks && Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
        if (cfg.env) {
          delete cfg.env.GOL_CLIENT_ID;
          if (Object.keys(cfg.env).length === 0) delete cfg.env;
        }
        return cfg;
      }
    }
  ];

  const mcpUserTargets = [
    { name: "Windsurf", path: join(home, ".codeium", "windsurf", "mcp_config.json") },
    { name: "Amazon Q", path: join(home, ".aws", "amazonq", "mcp.json") },
  ];

  const mcpProjectTargets = [
    { name: "Continue", path: join(process.cwd(), ".continue", "mcpServers", "check.json"), deleteFile: true },
    { name: "Roo Code", path: join(process.cwd(), ".roo", "mcp.json") },
    { name: "Project MCP", path: join(process.cwd(), ".mcp.json") },
  ];

  for (const t of hookTargets) {
    if (!existsSync(t.path)) continue;
    try {
      const cfg = JSON.parse(readFileSync(t.path, "utf8"));
      const cleaned = t.clean(cfg);
      writeFileSync(t.path, JSON.stringify(cleaned, null, 2) + "\n", "utf8");
      console.log("    removed  " + t.name);
      removed++;
    } catch {}
  }

  for (const t of [...mcpUserTargets, ...mcpProjectTargets]) {
    if (!existsSync(t.path)) continue;
    try {
      if (t.deleteFile) {
        unlinkSync(t.path);
        console.log("    removed  " + t.name);
        removed++;
      } else {
        const cfg = JSON.parse(readFileSync(t.path, "utf8"));
        if (cfg.mcpServers?.Check) {
          delete cfg.mcpServers.Check;
          if (Object.keys(cfg.mcpServers).length === 0) delete cfg.mcpServers;
          writeFileSync(t.path, JSON.stringify(cfg, null, 2) + "\n", "utf8");
          console.log("    removed  " + t.name);
          removed++;
        }
      }
    } catch {}
  }

  const checkDir = join(home, ".check");
  if (existsSync(checkDir)) {
    try {
      rmSync(checkDir, { recursive: true, force: true });
      console.log("    removed  ~/.check/");
    } catch {}
  }

  if (removed === 0) {
    console.log("  No Check installations found.\n");
  } else {
    console.log(`\n  Removed from ${removed} tool${removed !== 1 ? "s" : ""}.`);
    console.log("  CLAUDE.md / AGENTS.md rules were left in place.\n");
  }

  process.exit(0);
}

async function status() {
  const home = homedir();
  const checkDir = join(home, ".check");
  const ext = platform() === "win32" ? ".exe" : "";
  const id = getClientId();

  console.log(`\n  Check v${VERSION}\n`);

  if (id) {
    const masked = id.length > 12 ? id.slice(0, 8) + "..." + id.slice(-4) : id;
    console.log("  Client ID:  " + masked);
  } else {
    console.log("  Client ID:  not set");
  }

  const binaryPath = join(checkDir, "truth-gate" + ext);
  console.log("  Binary:     " + (existsSync(binaryPath) ? "installed" : "not found"));
  const scriptPath = join(checkDir, "check.mjs");
  console.log("  Script:     " + (existsSync(scriptPath) ? "installed" : "not found"));

  console.log("\n  Integrations:\n");

  const checks = [
    {
      name: "Claude Code",
      path: join(home, ".claude", "settings.json"),
      test: (cfg) => cfg.hooks?.PreToolUse?.some(h => h.hooks?.some(isCheckHook)) || cfg.hooks?.PostToolUse?.some(h => h.hooks?.some(isCheckHook)),
      detail: (cfg) => {
        const parts = [];
        if (cfg.hooks?.PreToolUse?.some(h => h.hooks?.some(isCheckHook))) parts.push("PreToolUse");
        if (cfg.hooks?.PostToolUse?.some(h => h.hooks?.some(isCheckHook))) parts.push("PostToolUse");
        return parts.join(", ");
      }
    },
    {
      name: "Gemini CLI",
      path: join(home, ".gemini", "settings.json"),
      test: (cfg) => cfg.hooks?.BeforeTool?.some(h => h.hooks?.some(hh => hh.name === "check-gate")),
      detail: () => "BeforeTool"
    },
    {
      name: "Cursor",
      path: join(home, ".cursor", "hooks.json"),
      test: (cfg) => cfg.hooks?.beforeShellExecution?.some(h => isCheckRef(h.command)),
      detail: () => "beforeShellExecution"
    },
    {
      name: "Homebase",
      path: join(home, ".homebase", "hooks.json"),
      test: (cfg) => cfg.hooks?.PreToolUse?.some(h => h.hooks?.some(isCheckHook)) || cfg.hooks?.PostToolUse?.some(h => h.hooks?.some(isCheckHook)),
      detail: (cfg) => {
        const parts = [];
        if (cfg.hooks?.PreToolUse?.some(h => h.hooks?.some(isCheckHook))) parts.push("PreToolUse");
        if (cfg.hooks?.PostToolUse?.some(h => h.hooks?.some(isCheckHook))) parts.push("PostToolUse");
        return parts.join(", ");
      }
    },
    { name: "Windsurf", path: join(home, ".codeium", "windsurf", "mcp_config.json"), test: (cfg) => !!cfg.mcpServers?.Check, detail: () => "MCP" },
    { name: "Continue", path: join(process.cwd(), ".continue", "mcpServers", "check.json"), test: (cfg) => !!cfg.mcpServers?.Check, detail: () => "MCP (project)" },
    { name: "Amazon Q", path: join(home, ".aws", "amazonq", "mcp.json"), test: (cfg) => !!cfg.mcpServers?.Check, detail: () => "MCP" },
    { name: "Roo Code", path: join(process.cwd(), ".roo", "mcp.json"), test: (cfg) => !!cfg.mcpServers?.Check, detail: () => "MCP (project)" },
    { name: "Project MCP", path: join(process.cwd(), ".mcp.json"), test: (cfg) => !!cfg.mcpServers?.Check, detail: () => "MCP (project)" },
  ];

  for (const c of checks) {
    if (!existsSync(c.path)) {
      console.log("    -  " + c.name.padEnd(14) + " not detected");
      continue;
    }
    try {
      const cfg = JSON.parse(readFileSync(c.path, "utf8"));
      if (c.test(cfg)) {
        console.log("    +  " + c.name.padEnd(14) + " active (" + c.detail(cfg) + ")");
      } else {
        console.log("    -  " + c.name.padEnd(14) + " tool installed, Check not configured");
      }
    } catch {
      console.log("    ?  " + c.name.padEnd(14) + " config unreadable");
    }
  }

  console.log("");
  process.exit(0);
}

async function credits() {
  const id = getClientId();
  if (!id) {
    console.log("\n  No Client ID found. Set GOL_CLIENT_ID or run --install first.\n");
    process.exit(1);
  }

  try {
    const res = await fetch(API.replace("/preflight", "/credits"), {
      method: "GET",
      headers: { "X-GOL-CLIENT-ID": id, "User-Agent": "c/" + VERSION },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.log("\n  Could not fetch credits (HTTP " + res.status + ").\n");
      process.exit(1);
    }
    const d = await res.json();
    console.log(`\n  Check v${VERSION} — Credits\n`);
    if (d.free_remaining !== undefined) console.log("  Free today:    " + d.free_remaining + " / " + (d.free_daily || 120));
    if (d.calls_today !== undefined) console.log("  Calls today:   " + d.calls_today);
    if (d.balance !== undefined) console.log("  Balance:       $" + d.balance + " AUD");
    if (d.total_calls !== undefined) console.log("  Total calls:   " + d.total_calls);
    if (d.plan) console.log("  Plan:          " + d.plan);
    if (Object.keys(d).length === 0) console.log("  " + JSON.stringify(d));
    console.log("");
  } catch (err) {
    console.log("\n  Could not reach API: " + err.message + "\n");
  }
  process.exit(0);
}

async function docs() {
  console.log(`
  Check v${VERSION} — Documentation

  Install:      npx @golproductions/check --install <key>
  Uninstall:    npx @golproductions/check --uninstall
  Status:       npx @golproductions/check --status
  Credits:      npx @golproductions/check --credits

  How it works:

    Check installs hooks into your AI coding tools. Every time
    the AI runs a command or edits a file, Check verifies it
    before or after execution.

    PreToolUse    Validates commands before they run.
    PostToolUse   Verifies results after execution.
    MCP Server    Provides Check and CheckAndExecute tools.
    CLAUDE.md     Adds anti-fabrication instructions.

  Supported tools:

    Claude Code, Gemini CLI, Cursor, Windsurf, Continue,
    Amazon Q Developer, Roo Code, Homebase

  Pricing:

    120 free checks per day. Then $0.0068 AUD per check.
    Credits never expire. Pay as you go.

  Links:

    Website:    https://golproductions.com/check
    Docs:       https://github.com/golproductions/check
    Support:    support@golproductions.com
`);

  try {
    const { execSync } = await import("node:child_process");
    const url = "https://github.com/golproductions/check";
    if (platform() === "win32") execSync(`start "" "${url}"`, { stdio: "ignore", shell: true });
    else if (platform() === "darwin") execSync(`open "${url}"`, { stdio: "ignore" });
    else execSync(`xdg-open "${url}"`, { stdio: "ignore" });
  } catch {}

  process.exit(0);
}

function help() {
  console.log(`
  Check v${VERSION} — Anti-hallucination layer for AI coding agents

  Usage:

    npx @golproductions/check --install <key>   Install Check with your Client ID
    npx @golproductions/check --uninstall        Remove Check from all tools
    npx @golproductions/check --status           Show what is installed and active
    npx @golproductions/check --credits          Check your usage and balance
    npx @golproductions/check --docs             View documentation
    npx @golproductions/check --help             Show this help

  Get your key:  https://golproductions.com/check
  Pricing:       120 free/day, then $0.0068 AUD per check
`);
  process.exit(0);
}

// CLI routing
const args = process.argv.slice(2);
if (args.includes("--install"))   { await install(); }
if (args.includes("--uninstall")) { await uninstall(); }
if (args.includes("--status"))    { await status(); }
if (args.includes("--credits"))   { await credits(); }
if (args.includes("--docs"))      { await docs(); }
if (args.includes("--help") || args.includes("-h")) { help(); }
if (args.includes("--mcp"))       { await import("./mcp.js"); process.exit(0); }

// No flags + interactive terminal = show help
if (!args.some(a => a.startsWith("-")) && process.stdin.isTTY) { help(); }

// Hook handler (invoked by tools via stdin)
function detect(p) {
  if (typeof p.command === "string" && !p.tool_input) return "cursor";
  if (p.hook_event_name === "BeforeTool" || p.toolCall?.argumentsJson) return "gemini";
  return "claude";
}

function cmd(p, f) {
  if (f === "cursor") return p.command;
  if (f === "gemini") {
    if (p.tool_input?.command) return p.tool_input.command;
    if (p.toolCall?.argumentsJson) {
      try {
        const a = typeof p.toolCall.argumentsJson === "string" ? JSON.parse(p.toolCall.argumentsJson) : p.toolCall.argumentsJson;
        return a.command || a.CommandLine || a.command_line;
      } catch { return null; }
    }
    return null;
  }
  return p.tool_input?.command;
}

function out(f, ok, reason) {
  if (ok) {
    const r = { cursor: { permission: "allow" }, gemini: { decision: "allow" }, claude: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } } };
    process.stdout.write(JSON.stringify(r[f] || r.claude));
    process.exit(0);
  }
  if (f === "gemini") {
    process.stdout.write(JSON.stringify({ decision: "deny", reason }));
    process.exit(2);
  }
  const r = { cursor: { permission: "deny", user_message: reason, agent_message: reason }, claude: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } } };
  process.stdout.write(JSON.stringify(r[f] || r.claude));
  process.exit(0);
}

async function main() {
  let f = "claude";
  try {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    input = input.replace(/^﻿/, "").trim();
    let p;
    try { p = JSON.parse(input); } catch { out("claude", true); return; }
    if (p.hook_event_name === "PostToolUse") { process.exit(0); return; }
    f = detect(p);
    const c = cmd(p, f);
    if (!c) { out(f, true); return; }
    if (!CLIENT_ID) { out(f, false, "check: GOL_CLIENT_ID not set. Get your key at https://golproductions.com/check"); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GOL-CLIENT-ID": CLIENT_ID, "User-Agent": "c/" + VERSION },
      body: JSON.stringify({ command: c, cwd: p.cwd || process.cwd(), platform: f, tool_name: p.tool_name, transcript_path: p.transcript_path, v: VERSION }),
      signal: controller.signal
    });
    clearTimeout(timer);
    const d = await res.json();
    if (d.verdict === "runnable") { out(f, true); }
    else { out(f, false, d.reason || "denied — address the issue before continuing"); }
  } catch { out(f, false, "check: verification failed, command blocked"); }
}

main();
