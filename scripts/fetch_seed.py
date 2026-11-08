#!/usr/bin/env python3
"""Refresh the bundled worldwide church dataset.

Wikidata has coordinates for ~270k church buildings, cathedrals and basilicas
(CC0). That is far too many to ship as-is, so this script keeps one church per
grid cell — preferring entries that have a name and a denomination — which gives
a dense, even layer at every zoom level while staying a few megabytes.

    python3 scripts/fetch_seed.py

Output: public/data/world-churches.json
"""
import json
import pathlib
import re
import urllib.parse
import urllib.request

ENDPOINT = "https://qlever.dev/api/wikidata"
# Church building, cathedral, basilica. Chapels and other subclasses are left to
# the live OpenStreetMap scan, which has them in full detail.
CLASSES = "wd:Q16970 wd:Q2977 wd:Q163687"
QUERY = f"""
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?item ?name ?coord ?denomLabel WHERE {{
  VALUES ?class {{ {CLASSES} }}
  ?item wdt:P31 ?class ; wdt:P625 ?coord .
  OPTIONAL {{ ?item rdfs:label ?name FILTER(lang(?name)="en") }}
  OPTIONAL {{ ?item wdt:P140 ?denom . ?denom rdfs:label ?denomLabel FILTER(lang(?denomLabel)="en") }}
}}
"""

# One church per 0.1° cell (~11 km) keeps the global layer dense without shipping
# every single building. 0.05° doubles the file, 0.2° visibly thins it out.
GRID = 0.1
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "world-churches.json"
COORD = re.compile(r"point\(\s*([-\d.]+)\s+([-\d.]+)\s*\)", re.I)


def fetch() -> list[dict]:
    body = urllib.parse.urlencode({"query": QUERY}).encode()
    request = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            "Accept": "application/sparql-results+json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "ChurchRadar/1.0 (personal map project)",
        },
    )
    print(f"querying {ENDPOINT} …")
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.load(response)["results"]["bindings"]


def clean(value: str | None, limit: int = 120) -> str | None:
    if not value:
        return None
    text = " ".join(value.split())
    return text[:limit] or None


def collect(rows: list[dict]) -> dict[str, dict]:
    """Fold the SPARQL rows (one per label/denomination) into one record per item."""
    items: dict[str, dict] = {}
    for row in rows:
        qid = row["item"]["value"].rsplit("/", 1)[-1]
        match = COORD.match(row["coord"]["value"])
        if not match:
            continue
        lon, lat = float(match.group(1)), float(match.group(2))
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            continue
        record = items.setdefault(
            qid,
            {"id": qid, "lat": round(lat, 4), "lon": round(lon, 4), "n": None, "d": None},
        )
        if record["n"] is None:
            record["n"] = clean(row.get("name", {}).get("value"))
        if record["d"] is None:
            record["d"] = clean(row.get("denomLabel", {}).get("value"))
    return items


def score(record: dict) -> tuple[int, int]:
    """Prefer named churches that also name their tradition."""
    return (2 if record["n"] else 0) + (1 if record["d"] else 0), -int(record["id"][1:] or 0)


def downsample(items: dict[str, dict]) -> list[dict]:
    cells: dict[tuple[int, int], dict] = {}
    for record in items.values():
        key = (int(record["lat"] // GRID), int(record["lon"] // GRID))
        current = cells.get(key)
        if current is None or score(record) > score(current):
            cells[key] = record
    return sorted(cells.values(), key=lambda record: record["id"])


def main() -> None:
    rows = fetch()
    items = collect(rows)
    churches = downsample(items)
    payload = {
        "source": "Wikidata (CC0) — church buildings, cathedrals and basilicas",
        "generated": __import__("datetime").date.today().isoformat(),
        "gridDegrees": GRID,
        "total": len(items),
        "churches": [
            {key: value for key, value in record.items() if value is not None}
            for record in churches
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    size = OUT.stat().st_size / 1e6
    named = sum(1 for record in churches if record["n"])
    print(
        f"{len(items)} churches with coordinates → {len(churches)} bundled "
        f"({named} named, {size:.1f} MB) → {OUT.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()
