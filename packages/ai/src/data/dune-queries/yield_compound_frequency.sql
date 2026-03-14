-- yield_compound_frequency.sql
-- Auto-compound event frequency (contract self-calls as proxy)
-- Params: {{protocol_address}}, {{days}}
-- Category: yield
-- Title: Auto-Compound Frequency
SELECT
  date_trunc('day', block_time) AS day,
  count(*) AS compound_events
FROM bnb.traces
WHERE "to" = {{protocol_address}}
  AND "from" = {{protocol_address}}
  AND block_time > now() - interval '{{days}} days'
  AND success = true
GROUP BY 1
ORDER BY 1
