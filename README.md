# 🐻 Binance Buddy

> An AI-powered DeFi companion for BNB Chain that researches, trades, and grows with you.

Binance Buddy is a hackathon project built for BNB Chain. It executes **real on-chain transactions on BSC mainnet** — swaps, LP positions, vault deposits, and lending — through a Claude-powered chat agent backed by a 30-minute research pipeline. A Tamagotchi-style 3D bear companion evolves as you trade.

> ⚠️ This project executes real transactions on BSC mainnet with real money. Only fund the agent wallet with amounts you're comfortable using for testing.

---

## Setup

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)

### Install

```bash
git clone https://github.com/your-org/binancebuddy
cd binancebuddy
pnpm install
```

### Environment Variables

Create a `.env` file at the project root:

```env
# Required
ANTHROPIC_API_KEY=sk-ant-...        # Claude API key

# Required for trading
AGENT_WALLET_PRIVATE_KEY=0x...      # Dedicated agent wallet (generate fresh — never use your main wallet)
BSC_RPC_URL=https://bsc-dataseed.binance.org/

# Strongly recommended
MORALIS_API_KEY=...                  # Full BEP-20 token discovery and tx history
BRAVE_SEARCH_API_KEY=...             # Contract address resolution fallback

# Optional
COVALENT_API_KEY=...                 # GoldRush fallback for DEX pool data
DUNE_API_KEY=...                     # Deep on-chain analytics
COINGECKO_API_KEY=...                # Higher rate limits on price data
TELEGRAM_BOT_TOKEN=...               # Telegram bot interface
```

> **Note:** If `AGENT_WALLET_PRIVATE_KEY` is not set, a wallet is auto-generated on first run and the address is printed to the console. The key is stored encrypted (AES-256-GCM) in `.agent-keystore.json`.

### Run

```bash
pnpm exec tsx packages/server/src/index.ts
```

Open **http://localhost:3000**

### Fund and Start

1. Copy the agent wallet address shown in the dashboard header
2. Send BNB to it — 0.05–0.1 BNB is enough to start
3. Chat with Buddy: *"What are the best yield opportunities right now?"*
4. Or click **Activate Autonomous** to let it trade on a 30-minute cycle

---

## What It Does

### Research Pipeline

Runs automatically every 30 minutes. Pulls data from 100+ DeFi protocols on BSC via DeFiLlama and organizes it into actionable intelligence:

- **Category summaries** — best APY and TVL across DEX, lending, LP, and yield categories
- **Protocol deep dives** — APY trend charts, fee/revenue data, pool history, IL estimates
- **Claude Haiku strategy briefs** — plain-language recommendation for each protocol
- **Dune Analytics integration** — on-chain holder distribution and transaction volume queries

The research report is injected into every agent conversation so the AI always has current market context before recommending a trade.

### AI Execution Agent

Claude Sonnet 4 runs a tool loop (up to 8 rounds per request) to handle multi-step operations. You can say:

- *"Swap 0.01 BNB for CAKE"* — executes via PancakeSwap V2
- *"Supply 5 USDT to Venus"* — approves, then calls `vToken.mint()`
- *"Add liquidity to the CAKE/BNB pool"* — detects V3 or V2, swaps half, mints position
- *"What are the best yield opportunities right now?"* — pulls live research report

The agent has 13 tools:

| Tool | What it does |
|---|---|
| `swap_tokens` | BNB↔token swaps via PancakeSwap V2 |
| `deposit_vault` | Deposit into Beefy yield vaults |
| `supply_lending` | Supply assets to Venus Protocol |
| `withdraw_lending` | Redeem all supplied tokens from Venus |
| `add_liquidity` | Add to PancakeSwap V2 or V3 pools |
| `withdraw_liquidity` | Remove V3 LP positions and collect tokens |
| `get_research` | Fetch research report or protocol deep-dive |
| `resolve_contract` | Resolve token address (DeFiLlama → Brave Search → on-chain verify) |
| `check_positions` | Fresh scan of all current wallet positions |
| `scan_wallet` | Full wallet state: BNB, BEP-20 tokens, USD values |
| `get_token_info` | Token metadata: price, market cap, liquidity, risk flags |
| `find_farms` | Top yield opportunities ranked by APY |
| `set_alert` | Register price or event alerts |
| `snipe_launch` | Monitor PancakeSwap for new pair launches (Trenches mode) |

### Autonomous Mode

One-click. The agent:

1. Scans live farm opportunities via the PancakeSwap farms API
2. Reads the current wallet balance
3. Builds 3 diversification steps using 60% of available BNB
4. Executes each step sequentially with a 5-second pause between them
5. Skips failed steps, stops if the circuit breaker trips

Repeats every 30 minutes. Manual override available at any time.

### 3D Buddy Evolution

A Tamagotchi-style bear rendered in Three.js (r128, GLB models). The bear evolves through 5 stages based on accumulated XP from real on-chain activity. Each stage has a different 3D model and idle animation.

Reactions: bounces on XP gain, spins on successful trade execution.

### Portfolio Overview

Real-time token holdings via Moralis API with full token names, contract addresses, and USD values. Includes a direct transfer panel to move tokens out of the agent wallet if a swap fails.

### Safety Features

