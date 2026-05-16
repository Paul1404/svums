import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import L from "leaflet";
import {
  getImportStats,
  listImportedMembers,
  getImportedMember,
  uploadImportSql,
  purgeImportedData,
  getMembersGeo,
  getGeocodeStatus,
  startGeocode,
  stopGeocode,
  type LwImportStats,
  type LwMemberListResponse,
  type LwMemberDetail,
  type LwMemberSummary,
  type LwMemberGeo,
  type LwGeocodeStatus,
} from "../services/api";
import { errorMessage } from "../lib/utils";
import MemberMap, { type MapMode, type MemberMapHandle } from "../components/MemberMap";
import MemberMapPoster from "../components/MemberMapPoster";
import { useBodyOverlay, useEscapeKey } from "../lib/useBodyOverlay";
import { useClubConfig } from "../context/ClubConfigContext";
import { toPng } from "html-to-image";
import {
  ArrowLeft,
  Upload,
  RefreshCw,
  Search,
  Database,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Mail,
  Phone,
  MapPin,
  CreditCard,
  FileSpreadsheet,
  Map as MapIcon,
  Play,
  StopCircle,
  Info,
  Image as ImageIcon,
  Flame,
  Circle,
  Loader2,
  Crosshair,
} from "lucide-react";

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SECONDS_PER_REQUEST = 1.1;

function formatEta(processed: number, total: number): string {
  const remaining = Math.max(0, total - processed);
  if (remaining === 0) return "fertig";
  const seconds = remaining * SECONDS_PER_REQUEST;
  if (seconds < 60) return `ca. ${Math.ceil(seconds)} Sek. verbleibend`;
  const minutes = Math.ceil(seconds / 60);
  return `ca. ${minutes} Min. verbleibend`;
}

function statusLabel(member: LwMemberSummary): { label: string; color: string } {
  if (member.geloscht) return { label: "Gelöscht", color: "bg-gray-200 text-gray-700" };
  if (member.verstorben_am) return { label: "Verstorben", color: "bg-gray-200 text-gray-700" };
  if (member.austritt) {
    const austritt = new Date(member.austritt);
    if (!Number.isNaN(austritt.getTime()) && austritt <= new Date()) {
      return { label: "Ausgetreten", color: "bg-amber-100 text-amber-800" };
    }
  }
  return { label: "Aktiv", color: "bg-green-100 text-green-700" };
}

const PAGE_SIZE = 50;

