import { describe, expect, it } from "vitest";
import { describeStatus, parseServiceTimes, statusAt } from "./schedule";

describe("parseServiceTimes", () => {
  it("parses a realistic OSM value with day ranges and time lists", () => {
    const windows = parseServiceTimes(
      "Su 09:00,10:00,11:15,12:30,19:00; Mo-Fr 08:00,12:30,19:00; Sa 12:30,19:00",
    );
    const sunday = windows.filter((window) => window.day === 0);
    expect(sunday.map((window) => window.start)).toEqual([540, 600, 675, 750, 1140]);
    // Mon-Fri (days 1-5) covers 3 services each
    expect(windows.filter((window) => window.day >= 1 && window.day <= 5)).toHaveLength(15);
    expect(windows.filter((window) => window.day === 6).map((window) => window.start)).toEqual([
      750, 1140,
    ]);
  });

  it("parses explicit end times and full day names", () => {
    expect(parseServiceTimes("Sunday 09:30-11:30")).toEqual([{ day: 0, start: 570, end: 690 }]);
  });

  it("gives untimed services a sensible default length", () => {
    const [window] = parseServiceTimes("Tu 19:00");
    expect(window).toEqual({ day: 2, start: 1140, end: 1215 });
  });

  it("wraps day ranges and handles lists", () => {
    const days = parseServiceTimes("Sa-Su 18:00").map((window) => window.day);
    expect(days.sort()).toEqual([0, 6]);
    expect(parseServiceTimes("Su,We 10:00").map((window) => window.day).sort()).toEqual([0, 3]);
  });

  it("ignores junk instead of inventing services", () => {
    expect(parseServiceTimes("")).toEqual([]);
    expect(parseServiceTimes("ask the office")).toEqual([]);
    expect(parseServiceTimes("PH 10:00")).toEqual([]);
    expect(parseServiceTimes("Su 99:99")).toEqual([]);
  });

  it("deduplicates identical slots", () => {
    expect(parseServiceTimes("Su 10:00; Su 10:00")).toHaveLength(1);
  });
});

describe("statusAt", () => {
  const sundayTen = [{ day: 0, start: 600, end: 675 }];

  it("reports a service in progress", () => {
    const status = statusAt(sundayTen, 0, 640);
    expect(status.state).toBe("live");
    expect(status.minutesLeft).toBe(35);
  });

  it("is not in session before the service starts", () => {
    const status = statusAt(sundayTen, 0, 585);
    expect(status.state).toBe("idle");
    expect(status.nextInMinutes).toBe(15);
    expect(describeStatus(status)).toBe("Not meeting yet · starts in 15 min at 10:00");
  });

  it("marks a church that already met today", () => {
    const status = statusAt(sundayTen, 0, 700);
    expect(status.state).toBe("done");
    expect(status.endedMinutesAgo).toBe(25);
    expect(describeStatus(status)).toBe("Met earlier today · next Sun 10:00");
  });

  it("stays idle for the rest of a day with no service yet", () => {
    const status = statusAt(sundayTen, 3, 500);
    expect(status.state).toBe("idle");
    // Wednesday 08:20 → Sunday 10:00 is four days and 100 minutes away.
    expect(status.nextInMinutes).toBe(4 * 24 * 60 + 100);
  });

  it("looks across midnight into the next day", () => {
    const lateSaturday = 23 * 60 + 50;
    const idle = statusAt([{ day: 0, start: 60, end: 120 }], 6, lateSaturday);
    expect(idle.state).toBe("idle");
    expect(idle.nextInMinutes).toBe(70);

    const soon = statusAt([{ day: 0, start: 30, end: 90 }], 6, lateSaturday);
    expect(soon.state).toBe("idle");
    expect(soon.nextInMinutes).toBe(40);
  });

  it("handles an empty schedule", () => {
    expect(statusAt([], 3, 500).state).toBe("idle");
  });
});
