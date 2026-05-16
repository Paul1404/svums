import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import type { LwMemberGeo } from "../services/api";
import { useTheme } from "../context/ThemeContext";

const GERMANY_CENTER: [number, number] = [51.1657, 10.4515];

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

  const center = useMemo<[number, number]>(() => {
    if (points.length === 0) return GERMANY_CENTER;
    const lat = points.reduce((acc, p) => acc + p.lat, 0) / points.length;
    const lng = points.reduce((acc, p) => acc + p.lng, 0) / points.length;
    return [lat, lng];
  }, [points]);

  return (
    <div className={className}>
      <MapContainer
        center={center}
        zoom={points.length === 0 ? 6 : 12}
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
        <FitBounds points={points} />
        {mode === "heat" ? (
          <HeatLayer points={points} active />
        ) : (
          <MarkerClusterGroup
            chunkedLoading
            maxClusterRadius={55}
            showCoverageOnHover={false}
            iconCreateFunction={clusterIcon}
          >
            {points.map((p) => (
              <Marker
                key={p.adr_nr}
                position={[p.lat, p.lng]}
                icon={dotIcon}
                eventHandlers={{
                  click: () => onSelectMember(p.adr_nr),
                }}
              >
                <Popup>
                  <div className="text-sm space-y-1">
                    <div className="font-semibold">
                      {[p.vorname, p.nachname].filter(Boolean).join(" ") || `AdrNr ${p.adr_nr}`}
                    </div>
                    {p.mitgliedsnummer && (
                      <div className="text-xs text-gray-500 font-mono">
                        Nr. {p.mitgliedsnummer}
                      </div>
                    )}
                    {(p.plz || p.ort) && (
                      <div className="text-xs text-gray-600">
                        {[p.plz, p.ort].filter(Boolean).join(" ")}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        onSelectMember(p.adr_nr);
                      }}
                      className="mt-1 text-xs text-svu-700 hover:underline"
                    >
                      Details öffnen
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        )}
      </MapContainer>
    </div>
  );
});

export default MemberMap;
