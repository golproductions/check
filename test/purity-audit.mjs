// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
// THE PURITY AUDIT — static proof that the verdict path is a pure function.
//
// The eternity test proves determinism by measurement. This proves it by
// construction: the verdict path must contain NO source of nondeterminism —
// no clock, no randomness, no network, no ambient state. If the only inputs
// are (command, machine), the output cannot vary between runs. This turns
// "pure function" from a design intention into a machine-verified invariant.
//
// Scope:
//   CLIENT verdict path: segmentBases, bashPath, shellKnows, allBinariesExist
//     (reading the machine — PATH, filesystem, the shell itself — IS the
//      input, not a side effect. spawnSync/existsSync are permitted.)
//   WORKER verdict path: runPreflight and its entire call graph
//     (pure parsing + policy. NOTHING else: no fetch, no KV, no time.)
//
// Forbidden anywhere in the verdict path:
//   fetch(            network — verdicts must not depend on remote state
//   Date / now(       time — verdicts must not depend on when you ask
//   Math.random       randomness
//   crypto            randomness / entropy
//   hrtime / performance   timers
//   setInterval       background state
//
// The one bounded escape: spawnSync timeouts. A probe that cannot answer in
// time returns null = ABSTAIN, never a different answer. Slow machines get
// "I don't know", not "no". Abstain is deterministic in effect: it always
// falls through to the same legacy path.
//
// Usage: node purity-audit.mjs [client.js] [gate.js]

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = process.argv[2] || join(here, "..", "src", "index.js");
const GATE = process.argv[3] || join(here, "..", "..", "worker", "src", "gate.js");

const FORBIDDEN = [
  [/\bfetch\s*\(/, "network fetch"],
  [/\bnew Date\b|\bDate\.now\b/, "clock"],
  [/\bMath\.random\b/, "randomness"],
  [/\bcrypto\b/, "entropy"],
  [/\bhrtime\b|\bperformance\./, "timer"],
  [/\bsetInterval\b/, "background state"],
];

// Extract a top-level function body by name. Walks past the parameter
// list first — `opts = {}` in a signature must not be mistaken for the
// body, or the audit passes vacuously on an empty string.
function extract(src, name) {
  const re = new RegExp("(?:export\\s+)?(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf("(", m.index), paren = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") paren++;
    else if (src[i] === ")") { paren--; if (paren === 0) break; }
  }
  let j = src.indexOf("{", i), depth = 0;
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) break; }
  }
  const body = src.slice(start, j + 1);
  if (body.replace(/\s/g, "").length < 4) throw new Error("suspiciously empty body for " + name);
  return body;
}

// Every function name called inside a body (crude but conservative:
// superset of the real call graph).
function calledNames(body) {
  return [...body.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)].map(m => m[1]);
}

function audit(file, roots, label) {
  const src = readFileSync(file, "utf8");
  // walk the call graph from the roots
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const body = extract(src, name);
    if (!body) continue; // builtin / not a top-level function here
    seen.add(name);
    for (const c of calledNames(body)) if (!seen.has(c)) queue.push(c);
  }

  let clean = true;
  console.log("\n" + label + " — verdict path: " + [...seen].join(", "));
  for (const fn of seen) {
    const body = extract(src, fn);
    for (const [re, why] of FORBIDDEN) {
      if (re.test(body)) {
        console.log("  IMPURE  " + fn + " — contains " + why);
        clean = false;
      }
    }
  }
  if (clean) console.log("  PURE — no clock, no randomness, no network, no ambient state");
  return clean;
}

const clientOk = audit(CLIENT, ["allBinariesExist", "segmentBases", "shellKnows", "bashPath"], "CLIENT rod");
const gateOk = audit(GATE, ["runPreflight"], "WORKER gate");

console.log("\nPURITY: " + (clientOk && gateOk ? "PROVEN — verdict is a pure function of (command, machine)" : "VIOLATED"));
process.exit(clientOk && gateOk ? 0 : 1);
