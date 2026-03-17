# Binance Buddy

A Tamagotchi-style AI companion for BNB Chain DeFi. Built for the BNB Chain hackathon.

Your Buddy lives on the BSC blockchain. It scans the market, finds yield opportunities, and executes DeFi actions on your behalf — swaps, lending, liquidity provision, and autonomous portfolio moves. It evolves as you trade.

---

## Demo Flow

> **Note:** Token→BNB swaps are currently excluded from the demo due to a BSC mainnet revert issue. All BNB→token and multi-step flows work.

### 1. Research Pipeline

The research agent runs in the background every 30 minutes, pulling live data from DeFiLlama.

1. Open the dashboard at `http://localhost:3000`
2. Click **Lending** in the Research panel → see Venus, Alpaca, and other BSC lending protocols with live TVL and best APY
3. Click any protocol row → deep dive: top pools, strategy brief (Claude Haiku), APY/TVL charts
4. Click **Liquidity Providing** → PancakeSwap, Thena, and other DEX pools with volume and fee APY

### 2. Agent Chat

1. In the Agent Chat panel, type: `what tokens do I hold?`
   - Buddy calls `check_positions`, scans all BEP-20 tokens via GoldRush, returns live balances
2. Type: `where should I put my BNB to earn yield?`
   - Buddy calls `get_research` for current opportunities, returns top picks with real APY numbers
3. Type: `find farms`
   - Buddy calls `find_farms`, shows ranked PancakeSwap V2 farms with risk scores

### 3. BNB → Token Swap

**Via agent chat:**
```
Swap 0.01 BNB for USDT
```
- Buddy calls `swap_tokens` → PancakeSwap V2 quote → approval check → executes on-chain → reports tx hash in one line

**Via Trade panel (direct, no LLM):**
1. Set **From** to BNB, **To** to CAKE, **Amount** to 0.01
2. Click **Swap** → hits `/api/swap/execute` directly → result + BSCScan link

### 4. Venus Lending Supply

**Via agent chat (multi-step, fully autonomous):**
```
Supply USDT to Venus
```
Buddy orchestrates:
1. Calls `check_positions` → sees wallet has USDT or 0 USDT
2. If no USDT: calls `swap_tokens(BNB → USDT, small amount)` automatically
3. Calls `supply_lending(USDT)` → resolves vUSDT via Venus Comptroller → ERC-20 approve → vToken.mint()
4. Reports: `Supplied 5.2 USDT to Venus. Tx: 0xabc...`

**Via Research panel (one click):**
1. Go to **Lending** → Venus core pool
2. Click **[Supply →]** on the USDT row → message sent to agent chat → agent executes

### 5. Buddy Evolution

Every action awards XP:

| Action | XP |
|---|---|
| Trade executed | 30 |
| Lending supply | 20 |
| LP entry | 30 |
| Vault deposit | 25 |
| Chat interaction | 1 |
| Research viewed | 10 |

Evolution stages: **Seedling** (0) → **Sprout** (30) → **Bloom** (80) → **Guardian** (150) → **Apex** (300)

Watch the 3D bear model in the top-left panel. It bounces on XP gain, spins on trade execution, and changes model on evolution.

Trenches Mode unlocks at Bloom (80 XP) — enables sniper, higher slippage (15%), larger trade limits.

### 6. Autonomous Mode

1. Open the **Autonomous Mode** panel
2. Click **Scan Farms** → Buddy finds current PancakeSwap farm opportunities
3. Click **Activate Autonomous** → the page scrolls to Agent Chat so you can watch live:
   - **Phase 1:** Buddy plans 3 small trades with reasoning
   - **Phase 2:** Executes each step sequentially (5s between steps) — you see every tool call and tx hash in chat
   - **Phase 3:** Complete — activity log shows summary

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     packages/server                          │
│  Express dashboard + REST API (port 3000)                   │
│  All endpoints callable by OpenClaw runtime                 │
└────────────┬────────────────────────────────────────────────┘
             │
     ┌───────┼──────────────┐
     ▼       ▼              ▼
┌─────────┐ ┌────────┐ ┌──────────┐
│   ai    │ │blockchain│ │  buddy  │
│ agent   │ │ DEX     │ │  XP     │
│ research│ │ lending │ │ moods   │
│ tools   │ │ LP      │ │ stages  │
│ prompts │ │ yield   │ └──────────┘
└─────────┘ └────────┘
     │
     ▼
Claude Sonnet 4.6 (Execution Agent)
Claude Haiku (Research Briefs)
```

**Dual-agent pattern:**
- **Research Agent** (slow, 30-min cadence) → pulls DeFiLlama, GoldRush, Brave → writes report to memory
- **Execution Agent** (fast, per message) → reads latest report + wallet state → plans + executes → reports

**Guardrails run at the engine layer, not the AI layer.** The LLM cannot bypass simulation, spending limits, or approval checks. All guardrail checks are disabled for demo mode.

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node 23, TypeScript 5.7, pnpm workspaces, Turborepo |
| Blockchain | ethers.js 6, BSC mainnet, PancakeSwap V2/V3, Venus, Beefy |
| AI | Claude Sonnet 4.6 (execution), Claude Haiku (research briefs) |
| Data | DeFiLlama, GoldRush/Covalent, Brave Search, CoinGecko |
| Frontend | Inline HTML dashboard, Three.js r128 (3D buddy), Chart.js v4 |
| Extension | Chrome MV3, React 18, Tailwind CSS, Vite |
| Telegram | grammy, OpenClaw runtime integration |

---

## Setup

```bash
# Install
pnpm install

# Configure
cp .env.example .env
# Required: ANTHROPIC_API_KEY
# Optional: MORALIS_API_KEY (tx history), COVALENT_API_KEY (full token scan)

# Build dependencies
pnpm --filter @binancebuddy/core build
pnpm --filter @binancebuddy/blockchain build
pnpm --filter @binancebuddy/buddy build
pnpm --filter @binancebuddy/ai build

# Start
pnpm --filter @binancebuddy/server dev
# → http://localhost:3000

# Tests
pnpm test
```

The server auto-generates an agent wallet on first run and prints the address to console. Fund it with a small amount of BNB (0.05 BNB is enough for the demo) before attempting swaps.

---

## Known Limitations

- **Token→BNB swaps revert on-chain.** Root cause under investigation (likely BSC mainnet RPC state divergence during simulation). BNB→token swaps work. Demo all buy-side flows.
- **GoldRush token scan** requires `COVALENT_API_KEY`. Without it, `check_positions` falls back to the 11-token SAFE_TOKENS list.
- **Research report** is in-memory only. Restarting the server clears it — click Background ↺ to regenerate.
- **Extension** built but not E2E tested in browser. The server API it talks to is production-ready.
- **Telegram bot** wired and functional; requires `TELEGRAM_BOT_TOKEN` and a public webhook URL.

---

## Packages

| Package | Description |
|---|---|
| `@binancebuddy/core` | Shared types, constants, `resolveToken`, BigInt serializer |
| `@binancebuddy/blockchain` | Provider, wallet scanner, DEX executor, lending, vault, LP |
| `@binancebuddy/ai` | Research agent, execution agent, 12 tools, system prompt |
| `@binancebuddy/buddy` | XP, evolution stages, mood engine |
| `@binancebuddy/strategies` | Sniper, farm scorer, risk scoring |
| `@binancebuddy/server` | Express server, all REST endpoints, dashboard HTML |
| `@binancebuddy/extension` | Chrome extension (popup + sidepanel) |
| `@binancebuddy/telegram` | Telegram bot (grammy) |
