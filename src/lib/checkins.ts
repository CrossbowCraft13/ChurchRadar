import { connectRealtime, type RealtimeConnection } from "./realtime";

/** A community report that a church is meeting right now. */
export interface CheckIn {
  churchId: string;
  /** when the first report for this gathering arrived (ms epoch) */
  startsAt: number;
  /** when the report stops counting as live (ms epoch) */
  endsAt: number;
  /** server ms timestamp of the latest write; used to reconcile broadcasts */
  revision: number;
  /** distinct people currently reporting the same gathering */
  reporters: number;
}

export type CheckinConnection = "idle" | "connecting" | "live" | "polling" | "unavailable";

/** Fixed server-side room; the value is validated and ignored by the server. */
export const CHECKIN_ROOM = "church-radar:checkins";

const ENDPOINT = "/api/checkins";
const TICKET_ENDPOINT = "/api/realtime/ticket";
const POLL_MS = 30_000;

const CHURCH_ID = /^(?:osm:(?:node|way|relation)\/\d{1,12}|wd:Q\d{1,12})$/;

export function normalizeCheckIn(value: unknown): CheckIn | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.churchId !== "string" || !CHURCH_ID.test(raw.churchId)) return null;
  const startsAt = Number(raw.startsAt);
  const endsAt = Number(raw.endsAt);
  const revision = Number(raw.revision);
  const reporters = Number(raw.reporters);
  if (![startsAt, endsAt, revision, reporters].every(Number.isFinite)) return null;
  if (endsAt <= startsAt || reporters < 1) return null;
  return {
    churchId: raw.churchId,
    startsAt,
    endsAt,
    revision,
    reporters: Math.max(1, Math.round(reporters)),
  };
}

function normalizeSnapshot(payload: unknown): CheckIn[] | null {
  if (!payload || typeof payload !== "object") return null;
  const list = (payload as { checkins?: unknown }).checkins;
  if (!Array.isArray(list)) return null;
  const checkins: CheckIn[] = [];
  for (const entry of list) {
    const checkin = normalizeCheckIn(entry);
    if (checkin) checkins.push(checkin);
  }
  return checkins;
}

/**
 * Fold newer records into the current map. The latest server revision wins, so
 * a slow snapshot response can never overwrite a newer broadcast.
 */
export function mergeCheckIns(
  current: ReadonlyMap<string, CheckIn>,
  incoming: Iterable<CheckIn>,
): Map<string, CheckIn> {
  const next = new Map(current);
  for (const checkin of incoming) {
    const existing = next.get(checkin.churchId);
    if (!existing || checkin.revision >= existing.revision) {
      next.set(checkin.churchId, checkin);
    }
  }
  return next;
}

export function isCheckInActive(checkin: CheckIn | undefined | null, now: number): checkin is CheckIn {
  return checkin != null && checkin.endsAt > now;
}

/** The active community report for a church, if any. */
export function activeCheckIn(
  checkins: ReadonlyMap<string, CheckIn>,
  churchId: string,
  now: number,
): CheckIn | null {
  const checkin = checkins.get(churchId);
  return isCheckInActive(checkin, now) ? checkin : null;
}

export function minutesLeft(endsAt: number, now: number): number {
  return Math.max(1, Math.ceil((endsAt - now) / 60_000));
}

