# Skill: get_token_info

## Description
Gets information about a token on BSC: price, name, symbol, decimals, and risk assessment.
Accepts either a contract address or a symbol (e.g. "CAKE").

## Endpoint
`POST /api/chat`

## Parameters
```json
{
  "message": "what is <token_symbol_or_address>",
  "walletAddress": "<optional_bsc_address>"
}
```

## Example Request
```json
{
  "message": "what is CAKE",
  "walletAddress": "0xABC123..."
}
```

## Example Response
```json
{
  "reply": "CAKE (PancakeSwap Token)\nAddress: 0x0E09FaBB73...\nPrice: $2.45 (+3.2% 24h)\nDecimals: 18\nSafe token ✅",
  "success": true,
  "toolName": "get_token_info",
  "xpAwarded": 3
}
```

## Notes
- Known safe tokens (WBNB, USDT, USDC, BUSD, CAKE, ETH, BTCB) return immediately
- Unknown tokens trigger an on-chain risk assessment via scoreTokenRisk()
- Risk score 0-100: 0 = safe, 80+ = likely honeypot
