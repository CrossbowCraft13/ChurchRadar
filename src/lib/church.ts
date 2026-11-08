import { familyOf, type Family } from "./denomination";
import { estimateServiceTimes, parseServiceTimes, type ServiceWindow } from "./schedule";

export type ChurchSource = "osm" | "wikidata";
export type ScheduleSource = "published" | "estimated";

export interface Church {
  id: string;
  name: string;
  lat: number;
  lon: number;
  family: Family;
  /** raw denomination string, when known */
  denomination?: string;
  /** raw OSM service_times value, when known */
  serviceTimes?: string;
  /** weekly slots in the church's local time */
  windows: ServiceWindow[];
  schedule: ScheduleSource;
  website?: string;
  osmUrl?: string;
  wikidataUrl?: string;
  city?: string;
  source: ChurchSource;
}

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function pick(tags: Record<string, string>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = tags[key];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

/** Turn a raw Overpass element into a Church, or null when it has no position. */
export function churchFromOsm(element: OsmElement): Church | null {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const tags = element.tags ?? {};
  const denomination = pick(tags, "denomination");
  const family = familyOf(denomination ?? tags.religion);
  const published = parseServiceTimes(tags.service_times);

  return {
    id: `osm:${element.type}/${element.id}`,
    name: pick(tags, "name", "name:en", "official_name", "alt_name") ?? "Unnamed church",
    lat,
    lon,
    family,
    denomination,
    serviceTimes: published.length > 0 ? pick(tags, "service_times") : undefined,
    windows: published.length > 0 ? published : estimateServiceTimes(family),
    schedule: published.length > 0 ? "published" : "estimated",
    website: pick(tags, "website", "contact:website", "url"),
    osmUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    city: pick(tags, "addr:city", "addr:place"),
    source: "osm",
  };
}

export interface SeedRecord {
  id: string;
  lat: number;
  lon: number;
  n?: string | null;
  d?: string | null;
}

/** Turn one bundled world-overview record (Wikidata) into a Church. */
export function churchFromSeed(record: SeedRecord): Church {
  const family = familyOf(record.d);
  return {
    id: `wd:${record.id}`,
    name: record.n || "Unnamed church",
    lat: record.lat,
    lon: record.lon,
    family,
    denomination: record.d ?? undefined,
    windows: estimateServiceTimes(family),
    schedule: "estimated",
    wikidataUrl: `https://www.wikidata.org/wiki/${record.id}`,
    source: "wikidata",
  };
}
