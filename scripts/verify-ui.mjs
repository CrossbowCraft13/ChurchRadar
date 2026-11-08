#!/usr/bin/env node
/**
 * Two-browser UI verification for community check-ins.
 *
 * Runs the real Worker + realtime helper + the Vite dev app (which proxies /api
 * to the Worker), then opens two independent browser profiles. One marks a
 * church as meeting; the other must show the live dot and confirmation without
 * a reload, and confirming from the second browser must update the first.
 *
 *   npm run verify:ui
 *   BASE_URL=https://site-....freebuff.page node scripts/verify-ui.mjs   # hosted
 *
 * With BASE_URL the script skips the local servers and tests that origin's
 * Worker, D1 database and managed realtime hub instead. SHOT_PREFIX renames the
 * screenshots (default: checkin).
 */
import { spawn } from "node:child_process";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const ROOT = process.cwd();
const WRANGLER = path.join(ROOT, "node_modules", ".bin", "wrangler");
const VITE = path.join(ROOT, "node_modules", ".bin", "vite");
const STATE = path.join(ROOT, ".verify");
const HELPER_STATE = path.join(STATE, "realtime");
const WORKER_STATE = path.join(STATE, "worker");
const WORKER_URL = "http://127.0.0.1:8787";
const HOSTED = process.env.BASE_URL?.replace(/\/$/, "") || "";
const APP = HOSTED || "http://127.0.0.1:3000";
const SHOT_PREFIX = process.env.SHOT_PREFIX || "checkin";
const SHOTS = path.join(ROOT, "artifacts");

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

function run(label, command, args) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" },
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

