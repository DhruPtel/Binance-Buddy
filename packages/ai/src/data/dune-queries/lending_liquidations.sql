-- lending_liquidations.sql
-- Recent liquidation events
-- Params: {{protocol_address}}, {{days}}
-- Category: lending
-- Title: Recent Liquidations
SELECT
  block_time,
  tx_hash,
  "from" AS liquidator,
  value / 1e18 AS liquidated_bnb
FROM bnb.traces
WHERE "to" = {{protocol_address}}
  AND block_time > now() - interval '{{days}} days'
  AND success = true
  AND value > 0
ORDER BY value DESC
LIMIT 50
