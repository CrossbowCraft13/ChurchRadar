import { churchFromSeed, type Church, type SeedRecord } from "./church";

interface SeedFile {
  source: string;
  generated: string;
  gridDegrees: number;
  total: number;
  churches: SeedRecord[];
}

let memory: Church[] | null = null;

/**
 * Bundled worldwide overview: every church building Wikidata knows about,
 * thinned to one per ~11 km cell (57k entries). It is used whenever the map is
 * too far out for a live OpenStreetMap scan, and as the fallback when a scan
 * fails. The JSON is cached by the service worker, so the globe is never empty —
 * even offline.
 */
export async function loadWorldChurches(): Promise<Church[]> {
  if (memory) return memory;

  const response = await fetch(`${import.meta.env.BASE_URL}data/world-churches.json`);
  if (!response.ok) throw new Error(`World overview unavailable (${response.status})`);
  const file = (await response.json()) as SeedFile;
  memory = file.churches.map(churchFromSeed);
  return memory;
}