async function waitFor(url, { timeoutMs = 180_000, label = url } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const dead = procs.find((record) => record.exited);
    if (dead) throw new Error(`${dead.label} exited with code ${dead.code}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not listening yet */
    }
    await sleep(400);
  }
  throw new Error(`${label} did not become ready`);
}

const seed = JSON.parse(readFileSync(path.join(ROOT, "public/data/world-churches.json"), "utf8"));
const church = seed.churches.find(
  (entry) =>
    typeof entry.n === "string" &&
    entry.n.length > 3 &&
    entry.lat > 35 &&
    entry.lat < 60 &&
    entry.lon > -10 &&
    entry.lon < 30,
);
if (!church) throw new Error("no seed church available for the UI test");
const churchName = church.n;
const churchId = `wd:${church.id}`;

async function openRadar(browser, label) {
  const context = await browser.newContext({ viewport: { width: 900, height: 760 }, locale: "en-US" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".dock", { timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const map = window.__radarMap;
      return Boolean(map) && map.querySourceFeatures("churches").length > 0;
    },
    null,
    { timeout: 30_000 },
  );
  await page.evaluate(
    ({ lon, lat }) => window.__radarMap.jumpTo({ center: [lon, lat], zoom: 6, animate: false }),
    { lon: church.lon, lat: church.lat },
  );
  await sleep(600);
  return { context, page, errors, label };
}

async function text(locator) {
  // textContent, not innerText: some headless shells report innerText as "".
  return ((await locator.textContent()) ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Centre the radar on the seed church and pick the nearest dot that the
 * collision-thinned layer actually placed — at country zoom it need not be the
 * seed record itself.
 */
async function openSheet(client) {
  const point = await client.page.evaluate(
    ({ lon, lat }) => {
      const map = window.__radarMap;
      map.jumpTo({ center: [lon, lat], zoom: 6, animate: false });
      const projected = map.project([lon, lat]);
      return { x: projected.x, y: projected.y };
    },
    { lon: church.lon, lat: church.lat },
  );
  await sleep(700);
  const target = await client.page.evaluate(
    ({ x, y }) => {
      const map = window.__radarMap;
      const [feature] = map.queryRenderedFeatures(
        [
          [x - 40, y - 40],
          [x + 40, y + 40],
        ],
        { layers: ["church-dot"] },
      );
      if (!feature) return null;
      const projected = map.project(feature.geometry.coordinates);
      const rect = map.getCanvas().getBoundingClientRect();
      return {
        id: feature.properties.id,
        name: feature.properties.name,
        clientX: rect.left + projected.x,
        clientY: rect.top + projected.y,
      };
    },
    point,
  );
  if (!target) throw new Error("no church dot near the target church");
  await client.page.mouse.click(target.clientX, target.clientY);
  await client.page.waitForSelector(".sheet", { timeout: 10_000 });
  return { sheet: client.page.locator(".sheet"), target };
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
  mkdirSync(SHOTS, { recursive: true });

  if (HOSTED) {
    console.log(`› testing the hosted app at ${HOSTED}`);
    const health = await fetch(`${APP}/api/health`).then((response) => response.json());
    expect("hosted Worker reports its bindings", health.realtime === true && health.database === true, JSON.stringify(health));
    if (!health.realtime || !health.database) throw new Error("hosted Worker is missing a binding");
    await runBrowsers();
    return;
  }

  // Separate local SQLite state per Worker avoids SQLITE_BUSY between them.
  rmSync(STATE, { recursive: true, force: true });
  await assertPortFree(`${WORKER_URL}/api/health`);
  await assertPortFree(APP);

  console.log("› starting realtime helper, check-in Worker and the dev app");
  run("realtime helper", WRANGLER, [
    "dev",
    "--local",
    "-c",
    "freebuff-realtime/wrangler.jsonc",
    "--inspector-port",
    "9230",
    "--ip",
    "127.0.0.1",
    "--persist-to",
    HELPER_STATE,
  ]);
  run("check-in worker", WRANGLER, [
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
  ]);
  run("vite", VITE, ["--host", "127.0.0.1", "--port", "3000", "--strictPort"]);

  await waitFor(`${WORKER_URL}/api/health`);
  await waitFor(APP);
  pass("dev app, Worker and realtime hub are up");

  await runBrowsers();
}

async function runBrowsers() {
  // Use Playwright's bundled Chromium by default; CHROME_PATH (plus optional
  // CHROME_LIBS for a library prefix) points the harness at another build.
  const browser = await chromium.launch({
    args: [
      "--enable-unsafe-swiftshader",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--ignore-gpu-blocklist",
    ],
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    ...(process.env.CHROME_LIBS
      ? { env: { ...process.env, LD_LIBRARY_PATH: process.env.CHROME_LIBS } }
      : {}),
  });
  const first = await openRadar(browser, "A");
  const second = await openRadar(browser, "B");
  pass("two independent radars loaded the world overview");

  const seedPresent = await first.page.evaluate(
    (id) => window.__radarMap.querySourceFeatures("churches").some((feature) => feature.properties.id === id),
    churchId,
  );
  expect("target church is on both radars", seedPresent, churchName);

  console.log(`› radar A marks a church near “${churchName}” as meeting now`);
  const { sheet: sheetA, target } = await openSheet(first);
  const titleA = await text(sheetA.locator(".sheet-title h2"));
  expect("tapping the dot opens the church sheet", titleA === target.name, titleA);
  const buttonLabel = await text(sheetA.locator(".community-btn"));
  const button = sheetA.locator(".community-btn");
  expect("sheet offers the check-in action", buttonLabel.toUpperCase().includes("MEETING NOW"), buttonLabel);
  await button.click();
  await first.page.waitForFunction(
    () => document.querySelector(".status-pill")?.textContent?.includes("1 person reporting"),
    null,
    { timeout: 10_000 },
  );
  pass("radar A shows its own check-in immediately");
  await first.page.screenshot({ path: path.join(SHOTS, `${SHOT_PREFIX}-radar-a.png`) });

  console.log("› radar B must update without a reload");
  const started = Date.now();
  await second.page.waitForFunction(
    (id) =>
      window.__radarMap
        .querySourceFeatures("churches")
        .some((feature) => feature.properties.id === id && feature.properties.community === "yes"),
    target.id,
    { timeout: 5_000 },
  );
  pass("radar B's dot turned into a community check-in", `${Date.now() - started} ms`);

  const { sheet: sheetB } = await openSheet(second);
  await second.page.waitForFunction(
    () => document.querySelector(".community")?.textContent?.includes("community says it is meeting"),
    null,
    { timeout: 5_000 },
  );
  const pillB = await text(sheetB.locator(".status-pill"));
  expect("radar B's sheet names the community report", pillB.includes("1 person reporting"), pillB);
  await second.page.screenshot({ path: path.join(SHOTS, `${SHOT_PREFIX}-radar-b.png`) });

  console.log("› a second person confirms from radar B");
  await sheetB.locator(".community-btn").click();
  await first.page.waitForFunction(
    () => document.querySelector(".status-pill")?.textContent?.includes("2 people reporting"),
    null,
    { timeout: 6_000 },
  );
  pass("radar A updates to two reporters without a reload");

  const hudCount = await text(first.page.locator(".stat-live"));
  expect("meeting-now counter includes the community check-in", Number(hudCount.replace(/[^\d]/g, "")) >= 1, `HUD=${hudCount}`);

  // MapLibre throws this when a click/mousemove lands before the style's layers
  // exist; it is unrelated to check-ins, so ignore only that message.
  const rendererErrors = (client) =>
    client.errors.filter((message) => !message.includes("does not exist in the map's style"));
  expect("no renderer errors in radar A", rendererErrors(first).length === 0, rendererErrors(first).join(" | ").slice(0, 300));
  expect("no renderer errors in radar B", rendererErrors(second).length === 0, rendererErrors(second).join(" | ").slice(0, 300));

  await browser.close();
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
    console.log("all UI checks passed");
    process.exit(0);
  });
