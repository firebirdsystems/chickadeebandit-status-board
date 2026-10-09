# Who's Home (`status-board`)

A [Chickadee Bandit](https://chickadeebandit.com/app-library/status-board) app.

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

## Lapsed "back by"

A status is never changed on anyone's behalf (`write_owner_only`), so a "back
by" that has gone past is a display matter:

- the board keeps the status and says *was due back 3:00 PM* instead of
  repeating the promise — being late is not being home;
- the member themselves gets a **Still away?** prompt the next time they open
  the app: *I'm home* sets Home, the other answer keeps the status and note and
  drops the lapsed time;
- the glance says *was due back* only once the back **date** is an earlier day.
  Its SQL has `:today` but no time-of-day token, so a same-day time that has
  passed still reads *back at 15:00* there.

Saving a back time with no date stores one (today, or tomorrow if that time has
already gone by), on the household's clock, and marks it `back_date_auto`. A
stamped date is the app's guess, not the member's choice: the setter leaves the
date field empty for it and every save stamps it again from the time. Rows saved
before this have a time and no date; they never lapse and never reach Today
until they are saved again.

## Hub surfaces

- **glance** (home dashboard + kiosk glance card): everyone who has set a status,
  out-first — "Casey · Away", with the note and "back by" beneath. A Home row
  shows no note, even one left over from an older save. Members who have
  never set a status have no row and do not appear (the query can only read this
  app's table).
- **agenda** (Today): members who are *away* with a "back by" landing today,
  e.g. "Casey · back at 3:00 PM". Busy and do-not-disturb never left, so their
  time is not a homecoming and stays off Today.

## Develop

```bash
npm install
npm test       # pure logic (src/logic.js)
npm run build  # -> dist/bundle.json
npm run dev    # local dev server with the deployed hub SDK
```
