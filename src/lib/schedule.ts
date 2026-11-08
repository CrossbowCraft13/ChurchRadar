import type { Family } from "./denomination";

/** A weekly service slot, in the church's own local time. */
export interface ServiceWindow {
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  /** minutes after local midnight */
  start: number;
  /** minutes after local midnight */
  end: number;
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DEFAULT_DURATION_MIN = 75;
export const SOON_MINUTES = 60;

const DAY_INDEX: Record<string, number> = {
  su: 0,
  sun: 0,
  sunday: 0,
  mo: 1,
  mon: 1,
  monday: 1,
  tu: 2,
  tue: 2,
  tues: 2,
  tuesday: 2,
  we: 3,
  wed: 3,
  wednesday: 3,
  th: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fr: 5,
  fri: 5,
  friday: 5,
  sa: 6,
  sat: 6,
  saturday: 6,
};

function dayIndex(token: string): number | undefined {
  return DAY_INDEX[token.toLowerCase().replace(/\./g, "").trim()];
}

function parseDays(spec: string): number[] {
  const days = new Set<number>();
  for (const part of spec.split(/[,&]/)) {
    const piece = part.trim();
    if (!piece) continue;
    const range = piece.match(/^([A-Za-z.]+)\s*-\s*([A-Za-z.]+)$/);
    if (range) {
      const from = dayIndex(range[1]);
      const to = dayIndex(range[2]);
      if (from === undefined || to === undefined) continue;
      for (let step = 0; step < 7; step++) {
        const day = (from + step) % 7;
        days.add(day);
        if (day === to) break;
      }
      continue;
    }
    const single = dayIndex(piece);
    if (single !== undefined) days.add(single);
  }
  return [...days];
}

function parseTimes(spec: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const chunk of spec.split(/[,;]/)) {
    const match = chunk.match(/(\d{1,2})[:.](\d{2})\s*(?:-\s*(\d{1,2})[:.](\d{2}))?/);
    if (!match) continue;
    const start = Number(match[1]) * 60 + Number(match[2]);
    if (!Number.isFinite(start) || start < 0 || start >= 24 * 60) continue;
    const end =
      match[3] !== undefined
        ? Number(match[3]) * 60 + Number(match[4])
        : Math.min(start + DEFAULT_DURATION_MIN, 24 * 60);
    out.push({ start, end: end > start ? Math.min(end, 24 * 60) : Math.min(start + DEFAULT_DURATION_MIN, 24 * 60) });
  }
  return out;
}

/**
 * Parse the subset of OSM `service_times` syntax that mappers actually use, e.g.
 * "Su 10:00", "Su 09:00,10:00,11:15", "Mo-Fr 08:00,12:30; Sa 18:00", "Sun 09:30-11:30".
 * Anything unrecognised is skipped rather than guessed.
 */
