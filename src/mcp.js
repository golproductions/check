#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION = "2.4.0";
const API = "https://triage.golproductions.com/preflight";
const CLIENT_ID = process.env.GOL_CLIENT_ID;
const IS_WIN = process.platform === "win32";

if (!CLIENT_ID) {
  process.stderr.write("check: GOL_CLIENT_ID environment variable is required.\nGet your key at https://www.golproductions.com/check.html\n");
  process.exit(1);
}

async function validate(command) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-GOL-CLIENT-ID": CLIENT_ID, "User-Agent": "c/" + VERSION },
    body: JSON.stringify({ command, v: VERSION })
  });
  return res.json();
}

const server = new McpServer({ name: "check", version: VERSION });

server.tool(
  "Check",
  "Know if a command will work before running it. Returns 'runnable' or 'invalid'. $0.0068 AUD per Check.",
  { command: z.string().max(10000).describe("The shell command to validate before execution") },
  async ({ command }) => {
    try {
      const d = await validate(command);
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
      if (d.verdict !== "runnable") return { content: [{ type: "text", text: "BLOCKED: " + (d.reason || "command is invalid") }] };
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
