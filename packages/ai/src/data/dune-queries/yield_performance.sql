-- yield_performance.sql
-- Daily vault activity: tx count, BNB value, and unique depositors
-- Params: {{protocol_address}}, {{days}}
-- Category: yield
-- Title: Vault Performance
SELECT
  date_trunc('day', block_time) AS day,
  count(*) AS tx_count,
  sum(value / 1e18) AS total_value_bnb,
  count(DISTINCT "from") AS unique_users
FROM bnb.transactions
WHERE "to" = {{protocol_address}}
  AND block_time > now() - interval '{{days}} days'
  AND success = true
GROUP BY 1
ORDER BY 1
