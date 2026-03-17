# 🐻 Binance Buddy

> A Tamagotchi-style AI DeFi companion for BNB Chain. Your bear grows as you trade.

Binance Buddy is an autonomous AI agent that manages a BNB Chain wallet, executes DeFi strategies, and evolves a 3D bear companion based on your on-chain activity. It combines a real-time research pipeline, a Claude-powered execution agent, and a gamified progression system into a single dashboard.

---

## Section 1 — The Bear

### Your Companion Evolves With You

The bear isn't cosmetic. It reflects your actual DeFi activity — every swap, yield deposit, and research session earns XP and pushes your bear toward the next stage.

```
    🐻‍❄️              🐻              🐻              🦾🐻             🐻‍🔥
  [ CUB ]         [ TEEN ]        [ ADULT ]       [ GUARDIAN ]     [ APEX ]
 Seedling  ───►   Sprout   ───►    Bloom   ───►   Guardian  ───►    Apex
   0 XP           30 XP           80 XP           150 XP           300 XP
```

| Stage | XP Required | Trenches | Personality |
|---|---|---|---|
| 🌱 **Seedling** | 0 | Locked | Tiny, eager, learning the ropes |
| 🌿 **Sprout** | 30 | Locked | Getting curious, watching the market |
| 🌸 **Bloom** | 80 | **Unlocked** | Confident trader, sharp instincts |
| 🛡️ **Guardian** | 150 | Unlocked | Seasoned, protective, battle-tested |
| ⚡ **Apex** | 300 | Unlocked | Legend of the chain |

Three animated 3D GLB models render in the dashboard — cub, teen, and adult — each with idle animations, mood expressions, and event reactions (bounce on trade success, spin on level-up).

### Earning XP

| Action | XP |
|---|---|
| Trade executed | +30 |
| LP position opened | +30 |
| Vault deposit | +25 |
| Snipe success | +25 |
| Profitable trade | +15 |
| Lending supply | +20 |
| Farm entered | +12 |
| Research action | +10 |
| Wallet scan | +3 |
| Chat interaction | +1 |

---

## Section 2 — AI & Agentic Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        RESEARCH PIPELINE                        │
│                        (every 30 min)                           │
│                                                                 │
│  DeFiLlama API ──► Category Analysis ──► Protocol Deep Dives   │
│       │                                        │                │
│       └──────────────► Claude Haiku ◄──────────┘               │
│                        strategy briefs                          │
│                              │                                  │
│                    ResearchReport in memory                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │  getLatestReport()
┌──────────────────────────────▼──────────────────────────────────┐
│                       EXECUTION AGENT                           │
│                    (on every user message)                      │
│                                                                 │
│  User / Autonomous Mode                                         │
│         │                                                       │
│         ▼                                                       │
│   Claude Sonnet 4 ──► Tool Selection ──► Tool Execution        │
│         ▲                                       │               │
│         └─────────── Tool Result ───────────────┘               │
│                    (up to 8 rounds)                             │
│                                                                 │
│   ┌─────────────────────────────────────────────────────┐      │
│   │                  GUARDRAIL PIPELINE                 │      │
│   │  simulate → spending limit → fee reserve →          │      │
│   │  risk gate → protocol allowlist → execute           │      │
│   └─────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                      AUTONOMOUS MODE                            │
│                    (30-min cycle timer)                         │
│                                                                 │
│  Scan Farms ──► Fetch Wallet Balance ──► Build 3 Steps         │
│                      (60% BNB / 3)              │               │
│                                                 ▼               │
│                              Execute Step 1 → Step 2 → Step 3  │
│                              (5s pause between steps)           │
│                              Skip on failure, stop on CB trip   │
└─────────────────────────────────────────────────────────────────┘
```

### Research Pipeline

Runs every 30 minutes as an in-process cron:

1. **DeFiLlama fetch** — pulls yield pools, protocol TVL, APY data for BSC
2. **Category analysis** — groups protocols into DEX / lending / yield / liquidity
3. **Protocol deep dives** — per-protocol APY trends, risk alerts, pool history
4. **Claude Haiku brief** — generates plain-language strategy recommendations
5. **Report stored in memory** — served to the execution agent on every chat turn via `GET /api/research/latest`

### Execution Agent — 12 Tools

The execution agent is Claude Sonnet 4 with a full tool loop (up to 8 rounds per request):

| Tool | What it does |
|---|---|
| `swap_tokens` | BNB↔token or token↔token via PancakeSwap V2 |
| `deposit_vault` | Deposit into Beefy yield vaults |
| `supply_lending` | Supply assets to Venus lending protocol |
| `add_liquidity` | Add to PancakeSwap V2/V3 liquidity pools |
| `get_research` | Fetch latest research report or protocol deep-dive |
| `resolve_contract` | Resolve token/protocol address (DeFiLlama → Brave Search → on-chain verify) |
| `check_positions` | Fresh scan of all current wallet positions |
| `scan_wallet` | Full wallet state: BNB balance, BEP-20 tokens, USD values |
| `get_token_info` | Token metadata: price, market cap, liquidity, risk flags |
| `find_farms` | Top yield opportunities ranked by risk-adjusted APY |
| `set_alert` | Register price or event alerts |
| `snipe_launch` | Monitor PancakeSwap factory for new pair launches (Trenches mode) |

### Contract Resolution

Addresses are never hallucinated. Every address goes through a 3-step pipeline:

```
Token symbol / name
       │
       ▼
