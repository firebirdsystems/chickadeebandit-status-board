// Pure, browser-free logic for Who's Home. Imported by both index.html and
// __tests__/logic.test.mjs. No DOM, no hub globals.

export const STATUSES = ["home", "away", "busy", "dnd"];

const STATUS_META = {
  home: { label: "Home", emoji: "🏠", glyph: "house", out: false },
  away: { label: "Away", emoji: "🚶", glyph: "door", out: true },
  busy: { label: "Busy", emoji: "⏳", glyph: "hourglass", out: true },
  dnd:  { label: "Do not disturb", emoji: "🔕", glyph: "bell-off", out: true },
};

/** Coerce any stored/typed value to a known status; unknown → "home". */
export function normalizeStatus(status) {
  return STATUS_META[status] ? status : "home";
}

export function statusLabel(status) {
  return STATUS_META[normalizeStatus(status)].label;
}

export function statusEmoji(status) {
  return STATUS_META[normalizeStatus(status)].emoji;
}

export function statusGlyph(status) {
  return STATUS_META[normalizeStatus(status)].glyph;
}

/** True when the status means the member is not simply home. */
export function isOut(status) {
  return STATUS_META[normalizeStatus(status)].out;
}

/** yyyy-mm-dd of a Date-like `now` (local). */
export function isoDate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "18:00" → "6:00 PM"; passes through anything that isn't HH:MM. */
export function formatTime(hhmm) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? "").trim());
  if (!m) return "";
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * True once a "back by" has passed. `today` is yyyy-mm-dd and `nowTime` HH:MM,
 * both on the household's clock.
 *
 * A date with no time is due at the end of that day, so it only lapses the day
 * after. A time with no date never lapses: "back at 07:00" typed at 20:00 means
 * tomorrow, and nothing in the row says which — `resolveBackDate` stamps a date
 * on new saves so only rows older than it are left in that state.
 */
export function isOverdue(backDate, backTime, today = isoDate(), nowTime = "") {
  const date = String(backDate ?? "").trim();
  if (!date) return false;
  const dayDiff = daysBetween(today, date);
  if (Number.isNaN(dayDiff)) return false;
  if (dayDiff !== 0) return dayDiff < 0;
  const time = formatTime(backTime) ? padTime(backTime) : "";
  const now = formatTime(nowTime) ? padTime(nowTime) : "";
  return !!time && !!now && now > time;
}

/** "9:05" → "09:05", so two HH:MM strings compare as text. */
function padTime(hhmm) {
  return String(hhmm).trim().padStart(5, "0");
}

