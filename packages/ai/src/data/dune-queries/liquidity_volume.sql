-- liquidity_volume.sql
-- Swap volume history by day
-- Params: {{protocol_address}}, {{days}}
-- Category: liquidity
-- Title: Swap Volume History
SELECT
  date_trunc('day', block_time) AS day,
  count(*) AS swap_count,
  sum(value / 1e18) AS volume_bnb
FROM bnb.traces
WHERE "to" = {{protocol_address}}
  AND block_time > now() - interval '{{days}} days'
  AND success = true
GROUP BY 1
ORDER BY 1
