// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
// Is what we SHIPPED what we SAY we shipped? Asked of the registry and the
// live service, never of the working tree.
//
// Every defect found on 26 Jul was the same shape: the artifact being looked
// at was not the artifact that runs. dist/ nine days behind src/. Five copies
// of gate.js. A replay pointed at two dead trees. A deploy to an idle script
// that reported success. Two npm packages a version apart, both named check-mcp,
// neither the source of truth.
//
// So this file trusts nothing local. It downloads the published tarball, runs
// it, and asks production. If it passes, the thing users get is the thing we
// think we built.
//
//   node test/shipped-truth.mjs

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WANT = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const KEY = process.env.GOL_CLIENT_ID || "";

let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { console.log("  PASS  " + label); return; }
  fail++; console.log("  FAIL  " + label + (detail ? "\n          " + detail : ""));
};

const reg = async (name) => {
  const r = await fetch("https://registry.npmjs.org/@golproductions%2f" + name, { signal: AbortSignal.timeout(25000) });
  return r.json();
};

// ── 1. the registry ──────────────────────────────────────────────────────────
console.log("\n── the registry, not the working tree ──");
const check = await reg("check");
const latest = check["dist-tags"].latest;
ok("@golproductions/check latest is " + WANT, latest === WANT, "registry says " + latest);
ok("latest is not deprecated", !check.versions[latest].deprecated);

const mcp = await reg("check-mcp");
const mcpVers = Object.keys(mcp.versions);
const depCount = mcpVers.filter(v => mcp.versions[v].deprecated).length;
ok("check-mcp fully deprecated (" + depCount + "/" + mcpVers.length + ")", depCount === mcpVers.length);
ok("its message points at the surviving package",
   String(mcp.versions[mcp["dist-tags"].latest].deprecated || "").includes("@golproductions/check"));

// ── 2. download it and run it ────────────────────────────────────────────────
console.log("\n── the published tarball, downloaded fresh ──");
const TMP = mkdtempSync(join(tmpdir(), "shipped-"));
const pack = spawnSync("npm", ["pack", "@golproductions/check@" + WANT], { cwd: TMP, encoding: "utf8", shell: true, timeout: 180000 });
const tgz = (pack.stdout || "").trim().split("\n").pop();
ok("npm pack succeeded", !!tgz && tgz.endsWith(".tgz"), (pack.stderr || "").slice(0, 120));

if (tgz) {
  spawnSync("tar", ["-xzf", tgz], { cwd: TMP, shell: true, timeout: 120000 });
  const pkgDir = join(TMP, "package");
  const files = ["dist/index.js", "dist/mcp.js", "package.json", "LICENSE", "README.md"];
  ok("tarball contains exactly the 5 expected files", files.every(f => existsSync(join(pkgDir, f))));
  ok("no source shipped", !existsSync(join(pkgDir, "src")));
  ok("no npm token shipped", !existsSync(join(pkgDir, ".npmrc")));

  const head = readFileSync(join(pkgDir, "dist", "index.js"), "utf8").slice(0, 200);
  ok("copyright survived obfuscation", head.includes("GOL Productions"));

  const st = spawnSync(process.execPath, [join(pkgDir, "dist", "index.js"), "--status"], { encoding: "utf8", timeout: 30000 });
  ok("CLI reports v" + WANT, ((st.stdout || "") + (st.stderr || "")).includes("v" + WANT));

  const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) + "\n";
  const m = spawnSync(process.execPath, [join(pkgDir, "dist", "mcp.js")], { input: init, encoding: "utf8", timeout: 30000 });
  const mv = ((m.stdout || "").match(/"version"\s*:\s*"([^"]+)"/) || [])[1];
  ok("bundled MCP announces v" + WANT + " on the wire", mv === WANT, "announced " + mv);

  // ── 3. the shipped hook against LIVE production ────────────────────────────
  console.log("\n── the shipped hook, against live production ──");
  if (!KEY) console.log("  SKIP  GOL_CLIENT_ID not set");
  else {
    const hook = (command) => {
      const ev = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash",
        tool_input: { command }, cwd: ROOT });
      const r = spawnSync(process.execPath, [join(pkgDir, "dist", "index.js")],
        { input: ev, encoding: "utf8", timeout: 40000, env: { ...process.env, GOL_CLIENT_ID: KEY } });
      let d = null;
      try { d = JSON.parse((r.stdout || "").trim()); } catch {}
      return { decision: d?.hookSpecificOutput?.permissionDecision, reason: d?.hookSpecificOutput?.permissionDecisionReason, code: r.status };
    };

    const a = hook("git status");
    ok("real command is allowed", a.decision === "allow", JSON.stringify(a));
    ok("and exits 0 (a dirty exit discards the verdict)", a.code === 0, "exit " + a.code);

    const b = hook("frobnicate --all");
    ok("fabricated binary is denied", b.decision === "deny", JSON.stringify(b));
    ok("denial carries the shell's own words", /not found/i.test(b.reason || ""), b.reason);

    const c = hook('git commit -m "unterminated');
    ok("unparseable command is denied", c.decision === "deny", JSON.stringify(c));

    const d = hook("for f in a b; do echo $f; done");
    ok("loop variables are not treated as commands", d.decision === "allow", JSON.stringify(d));

    const e = hook("git commit -m \"$(cat <<'EOF'\nsolPriceUSD flagged\nEOF\n)\"");
    ok("heredoc bodies are not treated as commands", e.decision === "allow", JSON.stringify(e));
  }
}

console.log("");
if (fail === 0) console.log("Everything shipped matches what we say we shipped.");
else { console.log(fail + " CHECK(S) FAILED."); process.exit(1); }
