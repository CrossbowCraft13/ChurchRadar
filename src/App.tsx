import type { Feature, Point } from "geojson";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChurchSheet } from "./components/ChurchSheet";
import { Dock } from "./components/Dock";
import { Hud } from "./components/Hud";
import {
  RadarMap,
  type RadarFeatures,
  type RadarMapHandle,
  type RadarProps,
  type Viewport,
} from "./components/RadarMap";
import type { Church } from "./lib/church";
import {
  activeCheckIn,
  createCheckinClient,
  mergeCheckIns,
  minutesLeft,
  type CheckIn,
  type CheckinClient,
  type CheckinConnection,
} from "./lib/checkins";
import { FAMILY_META, FAMILY_ORDER, type Family } from "./lib/denomination";
import { boundsArea, distanceKm } from "./lib/geo";
import { MAX_SCAN_AREA, SCAN_MIN_ZOOM, scanBounds } from "./lib/overpass";
import { statusAt, type Status } from "./lib/schedule";
import { loadWorldChurches } from "./lib/seed";
import { localClock, timezoneFor } from "./lib/time";
import { compactNumber, STATUS_COLORS, type ColorMode, type SyncState } from "./lib/ui";

const INITIAL_VIEW: Viewport = {
  zoom: 1.4,
  center: [12, 24],
  bounds: { south: -60, west: -180, north: 75, east: 180 },
  key: "init",
};

const REFRESH_MS = 5 * 60_000;

/** Stable 0-3 bucket per church, used to thin dots at continental zoom. */
function tierOf(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 4;
}

