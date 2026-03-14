-- common_holder_concentration.sql
-- Token holder concentration: top wallets by transfer volume
-- Params: {{protocol_address}}, {{days}}
-- Category: common
-- Title: Holder Concentration (Top 10)
SELECT
  "from" AS wallet,
  count(*) AS tx_count,
  sum(value / 1e18) AS total_bnb_volume
FROM bnb.traces
WHERE "to" = {{protocol_address}}
  AND block_time > now() - interval '{{days}} days'
  AND success = true
  AND value > 0
GROUP BY 1
ORDER BY total_bnb_volume DESC
LIMIT 10
