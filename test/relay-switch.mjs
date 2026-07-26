// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
// THE RELAY SWITCH — the one test that must eternally pass.
//
// The AI cannot argue with the hook, so the entire system compresses to one
// measurable channel: the verdict Check feeds back to the model. This harness
// isolates that channel and grades it against the only judge that matters:
// the shell itself.
//
// For every command:
//   RELAY:   pipe a real PreToolUse payload into the installed hook and read
//            its allow/deny — the full production path (shell probe + API).
//   REALITY: hand the same command to bash and let it run. Exit 127 is the
//            shell's own word for "command not found"; 126 for "found but not
//            executable". Anything else means the shell launched it.
//   AGREE:   allow <=> launched. Any divergence, either direction, is a bug
//            by definition. The bar is 100%, forever, on any machine.
//
// Usage: node relay-switch.mjs [workdir]

import { spawnSync } from "node:child_process";
import { writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

const HOOK = join(homedir(), ".check", "check.mjs");
const CWD = process.argv[2] || tmpdir();

// Fixtures for the relative-path cases: one script that exists, one that never will.
const realScript = join(CWD, "relay-real.sh");
writeFileSync(realScript, "#!/bin/sh\necho relay\n");
try { chmodSync(realScript, 0o755); } catch {}

const CASES = [
  // commands that resolve on any machine with git/node — and this harness runs on node
  "node --version",
  "git --version",
  "npm --version",
  "echo hello",
  "git log -1 --oneline | node --version",
  "./relay-real.sh",
  // commands no machine has
  "gti status",
  "nodee --version",
  "definitely-fake-xyz-tool --run",
  "imaginary-deploy prod --now",
  "./relay-missing.sh",
  "fake-bin-abc | git status",
];

function relay(cmd) {
  const payload = JSON.stringify({
    hook_event_name: "PreToolUse", tool_name: "Bash", cwd: CWD,
    tool_input: { command: cmd },
  });
  const r = spawnSync("node", [HOOK], { input: payload, encoding: "utf8", timeout: 30000 });
  try {
    return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision === "allow";
  } catch { return null; }
}

function reality(cmd) {
  // pipefail so a vanished binary anywhere in a pipeline surfaces as the exit code
  const r = spawnSync("bash", ["-c", "set -o pipefail; " + cmd], {
    cwd: CWD, timeout: 30000, stdio: "ignore",
  });
  if (r.error || r.status === null) return null;
  return r.status !== 127 && r.status !== 126;
}

let agree = 0, total = 0;
console.log("RELAY".padEnd(7) + "SHELL".padEnd(7) + "MATCH".padEnd(7) + "COMMAND");
for (const cmd of CASES) {
  const allowed = relay(cmd);
  const launched = reality(cmd);
  if (allowed === null || launched === null) {
    console.log("ERR".padEnd(7) + "ERR".padEnd(7) + "-".padEnd(7) + cmd);
    continue;
  }
  total++;
  const match = allowed === launched;
  if (match) agree++;
  console.log(
    (allowed ? "allow" : "deny").padEnd(7) +
    (launched ? "ran" : "notfnd").padEnd(7) +
    (match ? "YES" : "NO !!").padEnd(7) + cmd
  );
}

try { rmSync(realScript); } catch {}

const pct = total ? ((agree / total) * 100).toFixed(1) : "0";
console.log("\nAgreement: " + agree + "/" + total + " = " + pct + "%");
process.exit(agree === total && total > 0 ? 0 : 1);
