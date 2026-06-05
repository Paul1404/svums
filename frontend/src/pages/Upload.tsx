import { useParams, Link } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { ApiError } from "../services/api";
import {
  captureEvent,
  normalizeFailureReason,
} from "../lib/analytics";
import { useClubConfig } from "../context/ClubConfigContext";
import {
  Upload as UploadIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  ArrowLeft,
  X,
} from "lucide-react";

interface UploadInfo {
  antragsnummer: string;
  vorname: string;
  nachname: string;
  antragstyp: string;
  already_uploaded: boolean;
  uploaded_at: string | null;
}

export default function UploadPage() {
  const club = useClubConfig();
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<UploadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/upload/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new ApiError(data.detail || "Ungültiger Upload-Link", res.status);
        }
        return res.json();
      })
      .then((data) => {
        setInfo(data);
        captureEvent("membership_upload_page_loaded", {
          app_area: "public",
          antragsnummer: data.antragsnummer,
          already_uploaded: Boolean(data.already_uploaded),
          antragstyp: data.antragstyp,
        });
        if (data.already_uploaded) setSuccess(true);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleUpload = async () => {
    if (!file || !token) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/upload/${token}`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(data.detail || `Fehler: ${res.status}`, res.status);
      }
      setSuccess(true);
    } catch (err: any) {
      captureEvent("membership_upload_failed", {
        app_area: "public",
        http_status: err instanceof ApiError ? err.status : null,
        reason:
          err instanceof ApiError
            ? normalizeFailureReason(err.status)
            : "server_error",
      });
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const ALLOWED = ".pdf, .jpg, .jpeg, .png, .heic, .heif";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-svu-600" />
      </div>
    );
  }

  if (!info && error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-xl mx-auto px-4 mt-12">
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              Ungültiger Link
            </h2>
            <p className="text-gray-600 mb-6">
              Dieser Upload-Link ist ungültig oder abgelaufen.
            </p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-svu-600 hover:text-svu-700 font-medium"
            >
              <ArrowLeft className="w-4 h-4" /> Zur Startseite
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-xl mx-auto px-4 mt-8">
        <div className="bg-white rounded-xl shadow-sm border p-8">
          {/* Application info */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <span className="text-gray-500">Antragsnummer:</span>
              <span className="font-medium font-mono">
                {info?.antragsnummer}
              </span>
              <span className="text-gray-500">Antragsteller:</span>
              <span className="font-medium">
                {info?.nachname}, {info?.vorname}
              </span>
            </div>
          </div>

          {success ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Dokument erfolgreich hochgeladen!
              </h2>
              <p className="text-gray-600 mb-2">
                Vielen Dank! Ihre unterschriebene Beitrittserklärung ist bei uns
                eingegangen.
              </p>
              {info?.already_uploaded && info.uploaded_at && (
                <p className="text-xs text-gray-400 mb-6">
                  Hochgeladen am{" "}
                  {new Date(info.uploaded_at).toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
              {!info?.already_uploaded && (
                <p className="text-xs text-gray-400 mb-6">
                  Gerade eben hochgeladen
                </p>
              )}
              <Link
                to="/"
                className="inline-flex items-center gap-2 text-svu-600 hover:text-svu-700 font-medium"
              >
                <ArrowLeft className="w-4 h-4" /> Zur Startseite
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Unterschriebene Beitrittserklärung hochladen
              </h2>
              <p className="text-sm text-gray-500 mb-6">
                Bitte laden Sie Ihre ausgedruckte, unterschriebene
                Beitrittserklärung als Scan oder Foto hoch.
              </p>

              {/* Drop zone */}
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={`
                  border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
                  ${dragActive ? "border-svu-500 bg-svu-50" : "border-gray-300 hover:border-svu-400 hover:bg-gray-50"}
                  ${file ? "border-green-400 bg-green-50" : ""}
                `}
                onClick={() =>
                  document.getElementById("file-input")?.click()
                }
              >
                <input
                  id="file-input"
                  type="file"
                  accept={ALLOWED}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) setFile(e.target.files[0]);
                  }}
                />
                {file ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="w-8 h-8 text-green-600" />
                    <div className="text-left">
                      <p className="font-medium text-gray-900">{file.name}</p>
                      <p className="text-xs text-gray-500">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                      }}
                      className="ml-2 p-1 rounded-full hover:bg-gray-200"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>
                ) : (
                  <>
                    <UploadIcon className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    <p className="font-medium text-gray-700 mb-1">
                      Datei hierher ziehen oder klicken
                    </p>
                    <p className="text-xs text-gray-400">
                      PDF, JPG, PNG oder HEIC · max. 20 MB
                    </p>
                  </>
                )}
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleUpload}
                disabled={!file || uploading}
                className="mt-6 w-full py-3 px-4 bg-svu-600 text-white font-medium rounded-lg hover:bg-svu-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Wird hochgeladen…</span>
                  </>
                ) : (
                  <>
                    <UploadIcon className="w-4 h-4" />
                    <span>Hochladen</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>

        <footer className="text-center text-xs text-gray-400 py-8 space-y-1">
          <img
            src="/logo_svu-241x300.png"
            alt={club.club_abbreviation}
            className="h-10 w-auto mx-auto mb-2 opacity-40"
          />
          <p className="font-medium text-gray-500">
            {club.club_name}
          </p>
          <p>{club.club_address}</p>
          <p className="pt-2 space-x-3">
            <a
              href={club.impressum_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-svu-600 underline"
            >
              Impressum
            </a>
            <a
              href={club.datenschutz_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-svu-600 underline"
            >
              Datenschutz
            </a>
            <a
              href={club.satzung_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-svu-600 underline"
            >
              Satzung
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}

function Header() {
  const club = useClubConfig();
  return (
    <header className="bg-svu-600 text-white shadow-lg">
      <div className="max-w-3xl mx-auto px-4 py-5 flex items-center gap-4">
        <Link
          to="/"
          className="p-2 -ml-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors flex-shrink-0"
          title="Zur Startseite"
          aria-label="Zur Startseite"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <img
          src="/logo_svu-241x300.png"
          alt={club.club_name}
          className="h-14 w-auto drop-shadow-md"
        />
        <div>
          <h1 className="text-2xl font-bold">{club.club_name}</h1>
          <p className="text-svu-200 mt-0.5 text-sm">Dokument hochladen</p>
        </div>
      </div>
    </header>
  );
}
