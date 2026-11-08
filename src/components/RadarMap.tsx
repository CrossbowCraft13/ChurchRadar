import type { FeatureCollection, Point } from "geojson";
import maplibregl from "maplibre-gl";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { boundsKey, type Bounds } from "../lib/geo";

export interface RadarProps {
  id: string;
  name: string;
  family: string;
  state: "live" | "done" | "idle";
  color: string;
  schedule: "published" | "estimated";
  source: "osm" | "wikidata";
  /** "yes" when the live status comes from a community check-in */
  community: "yes" | "no";
  /**
   * 0-3, stable per church. Continental zooms draw only tier 0 so 57k dots read
   * as a stipple instead of a solid carpet; wide and close zooms draw them all.
   */
  tier: number;
  [key: string]: string | number;
}

export type RadarFeatures = FeatureCollection<Point, RadarProps>;

export interface Viewport {
  zoom: number;
  center: [number, number];
  bounds: Bounds;
  key: string;
}

export interface RadarMapHandle {
  flyTo: (lon: number, lat: number, zoom: number) => void;
}

interface Props {
  features: RadarFeatures;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onViewport: (viewport: Viewport) => void;
}

const EMPTY: RadarFeatures = { type: "FeatureCollection", features: [] };

const RADIUS: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  0,
  1.9,
  4,
  2.3,
  7,
  3.4,
  10,
  4.6,
  14,
  6.0,
];

const DOT_OPACITY: maplibregl.ExpressionSpecification = [
  "case",
  ["==", ["get", "state"], "live"],
  1,
  ["==", ["get", "state"], "done"],
  0.92,
  0.75,
];

const DOT_LAYER_IDS = ["church-dot", "church-dot-mid", "church-dot-far"];

function dotLayer(
  id: string,
  options: { minzoom?: number; maxzoom?: number; tier?: number },
): maplibregl.LayerSpecification {
  return {
    id,
    type: "circle",
    source: "churches",
    ...(options.minzoom === undefined ? {} : { minzoom: options.minzoom }),
    ...(options.maxzoom === undefined ? {} : { maxzoom: options.maxzoom }),
    ...(options.tier === undefined ? {} : { filter: ["==", ["get", "tier"], options.tier] }),
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": RADIUS,
      "circle-opacity": DOT_OPACITY,
      "circle-stroke-width": 0.9,
      "circle-stroke-color": "#04070d",
      "circle-stroke-opacity": 0.85,
    },
  };
}

const GLOW: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  0,
  5,
  6,
  8,
  11,
  15,
  15,
  24,
];

function addLayers(map: maplibregl.Map) {
  map.addSource("churches", { type: "geojson", data: EMPTY });
  map.addSource("selected", { type: "geojson", data: EMPTY });

  // Only live churches glow: at 50k+ dots a glow on every one would wash the
  // whole map out (and cost fill rate on phones).
  map.addLayer({
    id: "church-glow",
    type: "circle",
    source: "churches",
    filter: ["==", ["get", "state"], "live"],
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": GLOW,
      "circle-opacity": 0.2,
      "circle-blur": 1,
    },
  });

  map.addLayer({
    id: "church-pulse",
    type: "circle",
    source: "churches",
    filter: ["==", ["get", "state"], "live"],
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": 6,
      "circle-opacity": 0,
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": 1.4,
      "circle-stroke-opacity": 0,
    },
  });

  // Three circle layers over one source, split by zoom so the mid zooms do not
  // drown in dots. A single symbol layer would thin itself, but MapLibre breaks
  // above 32,768 icons in one bucket, which a 57k dataset hits immediately.
  map.addLayer(dotLayer("church-dot", { minzoom: 6 }));
  map.addLayer(dotLayer("church-dot-mid", { minzoom: 3, maxzoom: 6, tier: 0 }));
  map.addLayer(dotLayer("church-dot-far", { maxzoom: 3 }));

  // Outer ring marks a live dot whose status came from the community, not a schedule.
  map.addLayer({
    id: "church-community",
    type: "circle",
    source: "churches",
    filter: ["==", ["get", "community"], "yes"],
    paint: {
      "circle-color": "rgba(255,255,255,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 4.5, 8, 8.5, 14, 13.5],
      "circle-stroke-color": "#eaf7ff",
      "circle-stroke-width": 1.1,
      "circle-stroke-opacity": 0.68,
    },
  });

  map.addLayer({
    id: "church-label",
    type: "symbol",
    source: "churches",
    minzoom: 13,
    filter: ["==", ["get", "source"], "osm"],
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 0.9],
      "text-padding": 3,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#b9d3e8",
      "text-halo-color": "#04070d",
      "text-halo-width": 1.5,
      "text-halo-blur": 0.4,
    },
  });

  map.addLayer({
    id: "church-selected",
    type: "circle",
    source: "selected",
    paint: {
      "circle-color": "rgba(255,255,255,0)",
      "circle-radius": 13,
      "circle-stroke-color": "#eaf7ff",
      "circle-stroke-width": 1.6,
      "circle-stroke-opacity": 0.9,
    },
  });
}

