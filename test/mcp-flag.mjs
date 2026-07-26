// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
// `--mcp` starts the MCP server AND keeps it alive.
//
// It did neither. The handler read:
//
//     if (args.includes("--mcp")) { await import("./mcp.js"); process.exit(0); }
//
// mcp.js ends with `await server.connect(transport)`, which resolves the
// moment the transport attaches and then needs the process to stay alive to
// serve stdio. The exit killed it in the same tick.
//
// --install writes `npx @golproductions/check --mcp` into five editors
// (Windsurf, Continue, Amazon Q, Roo Code, Claude Desktop), so the MCP face
// was dead for everyone who got it that way, on every version.
//
// Every existing check missed it because they all ask mcp.js directly, and
// mcp.js was never broken. Only the FLAG was. So this test uses the flag, the
// way the installer writes it, and asks a second question after the handshake
// to prove the process is still there.
//
//   node test/mcp-flag.mjs

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.GOL_CLIENT_ID || "mcp-flag-test-not-a-real-key";

let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { console.log("PASS  " + label); return; }
  fail++; console.log("FAIL  " + label + (detail ? "\n        " + detail : ""));
};

// Ask twice. The second question is the whole point: a server that answers
// initialize and then dies looks healthy to any single-shot check.
function ask(entry) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, "--mcp"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GOL_CLIENT_ID: KEY },
    });
    let out = "", err = "";
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; clearTimeout(t); try { child.kill(); } catch {} resolve(v); };
    const t = setTimeout(() => finish({ out, err, why: "timed out" }), 25000);

    child.stdout.on("data", (d) => {
      out += d;
      if (/"tools"\s*:\s*\[/.test(out)) finish({ out, err });
    });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => finish({ out, err, why: "spawn failed: " + e.message }));
    child.on("close", (code) => finish({ out, err, why: "exited " + code }));

    const send = (o) => { try { child.stdin.write(JSON.stringify(o) + "\n"); } catch {} };
    send({ jsonrpc: "2.0", id: 1, method: "initialize",
           params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mcp-flag", version: "1" } } });
    setTimeout(() => {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    }, 900);
  });
}

for (const rel of ["src/index.js", "dist/index.js"]) {
  const entry = join(ROOT, rel);
  if (!existsSync(entry)) { console.log("SKIP  " + rel + " not present"); continue; }
  const r = await ask(entry);
  const version = (r.out.match(/"serverInfo"\s*:\s*\{[^}]*"version"\s*:\s*"([^"]+)"/) || [])[1];
  const tools = (r.out.match(/"name"\s*:\s*"(Check|CheckAndExecute)"/g) || []).length;

  ok(rel + " --mcp answers initialize", !!version,
     r.why ? r.why + (r.err ? "; stderr: " + r.err.trim().slice(0, 160) : "") : "no serverInfo");
  ok(rel + " --mcp stays alive to serve tools/list", tools >= 2,
     "saw " + tools + " tool name(s); a server that answers initialize then dies is the bug this test exists for");
}

console.log("");
if (fail === 0) console.log("The --mcp flag starts a server that lives.");
else { console.log(fail + " CHECK(S) FAILED."); process.exit(1); }
