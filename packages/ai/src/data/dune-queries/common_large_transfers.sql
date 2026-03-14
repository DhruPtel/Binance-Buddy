-- common_large_transfers.sql
-- Large transfers involving the protocol in the last 7 days
-- Params: {{protocol_address}}, {{days}}
-- Category: common
-- Title: Large Transfers (Last 7d)
SELECT
  block_time,
  tx_hash,
  "from" AS sender,
  "to" AS receiver,
  value / 1e18 AS value_bnb
FROM bnb.traces
WHERE (
  "to" = {{protocol_address}} OR "from" = {{protocol_address}}
)
  AND block_time > now() - interval '{{days}} days'
  AND success = true
  AND value > 0
ORDER BY value DESC
LIMIT 25
