# OPENCLAW.md — Binance Buddy Agent Operating Manual

## Read This First, Every Session
1. Read progress.txt
2. Read this file
3. Read the types.ts of the module you're working on
4. Do NOT read more than 3 files at once

## Project Overview
Binance Buddy — a Tamagotchi-style AI blockchain companion for BNB Chain.
Monorepo with 8 packages: core, blockchain, ai, buddy, strategies, extension, telegram, server.

## Tech Stack (locked — do NOT add unlisted deps)
- TypeScript 5.7, Node 23, pnpm workspaces, Turborepo
- ethers.js 6 (blockchain), React 18 + Tailwind (extension), Three.js r128 (buddy 3D)
- grammy (Telegram), Express (server), Redis (cache)
- OpenClaw + Claude Sonnet 4 (AI agents)
- Full details: TECH_STACK.md

## Critical Rules

### Code Quality
- Run `npx tsc --noEmit` after EVERY file change
- Run `pnpm test` after every logical unit of work
- One file at a time for fixes. Compiler after each.
- Don't combine audit + fix — audit first, fix separately
- Commit after each logical unit with conventional commit messages
- BigInt values crash JSON.stringify — always use the replacer from core/constants.ts

### Architecture
- Dual agent: Research Agent (slow, every 30min) feeds Execution Agent (fast, on user message)
- Guardrails enforce at ENGINE layer, NOT the AI layer
- The LLM can plan whatever it wants — it cannot bypass simulation, guardrails, or risk gates
- One recommendation per execution cycle — don't batch
- Circuit breaker: 3 consecutive failures → auto-pause

### Safety (non-negotiable)
- NEVER include private keys in any LLM context
- ALWAYS simulate via eth_call before submitting any transaction
- ALWAYS keep 0.005 BNB reserved for gas fees
- ALWAYS check token allowance and approve() before swaps
- Guardrails ARE the safety layer — execute immediately if they pass, no confirmation prompt
- Normal mode: max 1% slippage. Trenches: max 15%

### Naming
- Project name: Binance Buddy (not ChainBuddy)
- Package prefix: @binancebuddy/
- Agent names: binancebuddy (OpenClaw), not chainbuddy

## File Routing — Which Files to Read for Each Task

### Wallet / Blockchain
Read `packages/core/src/types.ts` first, then:
- Provider: `packages/blockchain/src/provider.ts`
- Scanner: `packages/blockchain/src/scanner.ts`
- Tokens: `packages/blockchain/src/tokens.ts`
- History: `packages/blockchain/src/history.ts`
- DEX: `packages/blockchain/src/dex/executor.ts`
- Yield vaults: `packages/blockchain/src/yield/vault-executor.ts`
- LP: `packages/blockchain/src/lp/liquidity-executor.ts`
- Lending: `packages/blockchain/src/lending/lending-executor.ts`
- ABIs: `packages/blockchain/src/abis.ts`

### AI Agent
Read `packages/core/src/types.ts` first, then:
- Research agent: `packages/ai/src/research.ts`
- Execution agent: `packages/ai/src/agent.ts`
- System prompt: `packages/ai/src/prompts/system.ts`
- Tools: `packages/ai/src/tools/index.ts`

### Buddy
Read `packages/core/src/types.ts` first, then:
- Evolution: `packages/buddy/src/evolution.ts`
- XP: `packages/buddy/src/xp.ts`
- Mood: `packages/buddy/src/mood.ts`

### Strategies
Read `packages/core/src/types.ts` first, then:
- Sniper: `packages/strategies/src/trenches/sniper.ts`
- Farms: `packages/strategies/src/trenches/farms.ts`
- Risk: `packages/strategies/src/risk.ts`

### Extension
- Manifest: `packages/extension/manifest.json`
- Popup: `packages/extension/src/popup/`
- Sidepanel: `packages/extension/src/sidepanel/`
- Buddy 3D: `packages/extension/src/components/BuddyRenderer.tsx`

### Telegram
- Bot: `packages/telegram/src/bot.ts`
- Commands: `packages/telegram/src/commands/`

## Reference Docs
- Product spec: PRD.md
- User flows: APP_FLOW.md
- Dependencies: TECH_STACK.md
- Design system: FRONTEND_GUIDELINES.md
- Data models & agents: BACKEND_STRUCTURE.md
- Build sequence: IMPLEMENTATION_PLAN.md
- Lessons: lessons.md

## Prompting Patterns
- "Don't build anything. Just assess/report" — prevents premature coding
- "Read progress.txt only" — prevents vacuuming all files
- Write plans to IMPLEMENTATION_PLAN.md before building
- "Evaluate on your own" > telling it what answer to give
- Let the agent commit after each logical unit of work

## OpenClaw Runtime Integration

This codebase is deployed behind **OpenClaw** as the agent runtime. The responsibilities split cleanly:

**OpenClaw handles:** Telegram messaging, session memory, heartbeats, SOUL.md personality, conversation flow.
**Our code handles:** Blockchain execution, guardrails, market data, buddy state machine, tool logic.

### How OpenClaw calls our code
OpenClaw invokes our capabilities through **HTTP API endpoints** on the `packages/server` package. Every AI tool (`swap_tokens`, `scan_wallet`, `get_token_info`, `check_positions`, `set_alert`, `find_farms`, `snipe_launch`, etc.) must have a corresponding REST endpoint in `packages/server` that OpenClaw can call.

### Tool manifest
The server must expose **GET /api/tools** — a tool manifest endpoint that returns all available tools with their names, descriptions, and parameter schemas. This lets OpenClaw discover what capabilities exist at runtime.

### Research Agent runs on our server, not inside OpenClaw
The Research Agent runs as a **cron job on the server** (not inside OpenClaw). It writes reports to Redis. OpenClaw's execution agent reads the latest report via **GET /api/research/latest**.

### Extension bypasses OpenClaw
The Chrome extension talks **directly to the server API**, not through OpenClaw. OpenClaw is only for Telegram and scheduled tasks.

### Structured JSON responses
Every tool handler must return **structured JSON** that OpenClaw can parse and present to the user through its personality layer. No freeform text — always typed response objects.

## OpenClaw Runtime

On deployment, OpenClaw takes over as the always-on runtime. It uses its own Claude API key to run the AI agent. OpenClaw's workspace is this project folder. It reads SOUL.md for personality, runs heartbeats for the Research Agent, and handles Telegram. Our server runs as a background process that OpenClaw can call via shell commands or HTTP.

**Key implication:** every tool and agent function must be callable both **programmatically** (for dev/testing) and via **HTTP endpoint** (for OpenClaw). Design all tool handlers as pure functions that the server routes wrap.

## Commit Convention
- feat: new feature
- fix: bug fix
- refactor: code restructure
- docs: documentation update
- test: test additions
- chore: tooling/config
