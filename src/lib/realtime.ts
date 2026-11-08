/**
 * Minimal typed realtime client for the platform room hub.
 *
 * Adapted from the generated `freebuff-realtime/browser.js` helper, trimmed to
 * the messages this app uses (ready + broadcast). Tickets are fetched from the
 * app's own API on every connect and renewal, so a socket never outlives the
 * server's authorisation. No tickets or room secrets are persisted.
 */
export type RealtimeStatus = "connecting" | "connected" | "disconnected" | "unauthorized" | "closed";

export interface ReadyMessage {
  type: "ready";
  room: string;
  userId: string;
  connectionId: string;
  expiresAt: number;
  expiresInMs: number;
}

export interface BroadcastMessage {
  type: "broadcast";
  event: string;
  data: unknown;
  userId: string | null;
  connectionId: string | null;
}

export type RealtimeMessage = ReadyMessage | BroadcastMessage;

export interface RealtimeOptions {
  room: string;
  ticketUrl?: string;
  onMessage: (message: RealtimeMessage) => void;
  onStatus: (status: RealtimeStatus) => void;
  /** Optional transport rewrite (used when a dev proxy exposes the hub elsewhere). */
  websocketUrl?: (url: string) => string;
}

export interface RealtimeConnection {
  close: () => void;
}

const MAX_MESSAGE_BYTES = 16 * 1024;

function isRealtimeMessage(value: unknown): value is RealtimeMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "ready" || type === "broadcast";
}

export function connectRealtime({
  room,
  ticketUrl = "/api/realtime/ticket",
  onMessage,
  onStatus,
  websocketUrl = (url) => url,
}: RealtimeOptions): RealtimeConnection {
  const endpoint = new URL(ticketUrl, window.location.href);
  if (endpoint.origin !== window.location.origin) {
    throw new Error("The realtime ticket endpoint must be same-origin");
  }

  let socket: WebSocket | undefined;
  let retryTimer: number | undefined;
  let renewalTimer: number | undefined;
  let pending: AbortController | undefined;
  let stopped = false;
  let retry = 0;

  const retire = (connection: WebSocket | undefined) => {
    window.clearTimeout(renewalTimer);
    renewalTimer = undefined;
    if (!connection) return;
    connection.onmessage = null;
    connection.onclose = null;
    connection.onerror = null;
    if (socket === connection) socket = undefined;
    try {
      connection.close(1000, "Authorization renewal");
    } catch {
      /* already closing */
    }
  };

  const schedule = () => {
    window.clearTimeout(retryTimer);
    if (stopped) return;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(retry, 6)) * (0.5 + Math.random());
    retry += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined;
      void open();
    }, delay);
  };

  async function open() {
    if (stopped || pending) return;
    onStatus("connecting");
    const controller = new AbortController();
    pending = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room }),
        signal: controller.signal,
      });
      if (stopped) return;
      if (response.status === 401 || response.status === 403) {
        stopped = true;
        onStatus("unauthorized");
        return;
      }
      if (!response.ok) throw new Error(`Ticket request failed (${response.status})`);
      const ticket = (await response.json()) as { websocketUrl?: unknown };
      if (typeof ticket.websocketUrl !== "string") throw new Error("Ticket response is invalid");
      if (stopped) return;

      const connection = new WebSocket(websocketUrl(ticket.websocketUrl));
      socket = connection;

      connection.onmessage = ({ data }: MessageEvent<string>) => {
        if (stopped || socket !== connection) return;
        if (typeof data !== "string" || data.length > MAX_MESSAGE_BYTES) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        if (!isRealtimeMessage(parsed)) return;

        if (parsed.type === "ready") {
          retry = 0;
          window.clearTimeout(renewalTimer);
          const expiresInMs = Number.isFinite(parsed.expiresInMs)
            ? Math.max(1_000, Math.min(300_000, parsed.expiresInMs))
            : 300_000;
          const delay = Math.max(250, expiresInMs - 500 - Math.random() * 500);
          renewalTimer = window.setTimeout(() => {
            if (stopped || socket !== connection) return;
            retire(connection);
            void open();
          }, delay);
          onStatus("connected");
        }

        onMessage(parsed);
      };

      connection.onclose = () => {
        if (stopped || socket !== connection) return;
        retire(connection);
        onStatus("disconnected");
        schedule();
      };

      connection.onerror = () => {
        if (stopped || socket !== connection) return;
        retire(connection);
        onStatus("disconnected");
        schedule();
      };
    } catch {
      if (!stopped) {
        onStatus("disconnected");
        schedule();
      }
    } finally {
      window.clearTimeout(timeout);
      if (pending === controller) pending = undefined;
    }
  }

  void open();

  return {
    close() {
      stopped = true;
      window.clearTimeout(retryTimer);
      pending?.abort();
      retire(socket);
      onStatus("closed");
    },
  };
}
