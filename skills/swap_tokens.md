# Skill: swap_tokens

## Description
Prepares and (with user confirmation) executes a token swap on PancakeSwap V2/V3 on BSC.
Returns a quote with price impact, gas cost, and slippage. The swap does NOT execute until
the user explicitly confirms via the TradeConfirm flow.

## Endpoint
`POST /api/chat`

## Parameters
```json
{
  "message": "swap <amount> <tokenIn> for <tokenOut>",
  "walletAddress": "<bsc_address>",
  "mode": "normal | trenches"
}
```

## Example Request
```json
{
  "message": "swap 0.1 BNB for CAKE",
  "walletAddress": "0xABC123...",
  "mode": "normal"
}
```

## Example Response
```json
{
  "reply": "I've prepared your swap: 0.1 BNB → ~12.4 CAKE\nPrice impact: 0.12%\nGas: ~0.0003 BNB ($0.18)\nSlippage: 1%\n\nReply 'confirm' to execute or 'cancel' to abort.",
  "success": true,
  "toolName": "swap_tokens",
  "xpAwarded": 0
}
```

## Safety Notes
- Guardrail pipeline runs before any tx is submitted: simulation → spend limit → fee reserve → allowlist
- Normal mode: max 1 BNB per tx, 1% slippage
- Trenches mode: max 2 BNB per tx, 15% slippage
- Always keeps 0.005 BNB reserved for gas
- Token approval (ERC-20 `approve()`) is requested separately before swap if needed
