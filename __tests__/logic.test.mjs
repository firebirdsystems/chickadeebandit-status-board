import { describe, it, expect } from "vitest";
import {
  normalizeStatus, statusLabel, statusEmoji, isOut, formatTime,
  formatBackBy, daysBetween, buildBoard, boardSummary,
  isOverdue, addDays, resolveBackDate, storedBackDate, chosenBackDate,
} from "../src/logic.js";

describe("status helpers", () => {
  it("normalizes unknown statuses to home", () => {
    expect(normalizeStatus("away")).toBe("away");
    expect(normalizeStatus("nonsense")).toBe("home");
    expect(normalizeStatus(undefined)).toBe("home");
  });
  it("labels and emoji resolve for every known status", () => {
    for (const s of ["home", "away", "busy", "dnd"]) {
      expect(statusLabel(s)).toBeTruthy();
      expect(statusEmoji(s)).toBeTruthy();
    }
    expect(statusLabel("dnd")).toBe("Do not disturb");
  });
  it("isOut is false only for home", () => {
    expect(isOut("home")).toBe(false);
    expect(isOut("away")).toBe(true);
    expect(isOut("busy")).toBe(true);
    expect(isOut("dnd")).toBe(true);
    expect(isOut("bogus")).toBe(false); // normalized to home
  });
});

describe("formatTime", () => {
  it("formats 24h into 12h am/pm", () => {
    expect(formatTime("18:00")).toBe("6:00 PM");
    expect(formatTime("00:30")).toBe("12:30 AM");
    expect(formatTime("09:05")).toBe("9:05 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
  });
  it("returns empty for non-times", () => {
    expect(formatTime("")).toBe("");
    expect(formatTime("nope")).toBe("");
    expect(formatTime("25:00")).toBe("");
  });
});

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-07-17", "2026-07-17")).toBe(0);
    expect(daysBetween("2026-07-17", "2026-07-18")).toBe(1);
    expect(daysBetween("2026-07-17", "2026-07-20")).toBe(3);
  });
});

describe("formatBackBy", () => {
  const today = "2026-07-17";
  it("returns empty with nothing set", () => {
    expect(formatBackBy("", "", today)).toBe("");
  });
  it("time-only reads as 'back at'", () => {
    expect(formatBackBy("", "18:00", today)).toBe("back at 6:00 PM");
  });
  it("today with time", () => {
    expect(formatBackBy("2026-07-17", "18:00", today)).toBe("back at 6:00 PM");
  });
  it("today without time", () => {
    expect(formatBackBy("2026-07-17", "", today)).toBe("back later today");
  });
  it("tomorrow", () => {
    expect(formatBackBy("2026-07-18", "09:00", today)).toBe("back tomorrow, 9:00 AM");
    expect(formatBackBy("2026-07-18", "", today)).toBe("back tomorrow");
  });
  it("further out shows a date label", () => {
    expect(formatBackBy("2026-07-20", "", today)).toBe("back Jul 20");
    expect(formatBackBy("2026-08-03", "14:30", today)).toBe("back Aug 3, 2:30 PM");
  });
});

describe("buildBoard", () => {
  const members = [
    { id: "m1", name: "Alex", role: "adult" },
    { id: "m2", name: "Casey", role: "child" },
    { id: "m3", name: "Blair", role: "adult" },
  ];
  const today = "2026-07-17";

  it("defaults members with no row to home and sorts out-first then by name", () => {
    const rows = [
      { member_id: "m2", status: "away", note: "school", back_date: "2026-07-17", back_time: "15:00", updated_at: "t" },
    ];
    const board = buildBoard(members, rows, today);
    // Casey (out) first; then Alex, Blair (home) alphabetically.
    expect(board.map((b) => b.name)).toEqual(["Casey", "Alex", "Blair"]);
    expect(board[0]).toMatchObject({ status: "away", out: true, note: "school", backBy: "back at 3:00 PM" });
    expect(board[1]).toMatchObject({ status: "home", out: false, note: "", backBy: "" });
  });

  it("shows no note or back-by on a Home row, whatever the row holds", () => {
    // Saves made before Home cleared its note left "at the office" behind.
    const rows = [{ member_id: "m1", status: "home", note: "at the office", back_date: today, back_time: "15:00", updated_at: "t" }];
    const board = buildBoard([members[0]], rows, today, [], "16:00");
    expect(board[0]).toMatchObject({ status: "home", note: "", backBy: "", overdue: false });
  });

  it("coerces unknown stored status to home", () => {
    const board = buildBoard([members[0]], [{ member_id: "m1", status: "weird" }], today);
    expect(board[0].status).toBe("home");
  });

  it("summary counts home vs out", () => {
    const rows = [
      { member_id: "m1", status: "busy" },
      { member_id: "m2", status: "home" },
    ];
    const board = buildBoard(members, rows, today);
    expect(boardSummary(board)).toEqual({ total: 3, out: 1, home: 2 });
  });
});

