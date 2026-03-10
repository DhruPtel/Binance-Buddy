# BACKEND_STRUCTURE.md — Binance Buddy Data & Agent Architecture

## Data Storage Strategy

### Local (IndexedDB in Chrome Extension)
All user data stays on-device. We are NOT a custodial service.

**wallet_state** — Current wallet snapshot
```
{
  address: string
  chainId: number
  bnbBalance: string (bigint as string)
  tokens: TokenInfo[]
  totalValueUsd: number
  lastScanned: timestamp
}
```

**user_profile** — Built from wallet scan
```
{
  address: string
  archetype: 'newcomer' | 'holder' | 'swapper' | 'farmer' | 'degen'
  riskScore: number (1-10)
  protocols: ProtocolUsage[]
  preferredTokens: string[]
  avgTradeSize: number
  tradingFrequency: 'rare' | 'weekly' | 'daily' | 'hyperactive'
  totalTxCount: number
}
```

**buddy_state** — Tamagotchi state
```
{
  creatureType: 'creature_a' | 'creature_b' | 'creature_c'
  stage: 'seedling' | 'sprout' | 'bloom' | 'guardian' | 'apex'
  xp: number
  level: number
  mood: 'ecstatic' | 'happy' | 'neutral' | 'worried' | 'anxious'
  moodReason: string
  trenchesUnlocked: boolean
  achievements: string[]
  lastInteraction: timestamp
  totalInteractions: number
  totalTradesExecuted: number
  streakDays: number
}
```

**chat_history** — Conversation log
```
{
  id: string
  timestamp: timestamp
  role: 'user' | 'buddy' | 'system'
  content: string
  toolCall?: { name: string, params: object, result: object }
  xpAwarded?: number
}
```

**api_keys** — User-provided API keys (encrypted)
```
{
  service: string (e.g., 'bscscan', 'birdeye', 'defi_llama')
  key: string (AES-256 encrypted)
  addedAt: timestamp
  lastUsed: timestamp
  capabilities: string[] (what this key unlocks)
}
```

**alerts** — Active price/liquidity alerts
```
{
  id: string
  condition: AlertCondition
  active: boolean
  createdAt: timestamp
  triggeredAt?: timestamp
}
```

**trade_history** — Executed trades log
```
{
  id: string
  timestamp: timestamp
  type: 'swap' | 'farm_enter' | 'farm_exit' | 'snipe'
  tokenIn: string
  tokenOut: string
  amountIn: string
  amountOut: string
  txHash: string
  gasUsed: string
  success: boolean
  profitLoss?: number
  mode: 'normal' | 'trenches'
}
```

### Server-Side (Redis Cache)
Server only caches ephemeral market data. No user PII.

**market:{token}** — Token price data (TTL: 60s)
**research:latest** — Latest research report (TTL: 30min)
**farms:top** — Top farming opportunities (TTL: 15min)
**pairs:new** — Recently created pairs (TTL: 5min)

---

## Dual Agent Architecture

### Research Agent
```
Trigger: Every 30 minutes (configurable) OR on user request
Model: Claude Sonnet 4
Context window: 
  - System prompt (research persona + instructions)
  - Available API keys and their capabilities
  - Current wallet holdings (summary only)
  - User profile (archetype + risk score)
  - Previous research report (for delta detection)

Output: Structured research report
{
  timestamp: number
  marketOverview: { bnbPrice, totalTvl, sentiment }
  opportunities: FarmOpportunity[]
  risks: RiskAlert[]
  newPairs: NewPairInfo[]
  recommendations: string[]
}

Rate limits:
  - Max 1 research cycle per 15 minutes
  - Max 10 RPC calls per cycle
  - Max 3 external API calls per cycle
```

### Execution Agent
```
Trigger: User message OR research agent finding above threshold
Model: Claude Sonnet 4
Context window:
  - System prompt (execution persona + buddy personality + safety rules)
  - User profile
  - Wallet state (current balances)
  - Latest research report
  - Tool manifest (available tools based on API keys)
  - Recent trade history (last 10)
  - Buddy state (for personality)
  - User's strategy mandate (free text)

Tools available:
  - swap_tokens(tokenIn, tokenOut, amount, slippage)
  - scan_wallet(address?)
  - get_token_info(address)
  - check_positions()
  - set_alert(condition)
  - find_farms(minApy, maxRisk)
  - snipe_launch(params) — Trenches only

Guardrail pipeline (enforced at engine, NOT by AI):
  1. Simulate via eth_call
  2. Check spending limits
  3. Risk gate (token scoring)
  4. Amount caps (balance - fee reserve)
  5. If ALL pass → sign and send
  6. Log result to trade_history
```

### Agent Communication
```
Research Agent (slow: every 30 min)
    │
    ├── Fetches on-chain data, yield rates, new pairs
    ├── Produces structured research report
    ├── Stores report in Redis cache
    │
    ▼
Execution Agent (fast: on user message)
    │
    ├── Reads latest research report from cache
    ├── Reads wallet state + user profile from IndexedDB
    ├── LLM recommends action based on all context
    ├── Filters: risk level, protocol allowlist, dedup
    ├── Executes through guardrail pipeline
    └── Logs activity, awards XP
```

---

## API Endpoints (Server Package)

### GET /api/health
- Returns server status

### GET /api/market/:token
- Returns cached price data for token
- Falls back to CoinGecko if cache miss

### GET /api/research/latest
- Returns latest research report from Redis

### POST /api/research/trigger
- Manually triggers a research cycle
- Rate limited: 1 per 15 minutes

### GET /api/farms/top
- Returns top farming opportunities
- Cached, refreshed by research agent

### POST /api/webhook/telegram
- Telegram bot webhook handler
- Routes messages to execution agent

---

## Security Model

### Key Management
- User's wallet private keys NEVER touch our code
- Signing happens via the browser wallet (MetaMask/TrustWallet)
- We submit unsigned transactions, wallet signs them
- API keys stored in IndexedDB encrypted with AES-256-GCM
- LLM NEVER receives API keys or private key material

### Extension Permissions
- activeTab (read current page for DApp detection)
- sidePanel (chat interface)
- storage (IndexedDB for local data)
- alarms (heartbeat scheduling)
- No access to browsing history, bookmarks, or other tabs

### Guardrail Config (Hardcoded Defaults)
```typescript
NORMAL_MODE = {
  maxTransactionValueBnb: 1.0,
  maxSlippageBps: 100,       // 1%
  bnbFeeReserve: 0.005,
  circuitBreakerThreshold: 3,
  requireApprovalAboveBnb: 0.5,
}

TRENCHES_MODE = {
  maxTransactionValueBnb: 2.0,
  maxSlippageBps: 1500,      // 15%
  bnbFeeReserve: 0.005,
  circuitBreakerThreshold: 3,
  requireApprovalAboveBnb: 1.0,
}
```
