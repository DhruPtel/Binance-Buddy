# PHASE 4 — Research → Execution Bridge (v3)

**Goal:** Every pool/strategy shown in research becomes actionable with one click.

**Principle:** Research tells you what to do. Execution does it. No confirmation prompts — guardrails are the safety layer.

---

## Pre-Build Fixes (LE-2, LE-3, LE-4)

These three are standalone server-layer fixes. LE-1 (contract resolver), LE-5 (ABIs),
LE-6 (error recovery), and LE-7 (symbol resolution) are NOT pre-work — they get built
inline with the features that need them (4B/4C/4D).

### LE-2: Unify Dashboard Trade Panel — DONE

**Problem:** The trade panel uses `/api/swap/quote` → `/api/swap/execute` (two-step).
The chat uses the swap_tokens tool which auto-executes in one step. Inconsistent.

**Fix:** The existing `/api/swap/execute` already does quote → guardrails → execute in
one call when no pre-fetched quote is passed. No new endpoint needed. Change the
dashboard JS to call `/api/swap/execute` directly with a single "Swap" button. Remove
`tradeGetQuote()`, `_pendingQuote`, `renderQuote()`, the quote-card display, and the
two-button confirm/cancel flow. Keep `/api/swap/quote` for read-only quote preview only.

### LE-3: XP Not Awarded for Dashboard Actions

**Problem:** XP only awarded through `/api/chat` handler. Dashboard swap via
`/api/swap/execute` awards XP inline, but future vault/LP/lending endpoints will
need the same pattern.

**Fix:** Extract shared helper in server/index.ts:
```typescript
function awardXpForAction(source: XPSource): BuddyState {
  let updated = awardXp(buddyState, source);
  updated = { ...updated, stage: xpToStage(updated.xp), trenchesUnlocked: updated.xp >= 500 };
  buddyState = updated;
  saveBuddyState(buddyState);
  return buddyState;
}
```
Add new XP sources to `core/types.ts` (`'vault_deposit' | 'lp_entry' | 'lending_supply'`)
and corresponding rewards to `XP_REWARDS` in `core/constants.ts`. Use
`BuddyState.achievements[]` (already exists, currently unused) for first-ever bonuses.

### LE-4: Wallet Balance Refresh After Execution

**Problem:** After swap, next action might use stale BNB balance.

**Fix:** Lightweight — after any successful execution, call
`getBnbBalance(provider, agentWallet.address)` for the response. Do NOT call full
`scanWallet()` (expensive: Multicall3 + CoinGecko) post-execution. Reserve full
scan for explicit user-triggered wallet scans. The `/api/agent-wallet` endpoint
already calls `getBnbBalance()` live every time, so it's inherently fresh.

---

## Prerequisites for 4C

**Fix executeSwap() actual output parsing.** Currently `executeSwap()` returns
`amountOut: quote.amountOut` (the estimate, not the actual on-chain output).
LP entry needs the real amount received from the swap to calculate
`addLiquidityETH` parameters. Before building 4C, parse Transfer events from
the swap receipt to extract the actual output amount.

---

## Contract Address Sources

| Protocol | Source | Method | Free? |
|---|---|---|---|
| **Beefy** | `https://api.beefy.finance/vaults` | REST API, filter chain=bsc | Yes |
| **PancakeSwap** | Factory contract on-chain | `getPair(tokenA, tokenB)` | Yes (RPC) |
| **Venus** | Comptroller on-chain | `getAllMarkets()` | Yes (RPC) |
| **Generic** | DeFiLlama `contractAddresses` | Already parsed | Yes |
| **Tokens** | `SAFE_TOKENS` in constants.ts | Fast lookup, no API | Yes |

---

## Phase 4A: Swap Execution — DONE

- [Swap →] button on research pool rows
- Agent executes swaps without confirmation
- Guardrails run silently
- Deadline fixed (block.timestamp + 300)
- Dashboard trade panel unified to single-step execute

---

## Phase 4B: Yield Vault Deposits

### New Files
- `packages/blockchain/src/yield/beefy.ts` — Beefy API client (lives in blockchain, not ai, to avoid circular deps)
- `packages/blockchain/src/yield/vault-executor.ts` — vault deposit execution
- `packages/blockchain/src/abis.ts` — shared ABI registry for all protocols

### Package Boundaries
The server resolves the vault address (via Beefy client) and passes it as a
parameter to the executor. The executor takes `(provider, signer, vaultAddress,
wantTokenAddress, amount)` — no knowledge of where the address came from.

### Beefy API Client
```typescript
// packages/blockchain/src/yield/beefy.ts
interface BeefyVault {
  id: string;
  name: string;
  chain: string;
  token: string;
  tokenAddress: string;         // want token
  earnContractAddress: string;  // vault to deposit into
  status: 'active' | 'eol';
  platformId: string;
  assets: string[];
}

async function fetchBeefyVaults(): Promise<BeefyVault[]>   // cached 1 hour
async function findVaultForToken(tokenSymbol: string): Promise<BeefyVault | null>
```

