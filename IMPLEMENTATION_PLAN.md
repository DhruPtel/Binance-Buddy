# IMPLEMENTATION_PLAN.md — Binance Buddy Build Sequence

## Day 1 (Mar 10) — Setup & Foundation

### 1.1 Environment
- [x] WSL2 configured with memory limits
- [x] Node.js 23, pnpm, Redis installed
- [x] OpenClaw installed and onboarded
- [x] Monorepo scaffolded (8 packages)

### 1.2 Documentation (current step)
- [x] All canonical docs in project root (PRD, APP_FLOW, TECH_STACK, FRONTEND_GUIDELINES, BACKEND_STRUCTURE, this file)
- [x] OPENCLAW.md (agent operating manual)
- [x] progress.txt initialized
- [x] lessons.md initialized

### 1.3 Core Types
- [x] packages/core/src/types.ts — ALL shared type definitions
- [x] packages/core/src/constants.ts — BSC addresses, guardrails, safe tokens, BigInt serializer
- [x] packages/core/src/index.ts — re-exports

### 1.4 Dependencies & Validation
- [x] pnpm install all dependencies per TECH_STACK.md
- [x] npx tsc --noEmit passes clean on core package
- [x] git add -A && git commit "chore: Day 1 — foundation complete"

---

## Day 2 (Mar 11) — Wallet Scanner & Profile Builder

### 2.1 Provider Setup
- [x] packages/blockchain/src/provider.ts — ethers.js provider for BSC, RPC config
- [x] Test: can read BNB balance of a known address

### 2.2 Token Scanner
- [x] packages/blockchain/src/tokens.ts — Multicall3 batched balanceOf, CoinGecko prices
- [x] Price lookup via CoinGecko free API

### 2.3 Transaction History
- [x] packages/blockchain/src/history.ts — Moralis primary, Ankr fallback, [] if no keys
- [x] Categorize each tx: swap, farm, stake, transfer, NFT, bridge, approve, unknown
- [x] Map contract addresses to known protocols

### 2.4 Profile Builder
- [x] packages/blockchain/src/scanner.ts — orchestrates tokens + history into WalletState + profile
- [x] Determine archetype based on tx distribution
- [x] Calculate risk score based on token diversity + meme coin %

### 2.5 Validate & Commit
- [x] npx tsc --noEmit passes
- [x] 19/19 tests pass
- [x] git commit "feat: wallet scanner and profile builder"

---

## Day 3 (Mar 12) — AI Agent Core & Tool Framework

### 3.1 Tool Interface
- [x] packages/ai/src/tools/index.ts — tool registry, AgentTool interface, getTools(), executeTool()

### 3.2 Tool Implementations
- [x] packages/ai/src/tools/swap.ts — swap_tokens (wired to real PancakeSwap V2)
- [x] packages/ai/src/tools/scan.ts — scan_wallet
- [x] packages/ai/src/tools/token-info.ts — get_token_info
- [x] packages/ai/src/tools/positions.ts — check_positions
- [x] packages/ai/src/tools/alerts.ts — set_alert
- [x] packages/ai/src/tools/farms.ts — find_farms
- [x] packages/ai/src/tools/snipe.ts — snipe_launch (Trenches only)

### 3.3 System Prompt Builder
- [x] packages/ai/src/prompts/system.ts — stage personalities, mood modifiers, wallet summary, tools, safety rules

### 3.4 Research Agent
- [x] packages/ai/src/research.ts — CoinGecko + baseline farms, runs every 30min via setInterval
- [x] getLatestReport() / isReportFresh()

### 3.5 Execution Agent
- [x] packages/ai/src/agent.ts — Claude Sonnet 4.6, multi-round tool loop (max 5), circuit breaker
- [x] getCircuitBreakerStatus() + resetCircuitBreaker() exported

### 3.6 Validate & Commit
- [x] npx tsc --noEmit passes
- [x] 19/19 tests pass
- [x] git commit "feat: dual agent architecture with tool framework"

---

## Day 4 (Mar 13) — DEX Trading Engine

### 4.1 PancakeSwap Integration
- [x] packages/blockchain/src/dex/pancakeswap.ts — getSwapQuote, findBestPath (direct + WBNB routing)

### 4.2 Swap Execution Pipeline
- [x] packages/blockchain/src/dex/executor.ts — 8-step guardrail pipeline:
  1. Build unsigned transaction
  2. Simulate via eth_estimateGas
  3. Check guardrails (limits, allowlist, risk)
  4. Check amount caps (balance - fee reserve)
  5. Return for user confirmation
  6. Execute approval if needed
  7. Submit signed tx
  8. Return receipt

### 4.3 Token Approval
- [x] packages/blockchain/src/dex/approval.ts — checkApproval (on-chain allowance), executeApproval

### 4.4 Gas Estimation
- [x] packages/blockchain/src/dex/gas.ts — getGasPrice, estimateGasCost, simulateTransaction (revert detection)

### 4.5 Wire Tools to Real Execution
- [x] swap_tokens tool wired to real prepareSwap() / PancakeSwap V2 quotes

### 4.6 Validate & Commit
- [x] npx tsc --noEmit passes
- [x] 19/19 tests pass
- [x] git commit "feat: DEX trading engine with guardrail pipeline"

---

## Day 5 (Mar 14) — Buddy System & Extension Shell

