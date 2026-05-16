import { forwardRef } from "react";

export interface PosterMeta {
  clubName: string;
  memberCount: number;
  locationCount: number;
  generatedAt: Date;
}

interface Props {
  meta: PosterMeta;
  children: React.ReactNode;
  /** Outer pixel size used for the screenshot; should match aspect ratio 16:10. */
  width: number;
  height: number;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * Off-screen poster frame the map is briefly portaled into while exporting.
 * Adds a header (club name) and footer (stats + date) around the map area
 * so the rendered PNG looks like a finished poster, not a raw screenshot.
 */
const MemberMapPoster = forwardRef<HTMLDivElement, Props>(function MemberMapPoster(
  { meta, children, width, height },
  ref,
) {
  return (
    <div
      ref={ref}
      className="map-poster"
      style={{ width, height }}
    >
      <div className="map-poster__accent" />
      <div className="map-poster__bar map-poster__bar--top">
        <h2 className="map-poster__title">{meta.clubName}</h2>
        <p className="map-poster__subtitle">Mitglieder · geografische Verteilung</p>
      </div>

      <div style={{ position: "absolute", inset: 0 }}>{children}</div>

      <div className="map-poster__bar map-poster__bar--bottom">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
          <div className="map-poster__stats">
            <div>
              <div className="map-poster__stat-value">
                {meta.memberCount.toLocaleString("de-DE")}
              </div>
              <span className="map-poster__stat-label">Mitglieder</span>
            </div>
            <div>
              <div className="map-poster__stat-value">
                {meta.locationCount.toLocaleString("de-DE")}
              </div>
              <span className="map-poster__stat-label">Orte</span>
            </div>
          </div>
          <div className="map-poster__footer-meta">
            Stand {formatDate(meta.generatedAt)}
            <br />
            Karte: OpenStreetMap · CARTO
          </div>
        </div>
      </div>
    </div>
  );
});

export default MemberMapPoster;
