-- lending_utilization.sql
-- Utilization rate history: daily borrow vs supply volume
-- Params: {{protocol_address}}, {{days}}
-- Category: lending
-- Title: Utilization Rate History
SELECT
  date_trunc('day', block_time) AS day,
  sum(CASE WHEN action = 'borrow' THEN amount_usd ELSE 0 END) AS borrows_usd,
  sum(CASE WHEN action = 'supply' OR action = 'deposit' THEN amount_usd ELSE 0 END) AS supplies_usd,
  CASE
    WHEN sum(CASE WHEN action = 'supply' OR action = 'deposit' THEN amount_usd ELSE 0 END) > 0
    THEN sum(CASE WHEN action = 'borrow' THEN amount_usd ELSE 0 END)
         / sum(CASE WHEN action = 'supply' OR action = 'deposit' THEN amount_usd ELSE 0 END)
    ELSE 0
  END AS utilization_rate
FROM bnb.traces
WHERE "to" = {{protocol_address}}
  AND block_time > now() - interval '{{days}} days'
  AND success = true
GROUP BY 1
ORDER BY 1
