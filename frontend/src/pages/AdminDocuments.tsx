import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAdmin } from "../context/AdminContext";
import {
  getApplications,
  adminUploadDocument,
  getCancellationDocuments,
  deleteApplicationUpload,
  deleteApplicationApproved,
  deleteCancellationDocument,
  type ApplicationResponse,
  type CancellationLetterResponse,
} from "../services/api";
import {
  ArrowLeft,
  RefreshCw,
  FileText,
  Eye,
  Download,
  Upload,
  CheckCircle2,
  Clock,
  X,
  Trash2,
} from "lucide-react";

const DOC_FILTER_OPTIONS = [
  { value: "all", label: "Alle" },
  { value: "with", label: "Mit Dokument" },
  { value: "without", label: "Ohne Dokument" },
];

function formatDate(ts: string | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function UploadCell({ app, onDone }: { app: ApplicationResponse; onDone: (updated: ApplicationResponse) => void }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const updated = await adminUploadDocument(app.id, file);
      toast.success(`Dokument für ${app.vorname} ${app.nachname} hochgeladen`);
      onDone(updated);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
    }
  }, [app.id, app.vorname, app.nachname, onDone]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-2 text-center transition-colors cursor-pointer text-xs
        ${dragging ? "border-svu-500 bg-svu-50" : "border-gray-300 hover:border-svu-400 hover:bg-gray-50"}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !uploading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      {uploading ? (
        <RefreshCw className="h-4 w-4 animate-spin text-svu-600" />
      ) : (
        <>
          <Upload className="h-4 w-4 text-gray-400" />
          <span className="text-gray-500">PDF / Bild</span>
        </>
      )}
    </div>
  );
}

