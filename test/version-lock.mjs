// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
// One version number for the whole package, enforced.
//
// This has drifted twice. First the hook reported 2.1.0 while the package was
// 3.3.8. Then, on 26 Jul, index.js was bumped to 3.4.0 and mcp.js was not, so
// a 3.4.0 package shipped an MCP server introducing itself over the wire as
// 3.3.9. Both times it was found by asking the artifact rather than reading
// the source, and by then it was published.
//
// The version is a claim the product makes about itself. A product whose whole
// thesis is "do not assert what you have not measured" cannot ship one that is
// wrong.
//
//   node test/version-lock.mjs

import { readFileSync, existsSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const want = pkg.version;

let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { console.log("PASS  " + label); return; }
  fail++; console.log("FAIL  " + label + (detail ? "   " + detail : ""));
};

console.log("package.json declares " + want + "\n");

// ── sources, when present ────────────────────────────────────────────────────
// src/ is private and absent from the public mirror, so a missing source file
// is expected there and is not a failure. When it IS present, as on the
// machine that builds, it must agree. The artifact checks below are the ones
// that always run, because the artifact is what shipped both times this broke.
for (const f of ["src/index.js", "src/mcp.js"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) { console.log("SKIP  " + f + " not present (private source)"); continue; }
  const m = readFileSync(p, "utf8").match(/const VERSION = "([^"]+)"/);
  ok(f + " VERSION === " + want, m && m[1] === want, m ? "found " + m[1] : "no VERSION const");
}

// ── the built artifacts, which are what users actually run ───────────────────
// Reading the source is not enough: the build is what ships, and on 26 Jul the
// source was right and the artifact was published stale.
const dist = join(ROOT, "dist", "index.js");
if (existsSync(dist)) {
  const r = spawnSync(process.execPath, [dist, "--status"], { encoding: "utf8", timeout: 20000 });
  const out = (r.stdout || "") + (r.stderr || "");
  ok("dist/index.js --status reports v" + want, out.includes("v" + want),
     (out.match(/Check v[\d.]+/) || ["no version line"])[0]);
} else console.log("SKIP  dist/index.js not built");

// The MCP server, asked over a real handshake and given time to answer.
//
// This used to use spawnSync with `input`, which writes the request and closes
// stdin in the same breath. Locally the server won that race every time. In CI
// it did not, and the test reported "no serverInfo.version in the reply" for a
// server that was perfectly correct. A test that depends on winning a race
// fails on a slower machine and teaches you to distrust a red X.
//
// Now: spawn, write, wait for the reply, then close. Only a genuine silence
// reads as silence.
const distMcp = join(ROOT, "dist", "mcp.js");
if (existsSync(distMcp)) {
  const announced = await new Promise((resolve) => {
    const child = spawn(process.execPath, [distMcp], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill(); } catch {} resolve(v); };
    const timer = setTimeout(() => finish(null), 25000);
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/"serverInfo"\s*:\s*\{[^}]*"version"\s*:\s*"([^"]+)"/);
      if (m) finish(m[1]);
    });
    child.on("error", () => finish(null));
    child.on("close", () => finish(null));
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "version-lock", version: "1" } },
    }) + "\n");
  });
  ok("dist/mcp.js announces v" + want + " on the wire", announced === want,
     announced ? "announced " + announced : "no serverInfo.version in the reply");
} else console.log("SKIP  dist/mcp.js not built");

console.log("");
if (fail === 0) console.log("Every version string agrees with package.json.");
else { console.log(fail + " version(s) DISAGREE."); process.exit(1); }
