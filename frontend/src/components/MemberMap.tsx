import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import type { LwMemberGeo } from "../services/api";

// Vite-friendly default-icon wiring. Without this, markers fail to load
// because Leaflet tries to derive icon paths from window.location.
L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
});

const GERMANY_CENTER: [number, number] = [51.1657, 10.4515];

function FitBounds({ points }: { points: LwMemberGeo[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [points, map]);
  return null;
}

interface Props {
  points: LwMemberGeo[];
  onSelectMember: (adrNr: number) => void;
  className?: string;
}

export default function MemberMap({ points, onSelectMember, className }: Props) {
  const mapRef = useRef<L.Map | null>(null);

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
        className="h-full w-full rounded-xl"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <FitBounds points={points} />
        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={50}
          showCoverageOnHover={false}
        >
          {points.map((p) => (
            <Marker
              key={p.adr_nr}
              position={[p.lat, p.lng]}
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
                    Details öffnen →
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
}
