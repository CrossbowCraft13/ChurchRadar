import type { Church } from "../lib/church";
import {
  checkInSummary,
  reportedAgo,
  reportersLabel,
  type CheckIn,
  type CheckinConnection,
} from "../lib/checkins";
import { FAMILY_META } from "../lib/denomination";
import { formatDistance } from "../lib/geo";
import { describeStatus, formatWindow, type Status } from "../lib/schedule";
import { formatLocalTime, timezoneFor } from "../lib/time";

interface Props {
  church: Church;
  status: Status;
  checkIn?: CheckIn | null;
  connection: CheckinConnection;
  busy: boolean;
  error: string | null;
  now: Date;
  distanceKm?: number;
  onClose: () => void;
  onFocus: () => void;
  onCheckIn: () => void;
}

export function ChurchSheet({
  church,
  status,
  checkIn,
  connection,
  busy,
  error,
  now,
  distanceKm,
  onClose,
  onFocus,
  onCheckIn,
}: Props) {
  const meta = FAMILY_META[church.family];
  const zone = timezoneFor(church.lat, church.lon);
  const schedule =
    church.schedule === "published" && church.windows.length > 0
      ? church.windows.slice(0, 6).map(formatWindow).join(" · ")
      : `Typical ${meta.label.toLowerCase()} hours (not published)`;
  const offline = connection === "unavailable";

  return (
    <article className="sheet" aria-label={`${church.name} details`}>
      <div className="sheet-head">
        <span className="sheet-dot" style={{ background: meta.color }} />
        <div className="sheet-title">
          <h2>{church.name}</h2>
          <p>
            {meta.label}
            {church.denomination && church.denomination.toLowerCase() !== meta.label.toLowerCase()
              ? ` · ${church.denomination.replace(/_/g, " ")}`
              : ""}
            {church.city ? ` · ${church.city}` : ""}
          </p>
        </div>
        <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label="Close details">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <p className={`status-pill status-${status.state}`}>
        {checkIn && <span className="pill-tag">community</span>}
        {checkIn
          ? `Meeting now · ${reportersLabel(checkIn.reporters)} reporting`
          : describeStatus(status)}
      </p>

      <section className={`community ${checkIn ? "community-live" : ""}`} aria-label="Community check-in">
        <div className="community-copy">
          <strong>{checkIn ? "The community says it is meeting" : "Meeting right now?"}</strong>
          <p>
            {checkIn
              ? `${checkInSummary(checkIn, now.getTime())} · reported ${reportedAgo(
                  checkIn.startsAt,
                  now.getTime(),
                )}`
              : "If you are there, mark it — every open radar updates instantly."}
          </p>
        </div>
        <button
          type="button"
          className="community-btn"
          onClick={onCheckIn}
          disabled={busy || offline}
          aria-busy={busy}
        >
          {busy ? "Reporting…" : checkIn ? "Still meeting" : "It's meeting now"}
        </button>
        {error && (
          <p className="community-error" role="alert">
            {error}
          </p>
        )}
        {!error && offline && <p className="community-error">Community check-ins are offline here.</p>}
      </section>

      <dl className="sheet-meta">
        <div>
          <dt>Local time</dt>
          <dd>
            {formatLocalTime(zone)} <span className="muted">{zone}</span>
          </dd>
        </div>
        <div>
          <dt>{church.schedule === "published" ? "Service times" : "Assumed times"}</dt>
          <dd>{schedule}</dd>
        </div>
        {status.nextWindow && status.state !== "live" && (
          <div>
            <dt>Next service</dt>
            <dd>{formatWindow(status.nextWindow)}</dd>
          </div>
        )}
        {distanceKm !== undefined && (
          <div>
            <dt>Distance</dt>
            <dd>{formatDistance(distanceKm)}</dd>
          </div>
        )}
        <div>
          <dt>Source</dt>
          <dd>{church.source === "osm" ? "OpenStreetMap" : "Wikidata"}</dd>
        </div>
      </dl>

      <div className="sheet-actions">
        {church.osmUrl && (
          <a href={church.osmUrl} target="_blank" rel="noreferrer noopener">
            OpenStreetMap
          </a>
        )}
        {church.wikidataUrl && (
          <a href={church.wikidataUrl} target="_blank" rel="noreferrer noopener">
            Wikidata
          </a>
        )}
        {church.website && (
          <a href={church.website} target="_blank" rel="noreferrer noopener">
            Website
          </a>
        )}
        <button type="button" onClick={onFocus}>
          Centre
        </button>
      </div>

      <p className="sheet-note">
        {church.schedule === "published"
          ? "Live status follows the published service times, in the church's own time zone."
          : "No service times are published for this church, so the status is estimated from typical hours in its tradition."}{" "}
        Community reports override both while they last, then expire on their own.
      </p>
    </article>
  );
}
