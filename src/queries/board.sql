-- AI export "board": the current household presence board.
--
-- Runs under the statuses row policy (owner_or_visibility, everyone-visible), so
-- a member-bound token sees every public row; a household-scoped MCP token must
-- pass a member_id. member_name/status/back_date/back_time/updated_at are all
-- plaintext (db_encryption "off"), so they read back verbatim.
-- No trailing semicolon: named SQL must be a single bare statement, and the
-- hub's parser rejects the terminator outright (the query would never run).
SELECT member_id, member_name, status, note, back_date, back_time, updated_at
FROM app_status_board__statuses
ORDER BY (status = 'home'), updated_at DESC
