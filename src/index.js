#!/usr/bin/env node
// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream, chmodSync, unlinkSync, rmSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { join } from "node:path";
import { homedir, platform, arch } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const VERSION = "3.3.9";
const BINARY_VERSION = "3.0.0";
const API = "https://triage.golproductions.com/preflight";
const CDN = "https://pub-e55366a7f5994be9be04f0e205179f4a.r2.dev/releases";
const CLIENT_ID = process.env.GOL_CLIENT_ID || "";

function getClientId() {
  if (CLIENT_ID) return CLIENT_ID;
  // Universal fallback written at install time. Cursor and Gemini spawn hooks
  // with no GOL_CLIENT_ID in the environment, so the env var alone is not enough.
  try {
    const k = readFileSync(join(homedir(), ".check", "key"), "utf8").trim();
    if (k) return k;
  } catch {}
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

// Stable anonymous device fingerprint: one-way hash of coarse machine facts.
// No personal data. Server uses it only to rate-limit free-key minting.
async function deviceFingerprint() {
  const { createHash } = await import("node:crypto");
  const { hostname, userInfo } = await import("node:os");
  let user = "";
  try { user = userInfo().username || ""; } catch {}
  const seed = [hostname(), platform(), arch(), user].join("|");
  return createHash("sha256").update(seed).digest("hex");
}

// Mint a free key with no email and no browser. Returns the client_id or null.
async function mintInstantKey() {
  try {
    const fp = await deviceFingerprint();
    const res = await fetch(API.replace("/preflight", "/instant-key"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "c/" + VERSION },
      body: JSON.stringify({ fingerprint: fp, channel: "npm" }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d && d.client_id ? d.client_id : null;
  } catch {
    return null;
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
  let key = process.argv[3] || process.env.GOL_CLIENT_ID || "";

  // No key provided: mint one instantly. No email, no browser, no copy-paste.
  if (!key || key === "your_key") {
    console.log("\n  Activating Check (free, no signup)...\n");
    key = await mintInstantKey();
    if (!key) {
      console.log("  Could not activate automatically (offline, or this network hit its daily limit).\n");
      console.log("  Get a key the manual way: https://golproductions.com/check\n");
      console.log("  Then run:  npx @golproductions/check --install YOUR_KEY\n");
      process.exit(1);
    }
    console.log("  Activated. 120 free checks per day.\n");
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
  const scriptPath = join(hooksDir, "check.mjs").replace(/\\/g, "/");
  writeFileSync(scriptPath, scriptSrc, "utf8");
  // Key file is the fallback for tools that don't pass env to hooks (Cursor, Gemini).
  writeFileSync(join(hooksDir, "key"), key, "utf8");

  const ext = platform() === "win32" ? ".exe" : "";
  const binaryPath = join(hooksDir, "truth-gate" + ext).replace(/\\/g, "/");
  await downloadBinary(binaryPath);

  const mcpEntry = { command: "npx", args: ["@golproductions/check", "--mcp"], env: { GOL_CLIENT_ID: key } };

  const targets = [
    {
      name: "Claude Code",
      dir: join(home, ".claude"),
      file: "settings.json",
      config: (existing) => {
        // Merge, never clobber: drop stale Check entries, keep the user's own
        // hooks, then append ours.
        existing.hooks = existing.hooks || {};
        existing.hooks.PreToolUse = (existing.hooks.PreToolUse || []).filter(h => !h.hooks?.some(isCheckHook));
        existing.hooks.PreToolUse.push({
          matcher: "Bash|PowerShell",
          hooks: [{ type: "command", command: "node", args: [scriptPath] }]
        });
        existing.hooks.PostToolUse = (existing.hooks.PostToolUse || []).filter(h => !h.hooks?.some(isCheckHook));
        existing.hooks.PostToolUse.push(
          { matcher: "Bash|PowerShell", hooks: [{ type: "command", command: binaryPath }] },
          { matcher: "Edit|Write|NotebookEdit", hooks: [{ type: "command", command: binaryPath }] }
        );
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
        existing.hooks.beforeShellExecution = (existing.hooks.beforeShellExecution || []).filter(h => !isCheckRef(h.command));
        existing.hooks.beforeShellExecution.push({
          command: "node " + scriptPath
        });
        return existing;
      }
    },
    {
      name: "Homebase",
      dir: join(home, ".homebase"),
      file: "hooks.json",
      config: (existing) => {
        existing.hooks = existing.hooks || {};
        existing.hooks.PreToolUse = (existing.hooks.PreToolUse || []).filter(h => !h.hooks?.some(isCheckHook));
        existing.hooks.PreToolUse.push({
          matcher: "Bash|PowerShell",
          hooks: [{ type: "command", command: "node", args: [scriptPath] }]
        });
        existing.hooks.PostToolUse = (existing.hooks.PostToolUse || []).filter(h => !h.hooks?.some(isCheckHook));
        existing.hooks.PostToolUse.push(
          { matcher: "Bash|PowerShell", hooks: [{ type: "command", command: binaryPath }] }
        );
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

  console.log(`\n  Your free GOL Client ID (this machine):  ${key}`);
  console.log(`  Shared by every editor on this machine. 120 free checks/day.`);
  console.log(`  Need more? Get a GOL API Key (paid, prepaid balance) at`);
  console.log(`  https://www.golproductions.com/console`);
  console.log(`\n  By using Check you agree to the Terms and Privacy Policy:`);
  console.log(`  golproductions.com/terms  |  golproductions.com/privacy`);
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

  // Silent lifecycle ping. No output, failures swallowed, the uninstall
  // itself must never be affected. Awaited just before exit so the process
  // doesn't kill it mid-flight; the 3s abort caps worst-case delay.
  let uninstallPing = Promise.resolve();
  try {
    const key = getClientId();
    if (key) {
      uninstallPing = fetch(API.replace("/preflight", "/log"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-GOL-CLIENT-ID": key, "User-Agent": "c/" + VERSION },
        body: JSON.stringify({ verdict: "uninstall", channel: "npm", os: platform(), arch: arch(), version: VERSION }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    }
  } catch {}

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

  try { await uninstallPing; } catch {}
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
    console.log(`\n  Check v${VERSION}, Credits\n`);
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
  Check v${VERSION}, Documentation

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
  Check v${VERSION}, Anti-hallucination layer for AI coding agents

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

// THE ROD, syntax layer: do not model the shell's grammar, ask the shell.
// `bash -n` parses without executing anything; its verdict is the machine's
// own ground truth. Tri-state: null = no bash located or parse could not run,
// abstain and let the server decide. A string = the shell's own error, deny
// with it verbatim. false = parsed clean.
async function syntaxError(command) {
  try {
    const bash = bashPath();
    if (!bash) return null;
    // Command travels on stdin, not argv: same grammar, no OS arg-length
    // ceiling (a 30KB agent-generated script must not force an abstain).
    const r = spawnSync(bash, ["-n"], { input: command, timeout: 4000, encoding: "utf8" });
    if (r.error) return null;
    if (r.status === 0) {
      // Unterminated heredocs parse with exit 0 but bash still says so on
      // stderr. The shell's warning is the shell's verdict, honor it.
      const warn = (r.stderr || "").split("\n").find(l => /here-document.*end-of-file/i.test(l));
      if (warn) return warn.replace(/^[^:]*bash[^:]*:\s*/i, "").trim();
      return false;
    }
    const msg = (r.stderr || "").split("\n").find(l => l.trim()) || "syntax error";
    return msg.replace(/^[^:]*bash[^:]*:\s*/i, "").trim();
  } catch { return null; }
}

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

// Hook verdicts NEVER call process.exit(): after a second server round the
// loop still holds undici keep-alive teardown, and a forced exit trips a
// libuv assertion on Windows (async.c:76, measured 17 Jul), the process
// aborts with a garbage exit code and the consumer discards the verdict JSON.
// Set exitCode and let the loop drain; the sockets are unref'd, so the drain
// is immediate. A deny that exits dirty is not a deny.
function out(f, ok, reason) {
  if (ok) {
    const r = { cursor: { permission: "allow" }, gemini: { decision: "allow" }, claude: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } } };
    process.stdout.write(JSON.stringify(r[f] || r.claude));
    process.exitCode = 0;
    return;
  }
  if (f === "gemini") {
    process.stdout.write(JSON.stringify({ decision: "deny", reason }));
    process.exitCode = 2;
    return;
  }
  // The reason is for the AGENT only: it reads the shell's words, fixes the
  // command, and moves on. The user never sees the stumble, just clean flow.
  // (Claude Code's permissionDecisionReason and Cursor's agent_message feed
  // the model; user_message would put the error on the user's screen.)
  const r = { cursor: { permission: "deny", agent_message: reason }, claude: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } } };
  process.stdout.write(JSON.stringify(r[f] || r.claude));
  process.exitCode = 0;
}

// Out of checks is a billing state, not a bad command. Warn, then let the
// command run without the gate. The warning fires once per day per machine.
function outCreditsExhausted(f, reason) {
  let warned = true;
  try {
    const marker = join(homedir(), ".check", "credits-warned-" + new Date().toISOString().slice(0, 10));
    warned = existsSync(marker);
    if (!warned) { mkdirSync(join(homedir(), ".check"), { recursive: true }); writeFileSync(marker, "1"); }
  } catch { warned = false; }
  const msg = warned ? undefined : reason;
  if (f === "gemini") {
    process.stdout.write(JSON.stringify({ decision: "allow" }));
    if (msg) process.stderr.write(msg);
    process.exitCode = 0;
    return;
  }
  if (f === "cursor") {
    const r = { permission: "allow" };
    if (msg) r.user_message = msg;
    process.stdout.write(JSON.stringify(r));
    process.exitCode = 0;
    return;
  }
  const r = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
  if (msg) r.systemMessage = msg;
  process.stdout.write(JSON.stringify(r));
  process.exitCode = 0;
}

// The machine's own PATH resolution is the ground truth for whether a
// command exists. This is the same lookup the shell performs at launch:
// walk PATH (plus PATHEXT on Windows), pure filesystem reads, deterministic.
// The server honors binary_exists as proof, so real-but-unlisted tools
// (claude, codex, aider, internal CLIs) are never falsely blocked.
const PREFIX_WORDS = new Set(["sudo", "nohup", "nice", "time", "timeout", "env"]);

// POSIX shell builtins and keywords. Frozen by spec since 1992: these are
// provided by the shell itself, not the filesystem, and are treated as
// present. This set is evergreen, it does not rot the way a tool list does.
const SHELL_BUILTINS = new Set([
  "cd", "echo", "printf", "pwd", "export", "set", "unset", "alias", "unalias",
  "true", "false", "test", "[", "[[", "exit", "return", "break", "continue",
  "shift", "source", ".", "eval", "exec", "trap", "wait", "jobs", "fg", "bg",
  "read", "readonly", "local", "declare", "typeset", "let", "getopts", "hash",
  "type", "command", "builtin", "ulimit", "umask", "times", "dirs", "pushd",
  "popd", "for", "while", "until", "if", "then", "else", "elif", "fi", "do",
  "done", "case", "esac", "in", "function", "select", "{", "}", "!",
]);

// Heredoc bodies are data, not commands: everything between `<<WORD` and
// the line that is exactly WORD must never be probed as a binary. Strip
// them before segmenting. Handles <<-, <<'WORD', <<"WORD"; <<< is a
// herestring (one line, no body) and is left alone.
function stripHeredocs(command) {
  const lines = command.split("\n");
  const out = [];
  const pending = []; // heredoc bodies are consumed in the order opened
  for (const line of lines) {
    if (pending.length) {
      const { delim, dashed } = pending[0];
      const probe = dashed ? line.replace(/^\t+/, "") : line;
      if (probe === delim) pending.shift();
      continue;
    }
    out.push(line);
    // every heredoc opened on this line queues a body (<<< is a herestring, no body)
    for (const m of line.matchAll(/<<(-?)(?!<)\s*(?:'([^']+)'|"([^"]+)"|(\w+))/g)) {
      pending.push({ delim: m[2] || m[3] || m[4], dashed: m[1] === "-" });
    }
  }
  return out.join("\n");
}

// Quote-aware: "./spaced name.sh" is ONE token, and connectors inside
// quotes are literal text, not separators.
function segmentBases(command) {
  const segs = [[]];
  let cur = "", q = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === "|" || ch === "&" || ch === ";" || ch === "\n") {
      if (cur) { segs[segs.length - 1].push(cur); cur = ""; }
      if (segs[segs.length - 1].length) segs.push([]);
      if ((ch === "|" || ch === "&") && command[i + 1] === ch) i++;
      continue;
    }
    if (/\s/.test(ch)) { if (cur) { segs[segs.length - 1].push(cur); cur = ""; } continue; }
    cur += ch;
  }
  if (cur) segs[segs.length - 1].push(cur);

  // Keywords that PREFIX a real command (`do fakecmd`, `if grep -q x f`):
  // step over them so the command behind them still gets probed. Keywords
  // that BEGIN pure grammar (`for f in *.js`) stay as the base and are
  // filtered out as builtins by the caller.
  const KEYWORD_PREFIXES = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "{"]);
  const bases = [];
  for (const words of segs) {
    let base = null;
    for (const w of words) {
      if (!w) continue;
      if (PREFIX_WORDS.has(w)) continue;
      if (KEYWORD_PREFIXES.has(w)) continue;
      if (/^[\d.]+[smhd]?$/.test(w)) continue;
      if (w.includes("=") && !w.startsWith("-")) continue;
      if (w.startsWith("-")) continue;
      base = w;
      break;
    }
    if (base) bases.push(base);
  }
  return bases;
}

// THE ROD: do not model the shell, ask it. `type` is the shell reporting
// on itself: builtins, keywords, functions, and PATH binaries all answer
// through the exact resolution the shell will use at launch. A model of the
// shell can drift from the shell; the shell cannot drift from itself.
// On Windows, bare "bash" is a trap: PATH can resolve to WSL's
// System32\bash.exe, a different operating system with a different
// filesystem. The command will actually run in Git Bash, so the probe
// must ask Git Bash, located explicitly. If it cannot be located,
// abstain, never let the wrong interpreter answer for the right one.
function bashPath() {
  if (platform() !== "win32") return "bash";
  const candidates = [
    process.env.CLAUDE_CODE_GIT_BASH_PATH,
    "C:/Program Files/Git/bin/bash.exe",
    "C:/Program Files/Git/usr/bin/bash.exe",
    "C:/Program Files (x86)/Git/bin/bash.exe",
  ].filter(Boolean);
  for (const c of candidates) { try { if (existsSync(c)) return c; } catch {} }
  return null;
}

// When the shell refuses a name, keep its own words. The reason shown on a
// deny must come from the interpreter that would have run the command, not
// from us: deterministic (same machine, same words) and never argued with.
// Normalized as "<name>: <the shell's phrase>", pure string ops.
function shellWhy(raw, name) {
  if (!raw) return null;
  const line = raw.split(/\r?\n/).find(l => l.includes(name));
  if (!line) return null;
  let tail = line.slice(line.indexOf(name) + name.length);
  tail = tail.replace(/^['"\s:]+/, "").replace(/\s+$/, "");
  return tail ? name + ": " + tail : null;
}

function shellKnows(name, cwd, shell) {
  try {
    if (shell === "powershell") {
      const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        "try { $null = Get-Command $env:CHECK_PROBE -ErrorAction Stop; exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }"],
        { cwd, timeout: 4000, encoding: "utf8", env: { ...process.env, CHECK_PROBE: name } });
      if (r.error) return null;
      return { known: r.status === 0, why: r.status === 0 ? null : shellWhy(r.stderr, name) };
    }
    const bash = bashPath();
    if (!bash) return null;
    const r = spawnSync(bash, ["-c", 'type -- "$1"', "check", name],
      { cwd, timeout: 4000, encoding: "utf8" });
    if (r.error) return null;
    return { known: r.status === 0, why: r.status === 0 ? null : shellWhy(r.stderr, name) };
  } catch { return null; }
}

// Tri-state ground truth from the interpreter itself: true = every command
// word proven resolvable, false = at least one proven unresolvable, null =
// cannot be determined without executing (subshells, expansions), abstain,
// never guess. Per-base since 3.3.0: one noisy token (an expansion, paren
// grammar) no longer abandons the whole command, every CLEAN base is still
// probed, so a provably-fake word is denied locally even when it shares the
// line with an expansion. `answers` (optional) collects every probed base's
// verdict so the server round can be seeded with proof it did not ask for.
function allBinariesExist(command, cwd, shell, misses, answers) {
  try {
    // Backslash-newline is line continuation, not a token; heredoc bodies
    // are data, not commands. Both must vanish before segmenting.
    let bases = segmentBases(stripHeredocs(command).replace(/\\\r?\n/g, " "));
    if (shell !== "powershell") bases = bases.filter(b => !SHELL_BUILTINS.has(b));
    if (bases.length === 0) return true;
    // Probe only clean word-like names. Anything else (expansions, paren
    // grammar, or garbage from quote structures this scanner cannot model)
    // is "cannot determine without executing" for THAT word, abstain on it,
    // keep probing the rest.
    const clean = [...new Set(bases.filter(b => /^[A-Za-z0-9_.\/\\~:@+=-]+$/.test(b)))];
    const noisy = clean.length !== new Set(bases).size;
    let sawFalse = false, sawNull = noisy;
    for (const b of clean) {
      const probe = shellKnows(b, cwd, shell);
      if (probe === null) { sawNull = true; continue; }
      if (answers) {
        answers.probe[b] = probe.known;
        if (!probe.known && probe.why) answers.why[b] = probe.why;
      }
      if (probe.known === false) {
        sawFalse = true;
        if (misses) misses.push(probe.why || b + ": not found");
      }
    }
    // Proven absence outranks uncertainty: one dead word kills the command.
    if (sawFalse) return false;
    return sawNull ? null : true;
  } catch { return null; }
}

// PROBE PROTOCOL (3.3.0), the server names exactly the facts it cannot
// resolve (words, "path:" filesystem referents, "gitcmd:"/"gitref:" git
// facts) and this client asks the machine that would run the command,
// relaying its answer verbatim. One spawn answers the whole batch. The
// separators are control bytes (US/RS) so no real path or error text can
// forge a record boundary.
const PROBE_SH = `for k in "$@"; do
  r=0; w=""
  case "$k" in
    path:*) p="\${k#path:}"; [ -e "$p" ] && r=1 ;;
    gitcmd:*) s="\${k#gitcmd:}"
      if git --list-cmds=main,others,alias,parse-opt 2>/dev/null | grep -Fxq -- "$s"; then r=1
      elif type -- "git-$s" >/dev/null 2>&1; then r=1; fi ;;
    gitref:*) f="\${k#gitref:}"
      if git rev-parse --verify --quiet "$f" >/dev/null 2>&1; then r=1
      elif git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then r=1; fi ;;
    *) if w=$(type -- "$k" 2>&1 >/dev/null); then r=1; w=""; fi ;;
  esac
  printf '%s\\036%s\\036%s\\037' "$k" "$r" "$w"
done`;

const PROBE_PS = `$ks = $env:CHECK_PROBES -split [char]0x1f
foreach ($k in $ks) {
  if ($k -eq '') { continue }
  $r = 0; $w = ''
  if ($k.StartsWith('path:')) {
    if (Test-Path -LiteralPath $k.Substring(5)) { $r = 1 }
  } elseif ($k.StartsWith('gitcmd:')) {
    $s = $k.Substring(7)
    $out = & git --list-cmds=main,others,alias,parse-opt 2>$null
    if ($out -contains $s) { $r = 1 }
    else { try { $null = Get-Command ("git-" + $s) -ErrorAction Stop; $r = 1 } catch {} }
  } elseif ($k.StartsWith('gitref:')) {
    $f = $k.Substring(7)
    $null = & git rev-parse --verify --quiet $f 2>$null
    if ($LASTEXITCODE -eq 0) { $r = 1 }
    else { $null = & git ls-files --error-unmatch -- $f 2>$null; if ($LASTEXITCODE -eq 0) { $r = 1 } }
  } else {
    try { $null = Get-Command $k -ErrorAction Stop; $r = 1 } catch { $w = $_.Exception.Message }
  }
  [Console]::Out.Write($k + [char]0x1e + $r + [char]0x1e + $w + [char]0x1f)
}`;

// Answer a batch of server-named probes with the executing interpreter's own
// verdicts. Returns { probe: {key: bool}, why: {key: stderr} }; a probe the
// shell cannot answer is simply omitted, the server's documented fallback
// (legacy list) covers a missing answer, so silence is safe and never a lie.
// Async spawn, never spawnSync: this runs AFTER the first server round, and
// spawnSync after async I/O trips a libuv teardown assertion on Windows
// (measured 17 Jul: every probe pass exited 127, which un-denies the deny,
// a hook consumer honors the JSON only on a clean exit).
function answerProbes(keys, cwd, shell) {
  const out = { probe: {}, why: {} };
  if (!Array.isArray(keys) || keys.length === 0) return Promise.resolve(out);
  const safe = keys.filter(k => typeof k === "string" && k.length > 0 && k.length < 600).slice(0, 16);
  if (safe.length === 0) return Promise.resolve(out);
  let child;
  try {
    if (shell === "powershell") {
      child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", PROBE_PS],
        { cwd, env: { ...process.env, CHECK_PROBES: safe.join("\x1f") } });
    } else {
      const bash = bashPath();
      if (!bash) return Promise.resolve(out);
      child = spawn(bash, ["-c", PROBE_SH, "check", ...safe], { cwd });
    }
  } catch { return Promise.resolve(out); }
  return new Promise((resolve) => {
    let stdout = "";
    const done = () => {
      try {
        for (const rec of stdout.split("\x1f")) {
          if (!rec) continue;
          const [key, val, why] = rec.split("\x1e");
          if (!key || (val !== "0" && val !== "1")) continue;
          out.probe[key] = val === "1";
          if (val === "0" && why) out.why[key] = why.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 200);
        }
      } catch {}
      resolve(out);
    };
    const timer = setTimeout(() => { try { child.kill(); } catch {} done(); }, 8000);
    child.stdout.on("data", (c) => { stdout += c; });
    child.on("error", () => { clearTimeout(timer); resolve(out); });
    child.on("close", () => { clearTimeout(timer); done(); });
  });
}

async function main() {
  let f = "claude";
  try {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    input = input.replace(/^﻿/, "").trim();
    // FAIL OPEN ONLY, 26 Jul. This block used to fail closed on a broken
    // contract, on the theory that a firewall should. It is the wrong theory
    // here, because the thing on the other side of this gate is not an attacker,
    // it is the owner of the machine doing their job. Only a measurement may
    // deny. A payload we could not read is not a measurement of anything, and
    // exiting non-zero from a PreToolUse hook is itself a block on some hosts.
    if (!input) {
      process.stderr.write("check: no hook input on stdin. This entrypoint is for tool hooks; run --help for CLI usage.\n");
      process.exit(0);
    }
    let p;
    try { p = JSON.parse(input); } catch {
      outCreditsExhausted("claude", "check: the hook input could not be read, so this command ran unverified. Nothing is being blocked and no action is needed. It re-engages as soon as the service is back automatically.");
      return;
    }
    if (p.hook_event_name === "PostToolUse") { process.exit(0); return; }
    f = detect(p);
    const c = cmd(p, f);
    if (!c) { out(f, true); return; }
    const hookKey = getClientId();
    // FAIL OPEN, 26 Jul. This denied every command when no key was configured,
    // which meant a fresh install with an unset environment variable locked the
    // user's terminal until they found our website. Not having paid us is not a
    // fact about their command.
    if (!hookKey) {
      outCreditsExhausted(f, "check: no key configured, so commands are running unverified. Nothing is being blocked. Get your key at https://golproductions.com/check");
      return;
    }
    // LOCAL SYNTAX DENY: only where the executing shell is provably bash
    // (Claude Code's Bash tool). Elsewhere the shell is unknown, abstain.
    if (p.tool_name === "Bash") {
      const synErr = await syntaxError(c);
      if (typeof synErr === "string") { out(f, false, `check: syntax error, ${synErr}`); return; }
    }
    const shell = p.tool_name === "PowerShell" ? "powershell" : "bash";
    // Ask the same interpreter that will run the command.
    const misses = [];
    const localAnswers = { probe: {}, why: {} };
    const exists = allBinariesExist(c, p.cwd, shell, misses, localAnswers);
    // LOCAL FAST DENY: the shell just proved a command word does not resolve.
    // The verdict is already decided; a server round trip would only repeat
    // it slower and burn a check. No network, no charge, the shell's words,
    // and the whole answer in the time the probe took. The server still owns
    // every verdict the shell cannot see (URLs, flags, packages, syntax).
    if (exists === false && misses.length) {
      out(f, false, "denied by the shell that would run it. " + misses.join("; "));
      return;
    }
    // Send only what the verdict needs. No transcript paths, no usernames
    // beyond what cwd itself carries, the check is about the command.
    // probe_ok / path_ok / git_ok declare the full probe protocol: the server
    // names any fact it cannot resolve (a word, a "path:", a "gitcmd:"/
    // "gitref:") and this client answers with the machine's own verdict. This
    // is what turns the allow from list-faith into ground truth, the whole
    // point of the gate: "will this command run?" answered by the machine
    // that would run it, yes or no.
    const body = {
      command: c, cwd: p.cwd || process.cwd(), platform: f, channel: "npm",
      tool_name: p.tool_name, v: VERSION, probe_ok: 1, path_ok: 1, git_ok: 1,
    };
    if (exists !== null) body.binary_exists = exists;
    const post = (payload, signal) => fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GOL-CLIENT-ID": hookKey, "User-Agent": "c/" + VERSION },
      body: JSON.stringify(payload),
      signal,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let res = await post(body, controller.signal);
    clearTimeout(timer);
    let d = await res.json();

    // Second pass: the server named the facts it cannot resolve. Ask the
    // interpreter that would run the command, relay its answers verbatim,
    // and get the grounded verdict. Words already probed locally are answered
    // from that scan, no second spawn for them. A probe round is free on the
    // server side; only the verdict call bills.
    if (res.ok && d.verdict === "probe" && Array.isArray(d.probe)) {
      const unanswered = d.probe.filter(k => !(k in localAnswers.probe));
      const asked = await answerProbes(unanswered, p.cwd, shell);
      const probeAns = { ...localAnswers.probe, ...asked.probe };
      const probeWhy = { ...localAnswers.why, ...asked.why };
      const answered = {};
      const answeredWhy = {};
      for (const k of d.probe) {
        if (k in probeAns) {
          answered[k] = probeAns[k];
          if (probeWhy[k]) answeredWhy[k] = probeWhy[k];
        }
      }
      const body2 = { ...body, probe: answered, probe_why: answeredWhy };
      delete body2.probe_ok;
      const c2 = new AbortController();
      const t2 = setTimeout(() => c2.abort(), 5000);
      res = await post(body2, c2.signal);
      clearTimeout(t2);
      d = await res.json();
    }

    // Billing and account states arrive as non-2xx and carry no `verdict`.
    // Surface what the server actually said so the user knows this is about
    // their account, not their command. Without this, the free-tier wall
    // (HTTP 402) falls through to the generic "denied" below and reads like
    // the command itself was rejected.
    if (!res.ok) {
      // Rate limit is a traffic state, not a verdict. A deny must mean "your
      // command is wrong", never "you typed too fast", heavy agent sessions
      // hit 60/min in normal use. Same trade as the credits wall: warn, let
      // the command run ungated, resume when the window clears.
      if (res.status === 429 || /rate limit/i.test(d.reason || d.error || "")) {
        outCreditsExhausted(f, "check: rate limited (60 checks/min), command ran unverified. Check resumes automatically.");
        return;
      }
      // Server-side failure is the service breaking, not the command being
      // wrong. Same law as an unreachable network (Terms, section 5): the
      // gate's own outage must never block the user's work.
      if (res.status >= 500) {
        outCreditsExhausted(f, "check: validation service error (HTTP " + res.status + "), command ran unverified. Check resumes automatically.");
        return;
      }
      if (res.status === 402) {
        const free = d.daily_free || 120;
        const upsell = d.upgrade || "Top up at https://www.golproductions.com/console.html";
        outCreditsExhausted(f, `check: you've used all ${free} free checks for today and your balance is empty. Check is off until tomorrow, commands run unverified. Credits you buy never expire. ${upsell}`);
        return;
      }
      // FAIL OPEN, 26 Jul. What is left here is 401 and 403: a key we did not
      // recognise, or an account we marked inactive. Every one of those is our
      // accounting being wrong about them, and none of them is a statement about
      // the command. A billing dispute must not stop someone from working.
      outCreditsExhausted(f, "check: " + (d.reason || d.error || "this key was not accepted") + ". The command ran unverified and nothing is being blocked. It re-engages as soon as the service is back automatically.");
      return;
    }

    if (d.verdict === "runnable") { out(f, true); }
    else {
      // Prefer the shell's own words: when the interpreter that would run
      // this command already said why it can't, that sentence is the reason.
      // Server reason covers everything the shell can't see (URLs, syntax).
      const local = misses.length ? "denied by the shell that would run it. " + misses.join("; ") : null;
      out(f, false, local || d.reason || "denied. Address the issue before continuing.");
    }
  } catch {
    // Network failure or timeout: fail OPEN. An unreachable validation
    // service must never block the user's work (Terms, section 5).
    outCreditsExhausted(f, "check: validation service unreachable, command ran unverified. Check resumes automatically.");
  }
}

main();