export function parseServiceTimes(input?: string | null): ServiceWindow[] {
  if (!input) return [];
  const windows: ServiceWindow[] = [];
  for (const rawRule of input.split(/[;\n]/)) {
    const rule = rawRule.trim();
    if (!rule) continue;
    if (/^(PH|SH)\b/i.test(rule)) continue;
    const split = rule.match(/^([^0-9]*?)\s*(\d.*)$/);
    if (!split) continue;
    const days = parseDays(split[1]);
    if (days.length === 0) continue;
    for (const time of parseTimes(split[2])) {
      for (const day of days) {
        windows.push({ day, start: time.start, end: time.end });
      }
    }
  }

  const seen = new Set<string>();
  return windows
    .filter((window) => {
      const key = `${window.day}:${window.start}:${window.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.day - b.day || a.start - b.start);
}

/**
 * Typical service slots per tradition, used only when a church publishes no
 * service_times. Surfaced in the UI as "estimated", never as confirmed.
 */
export const ESTIMATED_TIMES: Record<Family, ServiceWindow[]> = {
  catholic: [
    { day: 6, start: 18 * 60, end: 19 * 60 },
    { day: 0, start: 9 * 60, end: 10 * 60 },
    { day: 0, start: 11 * 60, end: 12 * 60 },
  ],
  orthodox: [{ day: 0, start: 9 * 60 + 30, end: 11 * 60 + 30 }],
  anglican: [{ day: 0, start: 10 * 60, end: 11 * 60 + 15 }],
  protestant: [{ day: 0, start: 10 * 60, end: 11 * 60 + 15 }],
  baptist: [
    { day: 0, start: 10 * 60 + 30, end: 12 * 60 },
    { day: 0, start: 18 * 60, end: 19 * 60 + 15 },
  ],
  evangelical: [
    { day: 0, start: 10 * 60, end: 11 * 60 + 30 },
    { day: 0, start: 18 * 60 + 30, end: 20 * 60 },
  ],
  adventist: [
    { day: 6, start: 9 * 60 + 30, end: 11 * 60 },
    { day: 6, start: 11 * 60 + 15, end: 12 * 60 + 30 },
  ],
  restorationist: [{ day: 0, start: 10 * 60, end: 11 * 60 + 30 }],
  other: [{ day: 0, start: 10 * 60, end: 11 * 60 + 30 }],
};

export function estimateServiceTimes(family: Family): ServiceWindow[] {
  return ESTIMATED_TIMES[family];
}

export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatWindow(window: ServiceWindow): string {
  return `${DAY_NAMES[window.day]} ${formatClock(window.start)}`;
}

/**
 * live = a service is running now, done = one already ended earlier today,
 * idle = nothing has happened yet today (red).
 */
export type ServiceState = "live" | "done" | "idle";

export interface Status {
  state: ServiceState;
  /** minutes until the current service ends (only when live) */
  minutesLeft?: number;
  /** minutes since the last service today ended (only when done) */
  endedMinutesAgo?: number;
  /** minutes until the next service starts (only when not live) */
  nextInMinutes?: number;
  nextWindow?: ServiceWindow;
}

/** Evaluate a schedule against the church's local weekday and minute-of-day. */
export function statusAt(windows: ServiceWindow[], day: number, minutes: number): Status {
  let live: ServiceWindow | undefined;
  let lastEnd = -1;
  let next: ServiceWindow | undefined;
  let nextInMinutes = Number.POSITIVE_INFINITY;

  for (const window of windows) {
    if (window.day === day && minutes >= window.start && minutes < window.end) {
      if (!live || window.end < live.end) live = window;
      continue;
    }
    if (window.day === day && window.end <= minutes) lastEnd = Math.max(lastEnd, window.end);

    let delta = ((window.day - day + 7) % 7) * 24 * 60 + window.start - minutes;
    if (delta <= 0) delta += 7 * 24 * 60;
    if (delta < nextInMinutes) {
      nextInMinutes = delta;
      next = window;
    }
  }

  const upcoming = {
    nextInMinutes: Number.isFinite(nextInMinutes) ? nextInMinutes : undefined,
    nextWindow: next,
  };

  if (live) {
    return { state: "live", minutesLeft: live.end - minutes, nextWindow: live };
  }
  if (lastEnd >= 0) {
    return { state: "done", endedMinutesAgo: minutes - lastEnd, ...upcoming };
  }
  return { state: "idle", ...upcoming };
}

export function describeStatus(status: Status): string {
  if (status.state === "live") {
    const left = status.minutesLeft ?? 0;
    return left <= 1 ? "Meeting now · ending" : `Meeting now · ${left} min left`;
  }
  if (status.state === "done") {
    const soon = status.nextInMinutes !== undefined && status.nextInMinutes <= SOON_MINUTES;
    if (soon && status.nextWindow) return `Met earlier today · again at ${formatClock(status.nextWindow.start)}`;
    if (status.nextWindow) return `Met earlier today · next ${formatWindow(status.nextWindow)}`;
    return "Met earlier today";
  }
  if (status.nextInMinutes !== undefined && status.nextInMinutes <= SOON_MINUTES) {
    const mins = status.nextInMinutes ?? 0;
    const label = status.nextWindow ? ` at ${formatClock(status.nextWindow.start)}` : "";
    return `Not meeting yet · starts in ${mins <= 1 ? "a minute" : `${mins} min`}${label}`;
  }
  if (status.nextWindow && status.nextInMinutes !== undefined) {
    const hours = Math.round(status.nextInMinutes / 60);
    const when = hours < 48 ? `in ${hours || 1} h` : `in ${Math.round(hours / 24)} d`;
    return `Not meeting · next ${formatWindow(status.nextWindow)} (${when})`;
  }
  return "No schedule available";
}
