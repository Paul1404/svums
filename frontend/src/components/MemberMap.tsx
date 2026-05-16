import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import {
  MapContainer,
  TileLayer,
  Marker,
  Tooltip,
  useMap,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import type { LwMemberGeo } from "../services/api";
import { useTheme } from "../context/ThemeContext";

const GERMANY_CENTER: [number, number] = [51.1657, 10.4515];

// Once the map is zoomed in this far, every member is shown as an
// individual dot instead of being rolled up into a count bubble — at
// building level the clusters hide more than they reveal.
const DISABLE_CLUSTER_ZOOM = 16;

// Approx. metres of jitter applied to markers that share the exact same
// geocoded coordinates (very common for households at the same street and
// house number). 1 degree latitude ≈ 111_111 m, so 4.5 m ≈ 4e-5°.
const COINCIDENT_RADIUS_DEG = 0.00004;

// Spread members that geocoded to the same point around a small ring so
// each one is hoverable / clickable. The first one stays on the actual
// coordinate so single-occupant addresses sit exactly on the house.
function spreadCoincidentPoints(points: LwMemberGeo[]): LwMemberGeo[] {
  const groups = new Map<string, LwMemberGeo[]>();
  for (const p of points) {
    const key = `${p.lat.toFixed(6)}|${p.lng.toFixed(6)}`;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }
  const out: LwMemberGeo[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => a.adr_nr - b.adr_nr);
    const lonScale = 1 / Math.max(0.2, Math.cos((sorted[0].lat * Math.PI) / 180));
    sorted.forEach((p, i) => {
      // Concentric rings: first 8 on radius r, next 8 on 2r, etc.
      const ringIndex = Math.floor(i / 8);
      const ringSize = Math.min(8, sorted.length - ringIndex * 8);
      const ringPos = i - ringIndex * 8;
      const angle = (ringPos / ringSize) * Math.PI * 2 + ringIndex * 0.4;
      const r = COINCIDENT_RADIUS_DEG * (ringIndex + 1);
      out.push({
        ...p,
        lat: p.lat + Math.cos(angle) * r,
        lng: p.lng + Math.sin(angle) * r * lonScale,
      });
    });
  }
  return out;
}

export type MapMode = "dots" | "heat";

export type MemberMapHandle = {
  /** Underlying Leaflet map instance, useful for screenshots or fly-tos. */
  getMap: () => L.Map | null;
};