export function reportersLabel(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

/** e.g. "3 people report meeting now · 74 min left" */
export function checkInSummary(checkin: CheckIn, now: number): string {
  const verb = checkin.reporters === 1 ? "reports" : "report";
  const reporting = `${reportersLabel(checkin.reporters)} ${verb} meeting now`;
  const left = minutesLeft(checkin.endsAt, now);
  return `${reporting} · ${left} min left`;
}

/** e.g. "just now", "8 min ago" */
export function reportedAgo(startsAt: number, now: number): string {
  const minutes = Math.floor((now - startsAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

export interface CheckinHandlers {
  /** full authoritative list from the server */
  onSnapshot: (checkins: CheckIn[]) => void;
  /** one record changed (broadcast or local report) */
  onCheckIn: (checkin: CheckIn) => void;
  onConnection: (state: CheckinConnection) => void;
}

export interface CheckinClient {
  start: () => void;
  stop: () => void;
  refresh: () => Promise<void>;
  report: (churchId: string) => Promise<CheckIn>;
}

function errorText(status: number, code: string | undefined): string {
  switch (code) {
    case "rate_limited":
      return "Too many reports from this network — try again later";
    case "invalid_church":
      return "This church cannot be checked in";
    case "origin_denied":
      return "The check-in was rejected by the server";
    case "realtime_unavailable":
      return "Live updates are unavailable right now";
    default:
      return status === 503
        ? "Community check-ins are offline"
        : `Check-in failed (${status})`;
  }
}

/**
 * Talks to the check-in service: a durable snapshot on open, an instant room
 * broadcast while connected, and a slow poll so a missed broadcast can never
 * leave the radar permanently stale.
 */
export function createCheckinClient(handlers: CheckinHandlers): CheckinClient {
  let stopped = false;
  let unavailable = false;
  let state: CheckinConnection = "idle";
  let socket: RealtimeConnection | null = null;
  let poll: number | undefined;

  const emit = (next: CheckinConnection) => {
    if (state === next) return;
    state = next;
    handlers.onConnection(next);
  };

  const setUnavailable = () => {
    unavailable = true;
    emit("unavailable");
    window.clearInterval(poll);
    poll = undefined;
    socket?.close();
    socket = null;
  };

  async function readSnapshot(): Promise<void> {
    if (stopped || unavailable) return;
    let response: Response;
    try {
      response = await fetch(ENDPOINT, { cache: "no-store", credentials: "same-origin" });
    } catch {
      emit(state === "live" ? "live" : "polling");
      return;
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("application/json")) {
      // A static host without the check-in Worker answers with the app shell.
      setUnavailable();
      return;
    }
    if (!response.ok) {
      emit("polling");
      return;
    }

    const checkins = normalizeSnapshot(await response.json().catch(() => null));
    if (!checkins) {
      setUnavailable();
      return;
    }
    handlers.onSnapshot(checkins);
    if (state !== "live") emit("polling");
  }

  function connect() {
    if (stopped || unavailable) return;
    try {
      socket = connectRealtime({
        room: CHECKIN_ROOM,
        ticketUrl: TICKET_ENDPOINT,
        onStatus: (status) => {
          if (status === "connected") emit("live");
          else if (status === "disconnected" || status === "unauthorized") emit("polling");
        },
        onMessage: (message) => {
          if (message.type === "ready") {
            void readSnapshot();
            return;
          }
          if (message.event !== "checkin") return;
          const checkin = normalizeCheckIn(message.data);
          if (checkin) handlers.onCheckIn(checkin);
        },
      });
    } catch {
      emit("polling");
    }
    void readSnapshot();
    window.clearInterval(poll);
    poll = window.setInterval(() => void readSnapshot(), POLL_MS);
  }

  const onVisible = () => {
    if (!document.hidden) void readSnapshot();
  };

  return {
    start() {
      stopped = false;
      unavailable = false;
      emit("connecting");
      document.addEventListener("visibilitychange", onVisible);
      connect();
    },

    stop() {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(poll);
      poll = undefined;
      socket?.close();
      socket = null;
      emit("idle");
    },

    refresh: readSnapshot,

    async report(churchId: string): Promise<CheckIn> {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ churchId }),
      }).catch(() => null);

      if (!response) throw new Error("Check-in service unreachable");
      const payload = (await response.json().catch(() => null)) as
        | { checkin?: unknown; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(errorText(response.status, payload?.error));
      }
      const checkin = normalizeCheckIn(payload?.checkin);
      if (!checkin) throw new Error("The server returned an invalid check-in");
      handlers.onCheckIn(checkin);
      return checkin;
    },
  };
}
