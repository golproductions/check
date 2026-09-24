# Check

An anti-hallucination layer for Claude Code. Before your AI runs a command or writes a file, your own machine checks it. What your machine proves missing is blocked, and the AI is shown your machine's own answer, so its next attempt is a fix instead of another guess.

```
npx @golproductions/check@latest --install
```

Installing creates a free key on your machine. No signup. 120 free checks a day, then $0.0068 AUD each from a prepaid balance. A check is one command validated against your machine. Your messages are not read or billed. Syntax errors and file writes are checked on your machine, with no network call, and are always free.

Windows, Node 18 or newer, Claude Code.

---

## What it checks

Check adds one hook to Claude Code: **PreToolUse**, on Bash, PowerShell, Write, Edit and NotebookEdit. Nothing is added to the AI's context before it reasons, and nothing is written to your project.

**Commands.** Your own bash reads the command without running any of it and names every program it would call (PowerShell commands are read by PowerShell's own parser). Then:

| Question | Who answers |
|---|---|
| Does this program exist? | your shell (`type`) |
| Does this `./script` exist? | your file system |
| Is this git subcommand, branch, tag, commit or tracked file real? | your git |
| Does this npm, PyPI or crates.io package exist? | the package registry |
| Does the command parse? | your shell's parser, locally |

A block looks like this:

```
check: bash on this machine said: type: jq: not found
check: npm package 'left-padd' does not exist on the npm registry. Use a real package name.
```

**File writes.** Shell, Python and PowerShell files are parsed on your machine before they are written; a file that would not parse is blocked. JSON and JavaScript files are not checked yet.

## Where Check stays silent

Where your machine can't give a definite answer, Check lets the action through rather than guess:

- commands inside `$(...)`, `eval` or `bash -c`
- git and `./script` checks after a command changes folder (`cd`, `pushd`, `git -C`)
- everything after `PATH=`, `source` or `.` in the same command
- missing programs in PowerShell commands
- the rest of a line after `wget` or `http`

It also cannot know intent: a real command that does the wrong thing passes. Check is not a security tool.

## Fails open

Server unreachable, rate limited, balance empty, key rejected: the command runs, with a warning at most once a day. Check never blocks because Check itself failed, and your balance never blocks your agent.

## What leaves your machine

Per command: the command text with credential patterns redacted (API keys, tokens, JWTs, private keys, Bearer tokens, emails, card-like numbers; a secret in a PowerShell `$env:` assignment is sent as written), the working folder with your username masked, and your machine's answers. File contents never leave. Command text is not written to storage for customer keys; what is kept is usage counters and a billing record (time, cost, pass or block). Details: [privacy policy](https://golproductions.com/privacy).

## Pricing

120 free checks a day, capped per key, per device and per network. Then $0.0068 AUD per check from a prepaid balance: any whole amount from $5 to $500 AUD at [the console](https://golproductions.com/console). One check per command, however many round trips it takes. No subscription, nothing auto-recharges, credits don't expire.

## Keys

| Tier | What | Where |
|------|------|-------|
| **GOL Client ID** (free) | Created on install, bound to the machine. 120 checks a day. | `~/.check/key` |
| **GOL API Key** (paid) | Prepaid balance ($0.0068 AUD a check after the daily 120), spend caps, dashboard, 2FA. | [Console](https://golproductions.com/console) |

### Getting your key back out

The full key prints once, at `--install`. After that, every surface shows it masked, because it is a credential and an AI agent reads everything a hook prints back.

```
npx @golproductions/check@latest --print
```

Run this yourself, in a real terminal. The first time, it asks you to set a password (never written to disk, never told to any agent) and saves your key encrypted to a file on your Desktop. Every time after, it asks for that password before showing the key. Paste it into "Connect key" at [the console](https://golproductions.com/console) while signed in to link it to your account, then delete the encrypted file.

## Manage

```
npx @golproductions/check@latest --status      # key + installation status
npx @golproductions/check@latest --credits     # balance and free checks remaining
npx @golproductions/check@latest --print       # get your key back, password-gated
npx @golproductions/check@latest --uninstall   # remove hooks
```

Check does not update itself. Run the install command again to get the latest version. Upgrading from an earlier version also removes the retired prompt hook.

## Terms

By installing or using Check you agree to the [Terms of Service](https://golproductions.com/terms) and [Privacy Policy](https://golproductions.com/privacy). The service is provided as is; see the Terms for the full picture, including your Australian Consumer Law rights.

[Product](https://golproductions.com/check) · [How it works](https://golproductions.com/what-check-does) · [Pricing](https://golproductions.com/pricing) · [Console](https://golproductions.com/console)

## License

Copyright (c) 2026 GOL Productions. All rights reserved.