function FitBounds({ points }: { points: LwMemberGeo[] }) {
  const map = useMap();
  useEffect(() => {
    // Force a size recalc so off-screen instances (used for poster export)
    // still know their viewport and request the right tile range.
    map.invalidateSize();
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [points, map]);
  return null;
}

// Heat layer drawn on the same map. Adapts radius/intensity to zoom so
// the blob does not turn into a single splat when zoomed out.
function HeatLayer({ points, active }: { points: LwMemberGeo[]; active: boolean }) {
  const map = useMap();
  const layerRef = useRef<L.Layer | null>(null);

  useEffect(() => {
    if (!active) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      return;
    }
    const heatPoints = points.map((p) => [p.lat, p.lng, 0.6] as [number, number, number]);
    const heat = (L as typeof L & {
      heatLayer: (latlngs: [number, number, number][], opts: Record<string, unknown>) => L.Layer;
    }).heatLayer(heatPoints, {
      radius: 26,
      blur: 22,
      maxZoom: 12,
      minOpacity: 0.35,
      // Brand-tinted ramp: deep red center, warm orange mid, soft amber edge.
      gradient: {
        0.2: "rgba(254, 226, 226, 0.85)",
        0.4: "#fca5a5",
        0.6: "#f87171",
        0.8: "#dc2626",
        1.0: "#7f1d1d",
      },
    });
    heat.addTo(map);
    layerRef.current = heat;
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [active, points, map]);

  return null;
}

// Tile attribution kept short -- we still credit OSM + CartoDB in the
// footer of the export poster.
const TILES = {
  light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
} as const;

const dotIcon = L.divIcon({
  className: "svums-member-dot",
  html: '<span class="svums-member-dot__pulse"></span><span class="svums-member-dot__core"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function clusterIcon(cluster: { getChildCount: () => number }) {
  const count = cluster.getChildCount();
  const size = count < 10 ? 36 : count < 50 ? 44 : count < 200 ? 52 : 60;
  return L.divIcon({
    className: "svums-member-cluster",
    html: `<div class="svums-member-cluster__inner" style="width:${size}px;height:${size}px"><span>${count}</span></div>`,
    iconSize: [size, size],
  });
}

interface Props {
  points: LwMemberGeo[];
  onSelectMember: (adrNr: number) => void;
  className?: string;
  mode?: MapMode;
}

const MemberMap = forwardRef<MemberMapHandle, Props>(function MemberMap(
  { points, onSelectMember, className, mode = "dots" },
  ref,
) {
  const mapRef = useRef<L.Map | null>(null);
  const { resolved } = useTheme();
  const tile = TILES[resolved];

  useImperativeHandle(ref, () => ({ getMap: () => mapRef.current }), []);

  const displayPoints = useMemo(() => spreadCoincidentPoints(points), [points]);

  const center = useMemo<[number, number]>(() => {
    if (displayPoints.length === 0) return GERMANY_CENTER;
    const lat = displayPoints.reduce((acc, p) => acc + p.lat, 0) / displayPoints.length;
    const lng = displayPoints.reduce((acc, p) => acc + p.lng, 0) / displayPoints.length;
    return [lat, lng];
  }, [displayPoints]);

  return (
    <div className={className}>
      <MapContainer
        center={center}
        zoom={displayPoints.length === 0 ? 6 : 12}
        scrollWheelZoom
        ref={(instance) => {
          if (instance) mapRef.current = instance;
        }}
        className="h-full w-full rounded-xl svums-map"
      >
        <TileLayer
          key={resolved}
          attribution={tile.attribution}
          url={tile.url}
          maxZoom={19}
          crossOrigin="anonymous"
        />
        <FitBounds points={displayPoints} />
        {mode === "heat" ? (
          <HeatLayer points={displayPoints} active />
        ) : (
          <MarkerClusterGroup
            chunkedLoading
            maxClusterRadius={40}
            disableClusteringAtZoom={DISABLE_CLUSTER_ZOOM}
            spiderfyOnMaxZoom={false}
            showCoverageOnHover={false}
            spiderLegPolylineOptions={{ weight: 0, opacity: 0 }}
            spiderfyDistanceMultiplier={1.4}
            iconCreateFunction={clusterIcon}
          >
            {displayPoints.map((p) => {
              const name =
                [p.vorname, p.nachname].filter(Boolean).join(" ") || `AdrNr ${p.adr_nr}`;
              const place = [p.plz, p.ort].filter(Boolean).join(" ");
              return (
                <Marker
                  key={p.adr_nr}
                  position={[p.lat, p.lng]}
                  icon={dotIcon}
                  eventHandlers={{
                    click: () => onSelectMember(p.adr_nr),
                  }}
                >
                  <Tooltip
                    direction="top"
                    offset={[0, -10]}
                    opacity={1}
                    className="svums-member-tooltip"
                  >
                    <div className="svums-member-tooltip__card">
                      <div className="svums-member-tooltip__name">{name}</div>
                      {p.mitgliedsnummer && (
                        <div className="svums-member-tooltip__meta">
                          Nr. {p.mitgliedsnummer}
                        </div>
                      )}
                      {place && (
                        <div className="svums-member-tooltip__meta">{place}</div>
                      )}
                      <div className="svums-member-tooltip__hint">Klicken für Details</div>
                    </div>
                  </Tooltip>
                </Marker>
              );
            })}
          </MarkerClusterGroup>
        )}
      </MapContainer>
    </div>
  );
});

export default MemberMap;