- **Guardrail pipeline**: every transaction is simulated via `eth_call` before submission. Spending limit, gas reserve, risk gate, and protocol allowlist checks run before any `eth_sendRawTransaction`.
- **Circuit breaker**: 3 consecutive failures pauses autonomous trading until manually reset.
- **Transfer failsafe**: if a swap fails, tokens can be sent directly to any address from the dashboard without going through the agent.
- **Retry logic**: tax/fee-on-transfer tokens (that reject full-amount transfers) are retried at 99% → 95% → 90% → 80% of balance.

---

## Agent Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      RESEARCH LAYER                          │
│                      (every 30 min)                          │
│                                                              │
│  DeFiLlama API ──► Category Summaries ──► Protocol Dives    │
│  Dune Analytics ──► On-chain queries                         │
│                              │                               │
│                       Claude Haiku                           │
│                       strategy briefs                        │
│                              │                               │
│                   ResearchReport (in-memory)                 │
└──────────────────────────────┬───────────────────────────────┘
                               │ injected into every chat turn
┌──────────────────────────────▼───────────────────────────────┐
│                       AGENT LAYER                            │
│                    (on every user message)                   │
│                                                              │
│       User message / Autonomous step                         │
│               │                                              │
│               ▼                                              │
│       Claude Sonnet 4                                        │
│       ├── Tool call ──► tool handler ──► result             │
│       ├── Tool call ──► tool handler ──► result             │
│       └── end_turn ──► response to user                     │
│                    (up to 8 rounds)                          │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                     EXECUTION LAYER                          │
│                                                              │
│  simulate (eth_call) → spending limit → fee reserve         │
│  → risk gate → protocol allowlist → execute                 │
│                                                              │
│  PancakeSwap V2 Router      ── swaps                        │
│  PancakeSwap V3 Position Mgr ── LP mint / withdraw          │
│  Venus Comptroller          ── lending supply / redeem      │
│  Beefy Finance API          ── vault deposits               │
└──────────────────────────────────────────────────────────────┘
```

---

## Buddy Evolution

![Buddy Evolution](Evolutions.png)

| Stage | XP | Model | Notes |
|---|---|---|---|
| 🌱 Seedling | 0 | Bear cub | Starting stage |
| 🌿 Sprout | 30 | Bear cub | Trenches locked |
| 🌸 Bloom | 80 | Teen bear | Trenches unlocked |
| 🛡️ Guardian | 150 | Adult bear | |
| ⭐ Apex | 300 | Adult bear | Final form |

**XP Sources:**

| Action | XP |
|---|---|
| Trade / LP entry | +30 |
| Vault deposit | +25 |
| Lending supply | +20 |
| Research action | +10 |
| Wallet scan | +3 |
| Chat interaction | +1 |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.7, Node.js 23 |
| Monorepo | pnpm workspaces, Turborepo |
| Blockchain | ethers.js v6, BSC Mainnet (chain ID 56) |
| AI | Claude Sonnet 4 (execution agent), Claude Haiku (research briefs) |
| DeFi protocols | PancakeSwap V2/V3, Venus Protocol, Beefy Finance |
| Data sources | DeFiLlama, Moralis, CoinGecko, GoldRush (Covalent), Dune Analytics |
| 3D rendering | Three.js r128, GLB models |
| Dashboard | Express + embedded HTML/CSS/JS (no frontend build step) |
| Extension | React 18 + Tailwind CSS (Chrome MV3) |
| Telegram | grammy |

### Monorepo Structure

```
packages/
├── core/          # Shared types, constants, resolveToken, BigInt serializer
├── blockchain/    # Provider, scanner, DEX executor, LP, lending, vaults, ABIs
├── ai/            # Research pipeline, execution agent, 13 tools, system prompt
├── buddy/         # Evolution engine, XP system, mood state machine
├── strategies/    # Sniper, farm scanner, risk scoring
├── server/        # Express server — dashboard + all REST endpoints
├── extension/     # Chrome extension (sidepanel + popup)
└── telegram/      # Telegram bot with swap/status/buddy commands
```

---

## What Works / Known Limitations

### Confirmed working on BSC mainnet

- BNB → token swaps via PancakeSwap V2 (CAKE, USDT, FDUSD confirmed)
- Venus lending: supply and withdraw (USDT confirmed)
- PancakeSwap V3 LP: position mint and withdrawal via NonfungiblePositionManager
- Research pipeline: DeFiLlama data, Claude Haiku briefs, protocol deep dives
- Autonomous trading mode: farm scan → balance check → multi-step execution
- Buddy XP and evolution: all 5 stages with 3D model transitions

### Known issues

- **Token → BNB swaps** are unreliable for some Binance-Peg tokens. BNB → token direction always works.
- **Fee-on-transfer tokens** (e.g. tokens with a transfer tax) reject standard `transfer()` calls at full balance. Retry logic at reduced amounts (99% → 80%) is implemented but not guaranteed.
- **V3 LP entry** is sensitive to price movement between the swap step and the mint step. `amount0Min` and `amount1Min` are set to 0 for full-range positions to avoid slippage-check reverts.
- **Guardrail spending limit** is currently disabled — it compared raw token amounts against a BNB threshold (e.g. 2 USDT > 1 BNB limit = blocked). Needs USD-denominated comparison to be useful.
- **Research data** for small pools is noisy — APY displayed for pools under $10k TVL is filtered out.

---

*Built for the BNB Chain hackathon. The bear is real. The trades are real.*
