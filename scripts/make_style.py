#!/usr/bin/env python3
"""Build the basemap style used by the app.

Starts from the free OpenFreeMap "dark" style (no API key, no account) and
re-tints it into the app's deep-navy radar palette. Run with:

    python3 scripts/make_style.py

Output: public/style.json
"""
import json
import pathlib
import urllib.request

SOURCE = "https://tiles.openfreemap.org/styles/dark"
OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "style.json"

PALETTE = {
    "background": {"background-color": "#04070d"},
    "water": {"fill-color": "#071120"},
    "landcover_ice_shelf": {"fill-color": "#0a1420"},
    "landcover_glacier": {"fill-color": "#0a1420"},
    "landuse_residential": {"fill-color": "#070e18"},
    "landcover_wood": {"fill-color": "#08151b"},
    "landuse_park": {"fill-color": "#08151b"},
    "waterway": {"line-color": "#0d1a2c"},
    "building": {"fill-color": "#0a1220", "fill-outline-color": "#0e1c2e"},
    "road_area_pier": {"fill-color": "#070e18"},
    "road_pier": {"line-color": "#0b1524"},
    "aeroway-area": {"fill-color": "#060c15"},
    "aeroway-taxiway": {"line-color": "#101c2c"},
    "aeroway-runway": {"line-color": "#12202f"},
    "aeroway-runway-casing": {"line-color": "#16283c"},
    "highway_path": {"line-color": "#0d1a29"},
    "highway_minor": {"line-color": "#0f1c2c"},
    "highway_major_casing": {"line-color": "#16283c"},
    "highway_major_inner": {"line-color": "#12202f"},
    "highway_major_subtle": {"line-color": "#14243a"},
    "highway_motorway_casing": {"line-color": "#1a3147"},
    "highway_motorway_subtle": {"line-color": "#101f30"},
    "railway_transit": {"line-color": "#12202f"},
    "railway_transit_dashline": {"line-color": "#0a1420"},
    "railway_minor": {"line-color": "#12202f"},
    "railway_minor_dashline": {"line-color": "#0a1420"},
    "railway": {"line-color": "#14243a"},
    "railway_dashline": {"line-color": "#0a1420"},
    "boundary_state": {"line-color": "#16283c"},
    "boundary_country_z0-4": {"line-color": "#1c3450"},
    "boundary_country_z5-": {"line-color": "#1c3450"},
}

LABEL_COLORS = {
    "text-color": "#6f8aa8",
    "text-halo-color": "#04070d",
}


def main() -> None:
    request = urllib.request.Request(
        SOURCE, headers={"User-Agent": "church-radar-style/0.1 (open source build script)"}
    )
    with urllib.request.urlopen(request, timeout=60) as resp:
        style = json.load(resp)

    for layer in style["layers"]:
        lid = layer["id"]
        paint = layer.get("paint") or {}
        if lid in PALETTE:
            paint.update(PALETTE[lid])
            layer["paint"] = paint
        if layer["type"] == "symbol":
            paint = layer.get("paint") or {}
            for key, value in LABEL_COLORS.items():
                if key in paint:
                    paint[key] = value
            if lid == "place_city_large":
                paint["text-color"] = "#a8c6e2"
            if lid == "place_country_major":
                paint["text-color"] = "#9dbcd8"
            if lid == "water_name":
                paint["text-color"] = "#33506e"
            layer["paint"] = paint

    # Radar console: no pitch limits needed, and keep the globe background dark.
    style.setdefault("metadata", {})["church-radar"] = "re-tinted OpenFreeMap dark"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(style, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KiB)")


if __name__ == "__main__":
    main()