export default function App() {
  const [mode, setMode] = useState<ColorMode>("status");
  const [families, setFamilies] = useState<Family[]>(() => [...FAMILY_ORDER]);
  const [onlyLive, setOnlyLive] = useState(false);
  const [world, setWorld] = useState<Church[]>([]);
  const [local, setLocal] = useState<Church[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<Viewport>(INITIAL_VIEW);
  const [sync, setSync] = useState<SyncState>({ phase: "boot" });
  const [now, setNow] = useState(() => new Date());
  const [refreshTick, setRefreshTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkIns, setCheckIns] = useState<Map<string, CheckIn>>(() => new Map());
  const [checkinConnection, setCheckinConnection] = useState<CheckinConnection>("idle");
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const checkinClient = useRef<CheckinClient | null>(null);
  const mapApi = useRef<RadarMapHandle | null>(null);

  const area = boundsArea(view.bounds);
  const scanning = view.zoom >= SCAN_MIN_ZOOM && area <= MAX_SCAN_AREA;
  const zoomTooWide = view.zoom >= SCAN_MIN_ZOOM && area > MAX_SCAN_AREA;

  // Recompute every church's local clock regularly so statuses tick live.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    const onVisible = () => {
      if (!document.hidden) setNow(new Date());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Keep the scanned area fresh while the app stays open.
  useEffect(() => {
    const id = window.setInterval(() => setRefreshTick((tick) => tick + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  // Community check-ins: durable snapshot on open, instant room broadcasts after.
  useEffect(() => {
    const client = createCheckinClient({
      onSnapshot: (list) => setCheckIns((current) => mergeCheckIns(current, list)),
      onCheckIn: (checkin) => setCheckIns((current) => mergeCheckIns(current, [checkin])),
      onConnection: setCheckinConnection,
    });
    checkinClient.current = client;
    client.start();
    return () => {
      client.stop();
      checkinClient.current = null;
    };
  }, []);

  // Bundled world overview (works offline).
  useEffect(() => {
    let cancelled = false;
    loadWorldChurches()
      .then((churches) => {
        if (!cancelled) setWorld(churches);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSync((prev) =>
          prev.phase === "ok"
            ? prev
            : {
                phase: "error",
                message: error instanceof Error ? error.message : "World data unavailable",
              },
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live OpenStreetMap scan for the current viewport.
  useEffect(() => {
    if (!scanning) {
      setLocal([]);
      setSync((prev) => (prev.phase === "error" ? prev : { phase: "overview" }));
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      setSync((prev) => ({ ...prev, phase: "scanning" }));
      try {
        const result = await scanBounds(view.bounds, {
          signal: controller.signal,
          maxAgeMs: 4 * 60_000,
        });
        if (cancelled) return;
        setLocal(result.churches);
        setSync({
          phase: "ok",
          at: result.fetchedAt,
          endpoint: result.endpoint,
          fromCache: result.fromCache,
          stale: result.stale,
          truncated: result.truncated,
        });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSync({
          phase: "error",
          message: error instanceof Error ? error.message : "Church data unavailable",
        });
      }
    };

    const timer = window.setTimeout(run, 450);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [scanning, view.key, view.bounds, refreshTick]);

  const churches = scanning ? local : world;

  const nowMs = now.getTime();
  // Statuses only change on the minute; with ~57k churches it matters that the
  // feature collection is not rebuilt on every 15 s tick.
  const minuteKey = Math.floor(nowMs / 60_000);
  const minuteNow = useMemo(() => new Date(minuteKey * 60_000), [minuteKey]);
  const minuteMs = minuteKey * 60_000;

  const statusById = useMemo(() => {
    const map = new Map<string, Status>();
    for (const church of churches) {
      const clock = localClock(timezoneFor(church.lat, church.lon), minuteNow);
      const scheduled = statusAt(church.windows, clock.day, clock.minutes);
      const checkin = activeCheckIn(checkIns, church.id, minuteMs);
      map.set(
        church.id,
        checkin
          ? { ...scheduled, state: "live", minutesLeft: minutesLeft(checkin.endsAt, minuteMs) }
          : scheduled,
      );
    }
    return map;
  }, [churches, minuteNow, minuteMs, checkIns]);

  const features = useMemo<RadarFeatures>(() => {
    const allowed = new Set(families);
    const list: Array<Feature<Point, RadarProps>> = [];
    for (const church of churches) {
      if (!allowed.has(church.family)) continue;
      const status = statusById.get(church.id);
      if (!status) continue;
      if (onlyLive && status.state !== "live") continue;
      list.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [church.lon, church.lat] },
        properties: {
          id: church.id,
          name: church.name,
          family: church.family,
          state: status.state,
          color: mode === "status" ? STATUS_COLORS[status.state] : FAMILY_META[church.family].color,
          schedule: church.schedule,
          source: church.source,
          community: activeCheckIn(checkIns, church.id, minuteMs) ? "yes" : "no",
          tier: tierOf(church.id),
        },
      });
    }
    return { type: "FeatureCollection", features: list };
  }, [churches, statusById, families, onlyLive, mode, checkIns, minuteMs]);

  const meetingNow = useMemo(
    () => features.features.filter((feature) => feature.properties.state === "live").length,
    [features],
  );

  const selected = useMemo(
    () => churches.find((church) => church.id === selectedId) ?? null,
    [churches, selectedId],
  );
  const selectedStatus = selected ? statusById.get(selected.id) : undefined;
  const selectedCheckIn = selected ? activeCheckIn(checkIns, selected.id, nowMs) : null;

  const handleViewport = useCallback((next: Viewport) => {
    setView((prev) => (prev.key === next.key ? prev : next));
  }, []);

  const toggleFamily = useCallback((family: Family) => {
    setFamilies((prev) =>
      prev.includes(family) ? prev.filter((item) => item !== family) : [...prev, family],
    );
  }, []);

  const handleCheckIn = useCallback(async () => {
    const client = checkinClient.current;
    if (!client || !selectedId) return;
    setCheckinBusy(true);
    setCheckinError(null);
    try {
      // The sheet updates in place from the returned record, so no toast is
      // needed (and a toast would land on top of the open sheet).
      await client.report(selectedId);
    } catch (error) {
      setCheckinError(error instanceof Error ? error.message : "Check-in failed");
    } finally {
      setCheckinBusy(false);
    }
  }, [selectedId]);

  useEffect(() => {
    setCheckinError(null);
  }, [selectedId]);

  const handleLocate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setNotice("This device does not expose a location");
      return;
    }
    setNotice("Acquiring position…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setNotice(null);
        mapApi.current?.flyTo(position.coords.longitude, position.coords.latitude, 14);
      },
      () => setNotice("Location unavailable — check the permission"),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(id);
  }, [notice]);

  const hint = zoomTooWide
    ? "Zoom in a little further to scan this area"
    : `Zoom in to scan every church · ${compactNumber(churches.length)} churches worldwide`;

  return (
    <div className="app">
      <RadarMap
        ref={mapApi}
        features={features}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onViewport={handleViewport}
      />
      <div className="scan-grid" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      <Hud
        meetingNow={meetingNow}
        visible={features.features.length}
        tracked={churches.length}
        sync={sync}
        now={now}
        scanning={scanning}
      />

      <div className="bottom-stack">
        {sync.phase === "error" && (
          <div className="alert" role="alert">
            <span>{sync.message ?? "Church data unavailable"}</span>
            <button type="button" onClick={() => setRefreshTick((tick) => tick + 1)}>
              Retry
            </button>
          </div>
        )}

        {selected && selectedStatus && (
          <ChurchSheet
            church={selected}
            status={selectedStatus}
            checkIn={selectedCheckIn}
            connection={checkinConnection}
            busy={checkinBusy}
            error={checkinError}
            now={now}
            distanceKm={distanceKm(
              { lat: view.center[1], lon: view.center[0] },
              { lat: selected.lat, lon: selected.lon },
            )}
            onClose={() => setSelectedId(null)}
            onFocus={() => mapApi.current?.flyTo(selected.lon, selected.lat, 16)}
            onCheckIn={handleCheckIn}
          />
        )}

        <Dock
          mode={mode}
          onMode={setMode}
          families={families}
          onToggleFamily={toggleFamily}
          onlyLive={onlyLive}
          onOnlyLive={() => setOnlyLive((value) => !value)}
          scanning={scanning}
          truncated={Boolean(sync.truncated)}
          sync={sync}
          visible={features.features.length}
          hint={hint}
          onLocate={handleLocate}
          onWorld={() => mapApi.current?.flyTo(12, 24, 1.4)}
        />
      </div>

      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}
