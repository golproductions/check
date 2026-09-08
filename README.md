# Check

Every command it writes, you read first. You have to, because the ones it makes up look exactly like the ones that work.

Stop reading. Check validates every shell command against your actual machine before it runs. What exists passes through. What doesn't gets blocked. Deterministic, one round trip to the nearest Cloudflare edge, no AI inside.

```
npx @golproductions/check@latest --install
```

Installing mints a free key bound to your machine. No signup, 120 free checks per day, then $0.0068 AUD each from a prepaid balance. A check is one request: either a message you submit (scanned and annotated with verified environment facts before your AI sees it) or a command your AI writes (validated against your real machine before it runs). Both bill equally. Local syntax errors are caught before any network call and are always free. Need more? Get a paid GOL API Key at [the console](https://www.golproductions.com/console.html).

---

## How it works

`--install` wires Check into **Claude Code** as two hooks:

1. **Command gate.** Every shell command is intercepted before it runs, checked against your live machine, and either passed or blocked.
2. **Preflight snapshot.** Fires before every prompt you submit. It reads your actual environment (running ports, local data files, recent activity) and injects a verified snapshot into Claude's context before it reasons. Claude sees what is true on your machine, not what it assumes.

```
echo '{"tool_input":{"command":"some command"}}' | node ~/.check/check-hook.mjs
```

### CLI

For scripts, CI, git hooks, anything with a shell.

```
check "netlify-cli deploy --prod"        # invalid   (exit 1)
check "netlify deploy --prod"            # runnable  (exit 0)
echo "some command" | check              # pipe mode
```

Exit codes make it composable: gate a CI step, a git pre-push hook, a Docker entrypoint.

### HTTP

For everything else, in any language.

```
POST https://triage.golproductions.com/preflight
Header: X-GOL-CLIENT-ID: your_key
Body:   {"command": "the command to validate"}

{"verdict": "runnable" | "invalid", "reason": "...", "daily_remaining": 119}
```

That is the whole contract. Rate limit 60/min.

---

## Your commands always run

Only server-side verification is paid. Nothing about billing ever blocks execution, only the deeper check that verifies it first.

Free tier exhausted, balance empty, bad key, rate limited, the server itself is down: every one of these is a billing or infrastructure state, never a verdict on your command. When any of them happens, Check tells you plainly what is off, that local syntax checking is still running for free, and how to fix it. Verification resumes the instant your balance lands. No reinstall.

---

## Keys

| Tier | What | Where |
|------|------|-------|
| **GOL Client ID** (free) | Minted on install, bound to the machine, shared by every tool on it. 120 checks/day, forever. | `~/.check/key` |
| **GOL API Key** (paid) | Prepaid balance ($0.0068 AUD/check after the daily 120), spend caps, dashboard, 2FA. | [Console](https://www.golproductions.com/console.html) |

Same header, same API. The tier is just what the key can do. Credits you buy never expire.

### Getting your key back out

The full key prints once, at `--install`. After that, every surface shows it masked, because it is a credential and an AI agent reads everything a hook prints back.

To retrieve it safely:

```
npx @golproductions/check@latest --print
```

Run this yourself, in a real terminal. The first time, it asks you to set a password (never written to disk, never told to any agent) and saves your key encrypted to a file on your Desktop. Every time after, it asks for that password before showing the key. An AI agent can trigger the prompt, but it was never told the password and has nothing to type into it. Only you, typing it yourself, ever see the plaintext.

Paste it into "Connect key" at [the console](https://www.golproductions.com/console.html) while signed in to permanently link it to your account. Then delete the encrypted file.

## Manage

```
npx @golproductions/check@latest --status      # key + installation status
npx @golproductions/check@latest --credits     # balance and free checks remaining
npx @golproductions/check@latest --print       # get your key back, password-gated
npx @golproductions/check@latest --uninstall   # remove hooks
```

## Terms

By installing or using Check you agree to the [Terms of Service](https://golproductions.com/terms) and [Privacy Policy](https://golproductions.com/privacy). The service is provided as is; see the Terms for the full picture, including your Australian Consumer Law rights.

[Product](https://golproductions.com/check) · [Pricing](https://golproductions.com/pricing) · [Console](https://www.golproductions.com/console.html) · [Updates](https://www.golproductions.com/updates.html)

## License

Copyright (c) 2026 GOL Productions. All rights reserved.
