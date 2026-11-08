import { describe, expect, it } from "vitest";
import {
  activeCheckIn,
  checkInSummary,
  isCheckInActive,
  mergeCheckIns,
  minutesLeft,
  normalizeCheckIn,
  reportedAgo,
  reportersLabel,
  type CheckIn,
} from "./checkins";

const TTL = 90 * 60_000;

function checkin(overrides: Partial<CheckIn> = {}): CheckIn {
  const startsAt = 1_700_000_000_000;
  return {
    churchId: "osm:node/42",
    startsAt,
    endsAt: startsAt + TTL,
    revision: 10,
    reporters: 1,
    ...overrides,
  };
}

describe("normalizeCheckIn", () => {
  it("accepts a well formed record", () => {
    expect(normalizeCheckIn(checkin())).toEqual(checkin());
  });

  it("rejects unknown church ids, non numeric fields and empty records", () => {
    expect(normalizeCheckIn(checkin({ churchId: "somewhere" }))).toBeNull();
    expect(normalizeCheckIn({ ...checkin(), reporters: "two" })).toBeNull();
    expect(normalizeCheckIn(checkin({ reporters: 0 }))).toBeNull();
    expect(normalizeCheckIn(checkin({ endsAt: 1_700_000_000_000 }))).toBeNull();
    expect(normalizeCheckIn(null)).toBeNull();
  });
});

describe("mergeCheckIns", () => {
  it("keeps the newest server revision per church", () => {
    const current = new Map([[checkin().churchId, checkin({ revision: 10, reporters: 1 })]]);
    const merged = mergeCheckIns(current, [checkin({ revision: 12, reporters: 3 })]);
    expect(merged.get(checkin().churchId)?.reporters).toBe(3);
  });

  it("ignores an older broadcast or a slow snapshot response", () => {
    const current = new Map([[checkin().churchId, checkin({ revision: 10, reporters: 3 })]]);
    const merged = mergeCheckIns(current, [checkin({ revision: 9, reporters: 1 })]);
    expect(merged.get(checkin().churchId)?.reporters).toBe(3);
    // the caller's map is never mutated
    expect(current.get(checkin().churchId)?.reporters).toBe(3);
    expect(merged).not.toBe(current);
  });

  it("adds records for other churches", () => {
    const merged = mergeCheckIns(new Map(), [
      checkin(),
      checkin({ churchId: "wd:Q1234", revision: 11 }),
    ]);
    expect([...merged.keys()]).toEqual(["osm:node/42", "wd:Q1234"]);
  });
});

describe("expiry", () => {
  it("counts down and stops being active at the boundary", () => {
    const record = checkin();
    expect(isCheckInActive(record, record.endsAt - 1)).toBe(true);
    expect(isCheckInActive(record, record.endsAt)).toBe(false);
  });

  it("never reports a sub-minute remainder as zero", () => {
    expect(minutesLeft(2_000_000, 1_999_950)).toBe(1);
    expect(minutesLeft(1_700_000_000_000, 1_700_000_000_000 - 75 * 60_000)).toBe(75);
  });

  it("returns null for an expired or unknown church", () => {
    const records = new Map([[checkin().churchId, checkin()]]);
    expect(activeCheckIn(records, checkin().churchId, checkin().startsAt + 1000)?.reporters).toBe(1);
    expect(activeCheckIn(records, checkin().churchId, checkin().endsAt + 1)).toBeNull();
    expect(activeCheckIn(records, "osm:node/999", checkin().startsAt)).toBeNull();
  });
});

describe("copy", () => {
  it("pluralises reporters", () => {
    expect(reportersLabel(1)).toBe("1 person");
    expect(reportersLabel(4)).toBe("4 people");
  });

  it("summarises an active report", () => {
    const record = checkin({ reporters: 3, endsAt: checkin().startsAt + 30 * 60_000 });
    expect(checkInSummary(record, record.startsAt)).toBe("3 people report meeting now · 30 min left");
    expect(checkInSummary(record, record.startsAt + 1)).toBe("3 people report meeting now · 30 min left");
    expect(checkInSummary({ ...record, reporters: 1 }, record.startsAt)).toBe(
      "1 person reports meeting now · 30 min left",
    );
  });

  it("describes how long ago a report started", () => {
    const start = 1_700_000_000_000;
    expect(reportedAgo(start, start + 30_000)).toBe("just now");
    expect(reportedAgo(start, start + 8 * 60_000)).toBe("8 min ago");
    expect(reportedAgo(start, start + 2 * 60 * 60_000)).toBe("2 hours ago");
  });
});
