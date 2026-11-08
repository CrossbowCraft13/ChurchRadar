import { FAMILY_META, FAMILY_ORDER, type Family } from "../lib/denomination";
import { STATUS_COLORS, type ColorMode, type SyncState } from "../lib/ui";

interface Props {
  mode: ColorMode;
  onMode: (mode: ColorMode) => void;
  families: Family[];
  onToggleFamily: (family: Family) => void;
  onlyLive: boolean;
  onOnlyLive: () => void;
  scanning: boolean;
  truncated: boolean;
  sync: SyncState;
  visible: number;
  hint: string;
  onLocate: () => void;
  onWorld: () => void;
}

export function Dock({
  mode,
  onMode,
  families,
  onToggleFamily,
  onlyLive,
  onOnlyLive,
  scanning,
  truncated,
  sync,
  visible,
  hint,
  onLocate,
  onWorld,
}: Props) {
  return (
    <div className="dock">
      <div className="dock-row">
        <div className="segmented" role="group" aria-label="Dot colouring">
          <button
            type="button"
            className={mode === "status" ? "active" : ""}
            aria-pressed={mode === "status"}
            onClick={() => onMode("status")}
          >
            Status
          </button>
          <button
            type="button"
            className={mode === "denomination" ? "active" : ""}
            aria-pressed={mode === "denomination"}
            onClick={() => onMode("denomination")}
          >
            Denomination
          </button>
        </div>

        <div className="dock-actions">
          <button type="button" className="icon-btn" onClick={onLocate} aria-label="Centre on my location">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <path
                d="M12 1.8v4M12 18.2v4M1.8 12h4M18.2 12h4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button type="button" className="icon-btn" onClick={onWorld} aria-label="Back to world view">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" strokeWidth="1.1" />
              <path d="M3.4 9h17.2M3.4 15h17.2" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          </button>
        </div>
      </div>

      <div className="chips" role="group" aria-label="Denomination filters">
        <button
          type="button"
          className={`chip chip-live ${onlyLive ? "chip-on" : ""}`}
          aria-pressed={onlyLive}
          onClick={onOnlyLive}
        >
          <span className="chip-dot" style={{ background: STATUS_COLORS.live }} />
          Meeting now
        </button>
        {FAMILY_ORDER.map((family) => {
          const active = families.includes(family);
          return (
            <button
              key={family}
              type="button"
              className={`chip ${active ? "chip-on" : ""}`}
              aria-pressed={active}
              onClick={() => onToggleFamily(family)}
            >
              <span className="chip-dot" style={{ background: FAMILY_META[family].color }} />
              {FAMILY_META[family].label}
            </button>
          );
        })}
      </div>

      <div className="dock-foot">
        {scanning ? (
          <span className="legend">
            {mode === "status" ? (
              <>
                <span className="legend-item">
                  <i style={{ background: STATUS_COLORS.live }} />
                  meeting now
                </span>
                <span className="legend-item">
                  <i style={{ background: STATUS_COLORS.done }} />
                  met today
                </span>
                <span className="legend-item">
                  <i style={{ background: STATUS_COLORS.idle }} />
                  not meeting
                </span>
                <span className="legend-item">
                  <i className="ring ring-community" />
                  community
                </span>
              </>
            ) : (
              <span className="legend-item">colour = denomination</span>
            )}
            <span className="legend-sep">·</span>
            <span className="legend-item">
              <i className="ring" />
              pulse = meeting
            </span>
          </span>
        ) : (
          <span className="legend-item">{hint}</span>
        )}

        <span className="dock-source">
          {truncated
            ? "first results shown · zoom in for all"
            : sync.phase === "ok"
              ? sync.fromCache
                ? "OSM cache"
                : "OSM live"
              : visible === 0
                ? "no churches in view"
                : ""}
        </span>
      </div>
    </div>
  );
}