export const RadarMap = forwardRef<RadarMapHandle, Props>(function RadarMap(
  { features, selectedId, onSelect, onViewport },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const selectRef = useRef(onSelect);
  const viewportRef = useRef(onViewport);

  useEffect(() => {
    selectRef.current = onSelect;
    viewportRef.current = onViewport;
  }, [onSelect, onViewport]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo(lon, lat, zoom) {
        mapRef.current?.flyTo({ center: [lon, lat], zoom, duration: 1100, essential: true });
      },
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: `${import.meta.env.BASE_URL}style.json`,
      center: [12, 24],
      zoom: 1.4,
      minZoom: 0.9,
      maxZoom: 17,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    // Debug/verification hook: scripts/verify-ui.mjs drives the map (projection
    // and source features) in both dev and a deployed build.
    (window as unknown as { __radarMap?: maplibregl.Map }).__radarMap = map;

    const emitViewport = () => {
      const bounds = map.getBounds();
      const south = Math.max(-85, bounds.getSouth());
      const north = Math.min(85, bounds.getNorth());
      const west = Math.max(-180, bounds.getWest());
      const east = Math.min(180, bounds.getEast());
      const center = map.getCenter();
      const zoom = map.getZoom();
      const safeBounds = { south, west, north, east };
      viewportRef.current({
        zoom,
        center: [center.lng, center.lat],
        bounds: safeBounds,
        key: `${zoom.toFixed(2)}|${boundsKey(safeBounds)}`,
      });
    };

    map.on("load", () => {
      type GlobeMap = { setProjection?: (projection: { type: "globe" }) => void };
      (map as unknown as GlobeMap).setProjection?.({ type: "globe" });
      addLayers(map);
      setReady(true);
      emitViewport();
    });

    map.on("moveend", emitViewport);

    // Symbols are small, so taps get a forgiving 18×18 px hit box.
    const hitBox = (point: { x: number; y: number }): [[number, number], [number, number]] => [
      [point.x - 9, point.y - 9],
      [point.x + 9, point.y + 9],
    ];

    map.on("click", (event) => {
      const hit = map.queryRenderedFeatures(hitBox(event.point), { layers: DOT_LAYER_IDS });
      selectRef.current(hit.length > 0 ? String(hit[0].properties?.id ?? "") : null);
    });

    map.on("mousemove", (event) => {
      const hit = map.queryRenderedFeatures(hitBox(event.point), { layers: DOT_LAYER_IDS });
      map.getCanvas().style.cursor = hit.length > 0 ? "pointer" : "";
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("churches") as maplibregl.GeoJSONSource | undefined)?.setData(features);
  }, [features, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const selected: FeatureCollection<Point> = {
      type: "FeatureCollection",
      features: features.features.filter((feature) => feature.properties.id === selectedId),
    };
    (map.getSource("selected") as maplibregl.GeoJSONSource | undefined)?.setData(selected);
  }, [features, selectedId, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let last = 0;

    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (time - last < 60) return;
      last = time;
      const phase = reduced ? 0.5 : (time % 2600) / 2600;
      map.setPaintProperty("church-pulse", "circle-radius", 4 + phase * 18);
      map.setPaintProperty("church-pulse", "circle-opacity", 0.4 * (1 - phase));
      map.setPaintProperty("church-pulse", "circle-stroke-opacity", 0.55 * (1 - phase));
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  return <div className="map-root" ref={containerRef} role="application" aria-label="World map of churches" />;
});
