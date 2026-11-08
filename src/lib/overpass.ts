import { cacheGet, cacheSet } from "./cache";
import { churchFromOsm, type Church, type OsmElement } from "./church";
import { boundsKey, boundsArea, type Bounds } from "./geo";

/** Below this zoom the live Overpass scan is too heavy; the world overview is used instead. */
export const SCAN_MIN_ZOOM = 11;
/** Refuse to scan absurdly large viewports even at the minimum zoom. */
export const MAX_SCAN_AREA = 0.8;
export const RESULT_LIMIT = 1500;
const REQUEST_TIMEOUT_MS = 24_000;

/** Public, CORS-enabled Overpass mirrors. Tried in order. */
const ENDPOINTS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

let preferredEndpoint = 0;

export interface ScanResult {
  churches: Church[];
  endpoint: string;
  fetchedAt: number;
  fromCache: boolean;
  stale: boolean;
  truncated: boolean;
}

export interface ScanOptions {
  signal?: AbortSignal;
  /** return a cached scan younger than this without hitting the network */
  maxAgeMs?: number;
  /** skip the cache entirely */
  force?: boolean;
}

export function buildQuery(bounds: Bounds): string {
  const bbox = [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((value) => value.toFixed(5))
    .join(",");
  const selector = '["amenity"="place_of_worship"]["religion"="christian"]';
  return [
    "[out:json][timeout:25];",
    "(",
    `node${selector}(${bbox});`,
    `way${selector}(${bbox});`,
    `relation${selector}(${bbox});`,
    ");",
    `out center tags ${RESULT_LIMIT};`,
  ].join("");
}

function cacheKey(bounds: Bounds): string {
  return `osm:v1|${boundsKey(bounds)}`;
}

function orderedEndpoints(): string[] {
  return ENDPOINTS.map((_, index) => ENDPOINTS[(preferredEndpoint + index) % ENDPOINTS.length]);
}

async function requestEndpoint(
  endpoint: string,
  bounds: Bounds,
  signal?: AbortSignal,
): Promise<OsmElement[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const relayAbort = () => controller.abort();
  signal?.addEventListener("abort", relayAbort);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: buildQuery(bounds) }).toString(),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${endpoint} responded ${response.status}`);
    }
    const payload = (await response.json()) as { elements?: OsmElement[] };
    return payload.elements ?? [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relayAbort);
  }
}

/**
 * Fetch every Christian place of worship inside a viewport.
 * Falls back across mirrors and stale cache so a flaky mirror never blanks the radar.
 */
export async function scanBounds(bounds: Bounds, options: ScanOptions = {}): Promise<ScanResult> {
  if (boundsArea(bounds) > MAX_SCAN_AREA) {
    throw new Error("Viewport too large to scan — zoom in");
  }

  const key = cacheKey(bounds);
  const maxAgeMs = options.maxAgeMs ?? 10 * 60_000;
  const cached = await cacheGet<Church[]>(key);
  if (!options.force && cached && Date.now() - cached.storedAt < maxAgeMs) {
    return {
      churches: cached.value,
      endpoint: "cache",
      fetchedAt: cached.storedAt,
      fromCache: true,
      stale: false,
      truncated: false,
    };
  }

  const errors: string[] = [];
  for (const endpoint of orderedEndpoints()) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const elements = await requestEndpoint(endpoint, bounds, options.signal);
      const churches: Church[] = [];
      for (const element of elements) {
        const church = churchFromOsm(element);
        if (church) churches.push(church);
      }
      preferredEndpoint = Math.max(0, ENDPOINTS.indexOf(endpoint));
      void cacheSet(key, churches);
      return {
        churches,
        endpoint,
        fetchedAt: Date.now(),
        fromCache: false,
        stale: false,
        truncated: elements.length >= RESULT_LIMIT,
      };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (cached) {
    return {
      churches: cached.value,
      endpoint: "cache",
      fetchedAt: cached.storedAt,
      fromCache: true,
      stale: true,
      truncated: false,
    };
  }

  throw new Error(errors[0] ?? "Church data unavailable");
}
