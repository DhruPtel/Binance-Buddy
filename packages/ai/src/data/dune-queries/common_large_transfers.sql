-- common_large_transfers.sql
-- Largest transactions involving the protocol in the given time window
-- Params: {{protocol_address}}, {{days}}
-- Category: common
-- Title: Large Transfers
SELECT
  block_time,
  hash AS tx_hash,
  "from" AS sender,
  "to" AS receiver,
  value / 1e18 AS value_bnb
FROM bnb.transactions
WHERE ("to" = {{protocol_address}} OR "from" = {{protocol_address}})
  AND block_time > now() - interval '{{days}} days'
  AND success = true
  AND value > 0
ORDER BY value DESC
LIMIT 25