describe("buildBoard with hub presence", () => {
  const members = [
    { id: "m1", name: "Alex", role: "adult" },
    { id: "m2", name: "Casey", role: "child" },
  ];
  const today = "2026-07-17";
  const at = (memberId, state) => ({ memberId, state, since: "2026-07-17T08:00:00.000Z" });

  it("shows a member as away when their phone left and they said nothing", () => {
    const board = buildBoard(members, [], today, [at("m1", "away")]);
    const alex = board.find((b) => b.name === "Alex");
    expect(alex).toMatchObject({ status: "away", out: true, fromPhone: true, presenceHint: "" });
  });

  it("marks the phone as the source so the board never implies they typed it", () => {
    const board = buildBoard(members, [], today, [at("m1", "away")]);
    expect(board.find((b) => b.name === "Alex").fromPhone).toBe(true);
    expect(board.find((b) => b.name === "Casey").fromPhone).toBe(false);
  });

  it("overrides a stale explicit Home, which is indistinguishable from the default", () => {
    const rows = [{ member_id: "m1", status: "home", note: "", back_date: "", back_time: "", updated_at: "t" }];
    expect(buildBoard(members, rows, today, [at("m1", "away")])[0]).toMatchObject({
      status: "away", fromPhone: true,
    });
  });

  it("never overrides a self-reported Do-not-disturb", () => {
    const rows = [{ member_id: "m1", status: "dnd", note: "on a call", back_date: "", back_time: "", updated_at: "t" }];
    const board = buildBoard(members, rows, today, [at("m1", "home")]);
    const alex = board.find((b) => b.name === "Alex");
    expect(alex.status).toBe("dnd");
    expect(alex.fromPhone).toBe(false);
    expect(alex.presenceHint).toBe("phone says home");
  });

  it("keeps a self-reported Away as set when the phone agrees", () => {
    const rows = [{ member_id: "m1", status: "away", note: "", back_date: "", back_time: "", updated_at: "t" }];
    const alex = buildBoard(members, rows, today, [at("m1", "away")])[0];
    expect(alex).toMatchObject({ status: "away", fromPhone: false, presenceHint: "" });
  });

  it("treats unknown as no signal, never as home or away", () => {
    const board = buildBoard(members, [], today, [at("m1", "unknown")]);
    expect(board[0]).toMatchObject({ status: "home", fromPhone: false, presenceHint: "" });
  });

  it("leaves members missing from the presence board untouched", () => {
    const board = buildBoard(members, [], today, [at("m1", "away")]);
    expect(board.find((b) => b.name === "Casey")).toMatchObject({ status: "home", out: false });
  });

  it("behaves exactly as before when the hub returns no presence", () => {
    const rows = [{ member_id: "m2", status: "busy", note: "", back_date: "", back_time: "", updated_at: "t" }];
    expect(buildBoard(members, rows, today, [])).toEqual(buildBoard(members, rows, today));
    expect(buildBoard(members, rows, today, null)).toEqual(buildBoard(members, rows, today));
  });

  it("counts a phone-derived away in the out total", () => {
    const board = buildBoard(members, [], today, [at("m1", "away")]);
    expect(boardSummary(board)).toEqual({ total: 2, out: 1, home: 1 });
  });
});

describe("isOverdue", () => {
  const today = "2026-07-17";
  it("is false with no back date, even when a time has passed", () => {
    expect(isOverdue("", "", today, "20:00")).toBe(false);
    expect(isOverdue("", "07:00", today, "20:00")).toBe(false);
  });
  it("lapses a same-day time once the household clock passes it", () => {
    expect(isOverdue(today, "15:00", today, "14:59")).toBe(false);
    expect(isOverdue(today, "15:00", today, "15:00")).toBe(false);
    expect(isOverdue(today, "15:00", today, "15:01")).toBe(true);
    expect(isOverdue(today, "9:00", today, "10:00")).toBe(true);
  });
  it("holds a same-day date with no time until the day is over", () => {
    expect(isOverdue(today, "", today, "23:59")).toBe(false);
    expect(isOverdue("2026-07-16", "", today, "00:01")).toBe(true);
  });
  it("lapses an earlier day and never a later one, whatever the time", () => {
    expect(isOverdue("2026-07-16", "23:00", today, "01:00")).toBe(true);
    expect(isOverdue("2026-07-18", "01:00", today, "23:00")).toBe(false);
  });
  it("without a clock, only an earlier day lapses", () => {
    expect(isOverdue(today, "15:00", today)).toBe(false);
    expect(isOverdue("2026-07-16", "15:00", today)).toBe(true);
  });
});

