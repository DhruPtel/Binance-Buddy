# Skill: scan_wallet

## Description
Scans a BSC wallet address. Returns BNB balance, all BEP-20 token balances with USD
values, and a trader profile (archetype, risk score, trading frequency).

## Endpoint
`POST /api/scan/:address`

## Parameters
```json
{
  "address": "<bsc_wallet_address>"  // in URL path
}
```

## Example Request
```
POST /api/scan/0xABC123...
```

## Example Response
```json
{
  "walletState": {
    "address": "0xABC123...",
    "chainId": 56,
    "bnbBalance": "100000000000000000",
    "bnbBalanceFormatted": 0.1,
    "tokens": [
      {
        "address": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
        "symbol": "CAKE",
        "name": "PancakeSwap Token",
        "decimals": 18,
        "balance": "50000000000000000000",
        "balanceFormatted": 50.0,
        "priceUsd": 2.45,
        "valueUsd": 122.5
      }
    ],
    "totalValueUsd": 183.5,
    "lastScanned": 1741706400000
  },
  "profile": {
    "address": "0xABC123...",
    "archetype": "swapper",
    "riskScore": 4,
    "protocols": [],
    "preferredTokens": [],
    "avgTradeSize": 0.05,
    "tradingFrequency": "weekly",
    "totalTxCount": 47
  }
}
```

## Notes
- Token balances use Multicall3 (zero API keys needed)
- Prices from CoinGecko free tier
- Tx history requires MORALIS_API_KEY (optional — archetype defaults to 'unknown' without it)
