/*
 * Church Radar check-in service.
 *
 * A tiny Cloudflare Worker that serves the built PWA from ./dist and exposes a
 * community check-in API:
 *
 *   GET  /api/health          readiness probe
 *   GET  /api/checkins        durable snapshot of active check-ins
 *   POST /api/checkins        report / confirm "this church is meeting now"
 *   POST /api/realtime/ticket single-use realtime ticket (server-authorised)
 *
 * Durable truth lives in D1; the platform realtime room is only the fast fan-out
 * path. Every client therefore recovers from a missed broadcast by reloading the
 * snapshot, and nothing important is lost if realtime is unavailable.
 *
 * Identity: visitors get an opaque, server-issued, HMAC-signed HttpOnly cookie.
 * The browser never supplies a voter id and realtime tickets always carry
 * publish:false, so clients cannot inject events into the room.
 */
/** The room is fixed by the server; a client cannot choose one. */
const CHECKIN_ROOM = "church-radar:checkins";
const COOKIE = "cr_voter";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const DEFAULT_TTL_SECONDS = 90 * 60;
const MAX_TTL_SECONDS = 12 * 60 * 60;
const REPORTS_PER_HOUR = 30;
const MAX_BODY_BYTES = 2048;
const MAX_SNAPSHOT = 2000;
const CHURCH_ID = /^(?:osm:(?:node|way|relation)\/\d{1,12}|wd:Q\d{1,12})$/;
const LOOPBACK = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;

let schemaReady = false;
let signingKeyCache = null;
let signingKeyPromise = null;

/**
 * Realtime hub calls (same protocol as freebuff-realtime/server.js, inlined so
 * this Worker deploys as a single self-contained module). Server-only: called
 * after authorisation, never from the browser.
 */
async function realtimeRequest(env, path, body) {
  if (!env.REALTIME) throw new Error("Realtime binding is not configured");
  const response = await env.REALTIME.get(env.REALTIME.idFromName("hub")).fetch(
    new Request(`https://realtime${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (!response.ok) throw new Error(`Realtime request failed (${response.status})`);
  return response;
}

async function createRealtimeTicket(env, ticket) {
  return (await realtimeRequest(env, "/ticket", ticket)).json();
}

async function publishRealtime(env, event) {
  await realtimeRequest(env, "/publish", event);
}

const json = (value, status = 200, headers = {}) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json", ...headers },
  });

const fail = (error, status = 400) => json({ error }, status);

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteLength) {
  return hex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

/** Constant-time string comparison for hex signatures. */
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function ttlSeconds(env) {
  const value = Number(env?.CHECKIN_TTL_SECONDS);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(1, Math.round(value)));
}

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS checkins (
         church_id TEXT PRIMARY KEY,
         starts_at INTEGER NOT NULL,
         ends_at INTEGER NOT NULL,
         revision INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS checkin_reports (
         church_id TEXT NOT NULL,
         voter TEXT NOT NULL,
         reported_at INTEGER NOT NULL,
         expires_at INTEGER NOT NULL,
         PRIMARY KEY (church_id, voter)
       )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS checkin_signals (
         key TEXT PRIMARY KEY,
         count INTEGER NOT NULL,
         created_at INTEGER NOT NULL
       )`,
    ),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
  ]);
  schemaReady = true;
}

async function signingKey(env) {
  if (env.CHECKIN_KEY) return env.CHECKIN_KEY;
  if (signingKeyCache) return signingKeyCache;
  if (!signingKeyPromise) {
    signingKeyPromise = (async () => {
      const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'session_key'").first();
      if (row?.value) return row.value;
      await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('session_key', ?)")
        .bind(randomHex(32))
        .run();
      const saved = await env.DB.prepare("SELECT value FROM settings WHERE key = 'session_key'").first();
      return saved?.value ?? null;
    })().finally(() => {
      signingKeyPromise = null;
    });
  }
  signingKeyCache = await signingKeyPromise;
  return signingKeyCache;
}

