# Skill: snipe_launch

## Description
Monitors PancakeSwap V2 for new token pair launches (PairCreated events). Runs on-chain
safety checks and presents new pairs to the user for manual review. Auto-buy is NOT
implemented — the user must explicitly confirm any purchase.

**Requires Trenches Mode to be enabled.**

## Endpoint
`POST /api/chat`

## Parameters
```json
{
  "message": "start sniper [min liquidity <bnb_amount>]",
  "walletAddress": "<bsc_address>",
  "mode": "trenches"
}
```

## Example Requests
```json
{
  "message": "start sniper",
  "walletAddress": "0xABC123...",
  "mode": "trenches"
}
```

```json
{
  "message": "snipe new launches min liquidity 2 BNB",
  "walletAddress": "0xABC123...",
  "mode": "trenches"
}
```

## Example Response
```json
{
  "reply": "🎯 Sniper active! Watching PancakeSwap V2 for new BNB-paired launches.\nMin liquidity: 0.5 BNB\n\nI'll alert you when something interesting pops up. Use 'stop sniper' to deactivate.",
  "success": true,
  "toolName": "snipe_launch",
  "xpAwarded": 5
}
```

## New Pair Alert Format
When a pair is detected:
```json
{
  "reply": "🚨 New Launch: MEMECOIN/BNB\n\nLiquidity: 2.4 BNB\nHoneypot Risk: Medium ⚠️\nOwnership Renounced: ❌\nContract Readable: ✅\n\nReply 'buy 0.1 BNB of MEMECOIN' to enter, or ignore to skip.",
  "toolName": "snipe_launch"
}
```

## Safety Checks Performed
| Check | Method |
|-------|--------|
| Token name/symbol readable | ERC-20 `symbol()` / `name()` |
| Initial liquidity | Pair `getReserves()` |
| Ownership renounced | `owner()` == zero address |
| Mintable bytecode | Bytecode contains `mint(address,uint256)` selector |
| Honeypot risk | Composite heuristic (verified + liquidity + ownership) |

## Notes
- Only BNB-paired tokens are surfaced by default (most launches target BNB)
- Min liquidity filter prevents dust pairs from flooding alerts
- This is NOT a full honeypot simulation (no buy+sell eth_call)
- Requires `TRENCHES_MODE=true` — locked until Buddy reaches Bloom stage (500 XP)
