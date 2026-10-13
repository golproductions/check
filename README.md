# Check

Welcome to GOL Productions, the modern SaaS company that builds what we call deterministic gates: checks where the answer comes from your own machine, never from a guess. Check is our gate for AI coding agents.

**1. Get your key** at [the console](https://golproductions.com/console): sign in, press *Enable authenticator* and scan the QR code with an authenticator app, then press *Create GOL API Key*. 14 days free.

**2. No Node.js?** Install Node.js 18 or newer from [nodejs.org](https://nodejs.org) (free).

**3. Run one line in a terminal, yourself, not through your AI**, and paste your key when it asks:

```
npx @golproductions/check@latest --install
```

It asks for your key (masked), lists the AI agents it found, and adds Check to them when you press Enter.

**4. Restart your AI agent.**

Windows or Linux; macOS isn't supported yet. The installer never makes keys and never prints yours. Run by an AI with no key on the machine, it installs nothing and tells you to run it yourself.

The [install guide](https://golproductions.com/guide) covers making it work in each agent, what to expect, and how to know it's working.

## What does Check do?

Before your AI agent runs a command or writes a file, Check asks your own machine whether it will work. Does the program exist? Is the package real? Will the file still parse? If your machine proves it won't, Check blocks it and shows the AI your machine's answer, so its next attempt is a fix instead of another guess.

At the end of every reply you get a one-line receipt:

```
Check: 7 actions checked, 1 blocked (pkill: not found)
```

## Why?

AI agents guess. They call programs that aren't installed, install packages that don't exist, use git branches that were never made, and write code that won't parse. Each guess costs a failed run, a turn spent reading the error, and another guess, and some mistakes stay hidden until the file is run later.

Your machine already knows the answers. Check asks it first.

## Examples

Three real blocks from the last two days, on a Windows machine running Git Bash.

**A Linux tool, with its error hidden.** Stopping a dev server, Claude reached for `pkill`, which Git Bash doesn't have, and sent its errors to `/dev/null`, so the failure would never have shown.

```
taskkill //F //IM workerd.exe >/dev/null 2>&1; pkill -f "wrangler dev --remote --port 8799" 2>/dev/null; ...
check: bash on this machine said: type: pkill: not found
```

**An empty answer that would have read as "none".** In a site check, Claude asked `dig` for DNSSEC records and labelled empty output as "none". With no `dig` installed, the output is always empty, so the site would have been reported as having no DNSSEC, whatever the truth.

```
dig +short DS golproductions.com @1.1.1.1; echo "DS ^ (empty = none)"
check: bash on this machine said: type: dig: not found
```

**Code that Git Bash would break.** On Windows, Git Bash halves the backslashes in code passed to `node -e` before node sees it. The regex Claude wrote was valid; the one that would have arrived was not.

```
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");const m=s.match(/\\n\s*#[^\\]*/g)...'
check: Git Bash will break the code passed to node -e before it runs: it turns \\ into \ on its command line,
and the code that arrives does not parse (node said: Invalid regular expression: missing /).
Put the code in a file with the Write tool and run the file.
```

Each time, the AI read the answer and fixed it on the next try: it dropped `pkill` and kept `taskkill`, dropped the `dig` line, and moved the code into a script file.

---

## What it checks

| Question | Who answers |
|---|---|
| Does this program exist? | your shell (`type`) |
| Does this `./script` exist? | your file system |
| Is this git subcommand, branch, tag, commit or tracked file real? | your git |
| Does this package exist (npm, PyPI, crates.io, RubyGems, Packagist, NuGet, Homebrew, Chocolatey, PowerShell Gallery)? Does the version asked for? | the package registry |
| Does the module `python -m` would run exist? | your Python, from the folder the command runs in |
| Is the package a download-and-run tool would fetch real (`npx`, `pnpm dlx`, `yarn dlx`, `bunx`, `uvx`, `pipx run`)? | your machine (is it installed here?), then the npm registry or PyPI |
| Is the Docker image or tag that `docker pull`, `run` or `create` would fetch real? | your Docker (is it here?), then Docker Hub |
| Does the folder `cd` goes to, the script `node`, `python` or `bash` would run, or the `npm`, `pnpm` or `yarn run` script exist? Does the `git push` remote? | your file system, `package.json`, your git |
| Does the command parse? | your shell's own parser |
| Does the code passed to `node -e` or `python -c`, or fed to `node` or `python -` through a heredoc, parse as it will arrive? | node and python, including after Git Bash halves its backslashes |
| Will this file still parse after the write, whether written by Write, Edit, a heredoc, `echo` or `printf`? | `bash -n`, Python, PowerShell, `node --check`, and the JSON parser npm uses for `package.json` |
| Does a package a JavaScript or TypeScript write starts importing exist? | your project (installed or declared?), then the npm registry |
| Does a TypeScript write use a function, method, export or option a library actually has? | your project's own TypeScript (5 or 6), against the library's own type definitions; new errors in the edit only, capped at 2.5 s |

Commands are read by your own bash (PowerShell commands by PowerShell's parser) without running any of them. Bash also reads both sides of `||` and `else`, the commands inside `$(...)` and backticks, and the code given to `bash -c` or `sh -c`. JavaScript writes: `.mjs` and `.cjs` files are always checked. A `.js` file that parsed before the edit is blocked only if the result is valid as neither a CommonJS script nor an ES module, so bundler code passes. A new `.js` file is blocked only for an error JSX, Flow, TypeScript or decorators never cause (an unclosed bracket, an unexpected end of input), so those dialects pass. Other `.json` files, such as `tsconfig.json` with comments, are not checked.

When a Bash command fails because Git Bash changed its inline code, Check adds a note telling the AI what arrived and what to do instead.

## Where Check stays silent

Where your machine can't give a definite answer, Check lets the action through rather than guess:

- commands run through `eval`, `env`, `xargs`, `sudo`, or a login or interactive shell (`bash -l`, `bash -i`)
- git and `./script` checks after a command changes folder (`cd`, `pushd`, `git -C`)
- everything after `PATH=`, `source` or `.` in the same command
- programs after an install in the same command (`npm i -g x && x`)
- a script run after an earlier part of the same command, which may have made it
- a program or file the command tests for first (`command -v`, `which`, `type`, `hash`, `test`, `[`; in PowerShell `Get-Command`, `Test-Path`, `try`/`catch`, `$?`, `$LASTEXITCODE`)
- missing programs in PowerShell commands that load a module, define an alias or function, dot-source a script, change `$env:Path` or run on another machine, or that both installed PowerShells don't agree on
- a script or `python -m` module after the command changes folder, or after options before it (`node --inspect x.js`)
- files written by `echo` or `printf` in any form but one single-quoted argument with `>`; `.jsx` and TypeScript files; text a parser can't tell from a dialect (an unterminated string in a new `.js` file)
- package checks for an ecosystem this machine installs from a private registry, or a command that names another source (`choco -s`, `Install-Module -Repository`, `uvx --from`)
- version ranges and wildcards (`~> 7.0`, `^2.0`, `13.*`): the name is still checked; versions on the PowerShell Gallery; winget, scoop and Go modules
- Docker images from another registry (`ghcr.io/...`), by digest, or under a Docker Hub account that exists (a private repository looks missing from outside)
- imports in projects with path aliases, workspaces or import maps, and Python imports (an import name is often not the package's name)
- library names in TypeScript 7 projects (no programming interface), in libraries without type definitions, in plain JavaScript, in Python, and whenever the project's TypeScript takes longer than 2.5 s (the write goes ahead)

It also cannot know intent: a real command that does the wrong thing passes. Check is not a security tool.

## Fails open

Server unreachable, rate limited, balance empty, key rejected: the command runs, with a warning at most once a day. Check never blocks because Check itself failed, and your balance never blocks your agent.

## How it hooks in

| Claude Code event | What Check does |
|---|---|
| **PreToolUse** (Bash, PowerShell, Write, Edit, NotebookEdit) | the checks above |
| **PostToolUseFailure** (Bash) | the Git Bash note, only when it applies; free |
| **UserPromptSubmit** | counts the message for billing (its ID only); prints nothing |
| **Stop** | the one-line receipt |

### Other agents

The installer adds Check to each agent's own user-level hook file, keeping your hooks, and `--uninstall` removes only Check's entries.

| Agent | Hook file | Commands | File writes | Message billing |
|---|---|---|---|---|
| Codex CLI | `~/.codex/hooks.json` | `PreToolUse` (Bash) | `apply_patch` that adds a file | `UserPromptSubmit` (turn ID) |
| Cursor | `~/.cursor/hooks.json` | `beforeShellExecution` | not checked (no hook before an edit) | `beforeSubmitPrompt` |
| Gemini CLI | `~/.gemini/settings.json` | `BeforeTool` `run_shell_command` (Linux) | `write_file`, `replace` | `BeforeAgent` |
| Windsurf / Devin Desktop | `~/.codeium/windsurf/hooks.json` | `pre_run_command` | `pre_write_code` | `pre_user_prompt` |
| GitHub Copilot CLI | `~/.copilot/hooks/check.json` | `preToolUse` (bash, powershell) | not checked (tool arguments undocumented) | `userPromptSubmitted` |

On Windows, Codex, Cursor and Windsurf / Devin run commands in PowerShell, so they're checked as PowerShell; on Linux every agent's commands run in bash. Gemini CLI's Windows shell is undocumented, so its commands are checked on Linux only. Codex asks you to trust a new hook once: run `/hooks` in Codex and approve Check. The receipt at the end of a reply is Claude Code's only. Not supported: Cline (its hooks are now code plugins, not scripts) and any agent with no hook before an action.

### The connector: any other environment

The connector is how Check is integrated, the same for every tool. If your environment has a hook that can run a program before the AI acts and stop the action, install the gate on its own (`npx @golproductions/check@latest --install --manual`: key and gate, no agent changed), point the hook at it (`node ~/.check/check-hook.mjs`) and send it one JSON object on stdin:

```json
{ "check": 1, "event": "run", "session": "chat-42", "shell": "bash", "command": "npm i lodash@99.99.99", "cwd": "/path/to/project" }
```

`event` is `message` (with `prompt`), `run` (with `command` and `shell`: `bash` or `powershell`), `write` (with `file_path` and `content`) or `edit` (with `file_path`, `old_string`, `new_string`). Each `message` is billed once; every check after it in the same `session` belongs to it. The message text never leaves the machine.

The gate answers `{"decision":"allow"}`, or `{"decision":"deny","reason":"check: ..."}`: stop the action and give the reason to the AI. An `allow` may carry a `notice` for the person. Anything other than `deny`, including no answer, means go ahead. Full contract: https://golproductions.com/guide#connector

Nothing is written to your project.

## What leaves your machine

Per message: its ID, never its text. Per command: the command text with credential patterns redacted (API keys, tokens, JWTs, private keys, Bearer tokens, emails, card-like numbers; a secret in a PowerShell `$env:` assignment is sent as written), the working folder with your username masked, and your machine's answers. Per file write: the file's name, its size and whether it already exists; if a parser rejects it, the parser's one-line error message (redacted the same way), which can quote the word it stopped at; for a JavaScript or TypeScript file, the names of npm packages the write starts importing that aren't installed or declared in the project; and, when your project's own TypeScript says the write uses a name a library doesn't have, the library, that name, the error code, its line and TypeScript's one-line message. File contents never leave. `--feedback` sends your message, Check's version, your OS, which agents Check is installed in and a shortened form of your key. Command text is not written to storage for customer keys; what is kept is usage counters and a billing record (time, cost, pass or block). Details: [privacy policy](https://golproductions.com/privacy).

## Pricing

14 days free from the moment you create your GOL API Key at [the console](https://golproductions.com/console). Then US$0.02 per message you send to your AI, a price that will never be raised, from a prepaid balance: any amount from US$5 to US$500 at [the console](https://golproductions.com/console). Every check inside a message is free (one message covers up to 500 checks and 12 hours; past that, the next check counts as a new message). Messages Claude Code starts by itself (task results, helper messages) are not billed unless Check checks something in them. When the trial is over and the balance runs out, Check stops checking and your commands still run. No subscription, nothing auto-recharges, credits don't expire.

## Keys

One kind of key: the **GOL API Key**. It's made only at [the console](https://golproductions.com/console), by a signed-in account with two-factor authentication, and it's free for 14 days from its creation. After that it draws on its prepaid balance. On a machine it's saved in `~/.check/key`: the install asks for it, or set it yourself with `--key`.

Keep it safe: never paste it into an AI chat or prompt, a project file, a commit or a screenshot. Anyone with it can spend your credit. If it leaks, press Rotate at the console: the old key stops at once and the balance moves to the new one. On a server or in CI, pass it through the `GOL_API_KEY` environment variable from your secret store.

### Getting your key back out

Check never prints the full key: every surface shows it masked, because it is a credential and an AI agent reads everything a hook prints back.

```
npx @golproductions/check@latest --print
```

Run this yourself, in a real terminal. The first time, it asks you to set a password (never written to disk, never told to any agent) and saves your key encrypted to a file on your Desktop. Every time after, it asks for that password before showing the key. Paste it into "Connect key" at [the console](https://golproductions.com/console) while signed in to link it to your account, then delete the encrypted file.

## Manage

```
npx @golproductions/check@latest --key         # set your GOL API Key (run it yourself)
npx @golproductions/check@latest --status      # key + installation status
npx @golproductions/check@latest --credits     # balance and trial remaining
npx @golproductions/check@latest --print       # get your key back, password-gated
npx @golproductions/check@latest --uninstall   # remove hooks
```

The gate keeps itself current, checking for updates in the background at most once an hour; re-run the install only to update the installer itself.

## Terms

By installing or using Check you agree to the [Terms of Service](https://golproductions.com/terms) and [Privacy Policy](https://golproductions.com/privacy). The service is provided as is; see the Terms for the full picture, including your Australian Consumer Law rights.

[Product](https://golproductions.com/check) · [How it works](https://golproductions.com/what-check-does) · [Pricing](https://golproductions.com/pricing) · [Console](https://golproductions.com/console)

## Trademarks

Not affiliated with, endorsed by, or sponsored by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC. Cursor, Gemini, Codex, Windsurf, Devin and GitHub Copilot are trademarks of their respective owners. They are named only to say which tools Check works with. GOLProductions is an independent company.

## License

Copyright (c) 2026 GOL Productions. All rights reserved.
