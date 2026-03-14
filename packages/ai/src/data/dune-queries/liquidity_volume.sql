-- liquidity_volume.sql
-- Daily transaction volume (count + BNB value) to the DEX router
-- Params: {{protocol_address}}, {{days}}
-- Category: liquidity
-- Title: Swap Volume History
SELECT
  date_trunc('day', block_time) AS day,
  count(*) AS tx_count,
  sum(value / 1e18) AS volume_bnb,
  count(DISTINCT "from") AS unique_swappers
FROM bnb.transactions
WHERE "to" = {{protocol_address}}
  AND block_time > now() - interval '{{days}} days'
  AND success = true
GROUP BY 1
ORDER BY 1