/** yyyy-mm-dd `days` after `date`; "" when `date` isn't one. */
export function addDays(date, days) {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return "";
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The date to store with a "back by". A time typed without a date gets one:
 * today, or tomorrow when that time has already gone by. Without it the row
 * could never lapse (see `isOverdue`) and never reach Today, whose query
 * matches on back_date.
 */
export function resolveBackDate(backDate, backTime, today = isoDate(), nowTime = "") {
  const date = String(backDate ?? "").trim();
  if (date || !formatTime(backTime)) return date;
  const now = formatTime(nowTime) ? padTime(nowTime) : "";
  return now && now > padTime(backTime) ? addDays(today, 1) : today;
}

/**
 * The date half of a "back by" as it is stored: `chosen` is the date the member
 * picked in the setter, or "" when they picked none. A picked date is stored as
 * it is; with none, `resolveBackDate` stamps one and `back_date_auto` says so.
 */
export function storedBackDate(chosen, backTime, today = isoDate(), nowTime = "") {
  const date = String(chosen ?? "").trim();
  if (date) return { back_date: date, back_date_auto: 0 };
  const stamped = resolveBackDate("", backTime, today, nowTime);
  return { back_date: stamped, back_date_auto: stamped ? 1 : 0 };
}

/** The date the member picked for a stored row — "" when the app stamped it,
 *  so the setter never hands a guess back as the member's own choice. */
export function chosenBackDate(row) {
  return Number(row?.back_date_auto) === 1 ? "" : String(row?.back_date ?? "");
}

/** Human "back by" phrase from the split back_date/back_time columns, relative
 *  to `today` (yyyy-mm-dd). Returns "" when nothing useful is set. Pass
 *  `nowTime` (HH:MM) to have a lapsed one read "was due back …" rather than
 *  keep promising a time that has gone by. */
export function formatBackBy(backDate, backTime, today = isoDate(), nowTime = "") {
  const date = String(backDate ?? "").trim();
  const timeText = formatTime(backTime);
  if (!date) return timeText ? `back at ${timeText}` : "";

  const dayDiff = daysBetween(today, date);
  const [, mm, dd] = date.split("-");
  const dayLabel = `${MONTHS[Number(mm) - 1] ?? "?"} ${Number(dd)}`;
  if (isOverdue(date, backTime, today, nowTime)) {
    if (dayDiff === 0) return `was due back ${timeText}`;
    const day = dayDiff === -1 ? "yesterday" : dayLabel;
    return timeText ? `was due back ${day}, ${timeText}` : `was due back ${day}`;
  }
  let whenText;
  if (dayDiff === 0) whenText = timeText ? `back at ${timeText}` : "back later today";
  else if (dayDiff === 1) whenText = timeText ? `back tomorrow, ${timeText}` : "back tomorrow";
  else whenText = timeText ? `back ${dayLabel}, ${timeText}` : `back ${dayLabel}`;
  return whenText;
}

/** Whole calendar days from `a` to `b` (both yyyy-mm-dd); b−a. */
export function daysBetween(a, b) {
  const pa = Date.parse(`${a}T00:00:00Z`);
  const pb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return NaN;
  return Math.round((pb - pa) / 86_400_000);
}

/**
 * Merge live family members with their status rows into one board array.
 * Members without a row default to Home. Sorted out-first, then by name.
 * `statusRows` are rows from app_status_board__statuses keyed by member_id.
 *
 * `presence` is the hub's derived home/away board (the `family.presence` context
 * key): [{ memberId, state: "home"|"away"|"unknown" }]. It is a *hint*, never an
 * author — this app cannot write another member's row (write_owner_only), and a
 * phone must not overrule someone who deliberately said "do not disturb":
 *
 *  - said nothing, or said Home: a phone reporting "away" shows them as Away,
 *    marked `fromPhone` so the board doesn't claim they typed it. An explicit
 *    Home is indistinguishable from the default in the data, and a stale Home
 *    shouldn't outrank a live geofence exit.
 *  - said Away/Busy/Do-not-disturb: the self-report stands exactly as set. If the
 *    phone disagrees, that becomes a `presenceHint` beside it, not a change.
 *  - "unknown" (phone quiet, or no crossing yet) and members missing from the
 *    board contribute nothing at all — silence must never read as "home".
 *
 * `nowTime` (HH:MM, household clock) lets a same-day "back by" lapse; without it
 * only a back date on an earlier day does.
 */
export function buildBoard(members, statusRows, today = isoDate(), presence = [], nowTime = "") {
  const byMember = new Map((statusRows ?? []).map((r) => [r.member_id, r]));
  const presenceByMember = new Map(
    (Array.isArray(presence) ? presence : []).map((p) => [p?.memberId, p?.state]),
  );
  const board = (members ?? []).map((m) => {
    const row = byMember.get(m.id);
    const selfStatus = normalizeStatus(row?.status);
    const reported = presenceByMember.get(m.id);
    let status = selfStatus;
    let fromPhone = false;
    let presenceHint = "";
    if (isOut(selfStatus)) {
      if (reported === "home") presenceHint = "phone says home";
    } else if (reported === "away") {
      status = "away";
      fromPhone = true;
    }
    return {
      memberId: m.id,
      name: m.name,
      role: m.role,
      status,
      out: isOut(status),
      // A Home row carries no note or "back by" — older saves left them in
      // place, and a phone-derived "away" has nothing of the member's to show.
      note: row && isOut(selfStatus) ? row.note ?? "" : "",
      backBy: row && isOut(selfStatus) ? formatBackBy(row.back_date, row.back_time, today, nowTime) : "",
      /** Said they'd be back by now and hasn't changed their status since. The
       *  status stands — being late is not being home — but the board stops
       *  repeating the promise. */
      overdue: !!row && isOut(selfStatus) && isOverdue(row.back_date, row.back_time, today, nowTime),
      updatedAt: row?.updated_at ?? "",
      /** Status came from the phone's geofence, not from the member. */
      fromPhone,
      /** Set when a self-reported status and the phone disagree. */
      presenceHint,
    };
  });
  board.sort((x, y) => (
    Number(y.out) - Number(x.out) || String(x.name).localeCompare(String(y.name))
  ));
  return board;
}

/** Counts for a one-line summary, e.g. "3 home · 2 out". */
export function boardSummary(board) {
  const total = board.length;
  const out = board.filter((b) => b.out).length;
  return { total, out, home: total - out };
}
