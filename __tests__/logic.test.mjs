import { describe, it, expect } from "vitest";
import {
  normalizeStatus, statusLabel, statusEmoji, isOut, formatTime,
  formatBackBy, daysBetween, buildBoard, boardSummary,
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
