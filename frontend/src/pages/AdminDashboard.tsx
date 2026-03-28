import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { useAdmin } from "../context/AdminContext";
import {
  getApplications,
  getAdminStats,
  getTestData,
  formatFee,
  type ApplicationResponse,
  type ApplicationListResponse,
  type AdminStatsResponse,
} from "../services/api";
import { captureEvent } from "../lib/analytics";
import {
  Search,
  Download,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FileText,
  RefreshCw,
  Mail,
  MailX,
  FileCheck,
  FileX,
  UserX,
  BarChart3,
  CalendarDays,
  Euro,
  Users,
  FlaskConical,
} from "lucide-react";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  neu: { label: "Neu", color: "bg-blue-100 text-blue-700" },
  dokument_hochgeladen: { label: "Dok. hochgeladen", color: "bg-cyan-100 text-cyan-700" },
  in_bearbeitung: { label: "In Bearbeitung", color: "bg-amber-100 text-amber-700" },
  genehmigt: { label: "Genehmigt", color: "bg-green-100 text-green-700" },
  abgelehnt: { label: "Abgelehnt", color: "bg-red-100 text-red-700" },
};

export default function AdminDashboard() {
  const { logout } = useAdmin();
  const navigate = useNavigate();
  const [data, setData] = useState<ApplicationListResponse | null>(null);
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [showTestFilter, setShowTestFilter] = useState<boolean | null>(null); // null = show all, true = only test, false = hide test
  const [testModeType, setTestModeType] = useState<"einzel" | "kind" | "familie">("einzel");
  const [launchingTest, setLaunchingTest] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [result, statsResult] = await Promise.all([
        getApplications(
          page,
          25,
          statusFilter || undefined,
          search || undefined,
          showTestFilter
        ),
        getAdminStats(),
      ]);
      setData(result);
      setStats(statsResult);
      captureEvent("admin_dashboard_loaded", {
        app_area: "admin",
        page,
        status_filter: statusFilter || "all",
        search_present: Boolean(search),
        result_count: result.items.length,
      });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search, showTestFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const handleLogout = async () => {
    await logout();
    navigate("/admin/login");
  };

  const handleLaunchTestMode = async () => {
    setLaunchingTest(true);
    try {
      const testData = await getTestData(testModeType);
      sessionStorage.setItem("svums_test_data", JSON.stringify(testData));
      window.open("/", "_blank");
    } catch (err: any) {
      toast.error(err.message || "Testdaten konnten nicht geladen werden");
    } finally {
      setLaunchingTest(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / data.per_page) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">
              SVUMS Admin
            </h1>
            <p className="text-xs text-gray-500">Mitgliederverwaltung</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Test Application */}
            <div className="flex items-center gap-1.5 border-r pr-2 mr-1">
              <select
                value={testModeType}
                onChange={(e) => setTestModeType(e.target.value as "einzel" | "kind" | "familie")}
                className="text-xs border border-gray-300 rounded px-1.5 py-1.5 bg-white"
              >
                <option value="einzel">Einzel</option>
                <option value="kind">Kind</option>
                <option value="familie">Familie</option>
              </select>
              <button
                onClick={handleLaunchTestMode}
                disabled={launchingTest}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors disabled:opacity-50"
                title="Testantrag mit Beispieldaten öffnen"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                {launchingTest ? "Laden..." : "Testantrag"}
              </button>
            </div>
            <Link
              to="/admin/documents"
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              title="Dokumente verwalten"
            >
              <FileText className="w-4 h-4" /> Dokumente
            </Link>
            <Link
              to="/admin/email-log"
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              title="E-Mail-Log anzeigen"
            >
              <Mail className="w-4 h-4" /> E-Mail-Log
            </Link>
            <Link
              to="/admin/cancellation"
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              title="Kündigungsbestätigung erstellen"
            >
              <UserX className="w-4 h-4" /> Kündigung
            </Link>
            <Link
              to="/admin/settings"
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Einstellungen"
            >
              <Settings className="w-5 h-5" />
            </Link>
            <a
              href="/api/admin/export"
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              title="CSV Export"
            >
              <Download className="w-4 h-4" /> Export
            </a>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" /> Abmelden
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <form onSubmit={handleSearch} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Name, E-Mail oder Ort suchen..."
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-svu-600 rounded-lg hover:bg-svu-700 transition-colors"
            >
              Suchen
            </button>
          </form>

          <div className="flex gap-2 flex-wrap">
            {["", "neu", "dokument_hochgeladen", "in_bearbeitung", "genehmigt", "abgelehnt"].map((s) => (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(s);
                  setPage(1);
                }}
                className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                  statusFilter === s
                    ? "bg-svu-600 text-white border-svu-600"
                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {s ? STATUS_LABELS[s].label : "Alle"}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              setShowTestFilter((prev) =>
                prev === null ? true : prev === true ? false : null
              );
              setPage(1);
            }}
            className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
              showTestFilter === true
                ? "bg-orange-100 text-orange-700 border-orange-300"
                : showTestFilter === false
                ? "bg-gray-100 text-gray-500 border-gray-300"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}
            title={
              showTestFilter === null
                ? "Alle anzeigen — klicken für nur Testanträge"
                : showTestFilter
                ? "Nur Testanträge — klicken für ohne Testanträge"
                : "Ohne Testanträge — klicken für alle"
            }
          >
            <FlaskConical className="w-3.5 h-3.5" />
            {showTestFilter === null
              ? "Test: Alle"
              : showTestFilter
              ? "Test: Nur"
              : "Test: Aus"}
          </button>

          <button
            onClick={fetchData}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Aktualisieren"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <BarChart3 className="w-4 h-4" />
                <span className="text-xs font-medium">Gesamt</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            </div>
            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <CalendarDays className="w-4 h-4" />
                <span className="text-xs font-medium">Diesen Monat</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.applications_this_month}</p>
            </div>
            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Euro className="w-4 h-4" />
                <span className="text-xs font-medium">Einnahmen (genehmigt)</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{formatFee(stats.revenue_approved)}</p>
            </div>
            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <span className="text-xs font-medium">Status-Verteilung</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(STATUS_LABELS).map(([key, { label, color }]) => (
                  <span
                    key={key}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${color}`}
                  >
                    {stats.by_status[key] ?? 0} {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Detailed Stats Toggle */}
        {stats && (
          <div className="mb-6">
            <button
              onClick={() => setShowDetailedStats(!showDetailedStats)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 transition-colors mb-3"
            >
              <Users className="w-4 h-4" />
              <span className="font-medium">Detaillierte Statistiken</span>
              {showDetailedStats ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showDetailedStats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Abteilungen */}
                <div className="bg-white rounded-xl border shadow-sm p-4">
                  <h3 className="text-xs font-medium text-gray-500 mb-3">Anträge pro Abteilung</h3>
                  {Object.keys(stats.by_abteilung).length === 0 ? (
                    <p className="text-sm text-gray-400">Keine Daten</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(stats.by_abteilung)
                        .sort(([, a], [, b]) => b - a)
                        .map(([abt, count]) => (
                          <div key={abt} className="flex items-center justify-between">
                            <span className="text-sm text-gray-700 truncate mr-2">{abt}</span>
                            <span className="text-sm font-semibold text-gray-900 shrink-0">{count}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* Altersgruppen */}
                <div className="bg-white rounded-xl border shadow-sm p-4">
                  <h3 className="text-xs font-medium text-gray-500 mb-3">Altersverteilung</h3>
                  <div className="space-y-2">
                    {Object.entries(stats.by_age_group).map(([group, count]) => {
                      const max = Math.max(...Object.values(stats.by_age_group), 1);
                      return (
                        <div key={group}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-sm text-gray-700">{group}</span>
                            <span className="text-sm font-semibold text-gray-900">{count}</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div
                              className="bg-svu-500 h-1.5 rounded-full transition-all"
                              style={{ width: `${(count / max) * 100}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Mitgliedschaftstyp */}
                <div className="bg-white rounded-xl border shadow-sm p-4">
                  <h3 className="text-xs font-medium text-gray-500 mb-3">Mitgliedschaftstyp</h3>
                  {Object.keys(stats.by_membership_type).length === 0 ? (
                    <p className="text-sm text-gray-400">Keine Daten</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(stats.by_membership_type)
                        .sort(([, a], [, b]) => b - a)
                        .map(([typ, count]) => {
                          const labels: Record<string, string> = {
                            kind: "Kind",
                            jugendlich: "Jugendlich",
                            junger_erwachsener: "Junger Erwachsener",
                            erwachsener: "Erwachsener",
                            familie: "Familie",
                          };
                          return (
                            <div key={typ} className="flex items-center justify-between">
                              <span className="text-sm text-gray-700">{labels[typ] || typ}</span>
                              <span className="text-sm font-semibold text-gray-900">{count}</span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>

                {/* Geschlecht */}
                <div className="bg-white rounded-xl border shadow-sm p-4">
                  <h3 className="text-xs font-medium text-gray-500 mb-3">Geschlecht</h3>
                  {Object.keys(stats.by_gender).length === 0 ? (
                    <p className="text-sm text-gray-400">Keine Daten</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(stats.by_gender)
                        .sort(([, a], [, b]) => b - a)
                        .map(([g, count]) => (
                          <div key={g} className="flex items-center justify-between">
                            <span className="text-sm text-gray-700">{g}</span>
                            <span className="text-sm font-semibold text-gray-900">{count}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">
                    #
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden md:table-cell">
                    E-Mail
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden lg:table-cell">
                    Abteilung
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">
                    Beitrag
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">
                    Status
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 hidden md:table-cell" title="E-Mail / Upload">
                    ✉️
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden sm:table-cell">
                    Datum
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                      Lade Daten...
                    </td>
                  </tr>
                )}
                {!loading && data?.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                      <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      Keine Anträge gefunden
                    </td>
                  </tr>
                )}
                {!loading &&
                  data?.items.map((app) => (
                    <tr
                      key={app.id}
                      onClick={() =>
                        navigate(`/admin/applications/${app.id}`)
                      }
                      className={`border-b hover:bg-gray-50 cursor-pointer transition-colors ${
                        app.is_test ? "bg-orange-50/60" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-gray-500 font-mono">
                        {app.id}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <span className="flex items-center gap-1.5">
                          {app.is_test && (
                            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded bg-orange-100 text-orange-700 shrink-0">
                              TEST
                            </span>
                          )}
                          {app.nachname}, {app.vorname}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                        {app.email}
                      </td>
                      <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                        {app.abteilungen.join(", ")}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {formatFee(app.jahresbeitrag)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                            STATUS_LABELS[app.status]?.color ||
                            "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {STATUS_LABELS[app.status]?.label || app.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex items-center justify-center gap-1.5">
                          {app.email_sent ? (
                            <span title="E-Mail gesendet"><Mail className="w-3.5 h-3.5 text-green-500" /></span>
                          ) : (
                            <span title="E-Mail ausstehend"><MailX className="w-3.5 h-3.5 text-amber-500" /></span>
                          )}
                          {app.uploaded_file ? (
                            <span title="Dokument hochgeladen"><FileCheck className="w-3.5 h-3.5 text-green-500" /></span>
                          ) : (
                            <span title="Kein Upload"><FileX className="w-3.5 h-3.5 text-gray-300" /></span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                        {new Date(app.created_at).toLocaleDateString("de-DE")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" /> Zurück
              </button>
              <span className="text-sm text-gray-500">
                Seite {page} von {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Weiter <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