### 5.1 Buddy Logic
- [x] packages/buddy/src/evolution.ts — xpToStage(), checkEvolution(), applyEvolution(), STAGE_INFO
- [x] packages/buddy/src/xp.ts — awardXp(), xpToLevel(), getXpProgress(); post-apex leveling
- [x] packages/buddy/src/mood.ts — deriveMood() driven by portfolio % change + interaction recency

### 5.2 Extension Manifest
- [x] packages/extension/manifest.json — MV3, popup, sidepanel, background service worker
- [x] packages/extension/src/background.ts — alarm-based research cache refresh, message router

### 5.3 Voxel Buddy Renderer
- [x] packages/extension/src/components/BuddyRenderer.tsx — Three.js r128 voxel creature
- [x] Idle animation loop, mood expressions, stage colour palette

### 5.4 Extension Popup
- [x] packages/extension/src/popup/App.tsx — 264px compact view: buddy, mood, XP bar, portfolio value, connect/chat

### 5.5 Wallet Bridge + Sidepanel Shell
- [x] packages/extension/src/wallet-bridge.ts — EIP-1193 connectWallet, listenForWalletChanges, isBscMainnet
- [x] packages/extension/src/sidepanel/App.tsx — tab nav (Chat, Portfolio, Buddy, Settings), wallet connect, BSC chain warning

### 5.6 Validate & Commit
- [x] Extension builds via vite build → dist/
- [x] 19/19 tests pass
- [x] git commit "feat: buddy evolution system and extension shell"

---

## Day 6 (Mar 15) — Extension UI & Chat Interface

### 6.1 Sidepanel Layout
- [x] packages/extension/src/sidepanel/App.tsx — tab navigation (Chat, Portfolio, Buddy, Settings)

### 6.2 Chat Interface
- [x] packages/extension/src/sidepanel/Chat.tsx — message list, typing indicator, history-aware, background relay

### 6.3 Trade Confirmation Component
- [x] packages/extension/src/sidepanel/TradeConfirm.tsx — modal overlay, token amounts, gas, slippage, confirm/cancel, loading state

### 6.4 Portfolio View
- [x] packages/extension/src/sidepanel/Portfolio.tsx — total value, sorted token list with balances and prices

### 6.5 Wallet Connection
- [x] packages/extension/src/wallet-bridge.ts — MetaMask/TrustWallet detection, account/chain change listeners

### 6.6 Settings & API Keys
- [x] packages/extension/src/sidepanel/Settings.tsx — API key management, Normal/Trenches mode toggle

### 6.7 Validate & Commit
- [x] Extension builds to dist/ (popup.js 3.5kB, sidepanel.js 15.7kB, BuddyRenderer chunk 650kB)
- [x] 19/19 tests pass
- [x] git commit "feat: extension UI with chat and trade confirmation"

---

## Day 7 (Mar 16) — Trenches Mode & Telegram Bot

### 7.1 Token Launch Sniper
- [x] packages/strategies/src/trenches/sniper.ts — PairCreated event listener, assessNewPair() safety checks, honeypot heuristic, startSniper/stopSniper

### 7.2 Farm Scanner + Risk Scorer
- [x] packages/strategies/src/trenches/farms.ts — live PancakeSwap V2 farms API + baseline fallback, scoreFarms(), filterFarms()
- [x] packages/strategies/src/risk.ts — scoreTokenRisk() composite 0-100 heuristic

### 7.3 Telegram Bot
- [x] packages/telegram/src/bot.ts — createBot(), startPolling(), getWebhookHandler(), setWebhook()
- [x] packages/telegram/src/commands/start.ts — /start welcome + /link wallet linking
- [x] packages/telegram/src/commands/status.ts — /status portfolio scan with top holdings, archetype, risk score
- [x] packages/telegram/src/commands/swap.ts — /swap with inline confirm/cancel keyboard, cross-user guard
- [x] packages/telegram/src/commands/buddy.ts — /buddy stats (stage, XP bar, mood, streak, trenches lock)

### 7.4 Server
- [x] packages/server/src/index.ts — full Express app with all API endpoints + dev dashboard
- [x] POST /api/telegram/webhook, /set-webhook, /start-polling

### 7.5 Wire OpenClaw Skills
- [x] skills/ directory — 7 SKILL.md files: swap_tokens, scan_wallet, get_token_info, check_positions, set_alert, find_farms, snipe_launch

### 7.6 Validate & Commit
- [x] 19/19 tests pass
- [x] pnpm exec tsc --noEmit clean on all packages
- [x] git commit "feat: trenches mode and telegram bot"

---

## Day 8 (Mar 17-18) — Polish & Submit

### 8.1 Bug Fixes
- [ ] Test every user flow from APP_FLOW.md
- [ ] Fix any broken interactions
- [ ] Ensure guardrails work in all edge cases

### 8.2 Demo Video (3 minutes)
- [ ] Record: Open extension → connect wallet → buddy wakes up
- [ ] Record: Buddy summarizes wallet profile
- [ ] Record: Chat "swap 0.1 BNB for CAKE" → confirmation → execute
- [ ] Record: Toggle Trenches Mode → show sniper scanning
- [ ] Record: Telegram bot responding
- [ ] Record: Buddy evolution animation

### 8.3 README & Submission
- [ ] README.md with setup instructions, screenshots, architecture diagram
- [ ] Push to GitHub (public repo)
- [ ] Quote hackathon post on X/Twitter
- [ ] Submit via Binance survey form
- [ ] Deploy server to VPS for live demo

### 8.4 Final Commit
- [ ] git commit "chore: polish and submission prep"
- [ ] Tag release: v0.1.0
