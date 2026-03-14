-- lending_flows.sql
-- Daily inflows (value sent to protocol) and outflows (value sent from protocol)
-- Params: {{protocol_address}}, {{days}}
-- Category: lending
-- Title: Borrow & Supply Flows
SELECT
  date_trunc('day', block_time) AS day,
  sum(CASE WHEN "to" = {{protocol_address}} THEN value / 1e18 ELSE 0 END) AS inflow_bnb,
  sum(CASE WHEN "from" = {{protocol_address}} THEN value / 1e18 ELSE 0 END) AS outflow_bnb,
  sum(CASE WHEN "to" = {{protocol_address}} THEN value / 1e18 ELSE 0 END)
  - sum(CASE WHEN "from" = {{protocol_address}} THEN value / 1e18 ELSE 0 END) AS net_flow_bnb
FROM bnb.transactions
WHERE ("to" = {{protocol_address}} OR "from" = {{protocol_address}})
  AND block_time > now() - interval '{{days}} days'
  AND success = true
GROUP BY 1
ORDER BY 1
