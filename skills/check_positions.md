# Skill: check_positions

## Description
Returns the user's current token holdings and their USD values from the wallet state.
Summarizes active positions sorted by value descending.

## Endpoint
`POST /api/chat`

## Parameters
```json
{
  "message": "check my positions",
  "walletAddress": "<bsc_address>"
}
```

## Example Request
```json
{
  "message": "check my positions",
  "walletAddress": "0xABC123..."
}
```

## Example Response
```json
{
  "reply": "Your positions:\n• BNB: 0.1 ($61.40)\n• CAKE: 50.0 ($122.50)\n• USDT: 25.0 ($25.00)\n\nTotal: $208.90",
  "success": true,
  "toolName": "check_positions",
  "xpAwarded": 3
}
```

## Notes
- Uses cached wallet state from the current session
- Triggers a fresh scan if wallet hasn't been scanned in >5 minutes
- Positions with value < $0.01 are omitted
