# IMPLEMENTATION_PLAN.md — Binance Buddy Build Sequence

## Day 1 (Mar 10) — Setup & Foundation

### 1.1 Environment
- [x] WSL2 configured with memory limits
- [x] Node.js 23, pnpm, Redis installed
- [x] OpenClaw installed and onboarded
- [x] Monorepo scaffolded (8 packages)

### 1.2 Documentation (current step)
- [ ] All canonical docs in project root (PRD, APP_FLOW, TECH_STACK, FRONTEND_GUIDELINES, BACKEND_STRUCTURE, this file)
- [ ] OPENCLAW.md (agent operating manual)
- [ ] progress.txt initialized
- [ ] lessons.md initialized

### 1.3 Core Types
- [ ] packages/core/src/types.ts — ALL shared type definitions
- [ ] packages/core/src/constants.ts — BSC addresses, guardrails, safe tokens, BigInt serializer
- [ ] packages/core/src/index.ts — re-exports

### 1.4 Dependencies & Validation
- [ ] pnpm install all dependencies per TECH_STACK.md
- [ ] npx tsc --noEmit passes clean on core package
- [ ] git add -A && git commit "chore: Day 1 — foundation complete"

---

## Day 2 (Mar 11) — Wallet Scanner & Profile Builder

### 2.1 Provider Setup
- [ ] packages/blockchain/src/provider.ts — ethers.js provider for BSC, RPC config
- [ ] Test: can read BNB balance of a known address

### 2.2 Token Scanner
- [ ] packages/blockchain/src/tokens.ts — fetch all BEP-20 balances for wallet
- [ ] Use BSCScan API for token list, ethers for balances
- [ ] Price lookup via CoinGecko free API

### 2.3 Transaction History
- [ ] packages/blockchain/src/history.ts — fetch last 500 txs from BSCScan
- [ ] Categorize each tx: swap, farm, stake, transfer, NFT, bridge, approve, unknown
- [ ] Map contract addresses to known protocols

### 2.4 Profile Builder
- [ ] packages/blockchain/src/scanner.ts — orchestrates tokens + history into UserProfile
- [ ] Determine archetype based on tx distribution
- [ ] Calculate risk score based on token diversity + meme coin %
- [ ] Test: scan a real BSC wallet, print profile

### 2.5 Validate & Commit
- [ ] npx tsc --noEmit passes
- [ ] Test script runs successfully
- [ ] git commit "feat: wallet scanner and profile builder"

---

## Day 3 (Mar 12) — AI Agent Core & Tool Framework

### 3.1 Tool Interface
- [ ] packages/ai/src/tools/index.ts — tool registry, AgentTool interface
- [ ] Each tool: name, description, parameter schema, handler function

### 3.2 Tool Implementations (stubs first, wire later)
- [ ] packages/ai/src/tools/swap.ts — swap_tokens
- [ ] packages/ai/src/tools/scan.ts — scan_wallet
- [ ] packages/ai/src/tools/token-info.ts — get_token_info
- [ ] packages/ai/src/tools/positions.ts — check_positions
- [ ] packages/ai/src/tools/alerts.ts — set_alert
- [ ] packages/ai/src/tools/farms.ts — find_farms
- [ ] packages/ai/src/tools/snipe.ts — snipe_launch (Trenches only)

### 3.3 System Prompt Builder
- [ ] packages/ai/src/prompts/system.ts — builds system prompt from:
  - Buddy personality (stage + mood)
  - User profile (archetype + risk)
  - Current wallet state
  - Available tools
  - Safety rules
  - Mode (normal vs trenches)

### 3.4 Research Agent
- [ ] packages/ai/src/research.ts — separate agent loop
- [ ] Fetches market data, builds research report
- [ ] Stores report for execution agent to read

### 3.5 Execution Agent
- [ ] packages/ai/src/agent.ts — main agent loop
- [ ] Reads messages, decides tool calls, manages conversation
- [ ] Injects research report into context

### 3.6 Validate & Commit
- [ ] npx tsc --noEmit passes
- [ ] Agent responds to test message in CLI
- [ ] git commit "feat: dual agent architecture with tool framework"

---

## Day 4 (Mar 13) — DEX Trading Engine

### 4.1 PancakeSwap Integration
- [ ] packages/blockchain/src/dex/pancakeswap.ts — router contract interaction
- [ ] Quote fetching: getAmountsOut for price estimation
- [ ] Path finding: direct pair or through WBNB

### 4.2 Swap Execution Pipeline
- [ ] packages/blockchain/src/dex/executor.ts — the guardrail pipeline
  1. Build unsigned transaction
  2. Simulate via eth_call
  3. Check guardrails (limits, allowlist, risk)
  4. Check amount caps (balance - fee reserve)
  5. Return for user confirmation
  6. After confirm: submit signed tx
  7. Wait for receipt
  8. Return result

### 4.3 Token Approval
- [ ] packages/blockchain/src/dex/approval.ts — check and execute approve()
- [ ] Check allowance before every swap
- [ ] Auto-approve if needed (with user confirmation)

### 4.4 Gas Estimation
- [ ] packages/blockchain/src/dex/gas.ts — estimate gas, convert to BNB/USD

