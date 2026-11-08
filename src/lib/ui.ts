import type { ServiceState } from "./schedule";

export type ColorMode = "status" | "denomination";

export const STATUS_COLORS: Record<ServiceState, string> = {
  live: "#2fe27c",
  done: "#3d9bff",
  idle: "#ff5a68",
};

export type SyncPhase = "boot" | "overview" | "scanning" | "ok" | "error";

export interface SyncState {
  phase: SyncPhase;
  at?: number;
  endpoint?: string;
  fromCache?: boolean;
  stale?: boolean;
  truncated?: boolean;
  message?: string;
}

export function syncLabel(sync: SyncState, now: Date): { text: string; tone: string } {
  switch (sync.phase) {
    case "boot":
      return { text: "INITIALISING", tone: "idle" };
    case "overview":
      return { text: "WORLD OVERVIEW", tone: "idle" };
    case "scanning":
      return { text: "SCANNING", tone: "scan" };
    case "error":
      return { text: "LINK DOWN", tone: "error" };
    case "ok": {
      if (!sync.at) return { text: "LIVE", tone: "live" };
      const age = Math.max(0, Math.round((now.getTime() - sync.at) / 1000));
      const ago = age < 90 ? `${age}s` : `${Math.round(age / 60)}m`;
      if (sync.stale) return { text: `STALE ${ago}`, tone: "warn" };
      if (sync.fromCache) return { text: `CACHED ${ago}`, tone: "warn" };
      return { text: `LIVE ${ago}`, tone: "live" };
    }
  }
}

export function compactNumber(value: number): string {
  return value.toLocaleString("en-US");
}
