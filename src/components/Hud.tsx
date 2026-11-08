import { compactNumber, syncLabel, type SyncState } from "../lib/ui";

interface Props {
  meetingNow: number;
  visible: number;
  tracked: number;
  sync: SyncState;
  now: Date;
  scanning: boolean;
}

function RadarGlyph() {
  return (
    <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      <circle cx="16" cy="16" r="8" fill="none" stroke="currentColor" strokeOpacity="0.25" />
      <path d="M16 16 L26 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="21" cy="20" r="2" fill="#3ce0b4" />
      <circle cx="12" cy="11" r="1.6" fill="#ffc14d" />
      <circle cx="16" cy="16" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function Hud({ meetingNow, visible, tracked, sync, now, scanning }: Props) {
  const badge = syncLabel(sync, now);

  return (
    <header className="hud">
      <div className="hud-bar">
        <div className="brand">
          <span className="brand-mark">
            <RadarGlyph />
          </span>
          <span className="brand-copy">
            <span className="brand-title">CHURCH RADAR</span>
            <span className="brand-sub">{scanning ? "LIVE LOCAL SCAN" : "WORLD OVERVIEW"}</span>
          </span>
        </div>
        <span className={`sync sync-${badge.tone}`}>
          <span className="sync-dot" />
          {badge.text}
        </span>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-value stat-live">{compactNumber(meetingNow)}</span>
          <span className="stat-label">Meeting now</span>
        </div>
        <div className="stat-div" />
        <div className="stat">
          <span className="stat-value">{compactNumber(visible)}</span>
          <span className="stat-label">On radar</span>
        </div>
        <div className="stat-div" />
        <div className="stat">
          <span className="stat-value stat-muted">{compactNumber(tracked)}</span>
          <span className="stat-label">Tracked</span>
        </div>
      </div>
    </header>
  );
}
