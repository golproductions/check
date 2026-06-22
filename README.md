# Check — The Anti-Hallucination Firewall for AI Coding Agents

**Your AI hallucinates commands, imports, and function calls. Check catches them before execution.**

Check sits between your AI and your project. Every command is verified before it runs. Every import is checked against your actual dependencies. Every function call is matched against your real source files. What doesn't exist gets blocked.

No AI inside. Deterministic. Same input, same output. Every time.

## Install

One command. Every IDE.

```
npx @golproductions/check --install YOUR_KEY
```

Auto-detects and configures **Claude Code**, **Cursor**, **Gemini CLI / Antigravity**, and MCP servers for **Windsurf / Devin Desktop**, **Continue**, **Amazon Q**, and **Roo Code**.

Get your free API key (120 free checks) at [golproductions.com/check](https://www.golproductions.com/check.html)

## What it catches

| Type | What happens |
|------|-------------|
| **Phantom commands** | AI runs `git stash apply 3` — stash doesn't exist. **Blocked.** |
| **Hallucinated imports** | AI writes `import cache from "express-session"` — not installed. **Blocked.** |
| **Invented functions** | AI calls `db.findUserByEmail()` — doesn't exist in your project. **Blocked.** |
| **Broken syntax** | AI writes a file with mismatched brackets. **Flagged.** |
| **Post-write integrity** | After the AI writes a file, imports and function calls are re-verified. **Two checkpoints.** |

## Supported environments

**Hooks (automatic, pre-execution)**

| Environment | Integration |
|-------------|-------------|
| Claude Code | PreToolUse hook |
| Cursor | beforeShellExecution hook |
| Gemini CLI / Antigravity | BeforeTool hook |

**MCP Server (agent-driven)**

| Environment | Integration |
|-------------|-------------|
| Claude Code | MCP server |
| Cursor | MCP server |
| Windsurf / Devin Desktop | MCP server |
| Continue | MCP server |
| Amazon Q | MCP server |
| Roo Code | MCP server |
| Claude Desktop | MCP server |
| Any MCP client | MCP server |

**Editor plugins**

| Editor | Install |
|--------|---------|
| VS Code / Cursor / Devin Desktop | [Open VSX](https://open-vsx.org/extension/golproductions/gol-check) |
| JetBrains (IntelliJ, WebStorm, PyCharm, GoLand, Rider, PHPStorm, RubyMine) | [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/com.golproductions.check) |
| Neovim | [check.nvim](https://github.com/golproductions/check.nvim) |
| Emacs | [check.el](https://github.com/golproductions/check.el) |
| Sublime Text | [GOLCheck](https://github.com/golproductions/check-sublime) |
| Zed | [check-zed](https://github.com/golproductions/check-zed) |

**Direct API**

```
POST https://triage.golproductions.com/preflight
```

## MCP Server

Run Check as an MCP server for direct agent integration:

```
npx @golproductions/check check-mcp
```

Exposes two tools:
- **Check** — validates a command, returns `RUNNABLE` or `INVALID`
- **CheckAndExecute** — validates then executes, blocking invalid commands before they reach the shell

## How it works

```
AI generates code
    ↓
Check intercepts (pre-execution)
    ↓
Verifies against your actual project
    ↓
Real → allowed  |  Not real → blocked
    ↓
After file write → second verification pass
```

Sub-100ms. Your AI never knows it's there.

## Why not just use another guardrail?

| | Check | Security firewalls | LLM guardrails | Eval platforms |
|---|---|---|---|---|
| **Checks code correctness** | Yes | No — checks safety | No — checks format | No — scores after |
| **Knows your project** | Yes | No | No | No |
| **Pre-execution** | Yes | Yes | Varies | No |
| **Post-write verification** | Yes | No | No | No |
| **No AI inside** | Yes | Varies | Uses LLMs | Uses LLMs |
| **Per-check pricing** | $0.0068 AUD | Free (self-hosted) | Enterprise | SaaS |

Every other tool checks the AI. **Check checks the code.**

## Pricing

**$0.0068 AUD per check.** 120 free checks on signup. Prepaid wallet — no subscription, no monthly fee. Credits never expire.

| Tier | Checks | Cost per check |
|------|--------|---------------|
| Free | 120 | $0.00 |
| $5 | ~735 | $0.0068 |
| $10 | ~1,470 | $0.0068 |
| $25 | ~3,676 | $0.0068 |
| $50 | ~7,352 | $0.0068 |

## Links

- [Product page](https://www.golproductions.com/check.html)
- [Pricing](https://www.golproductions.com/pricing.html)
- [Updates](https://www.golproductions.com/updates.html)
- [Blog](https://www.golproductions.com/blog/)

## License

Copyright (c) 2026 GOL Productions. All rights reserved.