export default function AdminImportedMembers() {
  const [stats, setStats] = useState<LwImportStats | null>(null);
  const [list, setList] = useState<LwMemberListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [includeResigned, setIncludeResigned] = useState(true);
  const [selectedAdrNr, setSelectedAdrNr] = useState<number | null>(null);
  const [selectedMember, setSelectedMember] = useState<LwMemberDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [geoPoints, setGeoPoints] = useState<LwMemberGeo[]>([]);
  const [geoStatus, setGeoStatus] = useState<LwGeocodeStatus | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [mapMode, setMapMode] = useState<MapMode>("dots");
  const [exporting, setExporting] = useState(false);
  const club = useClubConfig();
  const posterRef = useRef<HTMLDivElement | null>(null);
  const exportMapRef = useRef<MemberMapHandle | null>(null);

  const handleExportPoster = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Wait one frame for the off-screen poster to mount, then wait until
      // the map's visible tiles have finished loading (with a hard timeout
      // so a stuck tile request doesn't hang the export).
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise<void>((resolve) => {
        const map = exportMapRef.current?.getMap();
        const timeout = window.setTimeout(resolve, 4000);
        if (!map) {
          resolve();
          return;
        }
        const tileLayers: L.TileLayer[] = [];
        map.eachLayer((layer) => {
          if (layer instanceof L.TileLayer) tileLayers.push(layer);
        });
        const tileLayer = tileLayers[0];
        if (!tileLayer) {
          resolve();
          return;
        }
        const done = () => {
          window.clearTimeout(timeout);
          // Small extra beat for the heat canvas / marker paints to commit.
          window.setTimeout(resolve, 300);
        };
        tileLayer.once("load", done);
      });

      const node = posterRef.current;
      if (!node) return;
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      const slug = (club.club_short_name || club.club_name || "verein")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      link.download = `${slug}-mitgliederkarte-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      toast.error(errorMessage(e, "Bildexport fehlgeschlagen"));
    } finally {
      setExporting(false);
    }
  }, [exporting, club.club_name, club.club_short_name]);

  const locationCount = useMemo(() => {
    const keys = new Set<string>();
    for (const p of geoPoints) keys.add(`${p.lat.toFixed(3)},${p.lng.toFixed(3)}`);
    return keys.size;
  }, [geoPoints]);

  const fetchStats = useCallback(async () => {
    try {
      setStats(await getImportStats());
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listImportedMembers({
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        includeDeleted,
        includeResigned,
      });
      setList(data);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [page, search, includeDeleted, includeResigned]);

  const fetchGeo = useCallback(async () => {
    setGeoLoading(true);
    try {
      const [points, status] = await Promise.all([
        getMembersGeo({ includeResigned, includeDeleted }),
        getGeocodeStatus(),
      ]);
      setGeoPoints(points);
      setGeoStatus(status);
    } catch (e) {
      // map is a non-critical extra; only surface real errors
      console.warn(e);
    } finally {
      setGeoLoading(false);
    }
  }, [includeResigned, includeDeleted]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    fetchGeo();
  }, [fetchGeo]);

  // Poll geocode progress while running; also stream new pins to the map
  // so the wait feels productive instead of a blank screen.
  useEffect(() => {
    if (!geoStatus?.running) return;
    let lastGeocodedCount = geoStatus.geocoded;
    const id = window.setInterval(async () => {
      try {
        const next = await getGeocodeStatus();
        setGeoStatus(next);
        // Refresh points whenever new ones have been resolved
        if (next.geocoded > lastGeocodedCount) {
          lastGeocodedCount = next.geocoded;
          const points = await getMembersGeo({ includeResigned, includeDeleted });
          setGeoPoints(points);
        }
        if (!next.running) {
          // Final refresh once the worker finishes (catches the last commit)
          const points = await getMembersGeo({ includeResigned, includeDeleted });
          setGeoPoints(points);
          if (next.last_error) {
            toast.error(`Geocoding fehlgeschlagen: ${next.last_error}`);
          } else {
            toast.success(
              `Geocoding abgeschlossen. ${next.found} gefunden, ${next.failed} ohne Treffer.`,
            );
          }
        }
      } catch (e) {
        console.warn(e);
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [geoStatus?.running, includeResigned, includeDeleted]);

  useEffect(() => {
    if (selectedAdrNr === null) {
      setSelectedMember(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    getImportedMember(selectedAdrNr)
      .then((m) => {
        if (!cancelled) setSelectedMember(m);
      })
      .catch((e) => {
        if (!cancelled) toast.error(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAdrNr]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".sql")) {
        toast.error("Bitte eine .sql-Datei auswählen.");
        return;
      }
      setUploading(true);
      try {
        const result = await uploadImportSql(file);
        toast.success(
          `Import erfolgreich. ${result.inserted_members} Mitglieder, ` +
            `${result.inserted_contracts} Verträge, ${result.inserted_sepa} SEPA, ` +
            `${result.inserted_fee_types} Beitragstypen.`,
        );
        await Promise.all([fetchStats(), fetchList()]);
      } catch (e) {
        toast.error(errorMessage(e));
      } finally {
        setUploading(false);
      }
    },
    [fetchStats, fetchList],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleUpload(file);
    },
    [handleUpload],
  );

  const handleStartGeocode = useCallback(async () => {
    try {
      const next = await startGeocode();
      setGeoStatus(next);
      if (next.running) {
        toast.success("Geocoding läuft. Das kann einige Minuten dauern.");
      } else if (next.pending === 0) {
        toast.info("Alle Adressen sind bereits geocodiert.");
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);

  const handleRefineGeocode = useCallback(async () => {
    const confirmed = window.confirm(
      "Ungenaue Adressen mit strukturierter Suche neu geocodieren? Hausgenau "
        + "platzierte Mitglieder bleiben unverändert. Das kann mehrere Minuten dauern.",
    );
    if (!confirmed) return;
    try {
      const next = await startGeocode("approximate");
      setGeoStatus(next);
      if (next.running) {
        toast.success("Verfeinern läuft. Adressen werden neu geocodiert.");
      } else {
        toast.info("Keine Adressen zum Verfeinern gefunden.");
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);

  const handleStopGeocode = useCallback(async () => {
    try {
      const next = await stopGeocode();
      setGeoStatus(next);
      toast.info("Geocoding angehalten.");
      await fetchGeo();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [fetchGeo]);

  const handlePurge = useCallback(async () => {
    const confirmed = window.confirm(
      "Alle importierten Daten endgültig löschen? Diese Aktion kann nicht rückgängig gemacht werden.",
    );
    if (!confirmed) return;
    try {
      await purgeImportedData();
      toast.success("Importierte Daten wurden gelöscht.");
      setSelectedAdrNr(null);
      await Promise.all([fetchStats(), fetchList()]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [fetchStats, fetchList]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const totalPages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/admin"
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            Zurück
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              Linear Webverein Import
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Importierte Bestandsdaten aus der Vereinssoftware
            </p>
          </div>
          <button
            onClick={() => {
              fetchStats();
              fetchList();
            }}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            title="Aktualisieren"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Stats + Upload */}
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Mitglieder" value={stats?.total_members ?? 0} icon={<Database className="w-4 h-4" />} />
            <StatCard label="Aktiv" value={stats?.active_members ?? 0} icon={<Database className="w-4 h-4 text-green-600" />} accent="text-green-700" />
            <StatCard label="Verträge" value={stats?.total_contracts ?? 0} icon={<FileSpreadsheet className="w-4 h-4" />} />
            <StatCard label="SEPA-Mandate" value={stats?.total_sepa ?? 0} icon={<CreditCard className="w-4 h-4" />} />
            {stats?.last_import && (
              <div className="col-span-2 sm:col-span-4 text-xs text-gray-500 dark:text-gray-400 mt-1">
                Letzter Import:{" "}
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {formatDateTime(stats.last_import.imported_at)}
                </span>
                {stats.last_import.filename && (
                  <> · {stats.last_import.filename} ({formatBytes(stats.last_import.file_size_bytes)})</>
                )}
              </div>
            )}
          </div>

          <div
            className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors
              ${dragging ? "border-svu-500 bg-svu-50 dark:bg-svu-900/20" : "border-gray-300 dark:border-gray-600 hover:border-svu-400 hover:bg-gray-50 dark:hover:bg-gray-800"}
              ${uploading ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".sql"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
            {uploading ? (
              <RefreshCw className="w-6 h-6 text-svu-600 animate-spin" />
            ) : (
              <Upload className="w-6 h-6 text-gray-400 dark:text-gray-500" />
            )}
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {uploading ? "Wird importiert..." : "SQL-Datei hier ablegen"}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Linear Webverein Datensicherung (.sql)
            </div>
            {stats && stats.total_members > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePurge();
                }}
                className="mt-2 inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-3 h-3" /> Daten löschen
              </button>
            )}
          </div>
        </div>

        {/* Map */}
        {stats && stats.total_members > 0 && (
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b dark:border-gray-700">
              <div className="flex items-center gap-2">
                <MapIcon className="w-5 h-5 text-svu-600" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Mitglieder-Karte
                </h2>
                {geoStatus && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {geoStatus.geocoded.toLocaleString("de-DE")} von{" "}
                    {geoStatus.total_with_address.toLocaleString("de-DE")} Adressen geocodiert
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {geoStatus?.running ? (
                  <button
                    type="button"
                    onClick={handleStopGeocode}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800"
                  >
                    <StopCircle className="w-3.5 h-3.5" /> Anhalten
                  </button>
                ) : (
                  <>
                    {geoStatus && geoStatus.pending > 0 && (
                      <button
                        type="button"
                        onClick={handleStartGeocode}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-svu-700 bg-svu-50 border border-svu-200 rounded-lg hover:bg-svu-100 dark:bg-svu-900/20 dark:text-svu-300 dark:border-svu-800"
                        title={`${geoStatus.pending} Adressen ohne Koordinaten`}
                      >
                        <Play className="w-3.5 h-3.5" />
                        {geoStatus.pending.toLocaleString("de-DE")} geocodieren
                      </button>
                    )}
                    {geoStatus && geoStatus.approximate > 0 && (
                      <button
                        type="button"
                        onClick={handleRefineGeocode}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800"
                        title={`${geoStatus.approximate} ungenaue Adressen mit strukturierter Suche neu geocodieren`}
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        {geoStatus.approximate.toLocaleString("de-DE")} verfeinern
                      </button>
                    )}
                  </>
                )}
                {showMap && geoPoints.length > 0 && (
                  <>
                    <div
                      className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-50 dark:bg-gray-900"
                      role="group"
                      aria-label="Darstellung"
                    >
                      <button
                        type="button"
                        onClick={() => setMapMode("dots")}
                        aria-pressed={mapMode === "dots"}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-colors ${
                          mapMode === "dots"
                            ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm"
                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        }`}
                      >
                        <Circle className="w-3 h-3" /> Punkte
                      </button>
                      <button
                        type="button"
                        onClick={() => setMapMode("heat")}
                        aria-pressed={mapMode === "heat"}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-colors ${
                          mapMode === "heat"
                            ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm"
                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        }`}
                      >
                        <Flame className="w-3 h-3" /> Heatmap
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleExportPoster}
                      disabled={exporting}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-svu-700 bg-svu-50 border border-svu-200 rounded-lg hover:bg-svu-100 dark:bg-svu-900/20 dark:text-svu-300 dark:border-svu-800 disabled:opacity-60 disabled:cursor-wait"
                      title="Karte als PNG-Poster speichern"
                    >
                      {exporting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ImageIcon className="w-3.5 h-3.5" />
                      )}
                      {exporting ? "Wird erstellt..." : "Als Bild speichern"}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setShowMap((v) => !v)}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 rounded-lg"
                >
                  {showMap ? "Karte ausblenden" : "Karte anzeigen"}
                </button>
              </div>
            </header>

            {geoStatus?.running && (
              <div className="px-4 py-3 border-b dark:border-gray-700 bg-svu-50 dark:bg-svu-900/20">
                <div className="flex items-center justify-between text-xs text-svu-800 dark:text-svu-200 mb-1.5">
                  <span>
                    Geocodierung läuft · {geoStatus.processed} / {geoStatus.total}
                    {geoStatus.last_address && (
                      <span className="ml-2 text-svu-600 dark:text-svu-300">
                        ({geoStatus.last_address})
                      </span>
                    )}
                  </span>
                  <span className="font-medium">
                    {formatEta(geoStatus.processed, geoStatus.total)}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-svu-100 dark:bg-svu-900 overflow-hidden">
                  <div
                    className="h-full bg-svu-600 transition-all duration-500"
                    style={{
                      width: `${geoStatus.total > 0 ? (geoStatus.processed / geoStatus.total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-svu-700 dark:text-svu-300">
                  <span className="flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    Läuft im Hintergrund. Sie können diese Seite verlassen.
                  </span>
                  <span>
                    {geoStatus.found} gefunden · {geoStatus.failed} ohne Treffer
                  </span>
                </div>
              </div>
            )}

            {showMap && (
              <div className="relative">
                {geoPoints.length === 0 ? (
                  <div className="h-[450px] flex flex-col items-center justify-center gap-3 text-center px-6">
                    <MapIcon className="w-10 h-10 text-gray-300 dark:text-gray-600" />
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Noch keine Adressen geocodiert.
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Wir nutzen OpenStreetMap (Nominatim) mit einer Anfrage pro Sekunde.
                        Bei {geoStatus?.total_with_address ?? 0} Adressen dauert das ca.{" "}
                        {Math.ceil((geoStatus?.total_with_address ?? 0) / 60)} Minuten.
                      </p>
                    </div>
                    {geoStatus && geoStatus.pending > 0 && !geoStatus.running && (
                      <button
                        type="button"
                        onClick={handleStartGeocode}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-svu-600 hover:bg-svu-700 rounded-lg"
                      >
                        <Play className="w-4 h-4" /> Geocoding starten
                      </button>
                    )}
                  </div>
                ) : (
                  <MemberMap
                    points={geoPoints}
                    onSelectMember={setSelectedAdrNr}
                    mode={mapMode}
                    className="h-[500px] relative z-0"
                  />
                )}
                {geoLoading && (
                  <div className="absolute top-3 right-3 bg-white/90 dark:bg-gray-800/90 rounded-lg px-3 py-1.5 text-xs flex items-center gap-2 shadow z-10">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Karte wird geladen
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Filter / Search */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Name, Mitglieds-Nr., Ort oder E-Mail"
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-svu-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={includeResigned}
                onChange={(e) => {
                  setIncludeResigned(e.target.checked);
                  setPage(1);
                }}
                className="rounded border-gray-300"
              />
              Ausgetretene anzeigen
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => {
                  setIncludeDeleted(e.target.checked);
                  setPage(1);
                }}
                className="rounded border-gray-300"
              />
              Gelöschte anzeigen
            </label>
            <button
              type="submit"
              className="px-3 py-2 text-sm bg-svu-600 text-white rounded-lg hover:bg-svu-700"
            >
              Suchen
            </button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                  setPage(1);
                }}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300"
              >
                Filter zurücksetzen
              </button>
            )}
          </form>
        </div>

        {/* Members table */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
          {list && list.items.length === 0 ? (
            <div className="p-12 text-center">
              <Database className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {stats?.total_members === 0
                  ? "Noch keine Daten importiert. Bitte eine SQL-Datei hochladen."
                  : "Keine Mitglieder gefunden."}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900 text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Mitglieds-Nr.</th>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Ort</th>
                      <th className="px-4 py-3 font-medium">Eintritt</th>
                      <th className="px-4 py-3 font-medium">Geburtsdatum</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {list?.items.map((m) => {
                      const status = statusLabel(m);
                      return (
                        <tr
                          key={m.adr_nr}
                          onClick={() => setSelectedAdrNr(m.adr_nr)}
                          className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">
                            {m.mitgliedsnummer || `#${m.adr_nr}`}
                          </td>
                          <td className="px-4 py-3 text-gray-900 dark:text-gray-100">
                            {[m.vorname, m.nachname].filter(Boolean).join(" ") || ""}
                          </td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                            {[m.plz, m.ort].filter(Boolean).join(" ") || ""}
                          </td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                            {formatDate(m.eintritt)}
                          </td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                            {formatDate(m.geburtsdatum)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs ${status.color}`}>
                              {status.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {list && list.total > PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-3 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm">
                  <div className="text-gray-600 dark:text-gray-400">
                    Seite {list.page} von {totalPages} · {list.total} Einträge
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {selectedAdrNr !== null && (
        <MemberDetailDrawer
          loading={detailLoading}
          member={selectedMember}
          onClose={() => setSelectedAdrNr(null)}
        />
      )}

      {geoStatus?.running && (
        <GeocodeMiniStatus status={geoStatus} onStop={handleStopGeocode} />
      )}

      {exporting && geoPoints.length > 0 && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            left: "-20000px",
            top: 0,
            pointerEvents: "none",
          }}
        >
          <MemberMapPoster
            ref={posterRef}
            width={1600}
            height={1000}
            meta={{
              clubName: club.club_name || "Sportverein",
              memberCount: geoPoints.length,
              locationCount,
              generatedAt: new Date(),
            }}
          >
            <MemberMap
              ref={exportMapRef}
              points={geoPoints}
              onSelectMember={() => undefined}
              mode={mapMode}
              className="h-full w-full"
            />
          </MemberMapPoster>
        </div>
      )}
    </div>
  );
}

function GeocodeMiniStatus({
  status,
  onStop,
}: {
  status: LwGeocodeStatus;
  onStop: () => void;
}) {
  const pct = status.total > 0 ? (status.processed / status.total) * 100 : 0;
  return (
    <div className="fixed bottom-4 right-4 z-30 w-72 bg-white dark:bg-gray-800 border border-svu-200 dark:border-svu-800 rounded-xl shadow-lg p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-svu-700 dark:text-svu-300">
          <MapIcon className="w-3.5 h-3.5" />
          Geocoding läuft
        </div>
        <button
          type="button"
          onClick={onStop}
          className="text-[11px] text-red-600 hover:text-red-700 dark:text-red-400"
          title="Anhalten"
        >
          Anhalten
        </button>
      </div>
      <div className="flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-300 mb-1">
        <span>
          {status.processed} / {status.total}
        </span>
        <span className="font-medium">{formatEta(status.processed, status.total)}</span>
      </div>
      <div className="h-1 w-full rounded-full bg-svu-100 dark:bg-svu-900 overflow-hidden">
        <div
          className="h-full bg-svu-600 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold ${accent ?? "text-gray-900 dark:text-white"}`}>
        {value.toLocaleString("de-DE")}
      </div>
    </div>
  );
}

function MemberDetailDrawer({
  loading,
  member,
  onClose,
}: {
  loading: boolean;
  member: LwMemberDetail | null;
  onClose: () => void;
}) {
  useBodyOverlay();
  useEscapeKey(true, onClose);

  return (
    <div
      className="fixed inset-0 z-40 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Mitglied-Details"
    >
      <div
        className="flex-1 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="w-full max-w-2xl bg-white dark:bg-gray-800 shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {member
                ? [member.vorname, member.nachname].filter(Boolean).join(" ") || `AdrNr ${member.adr_nr}`
                : "Lädt..."}
            </h2>
            {member?.mitgliedsnummer && (
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                Mitglieds-Nr. {member.mitgliedsnummer}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            aria-label="Schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {loading || !member ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="w-6 h-6 text-svu-600 animate-spin" />
            </div>
          ) : (
            <>
              <Section title="Stammdaten">
                <Field label="Anrede" value={member.anrede} />
                <Field label="Titel" value={member.titel} />
                <Field label="Vorname" value={member.vorname} />
                <Field label="Nachname" value={member.nachname} />
                <Field label="Geborene" value={member.geborene} />
                <Field label="Geburtsdatum" value={formatDate(member.geburtsdatum)} icon={<CalendarDays className="w-3.5 h-3.5" />} />
                <Field label="Geburtsort" value={member.geburtsort} />
                <Field label="Abteilung" value={member.abteilung} />
              </Section>

              <Section title="Anschrift">
                <Field
                  label="Straße"
                  value={[member.strasse, member.hausnummer].filter(Boolean).join(" ")}
                  icon={<MapPin className="w-3.5 h-3.5" />}
                />
                <Field label="PLZ / Ort" value={[member.plz, member.ort].filter(Boolean).join(" ")} />
                <Field label="Land" value={member.land} />
                <Field label="c/o" value={member.co} />
              </Section>

              <Section title="Kontakt">
                <Field label="Telefon" value={member.telefon} icon={<Phone className="w-3.5 h-3.5" />} />
                <Field label="Mobil" value={member.telefon_mobil} />
                <Field label="E-Mail" value={member.email} icon={<Mail className="w-3.5 h-3.5" />} />
              </Section>

              <Section title="Mitgliedschaft">
                <Field label="Eintritt" value={formatDate(member.eintritt)} />
                <Field label="Austritt" value={formatDate(member.austritt)} />
                <Field label="Verstorben am" value={formatDate(member.verstorben_am)} />
                <Field label="Status (Aktiv/Pasiv)" value={member.aktiv_pasiv} />
                <Field label="Bereich" value={member.bereich} />
                <Field
                  label="Gelöscht-Flag"
                  value={member.geloscht ? "Ja" : "Nein"}
                />
              </Section>

              <Section title="Bankverbindung">
                <Field label="Bank" value={member.bank} />
                <Field label="IBAN" value={member.iban} mono />
                <Field label="BIC" value={member.bic} mono />
                <Field label="Abw. Kontoinhaber" value={member.abw_kontoinhaber} />
                <Field label="Mandatsreferenz" value={member.mandatsreferenz} mono />
              </Section>

              {member.contracts.length > 0 && (
                <Section title={`Verträge (${member.contracts.length})`}>
                  <div className="col-span-full overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="text-gray-500 dark:text-gray-400">
                        <tr className="text-left">
                          <th className="py-2 pr-3">Nr.</th>
                          <th className="py-2 pr-3">Art</th>
                          <th className="py-2 pr-3">Betrag</th>
                          <th className="py-2 pr-3">Zahlweise</th>
                          <th className="py-2 pr-3">Beginn</th>
                          <th className="py-2 pr-3">Ende</th>
                          <th className="py-2 pr-3">Gekündigt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-300">
                        {member.contracts.map((c) => (
                          <tr key={c.id}>
                            <td className="py-2 pr-3 font-mono">{c.vertrag_nr || ""}</td>
                            <td className="py-2 pr-3">{c.art_name || c.art || ""}</td>
                            <td className="py-2 pr-3">
                              {c.betrag != null
                                ? c.betrag.toLocaleString("de-DE", { style: "currency", currency: "EUR" })
                                : ""}
                            </td>
                            <td className="py-2 pr-3">{c.sollstellung || ""}</td>
                            <td className="py-2 pr-3">{formatDate(c.vertrag_begin)}</td>
                            <td className="py-2 pr-3">{formatDate(c.vertrag_ende)}</td>
                            <td className="py-2 pr-3">{formatDate(c.gekuend_zum)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {member.sepa_mandates.length > 0 && (
                <Section title={`SEPA-Mandate (${member.sepa_mandates.length})`}>
                  <div className="col-span-full overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="text-gray-500 dark:text-gray-400">
                        <tr className="text-left">
                          <th className="py-2 pr-3">Mandats-Nr.</th>
                          <th className="py-2 pr-3">Art</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2 pr-3">Angelegt</th>
                          <th className="py-2 pr-3">Unterschrift</th>
                          <th className="py-2 pr-3">Letzte Nutzung</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-300">
                        {member.sepa_mandates.map((s) => (
                          <tr key={s.id}>
                            <td className="py-2 pr-3 font-mono">{s.mandats_nr || ""}</td>
                            <td className="py-2 pr-3">{s.lastschriftart || ""}</td>
                            <td className="py-2 pr-3">{s.status || ""}</td>
                            <td className="py-2 pr-3">{formatDate(s.angelegt_am)}</td>
                            <td className="py-2 pr-3">{formatDate(s.unterschrift_datum)}</td>
                            <td className="py-2 pr-3">{formatDate(s.letzte_verwendung)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              <div className="text-xs text-gray-400 dark:text-gray-500 pt-2 border-t dark:border-gray-700">
                Importiert am {formatDateTime(member.imported_at)} · AdrNr {member.adr_nr}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  icon,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        {icon}
        {label}
      </div>
      <div
        className={`text-sm text-gray-900 dark:text-gray-100 break-words ${mono ? "font-mono" : ""}`}
      >
        {value || <span className="text-gray-400" aria-label="keine Angabe">·</span>}
      </div>
    </div>
  );
}
