#!/usr/bin/env node
/**
 * Store listing screenshots (720 × 1500), captured from the deployed app.
 *
 *   node scripts/make_store_screenshots.mjs
 *   BASE_URL=http://127.0.0.1:3000 node scripts/make_store_screenshots.mjs
 *
 * Writes `fastlane/metadata/android/en-US/images/phoneScreenshots/`, which is the
 * layout Orion Store and F-Droid read (and Play would read, if it ever shipped
 * there). No data is written: the script only pans, zooms and opens a sheet, so
 * it never posts a check-in.
 */
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const ROOT = process.cwd();
const APP = (process.env.BASE_URL || "https://site-7d0666e0b7dd4270bb605ef825d84164.freebuff.page").replace(/\/$/, "");
const OUT = path.join(ROOT, "fastlane", "metadata", "android", "en-US", "images", "phoneScreenshots");

async function moveTo(page, center, zoom) {
  await page.evaluate(
    ({ center, zoom }) => window.__radarMap.jumpTo({ center, zoom, animate: false }),
    { center, zoom },
  );
  await sleep(900);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name) });
  const file = path.join(OUT, name);
  if (!existsSync(file)) throw new Error(`screenshot ${name} was not written`);
  console.log(`  wrote ${path.relative(ROOT, file)}`);
}

/** Tap the dot nearest the map centre and return the opened sheet. */
async function openNearestSheet(page) {
  const target = await page.evaluate(() => {
    const map = window.__radarMap;
    const centre = map.project(map.getCenter());
    const [feature] = map.queryRenderedFeatures(
      [
        [centre.x - 60, centre.y - 60],
        [centre.x + 60, centre.y + 60],
      ],
      { layers: ["church-dot"] },
    );
    if (!feature) return null;
    const projected = map.project(feature.geometry.coordinates);
    const rect = map.getCanvas().getBoundingClientRect();
    return {
      name: feature.properties.name,
      state: feature.properties.state,
      clientX: rect.left + projected.x,
      clientY: rect.top + projected.y,
    };
  });
  if (!target) throw new Error("no dot near the map centre");
  await page.mouse.click(target.clientX, target.clientY);
  await page.waitForSelector(".sheet", { timeout: 10_000 });
  await sleep(500);
  return target;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
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

  const context = await browser.newContext({
    viewport: { width: 720, height: 1500 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: "en-US",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  console.log(`› capturing from ${APP}`);
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".dock", { timeout: 45_000 });
  await page.waitForFunction(
    () => Boolean(window.__radarMap) && window.__radarMap.querySourceFeatures("churches").length > 0,
    null,
    { timeout: 45_000 },
  );
  await sleep(1200);

  await moveTo(page, [20, 34], 2.4);
  await shot(page, "01-world-radar.png");

  // A church that is meeting right now, so the sheet shows the live state.
  // Look across the whole globe view first: at country zoom only a slice of the
  // world is loaded, and the live churches cluster around local service times.
  const live = await page.evaluate(() => {
    const feature = window.__radarMap
      .querySourceFeatures("churches")
      .find((item) => item.properties.state === "live" && item.properties.name);
    return feature
      ? { coordinates: feature.geometry.coordinates, name: feature.properties.name }
      : null;
  });
  if (live) {
    // Stay below SCAN_MIN_ZOOM (11): a deeper zoom would fire a live Overpass scan.
    await moveTo(page, live.coordinates, 9.6);
    const opened = await openNearestSheet(page);
    console.log(`  sheet: ${opened.name} (${opened.state})`);
    await shot(page, "02-church-sheet.png");
    await page.locator(".sheet-close").click();
    await page.waitForSelector(".sheet", { state: "detached", timeout: 10_000 });
    await sleep(500);
  } else {
    console.log("  no live church in the world view — skipping the sheet screenshot");
  }

  await moveTo(page, [12, 48.5], 4.3);
  await shot(page, "03-europe.png");

  await moveTo(page, [19.4, 47.2], 6.4);
  await shot(page, "04-country.png");
  await moveTo(page, [19.4, 47.2], 6.4);
  const denominationTab = page.locator(".dock button", { hasText: /denomination/i }).first();
  if (await denominationTab.count()) {
    await denominationTab.click();
    await sleep(800);
    await shot(page, "05-denominations.png");
  }

  const realErrors = errors.filter((message) => !message.includes("does not exist in the map's style"));
  console.log(realErrors.length ? `renderer errors: ${realErrors.join(" | ")}` : "  no renderer errors");
  await browser.close();
  if (realErrors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
