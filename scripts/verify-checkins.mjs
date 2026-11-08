#!/usr/bin/env node
/**
 * End-to-end verification of community check-ins.
 *
 * Starts the real realtime helper and the real check-in Worker locally in
 * workerd (Wrangler + local D1), then proves with two independent websocket
 * clients that a report is durable, broadcast instantly, deduplicated per
 * person, refuses foreign origins, and expires.
 *
 *   npm run verify:checkins
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";

const ROOT = process.cwd();
const WRANGLER = path.join(ROOT, "node_modules", ".bin", "wrangler");
const STATE = path.join(ROOT, ".verify");
const HELPER_STATE = path.join(STATE, "realtime");
const WORKER_STATE = path.join(STATE, "worker");
const WORKER_URL = "http://127.0.0.1:8787";
const APP_ORIGIN = "http://localhost:3000";
const EVIL_ORIGIN = "https://evil.example";
const TTL_SECONDS = 6;

let failures = 0;
const procs = [];

function pass(name, detail = "") {
  console.log(`  ok    ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail = "") {
  failures += 1;
  console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function expect(name, condition, detail = "") {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

function run(label, args, env = {}) {
  const child = spawn(WRANGLER, args, {
    cwd: ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", ...env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const record = { label, child, log: [], exited: false };
  const collect = (chunk) => {
    record.log.push(String(chunk));
    if (record.log.length > 400) record.log.shift();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("exit", (code) => {
    record.exited = true;
    record.code = code;
  });
  procs.push(record);
  return record;
}

function stopAll() {
  for (const { child } of [...procs].reverse()) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

function dumpLogs() {
  for (const record of procs) {
    console.error(`\n--- ${record.label} (last output) ---`);
    console.error(record.log.join("").split("\n").slice(-25).join("\n"));
  }
}

async function waitForWorker(timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const dead = procs.find((record) => record.exited);
    if (dead) throw new Error(`${dead.label} exited with code ${dead.code}`);
    try {
      const response = await fetch(`${WORKER_URL}/api/health`);
      if (response.ok) return await response.json();
    } catch {
      /* not listening yet */
    }
    await sleep(500);
  }
  throw new Error("check-in Worker did not become ready");
}

async function postJson(pathname, body, { origin = APP_ORIGIN, cookie } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${WORKER_URL}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const setCookie = response.headers.getSetCookie?.()[0]?.split(";")[0] ?? null;
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload, cookie: setCookie };
}

async function openSocket() {
  const { status, payload } = await postJson("/api/realtime/ticket", {});
  if (status !== 200 || !payload?.websocketUrl) {
    throw new Error(`ticket request failed (${status}): ${JSON.stringify(payload)}`);
  }
  const messages = [];
  const socket = new WebSocket(payload.websocketUrl, { headers: { Origin: APP_ORIGIN } });
  socket.on("message", (data) => {
    try {
      messages.push({ at: Date.now(), message: JSON.parse(String(data)) });
    } catch {
      /* ignore */
    }
  });
  socket.on("error", () => {});
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
    setTimeout(() => reject(new Error("websocket open timed out")), 10_000);
  });
  const ready = await waitFor(messages, (entry) => entry.message.type === "ready", 10_000);
  if (!ready) throw new Error("socket never received a ready message");
  return { socket, messages };
}

async function waitFor(messages, predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const hit = messages.find((entry) => predicate(entry));
    if (hit) return hit;
    await sleep(15);
  }
  return null;
}

async function assertPortFree(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(800) });
  } catch {
    return;
  }
  throw new Error(`${url} is already running — stop the old dev servers first`);
}

