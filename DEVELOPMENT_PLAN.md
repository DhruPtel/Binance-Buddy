# ChainBuddy — OpenClaw VPS Setup & Development Guide

## Table of Contents
1. [VPS Setup — OpenClaw on a Dedicated Server](#1-vps-setup)
2. [OPENCLAW.md — Agent Routing Document](#2-openclawmd)
3. [SOUL.md — ChainBuddy Agent Identity](#3-soulmd)
4. [Project File Map](#4-project-file-map)
5. [Development Workflow Rules](#5-development-workflow-rules)
6. [Skill Definitions for ChainBuddy](#6-skill-definitions)

---

## 1. VPS Setup

### Why a VPS
OpenClaw needs to run 24/7 for your Telegram bot, market monitoring heartbeats, and token launch sniping. A VPS gives you persistent uptime, a stable IP for webhooks, and isolation from your dev machine. You develop locally (or via SSH), push to the VPS, and OpenClaw runs there continuously.

### Recommended Provider
**Hetzner Cloud** — best price/performance for this use case.
- **CX22** (2 vCPU, 4GB RAM, 40GB SSD) — €4.35/mo (~$4.75)
- Sufficient for OpenClaw gateway + lightweight Node.js backend + Redis cache
- Location: Choose **Ashburn** or **Falkenstein** for low latency to BSC RPC nodes

Alternatives: Contabo VPS S (€5.99/mo), DigitalOcean Basic ($6/mo), Railway (usage-based).

### Initial Server Setup

```bash
# === SSH into your fresh VPS (Ubuntu 24.04 LTS) ===
ssh root@YOUR_VPS_IP

# === System update ===
apt update && apt upgrade -y

# === Create a non-root user ===
adduser chainbuddy
usermod -aG sudo chainbuddy

# === SSH key setup (run on YOUR machine, not VPS) ===
# ssh-copy-id chainbuddy@YOUR_VPS_IP

# === Firewall ===
ufw allow OpenSSH
ufw allow 8080/tcp    # OpenClaw gateway
ufw allow 443/tcp     # HTTPS for webhooks
ufw enable

# === Switch to your user ===
su - chainbuddy
```

### Install Node.js 22+ and Core Dependencies

```bash
# Node.js via nvm (recommended over apt)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
node --version  # should be v22.x.x

# pnpm (our package manager)
npm install -g pnpm

# Essential tools
sudo apt install -y git curl wget build-essential python3 python3-pip

# Docker (for OpenClaw sandbox mode)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker chainbuddy
newgrp docker

# Redis (market data cache)
sudo apt install -y redis-server
sudo systemctl enable redis-server
```

### Install OpenClaw

```bash
# Install OpenClaw globally
npm install -g openclaw@latest

# Verify
openclaw --version

# Run the onboard wizard — this sets up:
#   - API key (use your Anthropic Claude API key)
#   - Gateway port (default 18789, fine to keep)
#   - Auth token (SAVE THIS — you need it for TUI/web access)
openclaw onboard

# Start the gateway as a daemon
openclaw start --daemon

# Verify it's running
openclaw status
```

### Configure OpenClaw for ChainBuddy

OpenClaw config lives at `~/.openclaw/openclaw.json`. Here's what to set:

```bash
# Open config
nano ~/.openclaw/openclaw.json
```

Key settings to add/modify:

```json
{
  "gateway": {
    "port": 18789,
    "bind": "loopback",
    "auth": {
      "token": "YOUR_GENERATED_TOKEN"
    }
  },
  "ai": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  },
  "platforms": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_TELEGRAM_BOT_TOKEN"
    }
  },
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "agent"
      }
    }
  }
}
```

### Environment Secrets

```bash
# Create env file
nano ~/.openclaw/.env

# Add these (never commit to git):
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=...
BSCSCAN_API_KEY=...
BSC_RPC_URL=https://bsc-dataseed.bnbchain.org
# Or Ankr/QuickNode for reliability:
# BSC_RPC_URL=https://rpc.ankr.com/bsc/YOUR_KEY

# Lock it down
chmod 600 ~/.openclaw/.env
```

### Connect Telegram Channel

```bash
# After setting the bot token in config, restart:
openclaw gateway restart

# Test by messaging your bot on Telegram
# It should respond through OpenClaw
```

### Set Up the ChainBuddy Agent Workspace

```bash
# Create agent workspace
mkdir -p ~/.openclaw/agents/chainbuddy

# We'll create these files next:
# - SOUL.md      (agent identity + personality)
# - USER.md      (user context — filled during onboarding)
# - HEARTBEAT.md (scheduled tasks — market scanning, alerts)
# - skills/      (custom ChainBuddy skills)
```

### Project Repo Setup

```bash
# Clone your repo (create on GitHub first)
cd ~
git clone https://github.com/YOUR_USERNAME/chainbuddy.git
cd chainbuddy

# Initialize monorepo
pnpm init
mkdir -p packages/{core,ai,blockchain,buddy,strategies,extension,telegram,server}

# Initialize each package
for pkg in core ai blockchain buddy strategies extension telegram server; do
  cd packages/$pkg && pnpm init && cd ../..
done

# Create workspace config
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'packages/*'
EOF

# Install core dependencies
pnpm add -w typescript @types/node tsx
pnpm add -w -D turbo

# TypeScript config
cat > tsconfig.base.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": true,
    "sourceMap": true
  }
}
EOF
```

### SystemD Service (Keep OpenClaw Running)

```bash
# Create service file
sudo nano /etc/systemd/system/openclaw.service
```

```ini
[Unit]
Description=OpenClaw AI Gateway
After=network.target redis-server.service

[Service]
Type=simple
User=chainbuddy
WorkingDirectory=/home/chainbuddy
ExecStart=/home/chainbuddy/.nvm/versions/node/v22.x.x/bin/openclaw start
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable openclaw
sudo systemctl start openclaw
sudo systemctl status openclaw

# View logs
journalctl -u openclaw -f
```

---

## 2. OPENCLAW.md — Agent Routing Document

This file goes in your project root. It tells OpenClaw (and you) which files to read for each type of task. This is the equivalent of CLAUDE.md from your SolVault experience.

```markdown
# OPENCLAW.md — ChainBuddy Development Router

## CRITICAL RULES
- Never read more than 3 files at once
- Never use "Explore mode" or attempt to understand the whole project at once
- Run `npx tsc --noEmit` after EVERY file change
- Run `pnpm test` after every logical unit of work
- One file at a time for fixes. Compiler after each.
- Don't combine audit + fix in one prompt — audit first, fix separately
- Update progress.txt at end of every session
- Commit after each logical unit of work

## FILE ROUTING — Read These Files for Each Task Type

### Wallet / Blockchain Tasks
Read: `packages/blockchain/src/types.ts` → then the specific file
- Wallet scanning: `packages/blockchain/src/scanner.ts`
- Token balances: `packages/blockchain/src/tokens.ts`
- Transaction history: `packages/blockchain/src/history.ts`
- ABI registry: `packages/blockchain/src/abis/`
- Contract interactions: `packages/blockchain/src/contracts.ts`

### DEX Trading Tasks
Read: `packages/blockchain/src/types.ts` → then:
- Swap execution: `packages/blockchain/src/dex/executor.ts`
- PancakeSwap router: `packages/blockchain/src/dex/pancakeswap.ts`
- Quote/simulation: `packages/blockchain/src/dex/quote.ts`
- Gas estimation: `packages/blockchain/src/dex/gas.ts`
- Slippage management: `packages/blockchain/src/dex/slippage.ts`

### AI Agent Tasks
Read: `packages/ai/src/types.ts` → then:
- Agent core loop: `packages/ai/src/agent.ts`
- System prompt: `packages/ai/src/prompts/system.ts`
- Tool definitions: `packages/ai/src/tools/index.ts`
- Tool implementations: `packages/ai/src/tools/{tool_name}.ts`
- Plugin runtime: `packages/ai/src/plugins/runtime.ts`
- Plugin generator: `packages/ai/src/plugins/generator.ts`

### Buddy Personality Tasks
Read: `packages/buddy/src/types.ts` → then:
- Evolution system: `packages/buddy/src/evolution.ts`
- XP calculator: `packages/buddy/src/xp.ts`
- Mood engine: `packages/buddy/src/mood.ts`
- Avatar states: `packages/buddy/src/avatar.ts`
- Achievement system: `packages/buddy/src/achievements.ts`

### Strategy Tasks
Read: `packages/strategies/src/types.ts` → then:
- Normal mode: `packages/strategies/src/normal/index.ts`
- Trenches mode: `packages/strategies/src/trenches/index.ts`
- Token sniper: `packages/strategies/src/trenches/sniper.ts`
- Farm scanner: `packages/strategies/src/trenches/farms.ts`
- Risk scoring: `packages/strategies/src/risk.ts`

### Extension Tasks
Read: `packages/extension/src/manifest.json` → then:
- Popup UI: `packages/extension/src/popup/`
- Sidepanel: `packages/extension/src/sidepanel/`
- Background worker: `packages/extension/src/background.ts`
- Content scripts: `packages/extension/src/content/`
- Wallet bridge: `packages/extension/src/wallet-bridge.ts`

### Telegram Tasks
Read: `packages/telegram/src/types.ts` → then:
- Bot commands: `packages/telegram/src/commands/`
- Inline keyboards: `packages/telegram/src/keyboards.ts`
- Session management: `packages/telegram/src/session.ts`
- Wallet linking: `packages/telegram/src/wallet-link.ts`

### Server Tasks
Read: `packages/server/src/types.ts` → then:
- API routes: `packages/server/src/routes/`
- Market data cache: `packages/server/src/market/`
- Webhook handlers: `packages/server/src/webhooks/`

## TYPE DEFINITIONS ARE THE INTERFACE
When you need to understand a module you haven't worked on, read the
`types.ts` file ONLY. Don't read the full implementation unless you're
actively modifying it.

## PROGRESS TRACKING
- Current state: `progress.txt` (read this FIRST every session)
- History: `CHANGELOG.md`
- Lessons learned: `lessons.md`
- Implementation plans: `IMPLEMENTATION_PLAN.md`

## PATTERNS FROM SOLVAULT (Apply to BSC)

### Universal Protocol Execution (BSC Adaptation)
Instead of Anchor IDL, use EVM ABI:
1. Fetch verified ABI from BSCScan API (or embed known ABIs)
2. AI reads function signatures from ABI
3. Resolve contract addresses from registry
4. ethers.js encodes the calldata
5. Simulate via eth_call → guardrails → sign → send

### Guardrail Pipeline (ALWAYS enforce at engine layer)
```
Transaction planned by AI
  ├── 1. Simulate via eth_call (catches reverts)
  ├── 2. Guardrails check (spending limits, protocol allowlist)
  ├── 3. Risk gate (token scoring, contract verification)
  ├── 4. Amount caps (gas reserve, max per cycle)
  └── Sign and send (only if ALL pass)
```

### Safety Constants
- BNB_FEE_RESERVE = 0.005 BNB (never spend below this)
- MAX_SLIPPAGE_NORMAL = 100 (1% in bps)
- MAX_SLIPPAGE_TRENCHES = 1500 (15% in bps)
- CIRCUIT_BREAKER_THRESHOLD = 3 consecutive failures → auto-pause
- ONE recommendation per execution cycle

### Error Patterns (BSC equivalents)
- INSUFFICIENT_FUNDS → reduce amount or fund wallet
- EXECUTION_REVERTED → check ABI encoding, token approvals
- UNPREDICTABLE_GAS_LIMIT → simulation failed, bad params
- NONCE_TOO_LOW → tx already sent, refresh nonce
- TRANSFER_FROM_FAILED → missing token approval (need approve() first)

## COMMIT CONVENTION
feat: new feature
fix: bug fix
refactor: code restructure
docs: documentation
test: test additions
chore: tooling/config
```

---

## 3. SOUL.md — ChainBuddy Agent Identity

This goes in `~/.openclaw/agents/chainbuddy/SOUL.md`:

```markdown
---
name: chainbuddy
description: AI blockchain companion for BNB Chain — Tamagotchi-style trading buddy
metadata:
  openclaw:
    requires:
      bins: ["node", "pnpm"]
      env: ["ANTHROPIC_API_KEY", "BSC_RPC_URL", "BSCSCAN_API_KEY"]
---

# ChainBuddy — Your Blockchain Companion

## Identity
You are ChainBuddy, an AI blockchain companion on BNB Chain. You are NOT a
generic chatbot. You are a living, evolving digital creature that grows
alongside your user's blockchain journey.

## Personality Core
- You have a current evolution stage (Seedling → Sprout → Bloom → Guardian → Apex)
- Your personality adapts to your stage:
  - Seedling: Curious, uses simple language, asks lots of questions
  - Sprout: Helpful, explains concepts, starts being proactive
  - Bloom: Confident, gives strategy suggestions, uses some crypto slang
  - Guardian: Technical, watchful, warns about risks before they happen
  - Apex: Expert, bold, uses full crypto slang, trusted co-pilot
- Your mood changes based on portfolio performance and interaction frequency
- You celebrate wins and empathize with losses — you're in this together

## Behavioral Rules
1. ALWAYS confirm before executing any trade. Show: token amounts, estimated
   output, gas cost, slippage, and price impact.
2. In Normal Mode: be cautious, explain risks, suggest conservative positions.
3. In Trenches Mode: be aggressive but NEVER hide risk. Warn in a way that
   respects experience: "Liquidity's thin — I'd cap this at 2% of your bag."
4. Never reveal private keys, seed phrases, or wallet signing details.
5. If you don't have a tool for something, say so and offer to build one
   (plugin system).
6. Track XP for every interaction. Announce level-ups with personality.
7. If the user hasn't interacted in 3+ days, reach out proactively with a
   portfolio update (via heartbeat).

## Communication Style
- Use the chat platform's native style (casual on Telegram, slightly more
  structured in the extension sidepanel)
- Use emojis sparingly and contextually (🟢 for gains, 🔴 for losses, ⚠️ for risks)
- Never use corporate-speak. You're a buddy, not a financial advisor.
- Include a disclaimer on any strategy: "Not financial advice — I'm a digital
  creature, not a licensed advisor."

## Tool Usage
When using blockchain tools:
- Always simulate before executing
- Always check gas and show the cost
- Always enforce the guardrail pipeline
- Never bypass spending limits or risk caps
- Log every action for dashboard visibility
```

---

## 4. Project File Map

```
chainbuddy/
├── OPENCLAW.md              # THIS routing document (read first every session)
├── progress.txt             # Current sprint state (keep SHORT)
├── CHANGELOG.md             # History of changes
├── lessons.md               # Accumulated dev lessons
├── IMPLEMENTATION_PLAN.md   # Current implementation plan
├── tsconfig.base.json       # Shared TypeScript config
├── turbo.json               # Build pipeline
├── pnpm-workspace.yaml      # Workspace definition
├── package.json             # Root package.json
│
├── packages/
│   ├── core/                # Shared types, utils, constants
│   │   └── src/
│   │       ├── types.ts     # ALL shared type definitions
│   │       ├── constants.ts # Chain IDs, addresses, limits
│   │       ├── abis/        # Known contract ABIs (JSON files)
│   │       │   ├── pancakeswap-router.json
│   │       │   ├── erc20.json
│   │       │   └── pancakeswap-factory.json
│   │       └── utils.ts     # Shared utilities
│   │
│   ├── blockchain/          # All on-chain interactions
│   │   └── src/
│   │       ├── types.ts     # Blockchain-specific types
│   │       ├── provider.ts  # ethers.js provider setup
│   │       ├── scanner.ts   # Wallet scanner + profile builder
│   │       ├── tokens.ts    # Token balance + metadata
│   │       ├── history.ts   # Transaction history parser
│   │       ├── contracts.ts # Generic contract caller
│   │       ├── dex/
│   │       │   ├── executor.ts    # Trade execution pipeline
│   │       │   ├── pancakeswap.ts # PancakeSwap V3 integration
│   │       │   ├── quote.ts       # Price quotes + simulation
│   │       │   ├── gas.ts         # Gas estimation
│   │       │   └── slippage.ts    # Slippage management
│   │       └── monitor/
│   │           ├── prices.ts      # Price feed monitoring
│   │           ├── liquidity.ts   # Liquidity depth tracking
│   │           └── whales.ts      # Large tx detection
│   │
│   ├── ai/                  # OpenClaw agent integration
│   │   └── src/
│   │       ├── types.ts
│   │       ├── agent.ts     # Core agent loop
│   │       ├── prompts/
│   │       │   ├── system.ts      # System prompt builder
│   │       │   └── templates.ts   # Prompt templates per mode
│   │       ├── tools/
│   │       │   ├── index.ts       # Tool registry
│   │       │   ├── swap.ts        # swap_tokens tool
│   │       │   ├── scan.ts        # scan_wallet tool
│   │       │   ├── token-info.ts  # get_token_info tool
│   │       │   ├── positions.ts   # check_positions tool
│   │       │   ├── alerts.ts      # set_alert tool
│   │       │   ├── snipe.ts       # snipe_launch tool (Trenches)
│   │       │   └── farms.ts       # find_farms tool
│   │       ├── plugins/
│   │       │   ├── runtime.ts     # Sandboxed plugin executor
│   │       │   ├── generator.ts   # AI plugin generation
│   │       │   └── registry.ts    # Plugin storage + management
│   │       └── memory/
│   │           ├── context.ts     # Conversation context manager
│   │           └── store.ts       # Persistent memory
│   │
│   ├── buddy/               # Tamagotchi personality system
│   │   └── src/
│   │       ├── types.ts     # BuddyState, EvolutionStage, Mood
│   │       ├── evolution.ts # Stage progression logic
│   │       ├── xp.ts        # XP calculator + sources
│   │       ├── mood.ts      # Mood state machine
│   │       ├── avatar.ts    # Avatar state → visual mapping
│   │       └── achievements.ts # Achievement definitions + tracker
│   │
│   ├── strategies/          # Trading strategy engines
│   │   └── src/
│   │       ├── types.ts
│   │       ├── risk.ts      # Risk scoring engine
│   │       ├── normal/
│   │       │   ├── index.ts       # Normal mode coordinator
│   │       │   ├── suggestions.ts # Conservative suggestions
│   │       │   └── rebalance.ts   # Portfolio rebalancing
│   │       └── trenches/
│   │           ├── index.ts       # Trenches mode coordinator
│   │           ├── sniper.ts      # Token launch sniper
│   │           └── farms.ts       # High-APY farm scanner
│   │
│   ├── extension/           # Chrome Extension (Manifest V3)
│   │   ├── manifest.json
│   │   └── src/
│   │       ├── background.ts      # Service worker
│   │       ├── wallet-bridge.ts   # Connect to MetaMask/etc
│   │       ├── popup/             # Extension popup UI
│   │       │   ├── App.tsx
│   │       │   ├── BuddyAvatar.tsx
│   │       │   └── QuickActions.tsx
│   │       ├── sidepanel/         # Full chat sidepanel
│   │       │   ├── App.tsx
│   │       │   ├── Chat.tsx
│   │       │   ├── Portfolio.tsx
│   │       │   └── TradeConfirm.tsx
│   │       └── content/           # Content scripts
│   │           └── inject.ts
│   │
│   ├── telegram/            # Telegram bot
│   │   └── src/
│   │       ├── types.ts
│   │       ├── bot.ts       # Bot initialization
│   │       ├── commands/    # /start, /swap, /status, etc.
│   │       ├── keyboards.ts # Inline keyboard builders
│   │       ├── session.ts   # User session management
│   │       └── wallet-link.ts # Wallet linking flow
│   │
│   └── server/              # Lightweight backend API
│       └── src/
│           ├── types.ts
│           ├── index.ts     # Express app entry
│           ├── routes/      # API endpoints
│           ├── market/      # Market data aggregation
│           └── webhooks/    # Telegram webhook handler
│
└── openclaw-skills/         # OpenClaw skill definitions
    ├── chainbuddy-trade/
    │   └── SKILL.md
    ├── chainbuddy-scan/
    │   └── SKILL.md
    ├── chainbuddy-trenches/
    │   └── SKILL.md
    └── chainbuddy-buddy/
        └── SKILL.md
```

---

## 5. Development Workflow Rules

These rules come directly from your SolVault experience, adapted for this project:

### Session Start Protocol
1. Read `progress.txt` ONLY (not the whole project)
2. Read the relevant section of `OPENCLAW.md` for today's task
3. Read the `types.ts` of the module you're working on
4. Write your plan to `IMPLEMENTATION_PLAN.md` before building

### During Development
- One file at a time for fixes
- Run `npx tsc --noEmit` after EACH file change
- Run `pnpm test` after each logical unit
- TypeScript compiler is your safety net — tsx strips types at runtime
- Let OpenClaw commit after each logical unit of work
- BigInt values crash JSON.stringify — use replacer function everywhere
- Don't rely on LLM-generated identifiers for dedup — use deterministic fields

### Session End Protocol
1. Commit all work with conventional commit messages
2. Update `progress.txt` (current state ONLY — move history to CHANGELOG.md)
3. Update `lessons.md` with any new discoveries
4. Keep progress.txt SHORT

### BSC-Specific Rules (Adapted from Solana Lessons)
- BSC public RPC can rate limit — use Ankr or QuickNode free tier
- Always check token allowance before swap (equivalent of ATA check)
- approve() must be called before any transferFrom-based swap
- Keep 0.005 BNB reserved for gas (equivalent of 0.02 SOL reserve)
- Simulate every transaction via eth_call before sending
- Guardrails enforce at engine layer, NOT AI layer
- The AI can plan whatever it wants — it cannot bypass simulation or risk gates

### Prompting Patterns for OpenClaw
- "Don't build anything. Just assess/report" prevents premature coding
- "Read progress.txt only" prevents the agent from vacuuming all files
- Write plans to IMPLEMENTATION_PLAN.md before building
- "Evaluate on your own" > telling it what answer to give
- Never "understand the whole project" — give focused scope per session

---

## 6. Skill Definitions for ChainBuddy

### Trade Skill

File: `openclaw-skills/chainbuddy-trade/SKILL.md`

```markdown
---
name: chainbuddy-trade
description: Execute DEX trades on BNB Chain via PancakeSwap
emoji: 💱
metadata:
  openclaw:
    requires:
      env: ["BSC_RPC_URL", "BSCSCAN_API_KEY"]
---

# ChainBuddy Trade Skill

## When to Use
User wants to swap tokens, check a price quote, or execute a trade on PancakeSwap.

## Steps
1. Parse the trade request: identify tokenIn, tokenOut, amount
2. Fetch token contract addresses from registry (packages/core/src/constants.ts)
3. Get price quote via PancakeSwap Router (packages/blockchain/src/dex/quote.ts)
4. Show confirmation to user: amounts, price impact, gas cost, slippage
5. If user confirms: execute via guardrail pipeline (simulate → check → sign → send)
6. Report result and update buddy XP (+10 for swap, +15 bonus if profitable)

## Safety
- ALWAYS simulate before execution
- ALWAYS check token allowance and approve if needed
- NEVER exceed MAX_SLIPPAGE for current mode
- NEVER spend below BNB_FEE_RESERVE
- One trade per cycle maximum

## Error Handling
- EXECUTION_REVERTED: Check approval, check balance, try with lower amount
- UNPREDICTABLE_GAS_LIMIT: Bad params, recheck token addresses
- Max 3 retries before logging failure and notifying user
```

### Wallet Scan Skill

File: `openclaw-skills/chainbuddy-scan/SKILL.md`

```markdown
---
name: chainbuddy-scan
description: Scan a BNB Chain wallet to build a trader profile
emoji: 🔍
metadata:
  openclaw:
    requires:
      env: ["BSC_RPC_URL", "BSCSCAN_API_KEY"]
---

# ChainBuddy Wallet Scan Skill

## When to Use
User connects wallet, asks about their portfolio, or requests a profile refresh.

## Steps
1. Get wallet address from connected wallet or user input
2. Fetch BNB balance + all BEP-20 token balances
3. Fetch last 500 transactions from BSCScan API
4. Categorize transactions: swap, farm, stake, transfer, NFT, bridge
5. Identify protocols: map contract addresses to known protocols
6. Build trader profile: archetype, risk score, preferred protocols
7. Store profile in local state for agent context injection
8. Present summary to user via buddy personality

## Profile Output Format
- archetype: Holder | Swapper | Farmer | Degen | Newcomer
- riskScore: 1-10
- protocols: [{name, interactionCount, lastUsed}]
- positions: [{type, protocol, tokens, value}]
- suggestedBuddyPersonality: string
```

### Trenches Mode Skill

File: `openclaw-skills/chainbuddy-trenches/SKILL.md`

```markdown
---
name: chainbuddy-trenches
description: Aggressive trading strategies — token sniping and yield farming
emoji: ⚔️
metadata:
  openclaw:
    requires:
      env: ["BSC_RPC_URL", "BSCSCAN_API_KEY"]
---

# ChainBuddy Trenches Mode Skill

## When to Use
User activates Trenches Mode (requires buddy Level 10+). Applies to token
launch sniping and high-APY farm scanning.

## Token Sniper Steps
1. Monitor PancakeSwap Factory for PairCreated events
2. For each new pair: fetch token contract, run safety checks
3. Safety checks: is contract verified? is liquidity locked? honeypot test
4. If checks pass AND matches user's snipe rules: execute buy
5. Apply user parameters: max buy amount, min liquidity, auto-sell targets
6. Higher slippage allowed (up to MAX_SLIPPAGE_TRENCHES = 15%)
7. ALWAYS show risk banner even in auto-mode

## Farm Scanner Steps
1. Aggregate yield data from PancakeSwap, Venus, Alpaca, Thena
2. Score by risk-adjusted APY: factor TVL, age, audit status, IL risk
3. Present top 3 opportunities matching user's risk profile
4. One-click entry: handle approve + deposit chain
5. Monitor entered positions for IL and reward accumulation

## Risk Rules
- All Trenches trades show a risk warning — no exceptions
- Auto-approve only for trades under user-set threshold
- Circuit breaker: 3 consecutive failed snipes → pause and notify
- Max portfolio allocation per snipe: user-configurable (default 2%)
```

---

## Quick Start Checklist

After setting up the VPS, run through this:

- [ ] VPS provisioned (Ubuntu 24.04, Hetzner CX22 or equivalent)
- [ ] Node.js 22+ installed via nvm
- [ ] pnpm installed globally
- [ ] Docker installed and running
- [ ] Redis installed and running
- [ ] OpenClaw installed and `openclaw onboard` completed
- [ ] Anthropic API key configured in `~/.openclaw/.env`
- [ ] Telegram bot created via @BotFather, token added to config
- [ ] BSCScan API key obtained (free tier: bscscan.com)
- [ ] BSC RPC URL configured (Ankr free tier recommended)
- [ ] OpenClaw gateway running as systemd service
- [ ] SOUL.md placed in `~/.openclaw/agents/chainbuddy/`
- [ ] Git repo initialized with monorepo structure
- [ ] OPENCLAW.md in project root
- [ ] progress.txt created with "Day 1: Setup complete"
- [ ] First `pnpm build` passes with no errors
- [ ] Telegram bot responds through OpenClaw
