-- Another app's event can set a member's status
-- (manifest.automation_actions.set_status).
--
-- The board holds exactly one row per member, so the action is an upsert:
-- INSERT ... ON CONFLICT(member_id) DO UPDATE. `source_event_id` records which
-- event last wrote the row, and the dispatcher's dedupe guard reads it before
-- running (SELECT 1 ... WHERE source_event_id = ? LIMIT 1) so a retry of the
-- same event can't re-apply it.
--
-- Note the guard is per-row here rather than per-event-forever: the column
-- holds only the LATEST event to touch that member, which is the right
-- trade-off for a current-value board — an older event arriving late should not
-- be able to overwrite a newer status, and it can't, because the rule's own
-- run claim (hub__automation_runs) is what makes each (rule, event) at-most-once.
--
-- Nullable on purpose: a member setting their own status leaves it NULL.
ALTER TABLE app_status_board__statuses ADD COLUMN source_event_id TEXT;

CREATE INDEX IF NOT EXISTS app_status_board__statuses_source_event_idx
  ON app_status_board__statuses (source_event_id);
