#!/usr/bin/env node
// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.
// BUILD FOR PUBLISH. The readable source in src/ never ships.
// dist/: terser (compress + mangle), then javascript-obfuscator (string arrays,
// RC4, self-defending). Two-pass: the moat is the backend; obfuscation is
// the tax on copiers.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// Both passes strip comments, so the notice in src/ never reaches the published
// file. It is re-attached below, after obfuscation, or the only artefact anyone
// outside this machine ever receives would carry no claim of ownership at all.
const NOTICE = "// Copyright (c) 2026 GOL Productions. All rights reserved. Proprietary and confidential.";

mkdirSync("dist", { recursive: true });

for (const f of ["index.js", "mcp.js"]) {
  // Pass 1: Terser — compress + mangle
  execSync(
    `npx --yes terser@5 src/${f} --module --compress passes=2 --mangle toplevel=true --format comments=false --output dist/${f}`,
    { stdio: "inherit" }
  );

  // Pass 2: javascript-obfuscator — string arrays, RC4, self-defending
  // Strip shebang before obfuscating (obfuscator corrupts it), re-attach after.
  const raw = readFileSync(`dist/${f}`, "utf8");
  const hasShebang = raw.startsWith("#!");
  const body = hasShebang ? raw.slice(raw.indexOf("\n") + 1) : raw;
  writeFileSync(`dist/${f}`, body, "utf8");

  execSync(
    `npx --yes javascript-obfuscator dist/${f} --output dist/${f} ` +
    `--compact true --self-defending true --string-array true ` +
    `--string-array-encoding rc4 --string-array-threshold 0.75 ` +
    `--identifier-names-generator mangled --rename-globals false ` +
    `--transform-object-keys true --dead-code-injection false`,
    { stdio: "inherit" }
  );

  // Shebang first so the file stays executable, notice immediately under it.
  const obfuscated = readFileSync(`dist/${f}`, "utf8");
  const shebang = hasShebang && !obfuscated.startsWith("#!") ? "#!/usr/bin/env node\n" : "";
  writeFileSync(`dist/${f}`, shebang + NOTICE + "\n" + obfuscated, "utf8");

  console.log(`built dist/${f} (${readFileSync(`dist/${f}`).length} bytes)`);
}

// Prove it, rather than assume the string survived. A build that silently drops
// the notice is worse than one that fails, because nobody looks at dist/.
for (const f of ["index.js", "mcp.js"]) {
  const head = readFileSync(`dist/${f}`, "utf8").slice(0, 400);
  if (!head.includes("GOL Productions")) {
    console.error(`build failed: dist/${f} carries no copyright notice`);
    process.exit(1);
  }
}
console.log("copyright notice present in both dist files");
console.log("verify next: node --check dist/index.js");
