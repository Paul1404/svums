import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  uploadPaperForm,
} from "../services/api";
import { useClubConfig } from "../context/ClubConfigContext";
import {
  Upload as UploadIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  ArrowLeft,
  Mail,
  ScanLine,
  X,
} from "lucide-react";

const ALLOWED_EXTS = [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif"];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export default function PaperFormUpload() {
  const club = useClubConfig();
  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ antragsnummer: string; emailSent: boolean } | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validate = (f: File): string | null => {
    const ext = "." + (f.name.split(".").pop()?.toLowerCase() ?? "");
    if (!ALLOWED_EXTS.includes(ext)) {
      return `Nicht erlaubtes Dateiformat. Erlaubt: ${ALLOWED_EXTS.join(", ")}`;
    }
    if (f.size > MAX_FILE_SIZE) return "Datei zu groß (max. 20 MB)";
    if (f.size === 0) return "Leere Datei";
    return null;
  };

  const pickFile = (f: File | null) => {
    if (!f) return;
    const err = validate(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(f);
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) pickFile(e.dataTransfer.files[0]);
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      setEmailError("Bitte eine gültige E-Mail-Adresse eingeben oder das Feld leer lassen.");
      return;
    }
    setEmailError(null);
    setUploading(true);
    setError(null);
    try {
      const result = await uploadPaperForm(file, trimmedEmail || undefined);
      setSuccess({ antragsnummer: result.antragsnummer, emailSent: Boolean(trimmedEmail) });
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Upload fehlgeschlagen";
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="max-w-xl mx-auto px-4 mt-8">
        {/* Intro / context box — make it unambiguous that this is for paper scans */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex gap-3">
          <ScanLine className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 space-y-1.5">
            <p className="font-semibold">
              Sie haben die Beitrittserklärung bereits auf Papier ausgefüllt?
            </p>
            <p>
              Hier können Sie einen <strong>Scan oder ein Foto</strong> der
              vollständig ausgefüllten und unterschriebenen Papier-Beitrittserklärung
              hochladen. Sie müssen <strong>kein Formular online ausfüllen</strong>.
            </p>
            <p className="text-xs text-amber-800/80">
              Möchten Sie stattdessen die digitale Beitrittserklärung verwenden?{" "}
              <Link to="/" className="underline font-medium hover:text-amber-900">
                Hier geht es zum Online-Formular.
              </Link>
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6 sm:p-8">
          {success ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Scan erfolgreich hochgeladen
              </h2>
              <p className="text-gray-600 mb-2">
                Vielen Dank! Der Verein hat Ihren Papier-Antrag erhalten und meldet
                sich bei Ihnen. Bitte sorgen Sie dafür, dass auf dem Scan Ihre
                Kontaktdaten gut leserlich sind.
              </p>
              {success.emailSent && (
                <p className="text-xs text-gray-500 mb-2">
                  Eine Bestätigung wurde an die angegebene E-Mail-Adresse gesendet.
                </p>
              )}
              <p className="text-xs text-gray-500 mt-4">
                Vorgangsnummer:{" "}
                <span className="font-mono font-semibold">
                  {success.antragsnummer}
                </span>
              </p>
              <Link
                to="/"
                className="mt-6 inline-flex items-center gap-2 text-svu-600 hover:text-svu-700 font-medium"
              >
                <ArrowLeft className="w-4 h-4" /> Zur Startseite
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                Scan der Papier-Beitrittserklärung hochladen
              </h2>
              <p className="text-sm text-gray-500 mb-6">
                PDF, JPG, PNG oder HEIC, max. 20 MB. Achten Sie auf gute Lesbarkeit
                (insbesondere Name, Adresse, IBAN und Unterschrift).
              </p>

              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  dragActive
                    ? "border-svu-500 bg-svu-50"
                    : file
                    ? "border-green-400 bg-green-50"
                    : "border-gray-300 hover:border-svu-400 hover:bg-gray-50"
                }`}
                onClick={() => document.getElementById("paper-file-input")?.click()}
              >
                <input
                  id="paper-file-input"
                  type="file"
                  accept={ALLOWED_EXTS.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    pickFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                {file ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="w-8 h-8 text-green-600" />
                    <div className="text-left">
                      <p className="font-medium text-gray-900">{file.name}</p>
                      <p className="text-xs text-gray-500">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                      }}
                      className="ml-2 p-1 rounded-full hover:bg-gray-200"
                      aria-label="Datei entfernen"
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
                      Scan oder Foto der unterschriebenen Papier-Beitrittserklärung
                    </p>
                  </>
                )}
              </div>

              <div className="mt-5">
                <label
                  htmlFor="paper-email-input"
                  className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1"
                >
                  <Mail className="w-4 h-4 text-gray-400" />
                  E-Mail-Adresse{" "}
                  <span className="text-xs font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  id="paper-email-input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError(null);
                  }}
                  placeholder="name@beispiel.de"
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none ${
                    emailError ? "border-red-400" : "border-gray-300"
                  }`}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Wenn Sie Ihre E-Mail eintragen, senden wir Ihnen eine Bestätigung
                  über den Eingang des Scans. Andernfalls meldet sich der Verein
                  über die Angaben auf dem Papier-Antrag.
                </p>
                {emailError && (
                  <p className="mt-1 text-xs text-red-600">{emailError}</p>
                )}
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
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
                    <span>Scan hochladen</span>
                  </>
                )}
              </button>

              <p className="mt-4 text-xs text-gray-400 text-center">
                Mit dem Hochladen erklären Sie, dass Sie auf dem Papier-Formular
                der Datenverarbeitung gemäß Datenschutzerklärung zugestimmt haben.
              </p>
            </>
          )}
        </div>

        <Footer />
      </div>
    </div>
  );
}

function Header() {
  const club = useClubConfig();
  return (
    <header className="brand-gradient-bg text-white shadow-lg relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.25),transparent_60%)]" />
      <div className="max-w-3xl mx-auto px-4 py-5 flex items-center gap-4 relative">
        <img
          src="/logo_svu-241x300.png"
          alt={club.club_name}
          className="h-14 w-auto drop-shadow-md"
        />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{club.club_name}</h1>
          <p className="text-white/80 mt-0.5 text-sm">
            Papier-Beitrittserklärung hochladen
          </p>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const club = useClubConfig();
  return (
    <footer className="text-center text-xs text-gray-400 py-8 space-y-1">
      <img
        src="/logo_svu-241x300.png"
        alt={club.club_abbreviation}
        className="h-10 w-auto mx-auto mb-2 opacity-40"
      />
      <p className="font-medium text-gray-500">{club.club_name}</p>
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
  );
}
