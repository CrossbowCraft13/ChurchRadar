export type Family =
  | "catholic"
  | "orthodox"
  | "anglican"
  | "protestant"
  | "baptist"
  | "evangelical"
  | "adventist"
  | "restorationist"
  | "other";

export interface FamilyMeta {
  label: string;
  short: string;
  color: string;
}

/** Radar-friendly palette: bright, cool, distinguishable on a near-black globe. */
export const FAMILY_META: Record<Family, FamilyMeta> = {
  catholic: { label: "Catholic", short: "Cath", color: "#ffb347" },
  orthodox: { label: "Orthodox", short: "Orth", color: "#b57bff" },
  anglican: { label: "Anglican", short: "Angl", color: "#3cd6a4" },
  protestant: { label: "Protestant", short: "Prot", color: "#4f9dff" },
  baptist: { label: "Baptist", short: "Bapt", color: "#29c2d8" },
  evangelical: { label: "Evangelical / Pentecostal", short: "Evang", color: "#ff79b0" },
  adventist: { label: "Adventist", short: "Adv", color: "#8f86ff" },
  restorationist: { label: "Restorationist", short: "Rest", color: "#a9b6c8" },
  other: { label: "Other / unspecified", short: "Other", color: "#7d8ba3" },
};

export const FAMILY_ORDER: Family[] = [
  "catholic",
  "orthodox",
  "anglican",
  "protestant",
  "baptist",
  "evangelical",
  "adventist",
  "restorationist",
  "other",
];

function has(haystack: string, ...needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Map a raw OSM `denomination` value or a Wikidata denomination label onto a
 * small, filterable family. Order matters: "Evangelical Lutheran" is Lutheran.
 */
export function familyOf(raw?: string | null): Family {
  if (!raw) return "other";
  const value = raw.toLowerCase().replace(/[_‑-]/g, " ");

  if (has(value, "catholic", "maronite", "melkite", "uniate")) return "catholic";
  if (
    has(
      value,
      "orthodox",
      "oriental",
      "coptic",
      "armenian apostolic",
      "syriac",
      "assyrian",
      "nestorian",
      "tawahedo",
      "tewahedo",
    )
  ) {
    return "orthodox";
  }
  if (has(value, "adventist")) return "adventist";
  if (
    has(
      value,
      "jehovah",
      "latter day",
      "latter-day",
      "mormon",
      "christadelphian",
      "christian science",
      "religious science",
    )
  ) {
    return "restorationist";
  }
  if (has(value, "anglican", "episcopal", "church of england", "church of ireland")) {
    return "anglican";
  }
  if (has(value, "baptist")) return "baptist";
  if (
    has(
      value,
      "lutheran",
      "reformed",
      "presbyterian",
      "calvinist",
      "methodist",
      "wesleyan",
      "united church",
      "united reformed",
      "congregational",
      "mennonite",
      "quaker",
      "friends",
      "moravian",
      "hussite",
      "waldensian",
      "church of scotland",
      "old catholic",
      "protestant",
    )
  ) {
    return "protestant";
  }
  if (
    has(
      value,
      "pentecostal",
      "charismatic",
      "evangelical",
      "gospel",
      "apostolic",
      "salvation army",
      "assemblies of god",
      "free church",
      "brethren",
      "vineyard",
      "nondenominational",
      "non denominational",
      "independent",
      "community church",
      "bible church",
    )
  ) {
    return "evangelical";
  }
  return "other";
}