### Vault Executor Flow
1. Check if wantToken needs approval for vault
2. If yes: `approve(vaultAddress, amount)` → wait
3. Read `decimals()` from want token contract (do NOT assume 18)
4. Call `vault.deposit(amount)`
5. Return tx hash + receipt tokens
6. Server awards XP (`vault_deposit`) and refreshes BNB balance

### Server Endpoint
- `POST /api/vault/execute` — one-step: resolve address → approve → deposit → return result

### Dashboard
- [Deposit →] button on yield pool rows
- Amount selector: 10%, 25%, 50%, 100% of available balance
- Executes immediately, shows tx hash

---

## Phase 4C: LP Transactions

### Prerequisite
Fix `executeSwap()` to parse actual output amount from Transfer events (not
`quote.amountOut`). Without this, `addLiquidityETH` amounts will mismatch and revert.

### New Files
- `packages/blockchain/src/lp/liquidity-executor.ts` — multi-step LP entry

### Router ABI Extension
The existing `ROUTER_ABI` in `executor.ts` only has swap methods. The LP executor
needs `addLiquidityETH` and `addLiquidity`. Define these in `packages/blockchain/src/abis.ts`.

### Flow (BNB + Token LP)
1. Swap half BNB for the other token (use existing swap engine)
2. Approve other token for PancakeSwap Router
3. Call `addLiquidityETH(token, amountTokenActual, amountTokenMin, amountBNBMin, to, deadline)`
   with `value: amountBNB` — use ACTUAL swap output, not quote estimate
4. Receive LP tokens
5. Award XP (`lp_entry`)

### Flow (Token + Token LP)
1. Approve token A for Router
2. Approve token B for Router
3. Call `addLiquidity(tokenA, tokenB, amountA, amountB, amountAMin, amountBMin, to, deadline)`
4. Receive LP tokens

### Multi-Step State
```typescript
interface LPExecutionState {
  steps: Array<{
    label: string;
    status: 'pending' | 'executing' | 'confirmed' | 'failed';
    txHash?: string;
  }>;
  currentStep: number;
}
```
On failure: stop and return state showing completed steps. Dangling approvals
are harmless. No retry API — user can re-trigger and approvals are idempotent.

### Server Endpoint
- `POST /api/lp/execute` — runs all steps sequentially, returns final result + step statuses

### Dashboard
- [Add Liquidity →] button on LP pool rows
- Progress: Step 1/3 → 2/3 → 3/3 → Done
- IL warning (non-blocking): "LP carries impermanent loss risk"

---

## Phase 4D: Lending Supply (Venus)

**Scope: supply only.** Borrow is a separate risk domain (liquidation risk, health
factor monitoring, oracle price feeds via `Comptroller.oracle()` → `PriceOracle.getUnderlyingPrice()`).
Defer borrow to a later phase.

### New Files
- `packages/blockchain/src/lending/lending-executor.ts`

### Contract Resolution
Venus Comptroller `getAllMarkets()` returns vToken addresses on-chain. Match to
underlying by calling `vToken.underlying()` (returns address, not symbol) and
comparing against `SAFE_TOKENS` addresses. Requires a `Provider` parameter.

### Supply Flow
1. Resolve vToken address from Venus Comptroller
2. Read `decimals()` from underlying token (do NOT assume 18)
3. Approve underlying token for vToken contract
4. Call `vToken.mint(amount)` — deposits and receives vTokens
5. Award XP (`lending_supply`)

### Server Endpoints
- `POST /api/lending/supply/execute` — approve + mint
- `GET /api/lending/health/:address` — current account liquidity from Comptroller

### Dashboard
- [Supply →] button on lending pool rows
- Shows supply APY from DeFiLlama data

---

## Implementation Order

| Step | What | Files |
|---|---|---|
| LE-2 | Unify trade panel to single execute | `server/index.ts` (dashboard JS) |
| LE-3 | Shared XP award function + new XP sources | `server/index.ts`, `core/types.ts`, `core/constants.ts` |
| LE-4 | BNB balance refresh after execution | `server/index.ts` |
| 4B-1 | ABI registry + Beefy client | `blockchain/src/abis.ts`, `blockchain/src/yield/beefy.ts` |
| 4B-2 | Vault executor | `blockchain/src/yield/vault-executor.ts` |
| 4B-3 | `/api/vault/execute` endpoint + [Deposit →] UI | `server/index.ts` |
| pre-4C | Fix executeSwap() output parsing | `blockchain/src/dex/executor.ts` |
| 4C-1 | LP executor (multi-step) | `blockchain/src/lp/liquidity-executor.ts` |
| 4C-2 | `/api/lp/execute` endpoint + [Add Liquidity →] UI | `server/index.ts` |
| 4D-1 | Lending executor (supply only) | `blockchain/src/lending/lending-executor.ts` |
| 4D-2 | `/api/lending/*` endpoints + [Supply →] UI | `server/index.ts` |

**LE-2 → LE-3 → LE-4 → 4B → pre-4C → 4C → 4D.**
