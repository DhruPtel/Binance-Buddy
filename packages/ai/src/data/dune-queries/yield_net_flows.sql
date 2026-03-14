-- yield_net_flows.sql
-- Deposit vs withdraw net flows per day
-- Params: {{protocol_address}}, {{days}}
-- Category: yield
-- Title: Deposit & Withdraw Net Flows
SELECT
  date_trunc('day', block_time) AS day,
  sum(CASE WHEN "from" != {{protocol_address}} AND "to" = {{protocol_address}} THEN value / 1e18 ELSE 0 END) AS deposits_bnb,
  sum(CASE WHEN "from" = {{protocol_address}} AND "to" != {{protocol_address}} THEN value / 1e18 ELSE 0 END) AS withdrawals_bnb,
  sum(CASE WHEN "from" != {{protocol_address}} AND "to" = {{protocol_address}} THEN value / 1e18 ELSE 0 END)
  - sum(CASE WHEN "from" = {{protocol_address}} AND "to" != {{protocol_address}} THEN value / 1e18 ELSE 0 END) AS net_flow_bnb
FROM bnb.traces
WHERE (
  "to" = {{protocol_address}} OR "from" = {{protocol_address}}
)
  AND block_time > now() - interval '{{days}} days'
  AND success = true
GROUP BY 1
ORDER BY 1
