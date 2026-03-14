-- lending_utilization.sql
-- Daily transaction activity to the lending protocol (proxy for utilization)
-- Params: {{protocol_address}}, {{days}}
-- Category: lending
-- Title: Utilization Rate History
SELECT
  date_trunc('day', block_time) AS day,
  count(*) AS tx_count,
  sum(value / 1e18) AS total_bnb_value,
  count(DISTINCT "from") AS unique_users
FROM bnb.transactions
WHERE "to" = {{protocol_address}}
  AND block_time > now() - interval '{{days}} days'
  AND success = true
GROUP BY 1
ORDER BY 1