export default function AdminDocuments() {
  const { isAuthenticated } = useAdmin();
  const [apps, setApps] = useState<ApplicationResponse[]>([]);
  const [cancellations, setCancellations] = useState<CancellationLetterResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [docFilter, setDocFilter] = useState<"all" | "with" | "without">("all");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [appsResult, cancellationsResult] = await Promise.allSettled([
        getApplications(1, 500),
        getCancellationDocuments(500),
      ]);

      if (appsResult.status === "fulfilled") {
        setApps(appsResult.value.items);
      } else {
        setApps([]);
        toast.error("Antragsdokumente konnten nicht geladen werden");
      }

      if (cancellationsResult.status === "fulfilled") {
        setCancellations(cancellationsResult.value);
      } else {
        setCancellations([]);
        toast.error("Kündigungsdokumente konnten nicht geladen werden");
      }
    } catch {
      setApps([]);
      setCancellations([]);
      toast.error("Daten konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchAll();
  }, [isAuthenticated, fetchAll]);

  const handleUploaded = useCallback((updated: ApplicationResponse) => {
    setApps((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }, []);

  const handleDeleteUpload = useCallback(async (app: ApplicationResponse) => {
    if (!app.uploaded_file) return;
    if (!window.confirm(`Dokument von ${app.vorname} ${app.nachname} wirklich löschen?`)) return;
    try {
      await deleteApplicationUpload(app.id);
      toast.success("Dokument gelöscht");
      setApps((prev) =>
        prev.map((a) =>
          a.id === app.id ? { ...a, uploaded_file: null, uploaded_at: null } : a
        )
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Löschen fehlgeschlagen");
    }
  }, []);

  const handleDeleteApproved = useCallback(async (app: ApplicationResponse) => {
    if (!app.admin_approved_file) return;
    if (!window.confirm(`Genehmigungsdokument von ${app.vorname} ${app.nachname} wirklich löschen?`)) return;
    try {
      await deleteApplicationApproved(app.id);
      toast.success("Genehmigungsdokument gelöscht");
      setApps((prev) =>
        prev.map((a) =>
          a.id === app.id ? { ...a, admin_approved_file: null } : a
        )
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Löschen fehlgeschlagen");
    }
  }, []);

  const handleDeleteCancellation = useCallback(async (doc: CancellationLetterResponse) => {
    if (!window.confirm(`Kündigungsbestätigung von ${doc.vorname} ${doc.nachname} wirklich löschen?`)) return;
    try {
      await deleteCancellationDocument(doc.id);
      toast.success("Kündigungsbestätigung gelöscht");
      setCancellations((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Löschen fehlgeschlagen");
    }
  }, []);

  const filtered = apps.filter((a) => {
    if (docFilter === "with") return !!a.uploaded_file;
    if (docFilter === "without") return !a.uploaded_file;
    return true;
  });

  const signatureSourceLabel = (source: string) => {
    if (source === "request") return "Manuell (Zeichnen/Bild)";
    if (source === "admin_saved") return "Gespeicherte Admin-Signatur";
    return "Keine";
  };

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
            <FileText className="h-5 w-5 text-svu-600" />
            <h1 className="text-lg font-semibold text-gray-900">Dokumente</h1>
          </div>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-gray-200 hover:bg-gray-100 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Aktualisieren
        </button>
      </header>

      {/* Filter bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex flex-wrap gap-2 items-center">
        {DOC_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setDocFilter(opt.value as typeof docFilter)}
            className={`px-3 py-1 text-sm rounded-full transition-colors ${
              docFilter === opt.value
                ? "bg-svu-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="text-sm text-gray-500 ml-auto">
          {filtered.length} Einträge
        </span>
      </div>

      {/* Membership documents table */}
      <div className="p-4">
        {loading ? (
          <div className="flex justify-center py-16 text-gray-400">
            <RefreshCw className="h-6 w-6 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            Keine Einträge gefunden.
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Antragsnr.</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden md:table-cell">Eingereicht</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Dokument</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Genehmigung</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden md:table-cell">Hochgeladen am</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((app) => (
                  <tr key={app.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/applications/${app.id}`}
                        className="text-svu-600 hover:underline font-mono text-xs"
                      >
                        {app.antragsnummer ?? `#${app.id}`}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      {app.nachname}, {app.vorname}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell whitespace-nowrap">
                      {formatDate(app.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {app.uploaded_file ? (
                        <span className="inline-flex items-center gap-1 text-green-700 text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Vorhanden
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
                          <Clock className="h-3.5 w-3.5" />
                          Ausstehend
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {app.admin_approved_file ? (
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`/api/admin/applications/${app.id}/approved`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Genehmigungsdokument anzeigen"
                            className="p-1.5 rounded-md text-svu-600 hover:bg-svu-50 transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </a>
                          <a
                            href={`/api/admin/applications/${app.id}/approved`}
                            download
                            title="Genehmigungsdokument herunterladen"
                            className="p-1.5 rounded-md text-gray-600 hover:bg-gray-100 transition-colors"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                          <button
                            onClick={() => handleDeleteApproved(app)}
                            title="Genehmigungsdokument löschen"
                            className="p-1.5 rounded-md text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs" aria-label="kein Dokument" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell whitespace-nowrap">
                      {formatDate(app.uploaded_at)}
                    </td>
                    <td className="px-4 py-3">
                      {app.uploaded_file ? (
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`/api/admin/applications/${app.id}/upload`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Anzeigen"
                            className="p-1.5 rounded-md text-svu-600 hover:bg-svu-50 transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </a>
                          <a
                            href={`/api/admin/applications/${app.id}/upload`}
                            download
                            title="Herunterladen"
                            className="p-1.5 rounded-md text-gray-600 hover:bg-gray-100 transition-colors"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                          <button
                            title="Ersetzen"
                            onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file";
                              input.accept = ".pdf,.jpg,.jpeg,.png,.heic,.heif";
                              input.onchange = async () => {
                                const file = input.files?.[0];
                                if (!file) return;
                                try {
                                  const updated = await adminUploadDocument(app.id, file);
                                  toast.success("Dokument ersetzt");
                                  handleUploaded(updated);
                                } catch (e: unknown) {
                                  toast.error(e instanceof Error ? e.message : "Upload fehlgeschlagen");
                                }
                              };
                              input.click();
                            }}
                            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteUpload(app)}
                            title="Dokument löschen"
                            className="p-1.5 rounded-md text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="w-32">
                          <UploadCell app={app} onDone={handleUploaded} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cancellation letters table */}
      <div className="px-4 pb-6">
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">Kündigungsbestätigungen</h2>
            <span className="text-xs text-gray-500">{cancellations.length} Einträge</span>
          </div>
          {loading ? (
            <div className="flex justify-center py-10 text-gray-400">
              <RefreshCw className="h-5 w-5 animate-spin" />
            </div>
          ) : cancellations.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              Noch keine gespeicherten Kündigungsbestätigungen.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden md:table-cell">Austritt</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden lg:table-cell">Signatur</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Erstellt am</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cancellations.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      {doc.nachname}, {doc.vorname}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell whitespace-nowrap">
                      {doc.austritt_datum}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                      {signatureSourceLabel(doc.signature_source)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {formatDate(doc.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`/api/admin/cancellation-documents/${doc.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Anzeigen"
                          className="p-1.5 rounded-md text-svu-600 hover:bg-svu-50 transition-colors"
                        >
                          <Eye className="h-4 w-4" />
                        </a>
                        <a
                          href={`/api/admin/cancellation-documents/${doc.id}/download`}
                          download
                          title="Herunterladen"
                          className="p-1.5 rounded-md text-gray-600 hover:bg-gray-100 transition-colors"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                        <button
                          onClick={() => handleDeleteCancellation(doc)}
                          title="Kündigungsbestätigung löschen"
                          className="p-1.5 rounded-md text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
