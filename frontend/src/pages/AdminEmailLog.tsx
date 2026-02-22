import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAdmin } from "../context/AdminContext";
import { getEmailLogs, type EmailLogEntry } from "../services/api";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Mail,
} from "lucide-react";

const EMAIL_TYPE_LABELS: Record<string, string> = {
  application_club: "Verein",
  application_applicant: "Antragsteller",
  upload_notification: "Upload",
  status_update: "Statusänderung",
  test: "Test",
};

const STATUS_OPTIONS = [
  { value: "", label: "Alle Status" },
  { value: "success", label: "Gesendet" },
  { value: "failed", label: "Fehler" },
];

const TYPE_OPTIONS = [
  { value: "", label: "Alle Typen" },
  { value: "application_club", label: "Verein" },
  { value: "application_applicant", label: "Antragsteller" },
  { value: "upload_notification", label: "Upload" },
  { value: "status_update", label: "Statusänderung" },
  { value: "test", label: "Test" },
];

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function StatusBadge({ status }: { status: "success" | "failed" }) {
  if (status === "success") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
        <CheckCircle2 className="h-3 w-3" />
        Gesendet
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
      <XCircle className="h-3 w-3" />
      Fehler
    </span>
  );
}

export default function AdminEmailLog() {
  const { isAuthenticated } = useAdmin();
  const [logs, setLogs] = useState<EmailLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchLogs = useCallback(async (status: string, emailType: string) => {
    setLoading(true);
    try {
      const data = await getEmailLogs({
        status: status || undefined,
        email_type: emailType || undefined,
      });
      setLogs(data);
    } catch {
      toast.error("E-Mail-Log konnte nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchLogs(statusFilter, typeFilter);
  }, [isAuthenticated, statusFilter, typeFilter, fetchLogs]);

  const toggleRow = (id: number) =>
    setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/admin"
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-svu-600" />
            <h1 className="text-lg font-semibold text-gray-900">E-Mail-Log</h1>
          </div>
        </div>
        <button
          onClick={() => fetchLogs(statusFilter, typeFilter)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-gray-200 hover:bg-gray-100 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Aktualisieren
        </button>
      </header>

      {/* Filter bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex flex-wrap gap-3 items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-svu-500"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-svu-500"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <span className="text-sm text-gray-500 ml-auto">
          {logs.length} Einträge
        </span>
      </div>

      {/* Table */}
      <div className="p-4">
        {loading ? (
          <div className="flex justify-center py-16 text-gray-400">
            <RefreshCw className="h-6 w-6 animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            Keine Einträge gefunden.
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-6"></th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">
                    Zeitpunkt
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">
                    Typ
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">
                    Empfänger
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden md:table-cell">
                    Betreff
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden md:table-cell">
                    Antrag
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <>
                    <tr
                      key={log.id}
                      className={`hover:bg-gray-50 ${log.status === "failed" ? "cursor-pointer" : ""}`}
                      onClick={() =>
                        log.status === "failed" ? toggleRow(log.id) : undefined
                      }
                    >
                      <td className="px-4 py-2.5 text-gray-400">
                        {log.status === "failed" &&
                          (expandedId === log.id ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          ))}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">
                        {EMAIL_TYPE_LABELS[log.email_type] ?? log.email_type}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 max-w-[180px] truncate">
                        {log.recipient}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 hidden md:table-cell max-w-[200px] truncate">
                        {log.subject ?? "–"}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 hidden md:table-cell">
                        {log.antragsnummer ? (
                          <Link
                            to={`/admin/applications/${log.antragsnummer}`}
                            className="text-svu-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {log.antragsnummer}
                          </Link>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={log.status} />
                      </td>
                    </tr>
                    {expandedId === log.id && log.error_message && (
                      <tr key={`${log.id}-err`} className="bg-red-50">
                        <td colSpan={7} className="px-8 py-3">
                          <p className="text-xs font-medium text-red-700 mb-1">
                            Fehlermeldung
                          </p>
                          <pre className="text-xs text-red-600 whitespace-pre-wrap break-all font-mono">
                            {log.error_message}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
