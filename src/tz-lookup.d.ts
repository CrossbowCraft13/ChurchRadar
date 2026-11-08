declare module "tz-lookup" {
  /** Returns the IANA time zone id for a coordinate, e.g. "Europe/Paris". */
  export default function tzLookup(lat: number, lon: number): string;
}
