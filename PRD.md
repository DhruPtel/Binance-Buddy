# PRD.md — Binance Buddy Product Requirements Document

## Product Overview
Binance Buddy is a Tamagotchi-style AI blockchain companion for BNB Chain. It lives as a Chrome browser extension alongside the user's wallet and provides research, trading, and portfolio management through an evolving 3D voxel creature that grows with the user's blockchain journey.

## Target Users
1. **Curious Newcomer** — Just arrived on BSC, needs a friendly guide
2. **Active DeFi User** — Farms on PancakeSwap/Venus, needs monitoring and optimization
3. **Degen Trader** — Lives in Trenches Mode, wants sniping and aggressive yield farming

## Core Value Proposition
An AI companion that understands YOUR wallet, YOUR trading patterns, and YOUR risk appetite — then helps you research, strategize, and execute trades on BNB Chain with personality.

---

## Features — In Scope (8-Day Hackathon)

### F1: Wallet Scanner & Profile Builder
- Connect wallet via browser extension (MetaMask, Trust Wallet injection)
- Scan BNB balance + all BEP-20 token balances
- Fetch and categorize last 500 transactions (swap, farm, stake, transfer, NFT, bridge)
- Map contract addresses to known protocols (PancakeSwap, Venus, Alpaca, Thena)
- Generate trader profile: archetype, risk score, preferred protocols, trading frequency
- Profile drives buddy personality and initial strategy suggestions

### F2: Dual Agent Architecture (Research + Execution)
- **Research Agent**: Runs on slower cadence (every 30 min). Scans token prices, pool TVL, yield rates, liquidity depth. Monitors large withdrawals, depegs, oracle deviations. Outputs structured research reports.
- **Execution Agent**: Reads portfolio + research reports + user mandate. Recommends actions using defined tools (swap, scan, alert, farm-check). Each recommendation filtered by risk level, allowed protocols, dedup. One recommendation executed per cycle through guardrail pipeline.
- Research feeds Execution — they are separate AI loops with separate context windows.

### F3: DEX Trading Engine
- PancakeSwap V2/V3 swap execution on BSC
- Quote fetching with price impact calculation
- Slippage management (1% normal, up to 15% trenches)
- Token approval handling (automatic approve before swap)
- Transaction simulation via eth_call before every execution
- Confirmation UI: show amounts, gas, slippage, price impact before user approves

### F4: Buddy Personality & Evolution System
- 3D voxel-style creature rendered in the extension (Three.js)
- 3 base creatures to choose from at onboarding
- 5 evolution stages: Seedling → Sprout → Bloom → Guardian → Apex
- XP earned from trades, interactions, daily check-ins, profitable trades
- Mood system: Ecstatic, Happy, Neutral, Worried, Anxious — driven by portfolio performance
- Animations for different events: trade executed, profit, loss, level up, idle, celebrating
- Personality affects response tone and language complexity

### F5: Trenches Mode
- Unlocks at Guardian stage (2000 XP)
- Token launch sniper: monitor PancakeSwap factory for new pairs, safety checks, auto-buy
- High-APY farm scanner: aggregate yields from BSC protocols, risk-adjusted ranking
- Higher slippage tolerance, faster execution, optional auto-approve below threshold
- Risk warnings always shown — never hidden even in aggressive mode

### F6: API-Modular Protocol Integration
- Settings section where users plug in their own API keys (BSCScan, Birdeye, DeFiLlama, protocol-specific APIs)
- Each API key unlocks deeper capabilities for that protocol
- Agent dynamically gains new tools based on available API keys
- Reduces need to hardcode every protocol — user-driven extensibility

### F7: Chrome Extension Interface
- Manifest V3 Chrome extension
- Popup: Quick buddy status, portfolio snapshot, alerts
- Sidepanel: Full chat interface, trade confirmations, portfolio details, buddy avatar
- Wallet connection via injected provider (MetaMask/TrustWallet)

### F8: Telegram Bot (Basic)
- /start — Link wallet
- /status — Portfolio overview + buddy mood
- /swap — Quick swap with inline confirmation
- /buddy — See buddy stage, XP, mood
- Free text chat for basic queries

### F9: Guardrail Safety System
- All guardrails enforce at ENGINE layer, not AI layer
- Simulate every transaction via eth_call
- Spending limits per transaction
- BNB fee reserve (0.005 BNB minimum)
- Protocol allowlist/blocklist
- Circuit breaker: 3 consecutive failures → auto-pause
- One recommendation per execution cycle
- Risk scoring: contract verification, mint authority, freeze authority, liquidity lock

---

## Features — Out of Scope (Post-Hackathon)
- MEV transactions and sandwich strategies
- Arbitrage execution
- Cross-chain bridging
- Self-customizing plugin system (AI generates new tools at runtime)
- CEX integration via Binance API keys
- Multi-chain support beyond BSC
- Advanced whale tracking with on-chain alerts
- NFT trading and analysis
- Social trading / copy trading

---

## Success Criteria
1. User connects wallet → buddy scans and summarizes portfolio within 10 seconds
2. User can execute a PancakeSwap swap through chat ("swap 0.1 BNB for CAKE")
3. Buddy visually evolves after accumulating enough XP
4. Research agent produces useful strategy suggestions based on wallet profile
5. Trenches mode successfully detects new token launches
6. Demo video shows complete flow in under 3 minutes

---

## Non-Goals
- This is NOT a custodial wallet — we never hold private keys
- This is NOT financial advice — always disclaim
- This is NOT a replacement for a full trading terminal
- We do NOT store user data on a server — wallet data lives locally in the extension
