#!/usr/bin/env node
// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile, spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION = "3.3.9";
const API = "https://triage.golproductions.com/preflight";
const CLIENT_ID = process.env.GOL_CLIENT_ID;
const IS_WIN = process.platform === "win32";

if (!CLIENT_ID) {
  process.stderr.write("check: GOL_CLIENT_ID environment variable is required.\nGet your key at https://www.golproductions.com/check.html\n");
  process.exit(1);
}

// THE ROD (ported from index.js): do not model the shell — ask it. The
// machine's own PATH resolution is the ground truth for whether a command
// exists. Tri-state: true = proven present, false = proven absent, null =
// cannot be determined without executing — abstain, never guess.
const PREFIX_WORDS = new Set(["sudo", "nohup", "nice", "time", "timeout", "env"]);

const SHELL_BUILTINS = new Set([
  "cd", "echo", "printf", "pwd", "export", "set", "unset", "alias", "unalias",
  "true", "false", "test", "[", "[[", "exit", "return", "break", "continue",
  "shift", "source", ".", "eval", "exec", "trap", "wait", "jobs", "fg", "bg",
  "read", "readonly", "local", "declare", "typeset", "let", "getopts", "hash",
  "type", "command", "builtin", "ulimit", "umask", "times", "dirs", "pushd",
  "popd", "for", "while", "until", "if", "then", "else", "elif", "fi", "do",
  "done", "case", "esac", "in", "function", "select", "{", "}", "!",
]);

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

  const bases = [];
  for (const words of segs) {
    let base = null;
    for (const w of words) {
      if (!w) continue;
      if (PREFIX_WORDS.has(w)) continue;
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

// On Windows, bare "bash" is a trap: PATH can resolve to WSL's
// System32\bash.exe — a different operating system. The MCP executor
// runs cmd on Windows, but the probe still asks Git Bash for bash-family
// commands; if it cannot be located, abstain.
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

function shellKnows(name) {
  try {
    const bash = bashPath();
    if (!bash) return null;
    const r = spawnSync(bash, ["-c", 'type -- "$1" >/dev/null 2>&1', "check", name],
      { timeout: 4000, stdio: "ignore" });
    return r.error ? null : r.status === 0;
  } catch { return null; }
}

function allBinariesExist(command) {
  try {
    let bases = segmentBases(command);
    bases = bases.filter(b => !SHELL_BUILTINS.has(b));
    if (bases.length === 0) return true;
    if (bases.some(b => /[(){}$`]/.test(b))) return null;
    let verdict = true;
    for (const b of bases) {
      const known = shellKnows(b);
      if (known === null) return null;
      if (known === false) verdict = false;
    }
    return verdict;
  } catch { return null; }
}

// PROBE PROTOCOL (3.3.0), same contract as the hook client: the server names
// the facts it cannot resolve (words, "path:" referents, "gitcmd:"/"gitref:"
// git facts) and this process asks the machine, relaying the answer verbatim.
// One bash spawn answers the whole batch; control-byte separators (US/RS) so
// no path or error text can forge a record boundary.
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

// Async spawn, never spawnSync: probes run after a server round, and
// spawnSync after async I/O trips a libuv teardown assertion on Windows.
function answerProbes(keys) {
  const out = { probe: {}, why: {} };
  if (!Array.isArray(keys) || keys.length === 0) return Promise.resolve(out);
  const safe = keys.filter(k => typeof k === "string" && k.length > 0 && k.length < 600).slice(0, 16);
  if (safe.length === 0) return Promise.resolve(out);
  let child;
  try {
    const bash = bashPath();
    if (!bash) return Promise.resolve(out);
    child = spawn(bash, ["-c", PROBE_SH, "check", ...safe]);
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

async function validate(command) {
  // Ask the interpreter before asking the server, same as the hook client.
  const exists = allBinariesExist(command);
  const body = { command, v: VERSION, channel: "mcp", platform: "mcp", probe_ok: 1, path_ok: 1, git_ok: 1 };
  if (exists !== null) body.binary_exists = exists;
  const post = (payload) => fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-GOL-CLIENT-ID": CLIENT_ID, "User-Agent": "c/" + VERSION },
    body: JSON.stringify(payload)
  });
  let res = await post(body);
  let d = await res.json();
  // Second pass: answer the server-named probes with the machine's verdicts,
  // then get the grounded yes/no. The probe round is free; the verdict bills.
  if (res.ok && d.verdict === "probe" && Array.isArray(d.probe)) {
    const asked = await answerProbes(d.probe);
    const body2 = { ...body, probe: asked.probe, probe_why: asked.why };
    delete body2.probe_ok;
    res = await post(body2);
    d = await res.json();
  }
  d._status = res.status;
  return d;
}

// 402 = out of free checks with an empty balance. That is a billing state,
// not a bad command: warn and let the command through unverified.
const CREDITS_MSG = "Check: daily free checks used and balance is empty. Command NOT verified — Check resumes tomorrow or after a top-up at https://www.golproductions.com/console.html";

const server = new McpServer({ name: "check", version: VERSION });

server.tool(
  "Check",
  "Know if a command will work before running it. Returns 'runnable' or 'invalid'. $0.0068 AUD per Check.",
  { command: z.string().max(10000).describe("The shell command to validate before execution") },
  async ({ command }) => {
    try {
      const d = await validate(command);
      if (d._status === 402) return { content: [{ type: "text", text: `Verdict: RUNNABLE (unverified). ${CREDITS_MSG}` }] };
      if (!d.verdict) return { content: [{ type: "text", text: `Error: ${d.error || "unknown"}` }], isError: true };
      return { content: [{ type: "text", text: `Verdict: ${d.verdict === "runnable" ? "RUNNABLE" : "INVALID"}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Check API error: ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "CheckAndExecute",
  "Validate a command with Check, then execute it if runnable. Returns the command output if valid, or blocks it.",
  { command: z.string().max(10000).describe("The shell command to validate and execute") },
  async ({ command }) => {
    try {
      const d = await validate(command);
      if (d._status !== 402 && d.verdict !== "runnable") return { content: [{ type: "text", text: "BLOCKED: " + (d.reason || "command is invalid") }] };
      const { stdout, stderr } = await execFileAsync(IS_WIN ? "cmd" : "bash", IS_WIN ? ["/c", command] : ["-c", command], { timeout: 30000 });
      return { content: [{ type: "text", text: (stdout || "") + (stderr ? "\nSTDERR: " + stderr : "") || "(no output)" }] };
    } catch (err) {
      if (err.stdout || err.stderr) return { content: [{ type: "text", text: `Exit ${err.code || 1}:\n${(err.stdout || "") + (err.stderr ? "\nSTDERR: " + err.stderr : "")}` }] };
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
