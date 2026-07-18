// Pure, browser-free logic for Who's Home. Imported by both index.html and
// __tests__/logic.test.mjs. No DOM, no hub globals.

export const STATUSES = ["home", "away", "busy", "dnd"];

const STATUS_META = {
  home: { label: "Home", emoji: "🏠", out: false },
  away: { label: "Away", emoji: "🚶", out: true },
  busy: { label: "Busy", emoji: "⏳", out: true },
  dnd:  { label: "Do not disturb", emoji: "🔕", out: true },
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

/** Human "back by" phrase from the split back_date/back_time columns, relative
 *  to `today` (yyyy-mm-dd). Returns "" when nothing useful is set. */
export function formatBackBy(backDate, backTime, today = isoDate()) {
  const date = String(backDate ?? "").trim();
  const timeText = formatTime(backTime);
  if (!date) return timeText ? `back at ${timeText}` : "";

  const dayDiff = daysBetween(today, date);
  let whenText;
  if (dayDiff === 0) whenText = timeText ? `back at ${timeText}` : "back later today";
  else if (dayDiff === 1) whenText = timeText ? `back tomorrow, ${timeText}` : "back tomorrow";
  else if (dayDiff < 0) whenText = timeText ? `back at ${timeText}` : ""; // past date — treat as today-ish
  else {
    const [, mm, dd] = date.split("-");
    const label = `${MONTHS[Number(mm) - 1] ?? "?"} ${Number(dd)}`;
    whenText = timeText ? `back ${label}, ${timeText}` : `back ${label}`;
  }
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
 */
export function buildBoard(members, statusRows, today = isoDate()) {
  const byMember = new Map((statusRows ?? []).map((r) => [r.member_id, r]));
  const board = (members ?? []).map((m) => {
    const row = byMember.get(m.id);
    const status = normalizeStatus(row?.status);
    return {
      memberId: m.id,
      name: m.name,
      role: m.role,
      status,
      out: isOut(status),
      note: row?.note ?? "",
      backBy: row ? formatBackBy(row.back_date, row.back_time, today) : "",
      updatedAt: row?.updated_at ?? "",
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
