#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, arch } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const VERSION = "3.0.2";
const BINARY_VERSION = "3.0.0";
const API = "https://triage.golproductions.com/preflight";
const CDN = "https://pub-e55366a7f5994be9be04f0e205179f4a.r2.dev/releases";
const CLIENT_ID = process.env.GOL_CLIENT_ID || "";

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
  const key = process.argv[3] || process.env.GOL_CLIENT_ID || "your_key";
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
      name: "Antigravity IDE",
      dir: join(home, ".gemini", "config"),
      file: "hooks.json",
      config: (existing) => {
        existing["check-gate"] = {
          enabled: true,
          PreToolUse: [{
            matcher: "run_command",
            hooks: [{ type: "command", command: "node " + scriptPath }]
          }]
        };
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
    }
  ];

  let hasClaude = false;
  for (const t of targets) {
    if (!existsSync(t.dir)) continue;
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

if (process.argv.includes("--install")) { await install(); }
if (process.argv.includes("--mcp")) { await import("./mcp.js"); process.exit(0); }

function detect(p) {
  if (typeof p.command === "string" && !p.tool_input) return "cursor";
  if (p.hook_event_name === "BeforeTool") return "gemini";
  if (p.toolCall?.argumentsJson) return "antigravity";
  return "claude";
}

function cmd(p, f) {
  if (f === "cursor") return p.command;
  if (f === "antigravity") {
    try {
      const a = typeof p.toolCall.argumentsJson === "string" ? JSON.parse(p.toolCall.argumentsJson) : p.toolCall.argumentsJson;
      return a.command || a.CommandLine || a.command_line;
    } catch { return null; }
  }
  return p.tool_input?.command;
}

function out(f, ok, reason) {
  if (ok) {
    const r = { cursor: { permission: "allow" }, gemini: { decision: "allow" }, antigravity: { decision: "allow" }, claude: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } } };
    process.stdout.write(JSON.stringify(r[f]));
    process.exit(0);
  }
  if (f === "gemini" || f === "antigravity") { process.stderr.write(reason + "\n"); process.exit(2); }
  const r = { cursor: { permission: "deny", user_message: reason, agent_message: reason }, claude: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } } };
  process.stdout.write(JSON.stringify(r[f]));
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
    if (!CLIENT_ID) { process.stderr.write("check: GOL_CLIENT_ID not set. Get your key at https://www.golproductions.com/check.html\n"); out(f, true); return; }
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
  } catch { out(f, true); }
}

main();
