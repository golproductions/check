# Check

**The anti-hallucination layer.** Check stops hallucinated commands and packages before they run in your project. A binary that isn't on your machine, an npm package that isn't on the registry: blocked. What is real passes through. Deterministic, one round trip to the nearest Cloudflare edge, no AI inside.

```
npx @golproductions/check@latest --install       # Windows only for now
```

Mac and Linux builds exist in source but are unverified against the hardware they run on, so the installer refuses to proceed on those platforms. `package.json` declares `os: ["win32"]`, so `npm install` also refuses. If you want to help verify a Mac or Linux build, email support.

Installing mints a free key bound to your machine. No signup, 120 free checks per day, then $0.0068 AUD each from a prepaid balance. **A check is one verdict** - one command validated before it runs, or one prompt run through the preflight pipe. Both bill identically. Asking your shell what actually exists on your machine is a free step inside that; only the final answer counts as a check. Local syntax errors (`bash -n`, PowerShell's own parser) are caught before any network call and are always free, balance or no balance. Need more? Get a paid GOL API Key at [the console](https://www.golproductions.com/console.html).

---

## What `--install` wires

Check installs into **Claude Code**. That is the only tool it supports. It writes two hooks into `~/.claude/settings.json` and nothing into your project - no `CLAUDE.md`, no `AGENTS.md`, nothing `git status` would ever see.

### The gate: blocks bad commands before they run

A `PreToolUse` hook. Every command Claude tries to run is intercepted first, checked against your live machine, and either passed or blocked.

```
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git status"}}' | node ~/.check/check.mjs
→ {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}

echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"frobnicate --all"}}' | node ~/.check/check.mjs
→ {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
   "permissionDecisionReason":"check: 'frobnicate' is not on PATH on this machine. Install it, or resolve the binary."}}
```

When it denies, the reason is a single sentence in Check's voice, grounded in the machine's own answer (PATH lookup, `bash -n`, the PowerShell parser, `git`, or the package registry). No probe artifacts, no shell stderr echoed unchanged. One instruction the agent can act on. Install commands are resolved against the registry rather than the shell, so an invented package is caught the same way:

```
npm install express                     → allow
npm install @scope/not-a-real-package   → deny: "check: npm package '@scope/not-a-real-package'
                                                 does not exist on the npm registry.
                                                 Use a real package name."
```

### The preflight: grounds the model before it reasons

A `UserPromptSubmit` hook. It fires before every prompt you submit and injects two things into Claude's context:

- **A live environment scan** - running ports, local data files, recent activity, read from your machine at that moment. Measurements, not recollections; they override whatever the model already believed.
- **A standing rule** - the anti-fabrication instruction, delivered fresh each prompt. It is never written to a file, so nothing can drift out of sync with it and nothing lingers after `--uninstall`.

This is the `/pipe` call in the pricing above: one prompt submitted, one check billed.

## The HTTP API

For anything that is not Claude Code. Nothing on npm wires this for you - it is the raw contract, for building your own integration.

The server never guesses what is installed on your machine, so the gate is a **two-step exchange**: the server names the words it cannot resolve, your client asks its own shell about exactly those words, and the server rules on the answer. Declare that your client can do this with `probe_ok`.

```
POST https://triage.golproductions.com/preflight
Header: X-GOL-CLIENT-ID: your_key

1. Body: {"command": "git status", "probe_ok": 1}
   → {"verdict": "probe", "probe": ["git"]}

2. Ask your shell about each named key, then call again with the answers.
   Body: {"command": "git status", "probe": {"git": true}}
   → {"verdict": "runnable", "grounded": true, "daily_remaining": 119, ...}

   Body: {"command": "frobnicate --all", "probe": {"frobnicate": false},
          "probe_why": {"frobnicate": "bash: frobnicate: command not found"}}
   → {"verdict": "invalid", "grounded": true,
      "reason": "check: 'frobnicate' is not on PATH on this machine.
                 Install it, or resolve the binary."}
```

Notes that will cost you an afternoon if you skip them:

- **`probe` values must be real booleans.** `true`/`false`, not `1`/`0`. Anything else is read as no answer, and the word falls through to being unresolvable.
- **`probe_why` no longer rides through to the reason.** The server used to compose the denial around the client's stderr; the current build composes one sentence from the word alone, in Check's voice. `probe_why` is still useful for analytics but is not part of the agent-facing text any more.
- **A `probe` round is free.** Only the call that returns a verdict bills, so one command validated is one check no matter how many words had to be resolved.
- **Skip the protocol entirely and the verdict abstains, it does not deny.** A bare `{"command": "git status"}` returns `{"verdict": "runnable", "grounded": false}`, not `invalid`. Nothing was in a position to say `git` was missing, so Check has no fact to deny on. This is the fail-open posture everywhere: only a measurement may deny.
- **`grounded: true` means a machine was actually asked.** Absent or false means the verdict rests on something weaker.

Rate limit 60/min. A `402` means the free tier is spent and the balance is empty. Treat it as allow-with-warning, never as a verdict.

---

## Fail open, always

Only server-side verification is paid. **Your commands always run** - nothing about billing ever blocks execution, only the deeper check that verifies it first.

Free tier exhausted, balance empty, bad key, rate limited, the server itself is down: every one of these is a billing or infrastructure state, never a verdict on your command. When any of them happens, Check tells you plainly what's off, that local syntax checking is still running for free, how to fix it, and that fixing it needs no reinstall - verification resumes the instant your balance lands.

## Your key

One key per install. It lives at `~/.check/key` (plaintext, read automatically by every hook on every command with no prompt) and it is the same key whether you have topped it up or not. 120 free checks a day come with any key. Past that, if the key has been linked to an account and has a balance, the balance kicks in at $0.0068 AUD per check. If there is no balance, Check falls open: local syntax checking still runs for free, the command runs, and verification resumes the moment a balance lands.

Credits never expire. The only way they run out is by being spent.

## Getting your key out, to link it

The full key prints once, at `--install`. After that, every other surface (`--status`, error messages) only ever shows it masked, because it is a credential and an AI agent reads everything a hook or command prints back.

To retrieve it safely:

```
npx @golproductions/check@latest --print
```

Run this yourself, in a real terminal, not as something you ask an AI to run for you. The first time, it asks you to set a password (never written to disk, never told to any agent) and saves your key encrypted to a file on your Desktop. Every time after, it asks for that password before showing the key in plain text. An AI agent can trigger the prompt the same way you can, but it was never told the password and has nothing to type into it. Only you, typing it yourself, ever sees the plaintext.

Once it is revealed, paste it into the [console](https://www.golproductions.com/console.html) while you are signed in. That permanently links the key to your account so a top-up can land on it. Then delete the encrypted file. It has done its job.

## Manage

```
npx @golproductions/check@latest --status      # your key + where Check is installed
npx @golproductions/check@latest --credits     # balance and free checks remaining
npx @golproductions/check@latest --print       # get your key back, password-gated (run this yourself)
npx @golproductions/check@latest --uninstall   # unwire the hooks and remove ~/.check
```

## Terms

By installing or using Check you agree to the [Terms of Service](https://golproductions.com/terms) and [Privacy Policy](https://golproductions.com/privacy). The service is provided as is; see the Terms for the full picture, including your Australian Consumer Law rights.

[Product](https://golproductions.com/check) · [Pricing](https://golproductions.com/pricing) · [Console](https://www.golproductions.com/console.html) · [Updates](https://www.golproductions.com/updates.html)

## License

Copyright (c) 2026 GOL Productions. All rights reserved.
