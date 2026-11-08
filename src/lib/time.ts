import tzLookup from "tz-lookup";

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const tzCache = new Map<string, string>();

/** IANA time zone for a church's coordinates (cached on a ~11 km grid). */
export function timezoneFor(lat: number, lon: number): string {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const cached = tzCache.get(key);
  if (cached) return cached;
  let zone = "UTC";
  try {
    zone = tzLookup(lat, lon) || "UTC";
  } catch {
    zone = "UTC";
  }
  tzCache.set(key, zone);
  return zone;
}

export interface LocalClock {
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  /** minutes after local midnight */
  minutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const clockCache = new Map<string, LocalClock>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
    }
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** Wall-clock weekday and minute-of-day inside a time zone (memoised per minute). */
export function localClock(zone: string, at: Date = new Date()): LocalClock {
  const bucket = Math.floor(at.getTime() / 60_000);
  const key = `${zone}|${bucket}`;
  const cached = clockCache.get(key);
  if (cached) return cached;

  let day = 0;
  let minutes = 0;
  for (const part of formatterFor(zone).formatToParts(at)) {
    if (part.type === "weekday") {
      day = WEEKDAY[part.value] ?? 0;
    } else if (part.type === "hour") {
      minutes = (Number(part.value) % 24) * 60;
    } else if (part.type === "minute") {
      minutes += Number(part.value);
    }
  }

  const clock = { day, minutes: minutes % (24 * 60) };
  clockCache.set(key, clock);
  if (clockCache.size > 8192) clockCache.clear();
  return clock;
}

export function formatLocalTime(zone: string, at: Date = new Date()): string {
  const clock = localClock(zone, at);
  const h = String(Math.floor(clock.minutes / 60)).padStart(2, "0");
  const m = String(clock.minutes % 60).padStart(2, "0");
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][clock.day]} ${h}:${m}`;
}
