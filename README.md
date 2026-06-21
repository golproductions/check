# Check — The Anti-Hallucination Firewall for AI Coding Agents

**Your AI hallucinates commands, imports, and function calls. Check catches them before execution.**

Check sits between your AI and your project. Every command is verified before it runs. Every import is checked against your actual dependencies. Every function call is matched against your real source files. What doesn't exist gets blocked.

No AI inside. Deterministic. Same input, same output. Every time.

## Install

One command. Every IDE.

```
npx @golproductions/check --install your_key
```

Auto-detects **Claude Code**, **Cursor**, and **Antigravity**. Writes the hook config, sets your key, done. Restart your IDE to activate.

Get your free API key (120 free checks) at [golproductions.com](https://www.golproductions.com/check.html)

## What it catches

| Type | What happens |
|------|-------------|
| **Phantom commands** | AI runs `git stash apply 3` — stash doesn't exist. **Blocked.** |
| **Hallucinated imports** | AI writes `import cache from "express-session"` — not installed. **Blocked.** |
| **Invented functions** | AI calls `db.findUserByEmail()` — doesn't exist in your project. **Blocked.** |
| **Broken syntax** | AI writes a file with mismatched brackets. **Flagged.** |
| **Post-write integrity** | After the AI writes a file, imports and function calls are re-verified. **Two checkpoints.** |

## How it works

```
AI writes code
    ↓
Check intercepts (pre-execution hook)
    ↓
Verifies against your actual project
    ↓
Real → allowed  |  Not real → blocked
    ↓
After file write → second verification pass
```

Check runs as a **PreToolUse** and **PostToolUse** hook. Your AI never knows it's there. Sub-100ms response time.

## Why not just use another guardrail?

| | Check | Security firewalls (AEGIS, Pipelock) | LLM guardrails (Guardrails AI, Lakera) | Eval platforms (Galileo, Braintrust) |
|---|---|---|---|---|
| **Checks code correctness** | Yes | No — checks safety | No — checks format | No — scores after |
| **Knows your project** | Yes | No | No | No |
| **Pre-execution** | Yes | Yes | Varies | No |
| **Post-write verification** | Yes | No | No | No |
| **No AI inside** | Yes | Varies | Uses LLMs | Uses LLMs |
| **Per-check pricing** | $0.0068 AUD | Free (self-hosted) | Enterprise pricing | SaaS pricing |

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

## MCP Server

Check also runs as an MCP (Model Context Protocol) server for direct integration:

```
check-mcp
```

## Links

- [Product page](https://www.golproductions.com/check.html)
- [Pricing](https://www.golproductions.com/pricing.html)
- [Documentation](https://www.golproductions.com/docs-triage-gate.html)
- [Blog](https://www.golproductions.com/blog/)

## Supported IDEs

- Claude Code
- Cursor
- Antigravity

More coming: Windsurf, Cline, Continue, Zed, Aider, JetBrains, GitHub Copilot.

## License

Copyright (c) 2026 GOL Productions. All rights reserved.
