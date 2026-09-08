// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
// THE ETERNITY TEST — every command shape we know of, graded by the shell.
//
// Two invariants, both must hold at 100%:
//   TRUTH:     relay allow <=> bash launches it (exit != 126/127)
//   ETERNITY:  same payload, repeated -> byte-identical verdict, every time
//
// Categories cover the full space of command shapes: real binaries, fakes,
// typos, builtins, keywords, prefixes, pipelines, chains, paths, quoting,
// case, extensions, unicode, and the abstain lane. Policy blocks (SSRF /
// internal targets) are a deliberate divergence from launchability and are
// excluded by design: Check blocks `curl localhost` on purpose.
//
// Usage: node eternity.mjs [repeats-per-case]

import { spawnSync } from "node:child_process";
import { writeFileSync, chmodSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

const HOOK = join(homedir(), ".check", "check.mjs");
const REPEATS = Number(process.argv[2]) || 2;
const DIR = join(tmpdir(), "eternity-" + Date.now());
mkdirSync(DIR, { recursive: true });

// fixtures
writeFileSync(join(DIR, "real.sh"), "#!/bin/sh\necho ok\n");
try { chmodSync(join(DIR, "real.sh"), 0o755); } catch {}
writeFileSync(join(DIR, "spaced name.sh"), "#!/bin/sh\necho ok\n");
try { chmodSync(join(DIR, "spaced name.sh"), 0o755); } catch {}

const CASES = [
  // — real binaries, plain
  ["node --version", "real binary"],
  ["git --version", "real binary"],
  ["npm --version", "real binary"],
  ["curl --version", "real binary, no URL"],
  // — case (Windows resolution is case-insensitive; so is bash-on-win)
  ["NODE --version", "uppercase name"],
  ["Git --version", "mixed case"],
  // — explicit extension
  ["node.exe --version", "explicit .exe"],
  // — fakes and typos
  ["gti status", "typo of real"],
  ["nodee --version", "typo of real"],
  ["npmm install", "typo of real"],
  ["definitely-fake-xyz --run", "pure fake"],
  ["x", "one-letter fake"],
  ["fake_with_underscores --v", "fake underscores"],
  ["fake.with.dots --v", "fake dotted"],
  ["ünïcode-tool --v", "unicode fake"],
  // — builtins and keywords (launch via the shell itself)
  ["echo hello", "builtin"],
  ["pwd", "builtin"],
  ["cd /tmp", "builtin"],
  ["type node", "builtin querying real"],
  ["true", "builtin"],
  ["false && echo no", "builtin chain"],
  // — prefix words
  ["env node --version", "env prefix"],
  ["time node --version", "time prefix"],
  ["timeout 5 node --version", "timeout + duration"],
  ["FOO=bar node --version", "var assignment prefix"],
  ["FOO=bar BAZ=qux git --version", "double assignment"],
  ["FOO=bar fake-tool-abc", "assignment + fake"],
  // — pipelines, every mix
  ["node --version | git --version", "real | real"],
  ["node --version | fake-pipe-end", "real | fake"],
  ["fake-pipe-start | node --version", "fake | real"],
  ["fake-a-x | fake-b-x", "fake | fake"],
  ["echo hi | node --version | git --version", "3-stage real"],
  // — chains: && || ;
  ["node --version && git --version", "real && real"],
  ["node --version && fake-chain-x", "real && fake"],
  ["fake-chain-y || node --version", "fake || real"],
  ["node --version; fake-semi-z", "real ; fake"],
  // — paths
  ["./real.sh", "relative existing"],
  ["./missing.sh", "relative missing"],
  ["../nonexistent-dir-xyz/tool", "relative missing deep"],
  ['"./spaced name.sh"', "relative existing, spaces+quotes"],
  // — quoting around the command word
  ['"node" --version', "quoted real"],
  ["'git' --version", "single-quoted real"],
  ['"fake-quoted-cmd" --v', "quoted fake"],
  // — flags-heavy and arg soup (only word 1 decides launch)
  ["git log --oneline -5 --graph --decorate", "real, many flags"],
  ["node -e 1+1", "real with inline code"],
  ["fake-argsoup -a -b -c --dee=eff gg hh", "fake, many args"],
  // — near-collisions with the legacy list (the old failure class)
  ["claude --help", "real but never listed"],
  ["gitk --nonexistent-flag", "list-name variant"],
  // — the abstain lane: expansions as the command word. Statically
  //   unknowable without executing; Check fails closed by doctrine.
  //   Graded for STABILITY only (marked policy).
  ["$(echo node) --version", "subshell as command", "policy"],
  ["`echo git` --version", "backtick as command", "policy"],
];

function relay(cmd) {
  const payload = JSON.stringify({
    hook_event_name: "PreToolUse", tool_name: "Bash", cwd: DIR,
    tool_input: { command: cmd },
  });
  const r = spawnSync("node", [HOOK], { input: payload, encoding: "utf8", timeout: 30000 });
  try { return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision === "allow"; }
  catch { return null; }
}

// TRUTH is graded per segment: Check's doctrine is "every command word the
// agent wrote must be real", so `fake || real` is a deny even though bash
// recovers — the fake is still a hallucination. Each segment must launch.
function segments(cmd) {
  const out = [];
  let cur = "", q = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === "|" || ch === "&" || ch === ";" || ch === "\n") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      if ((ch === "|" || ch === "&") && cmd[i + 1] === ch) i++;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function reality(cmd) {
  for (const seg of segments(cmd)) {
    const r = spawnSync("bash", ["-c", seg], { cwd: DIR, timeout: 30000, stdio: "ignore" });
    if (r.error || r.status === null) return null;
    if (r.status === 127 || r.status === 126) return false;
  }
  return true;
}

let truthPass = 0, truthTotal = 0, stablePass = 0, stableTotal = 0;
const failures = [];

for (const [cmd, label, policy] of CASES) {
  const verdicts = [];
  for (let i = 0; i < REPEATS; i++) verdicts.push(relay(cmd));
  const first = verdicts[0];
  const stable = verdicts.every(v => v === first);

  stableTotal++;
  if (stable) stablePass++; else failures.push(["UNSTABLE", cmd, label, verdicts.join(",")]);

  if (policy) {
    console.log((first ? "allow" : "deny").padEnd(7) + "poli ".padEnd(6) +
      (stable ? "YES" : "NO!").padEnd(5) + label.padEnd(34) + cmd);
    continue;
  }

  const launched = reality(cmd);
  if (first === null || launched === null) {
    console.log("ERR    ".padEnd(9) + label.padEnd(34) + cmd);
    continue;
  }
  truthTotal++;
  const match = first === launched;
  if (match) truthPass++; else failures.push(["MISMATCH", cmd, label, `relay=${first} shell=${launched}`]);

  console.log(
    (first ? "allow" : "deny").padEnd(7) +
    (launched ? "ran " : "127 ").padEnd(6) +
    (match && stable ? "YES" : "NO!").padEnd(5) +
    label.padEnd(34) + cmd
  );
}

try { rmSync(DIR, { recursive: true, force: true }); } catch {}

console.log("\nTRUTH    (allow <=> shell ran):    " + truthPass + "/" + truthTotal +
  " = " + (truthTotal ? (truthPass / truthTotal * 100).toFixed(1) : 0) + "%");
console.log("ETERNITY (identical across " + REPEATS + " runs): " + stablePass + "/" + stableTotal +
  " = " + (stableTotal ? (stablePass / stableTotal * 100).toFixed(1) : 0) + "%");
for (const f of failures) console.log("FAIL " + f.join("  "));
process.exit(truthPass === truthTotal && stablePass === stableTotal && truthTotal > 0 ? 0 : 1);