async function main() {
  // Each Worker keeps its own local SQLite state; sharing one directory makes
  // workerd hit SQLITE_BUSY between the helper and the app.
  rmSync(STATE, { recursive: true, force: true });
  await assertPortFree(`${WORKER_URL}/api/health`);

  console.log("› starting realtime helper (8788) and check-in Worker (8787) in workerd");
  run(
    "realtime helper",
    ["dev", "--local", "-c", "freebuff-realtime/wrangler.jsonc", "--inspector-port", "9230", "--ip", "127.0.0.1", "--persist-to", HELPER_STATE],
  );
  run("check-in worker", [
    "dev",
    "--local",
    "-c",
    "worker/wrangler.jsonc",
    "--inspector-port",
    "9229",
    "--ip",
    "127.0.0.1",
    "--persist-to",
    WORKER_STATE,
    // A short window so expiry is observable in seconds, not the 90 min default.
    "--var",
    `CHECKIN_TTL_SECONDS:${TTL_SECONDS}`,
  ]);

  const health = await waitForWorker();
  expect("health endpoint answers", health.ok === true, JSON.stringify(health));
  expect("D1 binding is present", health.database === true);
  expect("realtime binding is present", health.realtime === true);

  console.log("› checking the Worker also serves the built PWA");
  const index = await fetch(`${WORKER_URL}/`);
  const html = await index.text();
  expect("assets served", index.status === 200 && html.includes("Church Radar"), `HTTP ${index.status}`);
  const deep = await fetch(`${WORKER_URL}/some/deep/route`);
  expect(
    "SPA deep link falls back to the shell",
    deep.status === 200 && (await deep.text()).includes('<div id="root">'),
    `HTTP ${deep.status}`,
  );

  console.log("› connecting two independent radar clients");
  const clientA = await openSocket();
  const clientB = await openSocket();
  pass("both clients authorised through the ticket route");

  const random = 100_000 + Math.floor(Math.random() * 900_000_000);
  const churchId = `osm:node/${random}`;

  console.log("› client A marks a church as meeting now");
  const firstStarted = Date.now();
  const first = await postJson("/api/checkins", { churchId });
  expect("report accepted", first.status === 200 && first.payload?.checkin?.churchId === churchId, `HTTP ${first.status}`);
  expect("report is attributed to one person", first.payload?.checkin?.reporters === 1);
  expect("server issued an opaque visitor cookie", Boolean(first.cookie?.startsWith("cr_voter=")));

  const broadcast = await waitFor(
    clientB.messages,
    (entry) => entry.message.type === "broadcast" && entry.message.event === "checkin" && entry.message.data?.churchId === churchId,
    4000,
  );
  const latency = broadcast ? broadcast.at - firstStarted : -1;
  expect("every open radar receives the check-in instantly", Boolean(broadcast), `${latency} ms after the tap`);

  console.log("› client B confirms with a second person");
  const second = await postJson("/api/checkins", { churchId });
  expect("second person accepted", second.status === 200);
  expect("reporter count grows", second.payload?.checkin?.reporters === 2, `reporters=${second.payload?.checkin?.reporters}`);
  const secondBroadcast = await waitFor(
    clientA.messages,
    (entry) => entry.message.type === "broadcast" && entry.message.event === "checkin" && entry.message.data?.reporters === 2,
    4000,
  );
  expect("the first client also sees the confirmation", Boolean(secondBroadcast));

  console.log("› client A confirms again (same person)");
  const third = await postJson("/api/checkins", { churchId }, { cookie: first.cookie });
  expect("repeat report does not inflate the count", third.payload?.checkin?.reporters === 2, `reporters=${third.payload?.checkin?.reporters}`);
  expect("repeat report extends the window", third.payload?.checkin?.endsAt > first.payload?.checkin?.endsAt);

  const snapshot = await (await fetch(`${WORKER_URL}/api/checkins`)).json();
  const stored = snapshot.checkins?.find((entry) => entry.churchId === churchId);
  expect("snapshot on a fresh radar includes the check-in", Boolean(stored));
  expect("snapshot carries the reporter count", stored?.reporters === 2, `reporters=${stored?.reporters}`);

  console.log("› abuse and validation guards");
  const foreign = await postJson("/api/checkins", { churchId }, { origin: EVIL_ORIGIN });
  expect("foreign origin cannot post", foreign.status === 403, `HTTP ${foreign.status} ${foreign.payload?.error ?? ""}`);
  const foreignTicket = await postJson("/api/realtime/ticket", {}, { origin: EVIL_ORIGIN });
  expect("foreign origin cannot mint a realtime ticket", foreignTicket.status === 403, `HTTP ${foreignTicket.status}`);
  const invalid = await postJson("/api/checkins", { churchId: "not-a-church" });
  expect("invalid church id is rejected", invalid.status === 400, `HTTP ${invalid.status} ${invalid.payload?.error ?? ""}`);
  const forged = await postJson("/api/checkins", { churchId }, { cookie: "cr_voter=deadbeefdeadbeefdeadbeefdeadbeef.deadbeef" });
  expect(
    "a tampered visitor cookie is treated as a new visitor",
    forged.payload?.checkin?.reporters === 3,
    `reporters=${forged.payload?.checkin?.reporters}`,
  );

  console.log(`› waiting ${TTL_SECONDS + 3}s for the check-in to expire`);
  await sleep((TTL_SECONDS + 3) * 1000);
  const after = await (await fetch(`${WORKER_URL}/api/checkins`)).json();
  expect(
    "expired check-ins disappear from every radar",
    !after.checkins?.some((entry) => entry.churchId === churchId),
  );

  clientA.socket.close();
  clientB.socket.close();
}

main()
  .catch((error) => {
    fail("verification run", error instanceof Error ? error.message : String(error));
    dumpLogs();
  })
  .finally(() => {
    stopAll();
    console.log("");
    if (failures > 0) {
      console.error(`${failures} check(s) failed`);
      process.exit(1);
    }
    console.log("all check-in checks passed");
    process.exit(0);
  });