async function sign(env, voter) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(await signingKey(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(voter));
  return hex(new Uint8Array(signature));
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

/** Returns the verified voter id, or null when absent/tampered. */
async function readVoter(request, env) {
  const raw = readCookie(request, COOKIE);
  if (!raw) return null;
  const [voter, signature] = raw.split(".");
  if (!/^[a-f0-9]{32}$/.test(voter ?? "") || !signature) return null;
  return sameSecret(signature, await sign(env, voter)) ? voter : null;
}

async function voterFor(request, env) {
  const existing = await readVoter(request, env);
  if (existing) return { voter: existing, issued: null };
  const voter = randomHex(16);
  return { voter, issued: `${voter}.${await sign(env, voter)}` };
}

function cookieHeader(value, secure, maxAge = COOKIE_MAX_AGE) {
  return [
    `${COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Origin gate for every state-changing or realtime-authorising request.
 * A browser request is accepted when it comes from this site itself (the
 * request URL's origin, which also covers preview and custom domains) or from
 * the platform-configured application origin. Local development additionally
 * accepts loopback origins so the Vite dev server can talk to the Worker.
 */
function checkOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  if (origin === new URL(request.url).origin) return origin;
  if (env.APP_ORIGIN && origin === env.APP_ORIGIN) return origin;
  if (env.ENVIRONMENT === "production") return null;
  return LOOPBACK.test(origin) ? origin : null;
}

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function snapshot(env, now) {
  const rows = await env.DB.prepare(
    `SELECT c.church_id, c.starts_at, c.ends_at, c.revision,
            (SELECT COUNT(*) FROM checkin_reports r
              WHERE r.church_id = c.church_id AND r.expires_at > ?) AS reporters
       FROM checkins c
      WHERE c.ends_at > ?
      ORDER BY c.updated_at DESC
      LIMIT ?`,
  )
    .bind(now, now, MAX_SNAPSHOT)
    .all();
  const checkins = (rows.results ?? []).map((row) => ({
    churchId: row.church_id,
    startsAt: Number(row.starts_at),
    endsAt: Number(row.ends_at),
    revision: Number(row.revision),
    reporters: Number(row.reporters ?? 0),
  }));
  return { now, checkins };
}

async function report(request, env) {
  const body = await readBody(request);
  const churchId = body?.churchId;
  if (typeof churchId !== "string" || !CHURCH_ID.test(churchId)) return fail("invalid_church");

  const now = Date.now();
  const ttlMs = ttlSeconds(env) * 1000;
  const expiresAt = now + ttlMs;
  const { voter, issued } = await voterFor(request, env);

  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const signalKey = `ip:${(await sha256(ip)).slice(0, 32)}:${Math.floor(now / 3_600_000)}`;
  const signal = await env.DB.prepare("SELECT count FROM checkin_signals WHERE key = ?")
    .bind(signalKey)
    .first();
  if (Number(signal?.count ?? 0) >= REPORTS_PER_HOUR) return fail("rate_limited", 429);

  const existing = await env.DB.prepare(
    "SELECT starts_at, ends_at, revision FROM checkins WHERE church_id = ?",
  )
    .bind(churchId)
    .first();
  const continuing = Boolean(existing) && Number(existing.ends_at) > now;
  const startsAt = continuing ? Number(existing.starts_at) : now;
  const endsAt = continuing ? Math.max(Number(existing.ends_at), expiresAt) : expiresAt;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO checkin_reports (church_id, voter, reported_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(church_id, voter)
       DO UPDATE SET reported_at = excluded.reported_at, expires_at = excluded.expires_at`,
    ).bind(churchId, voter, now, expiresAt),
    env.DB.prepare(
      `INSERT INTO checkins (church_id, starts_at, ends_at, revision, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(church_id)
       DO UPDATE SET
         starts_at = CASE WHEN checkins.ends_at <= excluded.updated_at
                          THEN excluded.starts_at ELSE checkins.starts_at END,
         ends_at = MAX(checkins.ends_at, excluded.ends_at),
         revision = excluded.revision,
         updated_at = excluded.updated_at`,
    ).bind(churchId, startsAt, endsAt, now, now),
    env.DB.prepare(
      `INSERT INTO checkin_signals (key, count, created_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = count + 1`,
    ).bind(signalKey, now),
    env.DB.prepare("DELETE FROM checkin_signals WHERE created_at < ?").bind(now - 2 * 3_600_000),
    env.DB.prepare("DELETE FROM checkins WHERE ends_at < ?").bind(now - 24 * 3_600_000),
    env.DB.prepare("DELETE FROM checkin_reports WHERE expires_at < ?").bind(now - 24 * 3_600_000),
  ]);

  const tally = await env.DB.prepare(
    "SELECT COUNT(*) AS reporters FROM checkin_reports WHERE church_id = ? AND expires_at > ?",
  )
    .bind(churchId, now)
    .first();

  const checkin = {
    churchId,
    startsAt,
    endsAt,
    revision: now,
    reporters: Math.max(1, Number(tally?.reporters ?? 1)),
  };

  // Durable write first, fan-out second: a realtime failure never loses a report.
  if (env.REALTIME) {
    try {
      await publishRealtime(env, { room: CHECKIN_ROOM, event: "checkin", data: checkin });
    } catch {
      /* clients recover from the next snapshot */
    }
  }

  const headers = issued ? { "Set-Cookie": cookieHeader(issued, new URL(request.url).protocol === "https:") } : {};
  return json({ checkin }, 200, headers);
}

async function ticket(request, env, origin) {
  if (!env.REALTIME) return fail("realtime_unavailable", 503);
  if (!(await readBody(request))) return fail("invalid_request");

  const { voter, issued } = await voterFor(request, env);

  const minted = await createRealtimeTicket(env, {
    room: CHECKIN_ROOM,
    userId: voter,
    origin,
    publish: false,
    presence: false,
  });

  const headers = issued ? { "Set-Cookie": cookieHeader(issued, new URL(request.url).protocol === "https:") } : {};
  return json(minted, 200, headers);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/health") {
      return json({ ok: true, now: Date.now(), realtime: Boolean(env.REALTIME), database: Boolean(env.DB) });
    }

    if (pathname.startsWith("/api/")) {
      if (!env.DB) return fail("database_unavailable", 503);
      try {
        await ensureSchema(env);
      } catch {
        return fail("database_unavailable", 503);
      }

      if (pathname === "/api/checkins" && request.method === "GET") {
        return json(await snapshot(env, Date.now()));
      }

      if (request.method !== "POST") return fail("method_not_allowed", 405);
      const origin = checkOrigin(request, env);
      if (!origin) return fail("origin_denied", 403);

      if (pathname === "/api/checkins") return report(request, env);
      if (pathname === "/api/realtime/ticket") return ticket(request, env, origin);
      return fail("not_found", 404);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
