# TECH_STACK.md — Binance Buddy Technology Stack

## Runtime & Package Management
- Node.js 23.3.0 (already installed)
- pnpm 10.x (workspace management)
- TypeScript 5.7.x (strict mode, everywhere)
- Turborepo (monorepo build pipeline)

## Monorepo Structure
- pnpm workspaces with 8 packages
- Shared tsconfig.base.json
- Package naming: @binancebuddy/{package}

## Blockchain
- ethers.js 6.x — BSC interactions, wallet connection, contract calls, tx signing
- No other blockchain libraries. ethers handles everything.

## AI / Agent
- OpenClaw — agent runtime, skill system, session management
- Anthropic Claude Sonnet 4 — primary model for both Research and Execution agents
- Agent communicates via OpenClaw gateway (WebSocket on port 18789)

## Extension
- Chrome Extension Manifest V3
- React 18.x — popup and sidepanel UI
- Tailwind CSS 3.x — styling (utility classes only)
- Three.js r128 — 3D voxel buddy rendering in extension
- Vite — bundler for extension build

## Telegram Bot
- grammy 1.x — lightweight Telegram bot framework
- Runs as part of the server package

## Server
- Express 4.x — lightweight HTTP API
- Redis 7.x — market data cache, rate limiting
- cors — CORS middleware

## Data Storage
- IndexedDB (in extension) — wallet data, buddy state, chat history, API keys
- Redis (server-side) — market data cache, research reports
- No SQL database. User data stays local in the extension.

## APIs & External Services
- BSCScan API — transaction history, contract verification, ABI fetching
- BNB Chain RPC — on-chain reads and tx submission (Ankr free tier or public nodes)
- PancakeSwap Router V2/V3 — swap execution
- PancakeSwap Factory V2/V3 — new pair detection (for sniper)
- CoinGecko API (free) — token prices as fallback

## Dev Tools
- tsx — TypeScript execution without compilation (dev only)
- Vitest — testing framework
- ESLint — linting
- Prettier — formatting

## Deployment (Day 8)
- VPS (DigitalOcean $12/mo) — OpenClaw gateway + server + Telegram bot
- Chrome extension — distributed as unpacked extension for demo
- GitHub — public repo with README

---

## Dependency Rules
- Do NOT add new dependencies without documenting here first
- Do NOT use any package not listed above
- All versions locked in package.json (no ^ or ~ ranges)
- If a task requires a new dep, update this doc THEN install
