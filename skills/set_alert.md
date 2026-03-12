# Skill: set_alert

## Description
Sets a price or condition alert for a token. Buddy will notify the user via Telegram or
extension notification when the condition is triggered.

## Endpoint
`POST /api/chat`

## Parameters
```json
{
  "message": "alert me when <token> is <above|below> <price>",
  "walletAddress": "<optional_bsc_address>"
}
```

## Example Requests
```json
{ "message": "alert me when BNB is above 650" }
{ "message": "alert me when CAKE drops below 2.00" }
{ "message": "set alert: BNB price change > 5%" }
```

## Example Response
```json
{
  "reply": "✅ Alert set! I'll notify you when BNB goes above $650.\n\nCurrent price: $612.30",
  "success": true,
  "toolName": "set_alert",
  "xpAwarded": 1
}
```

## Alert Condition Types
| Type | Description |
|------|-------------|
| `price_above` | Token price rises above threshold |
| `price_below` | Token price drops below threshold |
| `price_change_pct` | Token price changes by ≥ N% in either direction |
| `liquidity_below` | Pool liquidity drops below threshold |
| `new_pair` | New token pair created on PancakeSwap |

## Notes
- Alerts are checked on research cycle (every 30 minutes)
- In-memory storage — alerts reset on server restart (Redis persistence planned)
