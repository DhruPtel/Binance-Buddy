-- liquidity_fee_revenue.sql
-- Fee revenue estimate: 0.3% of BNB value transacted through the DEX
-- Params: {{protocol_address}}, {{days}}
-- Category: liquidity
-- Title: Fee Revenue Estimate
SELECT
  date_trunc('day', block_time) AS day,
  count(*) AS tx_count,
  sum(value / 1e18) AS total_value_bnb,
  sum(value / 1e18) * 0.003 AS estimated_fees_bnb
FROM bnb.transactions
WHERE "to" = {{protocol_address}}
  AND block_time > now() - interval '{{days}} days'
  AND success = true
  AND value > 0
GROUP BY 1
ORDER BY 1
