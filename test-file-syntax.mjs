// Copyright © 2026 GOL Productions. All rights reserved.
//
// File syntax preflight, tested through the REAL hook the way an agent calls
// it: a PreToolUse payload on stdin, a JSON verdict on stdout.
//
// Run:  node test-file-syntax.mjs

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const HOOK = new URL('./src/index.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TMP = mkdtempSync(join(tmpdir(), 'check-syntax-'));

let pass = 0, fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`* FAIL  ${name}${detail ? '\n         ' + detail : ''}`); }
};

function hook(payload) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, GOL_CLIENT_ID: process.env.GOL_CLIENT_ID || 'test-key-not-used-for-writes' },
  });
  let out = null;
  try { out = JSON.parse((r.stdout || '').trim().split('\n').filter(Boolean).pop()); } catch {}
  const decision = out?.hookSpecificOutput?.permissionDecision
    || out?.permission || out?.decision || null;
  return { decision, reason: out?.hookSpecificOutput?.permissionDecisionReason || out?.reason || '', raw: r.stdout, status: r.status };
}

const write = (file, content) => ({
  hook_event_name: 'PreToolUse', tool_name: 'Write',
  tool_input: { file_path: join(TMP, file), content },
});

console.log('\n=== BROKEN WRITES MUST BE DENIED ===');
let r = hook(write('broken.js', 'function f( { return 1 }'));
console.log(`   ${r.decision}  ${r.reason.slice(0, 92)}`);
t('broken .js denied', r.decision === 'deny');
t('and carries the parser message', /unparseable/.test(r.reason));

r = hook(write('broken.json', '{ "a": 1, }'));
console.log(`   ${r.decision}  ${r.reason.slice(0, 92)}`);
t('broken .json denied', r.decision === 'deny');

r = hook(write('broken.mjs', 'import x from "y"\nfunction f( {'));
t('broken .mjs denied', r.decision === 'deny');

r = hook(write('broken.sh', 'if [ -f x ]; then\n  echo hi\n'));
t('broken .sh denied', r.decision === 'deny', `got ${r.decision}`);

console.log('\n=== VALID WRITES MUST PASS ===');
t('valid .js', hook(write('ok.js', 'function f() { return 1; }\nmodule.exports = f;')).decision === 'allow');
t('valid .json', hook(write('ok.json', '{"a":1,"b":[2,3]}')).decision === 'allow');
t('valid .mjs with import', hook(write('ok.mjs', 'import { join } from "node:path";\nexport const x = join("a","b");')).decision === 'allow');
t('valid .mjs top-level await', hook(write('ok2.mjs', 'const r = await Promise.resolve(1);\nexport default r;')).decision === 'allow');
t('valid .sh', hook(write('ok.sh', 'if [ -f x ]; then\n  echo hi\nfi\n')).decision === 'allow');

console.log('\n=== NO AUTHORITY: MUST ABSTAIN, NEVER DENY ===');
t('.ts not claimed', hook(write('x.ts', 'const a: number = ;')).decision === 'allow');
t('.yaml not claimed', hook(write('x.yaml', 'a: [1,2\n')).decision === 'allow');
t('.html not claimed', hook(write('x.html', '<div><span></div>')).decision === 'allow');
t('.md not claimed', hook(write('x.md', '# hi\n```\nunclosed')).decision === 'allow');
t('no extension not claimed', hook(write('Makefile', 'all:\n\techo hi')).decision === 'allow');

console.log('\n=== EDIT: judges the RESULT, not the fragment ===');
const target = join(TMP, 'edit-me.js');
writeFileSync(target, 'function greet() {\n  return "hi";\n}\n');

const edit = (oldS, newS) => ({
  hook_event_name: 'PreToolUse', tool_name: 'Edit',
  tool_input: { file_path: target, old_string: oldS, new_string: newS },
});

r = hook(edit('return "hi";', 'return "hi"'));
t('an edit that leaves valid code passes', r.decision === 'allow', `got ${r.decision}`);

r = hook(edit('function greet() {', 'function greet( {'));
console.log(`   ${r.decision}  ${r.reason.slice(0, 92)}`);
t('an edit that BREAKS the file is denied', r.decision === 'deny');

r = hook(edit('this string is not in the file', 'x'));
t('an unmatchable edit abstains', r.decision === 'allow');

console.log('\n=== THE WRITE PATH MAKES NO NETWORK CALL ===');
const t0 = Date.now();
hook(write('speed.js', 'const x = 1;'));
const ms = Date.now() - t0;
console.log(`   round trip including node startup: ${ms}ms`);
t('fast enough to be a parser call, not a fetch', ms < 3000, `${ms}ms`);

rmSync(TMP, { recursive: true, force: true });
console.log(`\n===== ${pass} passed, ${fail} failed =====\n`);
process.exitCode = fail ? 1 : 0;
