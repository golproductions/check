# Check

**The anti-hallucination layer.** Check stops hallucinated commands, packages, and URLs before they run in your project. What isn't real gets blocked, what is real passes through. Deterministic, one round trip to the nearest Cloudflare edge, no AI inside.

```
npx @golproductions/check@latest --install       # Windows, macOS, Linux
```

Installing mints a free key bound to your machine. No signup, 120 free checks per day, then $0.0068 AUD each from a prepaid balance. **A check is one verdict** — validating a command before it runs, or answering one `/pipe` message — both bill identically. Asking your shell what actually exists on your machine is a free step inside that; only the final answer counts as a check. Local syntax errors (`bash -n`, PowerShell's own parser) are caught before any network call and are always free, balance or no balance. Need more? Get a paid GOL API Key at [the console](https://www.golproductions.com/console.html).

---

## Integrate it into anything

Check is one primitive with three faces. Pick the one your environment speaks.

### 1. Hook mode: blocks bad commands before they run

`--install` wires Check as a preflight hook for **Claude Code**. Every command is intercepted before it runs, checked against your live machine, and either passed or blocked.

```
echo '{"tool_input":{"command":"some command"}}' | node ~/.check/check.mjs
→ {"hookSpecificOutput":{"permissionDecision":"allow"}}          # runnable
→ {"hookSpecificOutput":{"permissionDecision":"deny", ...}}      # hallucinated
```

**Preflight gate.** `--install` also wires a hook that fires before every prompt you submit. It reads your actual environment — running ports, local data files, recent activity — and injects a verified snapshot into Claude's context before it reasons. Claude sees what is true on your machine, not what it assumes.

### 2. CLI: for scripts, CI, git hooks, anything with a shell

```
check "netlify-cli deploy --prod"        # → invalid   (exit 1)
check "netlify deploy --prod"            # → runnable  (exit 0)
echo "some command" | check              # pipe mode
```

Exit codes make it composable: gate a CI step, a git pre-push hook, a Docker entrypoint, a cron job.

### 3. HTTP: for everything else, in any language

```
POST https://triage.golproductions.com/preflight
Header: X-GOL-CLIENT-ID: your_key
Body:   {"command": "the command to validate"}

→ {"verdict": "runnable" | "invalid", "reason": "...", "daily_remaining": 119}
```

That is the whole contract. Rate limit 60/min. A `402` means the free tier is spent and the balance is empty. Treat it as allow-with-warning, never as a verdict.

---

## Fail open, always

Only server-side verification is paid. **Your commands always run** — nothing about billing ever blocks execution, only the deeper check that verifies it first.

Free tier exhausted, balance empty, bad key, rate limited, the server itself is down: every one of these is a billing or infrastructure state, never a verdict on your command. When any of them happens, Check tells you plainly what's off, that local syntax checking is still running for free, how to fix it, and that fixing it needs no reinstall — verification resumes the instant your balance lands.

## Keys

| Tier | What | Where |
|------|------|-------|
| **GOL Client ID** (free) | Minted automatically on install, bound to the machine, shared by every tool on it. 120 checks/day, forever. | `~/.check/key` (plaintext — read automatically by every hook, on every command, with no prompt) |
| **GOL API Key** (paid) | Prepaid balance ($0.0068 AUD/check after the daily 120), spend caps, dashboard, 2FA. | [Console](https://www.golproductions.com/console.html) |

Same header, same API. The tier is just what the key can do.

Credits you buy never expire — the only way they run out is by being spent.

## Getting your key back out

The full key prints once, at `--install`. After that, every other surface — `--status`, error messages, the MCP tools — only ever shows it masked, because it's a credential and an AI agent reads everything a hook or tool call prints back.

To retrieve it safely:

```
npx @golproductions/check@latest --print
```

Run this yourself, in a real terminal — not as something you ask an AI to run for you. The first time, it asks you to set a password (never written to disk, never told to any agent) and saves your key encrypted to a file on your Desktop. Every time after, it asks for that password before showing the key in plain text. An AI agent can trigger the prompt, same as you can, but it was never told the password and has nothing to type into it — only you, typing it yourself, ever sees the plaintext.

Once it's revealed: paste it into "Connect key" at [the console](https://www.golproductions.com/console.html) while you're signed in — that permanently links the key to your account, not just to that file — then delete the encrypted file. It's done its job.

## Manage

```
npx @golproductions/check@latest --status      # your key + where Check is installed
npx @golproductions/check@latest --credits     # balance and free checks remaining
npx @golproductions/check@latest --print       # get your key back, password-gated (run this yourself)
npx @golproductions/check@latest --uninstall   # remove from every tool
```

## Terms

By installing or using Check you agree to the [Terms of Service](https://golproductions.com/terms) and [Privacy Policy](https://golproductions.com/privacy). The service is provided as is; see the Terms for the full picture, including your Australian Consumer Law rights.

[Product](https://golproductions.com/check) · [Pricing](https://golproductions.com/pricing) · [Console](https://www.golproductions.com/console.html) · [Updates](https://www.golproductions.com/updates.html)

## License

Copyright (c) 2026 GOL Productions. All rights reserved.
