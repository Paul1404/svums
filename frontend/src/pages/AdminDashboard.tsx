import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { useAdmin } from "../context/AdminContext";
import {
  getApplications,
  getAdminStats,
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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [result, statsResult] = await Promise.all([
        getApplications(
          page,
          25,
          statusFilter || undefined,
          search || undefined
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
  }, [page, statusFilter, search]);

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
                      className="border-b hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 text-gray-500 font-mono">
                        {app.id}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {app.nachname}, {app.vorname}
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
