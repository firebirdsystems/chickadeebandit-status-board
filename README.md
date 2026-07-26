# Who's Home (`status-board`)

A shared household presence/status board. Each member sets whether they're
**home · away · busy · do-not-disturb**, with an optional note and a "back by"
time. Everyone sees the board at a glance — in the app, on the home-screen
glance widget, and on the kiosk.

## Model

One row per member (`app_status_board__statuses`, `member_id` PRIMARY KEY);
setting your status is an upsert. `db_encryption` is off because presence is
household-shared (not secret) and the plaintext columns let the hub render the
native glance and Today card directly.

## Access

`statuses` uses an `owner_or_visibility` row policy with `write_owner_only`:
everyone reads the whole board (all rows are `visibility='everyone'`), but a
member can only write **their own** row. The hub forces `member_id` to the
caller on insert and scopes updates/deletes to the caller's row — nobody can
spoof another member's presence via raw `/api/db`. See `scenarios.json`.

## Geofence presence (optional)

When Safe Zones has a home zone and location collection is on, the hub exposes a
derived home/away signal per member through the `family.presence` context key
(state + when it changed, never coordinates). This app reads it as a **hint only**
— it writes nothing on anyone's behalf, and `write_owner_only` stays untouched:

- said nothing, or said **Home** → a phone reporting "away" displays as Away,
  labelled *by phone* so the board never implies the member typed it. An explicit
  Home is indistinguishable from the default in the data, and a stale Home
  shouldn't outrank a live geofence exit.
- said **Away / Busy / Do not disturb** → the self-report stands exactly as set.
  A disagreeing phone shows as *phone says home* beside it, nothing more.
- **unknown** (phone quiet past the hub's stale threshold, or no crossing yet)
  and members absent from the board contribute nothing — silence must never read
  as "home".

The glance and agenda SQL stay self-report-only: hub-native queries can't join
the hub's presence table, and the merge is a board-view concern.

## Hub surfaces

- **glance** (home dashboard + kiosk ambient board): a list of who's currently
  out.
- **agenda** (Today): members with a "back by" time landing today, e.g.
  "Casey · back at 3:00 PM".

## Develop

```bash
npm install
npm test       # pure logic (src/logic.js)
npm run build  # -> dist/bundle.json
npm run dev    # local dev server with the deployed hub SDK
```