describe("formatBackBy once lapsed", () => {
  const today = "2026-07-17";
  it("says was due back instead of repeating the promise", () => {
    expect(formatBackBy(today, "15:00", today, "16:00")).toBe("was due back 3:00 PM");
    expect(formatBackBy("2026-07-16", "15:00", today, "09:00")).toBe("was due back yesterday, 3:00 PM");
    expect(formatBackBy("2026-07-16", "", today, "09:00")).toBe("was due back yesterday");
    expect(formatBackBy("2026-07-10", "", today, "09:00")).toBe("was due back Jul 10");
  });
  it("leaves a back-by that has not lapsed alone", () => {
    expect(formatBackBy(today, "15:00", today, "14:00")).toBe("back at 3:00 PM");
  });
});

describe("storedBackDate / chosenBackDate", () => {
  const today = "2026-07-17";
  it("stores a picked date as it is, unflagged", () => {
    expect(storedBackDate("2026-07-20", "07:00", today, "20:00")).toEqual({ back_date: "2026-07-20", back_date_auto: 0 });
  });
  it("stamps and flags a date for a bare time, and neither when there is no time", () => {
    expect(storedBackDate("", "18:00", today, "09:00")).toEqual({ back_date: today, back_date_auto: 1 });
    expect(storedBackDate("", "07:00", today, "20:00")).toEqual({ back_date: "2026-07-18", back_date_auto: 1 });
    expect(storedBackDate("", "", today, "20:00")).toEqual({ back_date: "", back_date_auto: 0 });
  });
  it("hands the setter only a date the member picked", () => {
    expect(chosenBackDate({ back_date: "2026-07-18", back_date_auto: 1 })).toBe("");
    expect(chosenBackDate({ back_date: "2026-07-18", back_date_auto: 0 })).toBe("2026-07-18");
    expect(chosenBackDate({ back_date: "2026-07-18" })).toBe("2026-07-18");
    expect(chosenBackDate(undefined)).toBe("");
  });
  it("a stamped tomorrow does not survive a time edit that means tonight", () => {
    // 20:00: "07:00" is stamped tomorrow. 20:05: the time becomes 22:00.
    const first = storedBackDate("", "07:00", today, "20:00");
    const chosen = chosenBackDate({ ...first });
    expect(storedBackDate(chosen, "22:00", today, "20:05")).toEqual({ back_date: today, back_date_auto: 1 });
  });
  it("a stamped yesterday is stamped afresh the next day", () => {
    const chosen = chosenBackDate({ back_date: "2026-07-16", back_date_auto: 1 });
    expect(storedBackDate(chosen, "17:00", today, "10:00")).toEqual({ back_date: today, back_date_auto: 1 });
  });
});

describe("resolveBackDate", () => {
  const today = "2026-07-17";
  it("keeps a date the member chose", () => {
    expect(resolveBackDate("2026-07-20", "07:00", today, "20:00")).toBe("2026-07-20");
  });
  it("stays empty when there is no time either", () => {
    expect(resolveBackDate("", "", today, "20:00")).toBe("");
  });
  it("dates a bare time today, or tomorrow when it has already gone by", () => {
    expect(resolveBackDate("", "18:00", today, "09:00")).toBe(today);
    expect(resolveBackDate("", "07:00", today, "20:00")).toBe("2026-07-18");
  });
  it("addDays crosses a month end", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("nope", 1)).toBe("");
  });
});

describe("buildBoard overdue", () => {
  const today = "2026-07-17";
  const members = [{ id: "m1", name: "Alex", role: "adult" }];
  const row = (over) => [{ member_id: "m1", status: "away", note: "", back_date: today, back_time: "15:00", ...over }];
  it("flags a lapsed back-by and keeps the status the member set", () => {
    expect(buildBoard(members, row(), today, [], "16:00")[0]).toMatchObject({
      status: "away", out: true, overdue: true, backBy: "was due back 3:00 PM",
    });
  });
  it("does not flag one still ahead, a home row, or a member with no row", () => {
    expect(buildBoard(members, row(), today, [], "14:00")[0].overdue).toBe(false);
    expect(buildBoard(members, row({ status: "home" }), today, [], "16:00")[0].overdue).toBe(false);
    expect(buildBoard(members, [], today, [], "16:00")[0].overdue).toBe(false);
  });
});
