# Skill: find_farms

## Description
Returns yield farming and liquidity providing opportunities on BSC, sorted by
risk-adjusted APY. Tries to fetch live data from PancakeSwap API; falls back to
curated baseline of known audited protocols.

## Endpoint
`POST /api/chat`

## Parameters
```json
{
  "message": "find farms [for <tokens>] [max risk <1-10>] [min apy <percent>]",
  "walletAddress": "<optional_bsc_address>"
}
```

## Example Requests
```json
{ "message": "find farms" }
{ "message": "find farms for BNB max risk 3" }
{ "message": "find farms min apy 20" }
```

## Example Response
```json
{
  "reply": "Top farms right now:\n\n1. PancakeSwap CAKE-BNB LP\n   APY: 28.5% | Risk: 3/10 | TVL: $45M\n   IL Risk: Medium ⚠️\n\n2. Venus USDT Lending\n   APY: 8.4% | Risk: 2/10 | TVL: $280M\n   IL Risk: Low ✅",
  "success": true,
  "toolName": "find_farms",
  "xpAwarded": 3
}
```

## Notes
- Risk score 1-10 (1 = safest). Stablecoin-only pools = 1, leveraged = 7+
- `riskAdjustedApy = apy * (1 - riskScore/20)`
- Live data from `https://farms-api.pancakeswap.finance/farms/v2?chainId=56`
- Baseline always includes Venus and Alpaca Finance pools regardless of live API
