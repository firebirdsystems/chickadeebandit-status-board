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