### 4.5 Wire Tools to Real Execution
- [ ] Connect swap tool to actual PancakeSwap executor
- [ ] Connect token-info tool to BSCScan + CoinGecko
- [ ] Test: execute a swap on BSC testnet

### 4.6 Validate & Commit
- [ ] npx tsc --noEmit passes
- [ ] Testnet swap executes successfully
- [ ] git commit "feat: DEX trading engine with guardrail pipeline"

---

## Day 5 (Mar 14) — Buddy System & Extension Shell

### 5.1 Buddy Logic
- [ ] packages/buddy/src/evolution.ts — stage progression, threshold checks
- [ ] packages/buddy/src/xp.ts — XP calculator, award XP for actions
- [ ] packages/buddy/src/mood.ts — mood state machine based on portfolio + interaction

### 5.2 Extension Manifest
- [ ] packages/extension/manifest.json — MV3, permissions, popup + sidepanel
- [ ] packages/extension/src/background.ts — service worker

### 5.3 Voxel Buddy Renderer
- [ ] packages/extension/src/components/BuddyRenderer.tsx — Three.js canvas
- [ ] 3 base creature models (can be simple voxel geometries built in code)
- [ ] Idle animation loop
- [ ] Mood-based expression changes

### 5.4 Extension Popup
- [ ] packages/extension/src/popup/App.tsx — compact view
  - Buddy avatar (small)
  - Portfolio value
  - Buddy stage + XP bar
  - Quick action buttons
  - "Open Chat" button → opens sidepanel

### 5.5 Validate & Commit
- [ ] Extension loads as unpacked in Chrome
- [ ] Buddy renders and animates
- [ ] git commit "feat: buddy evolution system and extension shell"

---

## Day 6 (Mar 15) — Extension UI & Chat Interface

### 6.1 Sidepanel Layout
- [ ] packages/extension/src/sidepanel/App.tsx — tab navigation
  - Chat tab (default)
  - Portfolio tab
  - Buddy tab
  - Settings tab

### 6.2 Chat Interface
- [ ] packages/extension/src/sidepanel/Chat.tsx
  - Message list with buddy avatar
  - Input field with send button
  - Connects to execution agent
  - Shows typing indicator while agent processes

### 6.3 Trade Confirmation Component
- [ ] packages/extension/src/sidepanel/TradeConfirm.tsx
  - Modal overlay with trade details
  - Token amounts, price impact, gas, slippage
  - Confirm / Cancel buttons
  - Loading state during execution
  - Success / failure result

### 6.4 Portfolio View
- [ ] packages/extension/src/sidepanel/Portfolio.tsx
  - Total value with 24h change
  - Token list with balances and values
  - Active positions (farms/stakes)

### 6.5 Wallet Connection
- [ ] packages/extension/src/wallet-bridge.ts
  - Detect MetaMask/TrustWallet
  - Request connection
  - Listen for account/chain changes
  - Trigger wallet scan on connect

### 6.6 Settings & API Keys
- [ ] packages/extension/src/sidepanel/Settings.tsx
  - API key management (add/remove/test)
  - Mode toggle (Normal/Trenches)
  - Guardrail config (advanced)

### 6.7 Validate & Commit
- [ ] Full chat flow works in extension
- [ ] Trade confirmation modal works
- [ ] git commit "feat: extension UI with chat and trade confirmation"

---

## Day 7 (Mar 16) — Trenches Mode & Telegram Bot

### 7.1 Token Launch Sniper (Stub)
- [ ] packages/strategies/src/trenches/sniper.ts
  - Listen for PairCreated events on PancakeSwap factory
  - Run safety checks on new token contract
  - Present to user with risk assessment
  - (Auto-buy is stretch goal — manual confirm for demo)

### 7.2 Farm Scanner
- [ ] packages/strategies/src/trenches/farms.ts
  - Fetch yield data from PancakeSwap
  - Score by risk-adjusted APY
  - Return top opportunities

### 7.3 Telegram Bot (Basic)
- [ ] packages/telegram/src/bot.ts — grammy bot init
- [ ] packages/telegram/src/commands/start.ts — wallet linking
- [ ] packages/telegram/src/commands/status.ts — portfolio overview
- [ ] packages/telegram/src/commands/swap.ts — quick swap with inline buttons
- [ ] packages/telegram/src/commands/buddy.ts — buddy stats

### 7.4 Server
- [ ] packages/server/src/index.ts — Express app
- [ ] Market data cache endpoints
- [ ] Telegram webhook handler

### 7.5 Wire OpenClaw Skills
- [ ] Create SKILL.md files that map each tool to a server endpoint or CLI command
- [ ] Each skill: name, description, endpoint (GET/POST), parameters, example response
- [ ] Tools covered: swap_tokens, scan_wallet, get_token_info, check_positions, set_alert, find_farms, snipe_launch
- [ ] Verify OpenClaw can discover and invoke each skill

### 7.6 Validate & Commit
- [ ] Sniper detects new pairs (testnet)
- [ ] Farm scanner returns results
- [ ] Telegram bot responds to basic commands
- [ ] git commit "feat: trenches mode and telegram bot"

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