1. SAFE_TOKENS lookup (hardcoded verified addresses)
       │ miss
       ▼
2. DeFiLlama pool cache (BSC pools, filtered by symbol)
       │ miss
       ▼
3. Brave Search → parse result → on-chain verify via symbol() + decimals()
       │
       ▼
Verified contract address (or error — never a guess)
```

### Guardrail Pipeline

Every transaction passes through this pipeline before execution. The LLM cannot bypass it:

```
eth_call simulation → spending limit check → BNB fee reserve check
→ risk gate → protocol allowlist → ✅ execute OR ❌ block with reason
```

- **Normal mode:** 1% max slippage, 1 BNB max per trade, 0.0005 BNB gas reserve
- **Trenches mode:** 15% max slippage, higher position limits, sniper tool unlocked
- **Circuit breaker:** 3 consecutive failures → auto-pause until manual reset

---

## Section 3 — Setup

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
PRIVATE_KEY=0x...              # Agent wallet private key (generate a fresh wallet)
BSC_RPC_URL=https://bsc-dataseed.binance.org/
ANTHROPIC_API_KEY=sk-ant-...

# Strongly recommended
BRAVE_SEARCH_API_KEY=...       # Contract resolution fallback
MORALIS_API_KEY=...            # Full BEP-20 token discovery

# Optional
COVALENT_API_KEY=...           # GoldRush fallback for token data
ANKR_API_KEY=...               # Ankr RPC fallback
COINGECKO_API_KEY=...          # Higher rate limits on price feeds
```

> ⚠️ **Use a dedicated agent wallet.** Generate a fresh private key — never use your main wallet. The agent will autonomously execute trades with whatever BNB you fund it.

### Run

```bash
pnpm exec tsx packages/server/src/index.ts
```

Open **http://localhost:3000**

### Fund & Start

1. Copy the agent wallet address from the dashboard
2. Send BNB to it (0.05–0.1 BNB is enough to start)
3. Chat with Buddy or click **Activate Autonomous** to let it trade

---

## Tech Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 23, TypeScript 5.7, pnpm workspaces |
| Blockchain | ethers.js 6, BSC Mainnet (chain ID 56) |
| AI | Anthropic Claude Sonnet 4 (execution), Claude Haiku (research) |
| DeFi | PancakeSwap V2/V3, Venus Protocol, Beefy Finance |
| Data | DeFiLlama, Moralis, CoinGecko, Brave Search |
| 3D | Three.js r128, GLB models |
| Dashboard | Express + inline HTML/CSS/JS |

## Monorepo Structure

```
packages/
├── core/          # Shared types, constants, guardrail configs
├── blockchain/    # Provider, scanner, DEX executor, LP, lending, vault
├── ai/            # Research agent, execution agent, 12 tools, system prompt
├── buddy/         # Evolution engine, XP system, mood state machine
├── strategies/    # Sniper, farm scanner, risk scoring
├── server/        # Express dashboard + all API endpoints
├── extension/     # Chrome extension (sidepanel + popup)
└── telegram/      # Telegram bot (grammy)
```

---

*Built for the BNB Chain hackathon. The bear is real. The trades are real. Grow your buddy.*
