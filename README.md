# Check

**Less hallucinations.** Check is a command firewall for AI coding agents: it validates commands, packages, and URLs before they run in your project. What isn't real gets denied, what is real passes through. Deterministic, no AI inside.

**This is the one location.** Everything integrates from here:

```
npx @golproductions/check --install       # Windows, macOS, Linux
curl check.golproductions.com | sh        # Unix shells
```

Installing mints a free key bound to your machine. No signup, 120 free checks per day, then $0.0068 AUD each from a prepaid balance, and the same key is shared by every Check tool on the machine. Need more? Get a paid GOL API Key at [the console](https://www.golproductions.com/console.html).

---

## Integrate it into anything

Check is one primitive with four faces. Pick the one your environment speaks.

### 1. Hook mode: blocks bad commands before they run

For any tool with pre-execution hooks. `--install` wires these automatically for **Claude Code, Cursor, and Gemini CLI**; wire anything else yourself: pipe the hook JSON to the script, read the verdict.

```
echo '{"tool_input":{"command":"some command"}}' | node ~/.check/check.mjs
→ {"hookSpecificOutput":{"permissionDecision":"allow"}}          # runnable
→ {"hookSpecificOutput":{"permissionDecision":"deny", ...}}      # hallucinated
```

The script auto-detects Claude Code, Cursor, and Gemini hook formats and answers in each tool's own dialect.

### 2. MCP server: for anything that speaks Model Context Protocol

Windsurf, Antigravity, Continue, Amazon Q, Roo Code, Claude Desktop, or your own agent:

```json
{
  "mcpServers": {
    "check": {
      "command": "npx",
      "args": ["@golproductions/check", "--mcp"],
      "env": { "GOL_CLIENT_ID": "your_key" }
    }
  }
}
```

Exposes two tools: `Check` (verdict only) and `CheckAndExecute` (validate, then run if clean). MCP is advisory: the agent calls it when its rules say to. Add one line to your agent's rules: *"Before running any shell command, validate it with the `check` tool."*

### 3. CLI: for scripts, CI, git hooks, anything with a shell

```
curl check.golproductions.com | sh       # installs the `check` command (Unix)
check "netlify-cli deploy --prod"        # → invalid   (exit 1)
check "netlify deploy --prod"            # → runnable  (exit 0)
echo "some command" | check              # pipe mode
```

Exit codes make it composable: gate a CI step, a git pre-push hook, a Docker entrypoint, a cron job.

### 4. HTTP: for everything else, in any language

```
POST https://triage.golproductions.com/preflight
Header: X-GOL-CLIENT-ID: your_key
Body:   {"command": "the command to validate"}

→ {"verdict": "runnable" | "invalid", "reason": "...", "daily_remaining": 119}
```

That is the whole contract. Rate limit 60/min. A `402` means the free tier is spent and the balance is empty. Treat it as allow-with-warning, never as a verdict.

---

## Keys

| Tier | What | Where |
|------|------|-------|
| **GOL Client ID** (free) | Minted automatically on install, bound to the machine, shared by every tool on it. 120 checks/day, forever. | Nowhere. It just happens |
| **GOL API Key** (paid) | Prepaid balance ($0.0068 AUD/check after the daily 120), spend caps, dashboard, 2FA. | [Console](https://www.golproductions.com/console.html) |

Same header, same API. The tier is just what the key can do.

## Manage

```
npx @golproductions/check --status      Your key + where Check is installed
npx @golproductions/check --credits     Balance and free checks remaining
npx @golproductions/check --uninstall   Remove from every tool
```

## Editor extensions

Thin wrappers over this same API exist on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=golproductions.gol-check), [Open VSX](https://open-vsx.org/extension/golproductions/gol-check) (also used by Antigravity), and the [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/32408). They validate on demand; the hook and MCP faces above are the real-time gate.

## Links

[Product](https://www.golproductions.com/check.html) · [Pricing](https://www.golproductions.com/pricing.html) · [Console](https://www.golproductions.com/console.html) · [Updates](https://www.golproductions.com/updates.html) · [Blog](https://www.golproductions.com/blog/)

## Terms

By installing or using Check you agree to the [Terms of Service](https://www.golproductions.com/terms.html) and [Privacy Policy](https://www.golproductions.com/privacy.html). The service is provided as is; see the Terms for the full picture, including your Australian Consumer Law rights.

## License

Copyright (c) 2026 GOL Productions. All rights reserved.
