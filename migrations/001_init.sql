-- Who's Home — one shared household presence board.
--
-- Exactly one row per member (member_id PRIMARY KEY); setting your status is an
-- upsert (INSERT ... ON CONFLICT(member_id) DO UPDATE). The `statuses` row
-- policy is owner_or_visibility with write_owner_only (manifest.json): every
-- member reads the whole board (all rows default visibility='everyone'), but a
-- member may only write their own row — the hub forces member_id to the caller
-- on INSERT and scopes UPDATE/DELETE to the caller's own row. Nobody can spoof
-- another member's presence via raw /api/db.
--
-- db_encryption is "off" (manifest.json): presence is household-shared, not
-- secret, and keeping the columns plaintext lets the hub's native glance and
-- Today/agenda SQL filter (status, back_date) and sort (updated_at) directly.
--
-- "Back by" is split into back_date (yyyy-mm-dd) + back_time (HH:MM) so the
-- Today/agenda query can compare a plaintext date column against the :today day
-- token (the same shape amenity-reservations uses for date + start_time).
CREATE TABLE IF NOT EXISTS app_status_board__statuses (
  member_id    TEXT NOT NULL,                    -- owner; one current status per member
  member_name  TEXT NOT NULL DEFAULT '',         -- denormalized for native glance/agenda titles
  status       TEXT NOT NULL DEFAULT 'home',      -- home | away | busy | dnd
  note         TEXT NOT NULL DEFAULT '',          -- optional "in a meeting", "at soccer"
  back_date    TEXT NOT NULL DEFAULT '',          -- optional yyyy-mm-dd the member is back/free
  back_time    TEXT NOT NULL DEFAULT '',          -- optional HH:MM
  visibility   TEXT NOT NULL DEFAULT 'everyone',  -- read-all board
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (member_id)
);

CREATE INDEX IF NOT EXISTS app_status_board__statuses_status_idx
  ON app_status_board__statuses (status);
