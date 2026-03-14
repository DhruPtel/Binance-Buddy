-- liquidity_top_lps.sql
-- Top addresses by total BNB value sent to the DEX router
-- Params: {{protocol_address}}, {{days}}
-- Category: liquidity
-- Title: Top LP Positions
SELECT
  "from" AS lp_address,
  count(*) AS tx_count,
  sum(value / 1e18) AS total_bnb_deposited
FROM bnb.transactions
WHERE "to" = {{protocol_address}}
  AND block_time > now() - interval '{{days}} days'
  AND success = true
  AND value > 0
GROUP BY 1
ORDER BY total_bnb_deposited DESC
LIMIT 20
