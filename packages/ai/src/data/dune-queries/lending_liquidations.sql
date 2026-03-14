-- lending_liquidations.sql
-- Largest transactions to the protocol (high-value interactions as proxy for liquidations)
-- Params: {{protocol_address}}, {{days}}
-- Category: lending
-- Title: Largest Interactions
SELECT
  block_time,
  hash AS tx_hash,
  "from" AS sender,
  value / 1e18 AS value_bnb
FROM bnb.transactions
WHERE "to" = {{protocol_address}}
  AND block_time > now() - interval '{{days}} days'
  AND success = true
  AND value > 0
ORDER BY value DESC
LIMIT 50
