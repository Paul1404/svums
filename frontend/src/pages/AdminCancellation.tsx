import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Download, FileText, Loader2, PenLine, Trash2, Upload } from "lucide-react";
import SignatureCanvasType from "react-signature-canvas";
// CJS interop: Vite 8/Rolldown may wrap the CJS module so the default import
// is a namespace object { default: Component } instead of the component itself.
const SignatureCanvas: typeof SignatureCanvasType = typeof SignatureCanvasType === "function"
  ? SignatureCanvasType
  : (SignatureCanvasType as unknown as { default: typeof SignatureCanvasType }).default;
import { extractApiError, getSettings, updateSettings } from "../services/api";
import { getAdminDistinctIdHeader } from "../lib/analytics";

interface CancellationForm {
  anrede: string;
  vorname: string;
  nachname: string;
  strasse: string;
  plz: string;
  ort: string;
  geburtsdatum: string;
  mitgliedsnummer: string;
  abteilung: string;
  austritt_datum: string;
}

const EMPTY_FORM: CancellationForm = {
  anrede: "",
  vorname: "",
  nachname: "",
  strasse: "",
  plz: "",
  ort: "",
  geburtsdatum: "",
  mitgliedsnummer: "",
  abteilung: "",
  austritt_datum: "",
};

export default function AdminCancellation() {
  const [form, setForm] = useState<CancellationForm>({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof CancellationForm, string>>>({});
  const sigCanvasRef = useRef<SignatureCanvasType | null>(null);
  const [sigEmpty, setSigEmpty] = useState(true);
  const [signatureInputMode, setSignatureInputMode] = useState<"draw" | "upload">("draw");
  const [uploadedSigDataUrl, setUploadedSigDataUrl] = useState<string | null>(null);
  const [hasSavedAdminSignature, setHasSavedAdminSignature] = useState(false);
  const [useSavedAdminSignature, setUseSavedAdminSignature] = useState(true);
  const [saveSignatureForFuture, setSaveSignatureForFuture] = useState(false);

  const set = (field: keyof CancellationForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  useEffect(() => {
    getSettings()
      .then((settings) => {
        const hasSaved = !!settings.admin_signature_base64;
        setHasSavedAdminSignature(hasSaved);
        setUseSavedAdminSignature(hasSaved);
      })
      .catch(() => {
        setHasSavedAdminSignature(false);
        setUseSavedAdminSignature(false);
      });
  }, []);

  const handleSignatureUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Bitte ein Bild (PNG/JPG) hochladen.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Signaturbild ist zu groß (max. 10 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setUploadedSigDataUrl(result);
        sigCanvasRef.current?.clear();
        setSigEmpty(true);
      }
    };
    reader.readAsDataURL(file);
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof CancellationForm, string>> = {};
    if (!form.anrede) errs.anrede = "Pflichtfeld";
    if (!form.vorname.trim()) errs.vorname = "Pflichtfeld";
    if (!form.nachname.trim()) errs.nachname = "Pflichtfeld";
    if (!form.strasse.trim()) errs.strasse = "Pflichtfeld";
    if (!form.plz.trim()) errs.plz = "Pflichtfeld";
    if (!form.ort.trim()) errs.ort = "Pflichtfeld";
    if (!form.geburtsdatum.trim()) errs.geburtsdatum = "Pflichtfeld";
    if (!form.austritt_datum.trim()) errs.austritt_datum = "Pflichtfeld";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleGenerate = async () => {
    if (!validate()) return;

    const unterschrift_base64 =
      uploadedSigDataUrl ||
      (!sigEmpty && sigCanvasRef.current && !sigCanvasRef.current.isEmpty()
        ? sigCanvasRef.current.getTrimmedCanvas().toDataURL("image/png")
        : null);

    setLoading(true);
    try {
      const response = await fetch("/api/admin/cancellation-pdf", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...getAdminDistinctIdHeader(),
        },
        body: JSON.stringify({
          ...form,
          mitgliedsnummer: form.mitgliedsnummer || null,
          abteilung: form.abteilung || null,
          unterschrift_base64,
          use_saved_admin_signature: useSavedAdminSignature,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(extractApiError(errData, `Fehler: ${response.status}`));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Kuendigungsbestaetigung_${form.nachname}_${form.vorname}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("PDF wurde erstellt und heruntergeladen.");
      if (saveSignatureForFuture && unterschrift_base64) {
        try {
          await updateSettings({ admin_signature_base64: unterschrift_base64 });
          toast.success("Signatur wurde gespeichert");
          setHasSavedAdminSignature(true);
          setUseSavedAdminSignature(true);
        } catch {
          toast.error("Signatur konnte nicht gespeichert werden");
        }
      }
      setSaveSignatureForFuture(false);
    } catch (err: any) {
      toast.error(err.message || "PDF konnte nicht erstellt werden.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setForm({ ...EMPTY_FORM });
    setErrors({});
    sigCanvasRef.current?.clear();
    setSigEmpty(true);
    setUploadedSigDataUrl(null);
    setSignatureInputMode("draw");
    setSaveSignatureForFuture(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/admin"
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Zurück zur Übersicht"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-gray-900">
              Kündigungsbestätigung erstellen
            </h1>
            <p className="text-xs text-gray-500">
              PDF-Dokument zur Bestätigung einer Mitgliedschaftskündigung generieren
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl shadow-sm border p-6">
          {/* Info box */}
          <div className="flex gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg mb-6">
            <FileText className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-800">
              Füllen Sie die Daten des austretenden Mitglieds aus. Es wird ein
              offizielles Bestätigungsschreiben als PDF erstellt, das Sie
              ausdrucken und versenden können.
            </p>
          </div>

          {/* Form */}
          <div className="space-y-5">
            {/* Anrede */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Anrede <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-4">
                {["Herr", "Frau", "keine Angabe"].map((a) => (
                  <label key={a} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="anrede"
                      value={a}
                      checked={form.anrede === a}
                      onChange={() => set("anrede", a)}
                      className="text-svu-600 focus:ring-svu-500"
                    />
                    <span className="text-sm">{a}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Name row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                label="Vorname"
                required
                value={form.vorname}
                error={errors.vorname}
                onChange={(v) => set("vorname", v)}
              />
              <FormField
                label="Nachname"
                required
                value={form.nachname}
                error={errors.nachname}
                onChange={(v) => set("nachname", v)}
              />
            </div>

            {/* Address */}
            <FormField
              label="Straße und Hausnummer"
              required
              value={form.strasse}
              error={errors.strasse}
              onChange={(v) => set("strasse", v)}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField
                label="PLZ"
                required
                value={form.plz}
                error={errors.plz}
                onChange={(v) => set("plz", v)}
                maxLength={5}
              />
              <div className="sm:col-span-2">
                <FormField
                  label="Ort"
                  required
                  value={form.ort}
                  error={errors.ort}
                  onChange={(v) => set("ort", v)}
                />
              </div>
            </div>

            {/* Dates row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                label="Geburtsdatum"
                required
                value={form.geburtsdatum}
                error={errors.geburtsdatum}
                onChange={(v) => set("geburtsdatum", v)}
                placeholder="TT.MM.JJJJ"
              />
              <FormField
                label="Austritt zum"
                required
                value={form.austritt_datum}
                error={errors.austritt_datum}
                onChange={(v) => set("austritt_datum", v)}
                placeholder="TT.MM.JJJJ"
              />
            </div>

            {/* Optional fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                label="Mitgliedsnummer"
                value={form.mitgliedsnummer}
                onChange={(v) => set("mitgliedsnummer", v)}
                placeholder="Optional"
              />
              <FormField
                label="Abteilung(en)"
                value={form.abteilung}
                onChange={(v) => set("abteilung", v)}
                placeholder="z.B. Fußball, Turnen"
              />
            </div>
          </div>

          {/* Signature */}
          <div className="mt-6 pt-6 border-t">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <PenLine className="w-4 h-4 text-svu-600" />
                Unterschrift (optional)
              </label>
              {(!sigEmpty || uploadedSigDataUrl) && (
                <button
                  type="button"
                  onClick={() => {
                    sigCanvasRef.current?.clear();
                    setSigEmpty(true);
                    setUploadedSigDataUrl(null);
                  }}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Löschen
                </button>
              )}
            </div>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setSignatureInputMode("draw")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  signatureInputMode === "draw"
                    ? "bg-svu-50 border-svu-300 text-svu-700"
                    : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                Zeichnen
              </button>
              <button
                type="button"
                onClick={() => setSignatureInputMode("upload")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  signatureInputMode === "upload"
                    ? "bg-svu-50 border-svu-300 text-svu-700"
                    : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                Bild hochladen
              </button>
            </div>

            {signatureInputMode === "draw" ? (
              <div className="relative rounded-lg border border-gray-300 bg-white overflow-hidden">
                <div className="absolute bottom-8 left-4 right-4 border-b border-dashed border-gray-300 pointer-events-none" />
                <SignatureCanvas
                  ref={sigCanvasRef}
                  penColor="#1a1a1a"
                  canvasProps={{
                    className: "w-full",
                    style: { height: 120, display: "block" },
                  }}
                  onBegin={() => setUploadedSigDataUrl(null)}
                  onEnd={() => setSigEmpty(false)}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-gray-300 bg-white p-3">
                <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                  <Upload className="w-3.5 h-3.5" />
                  Signaturbild auswählen
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleSignatureUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {uploadedSigDataUrl ? (
                  <div className="mt-3 rounded-md border border-gray-200 p-2 bg-gray-50">
                    <img
                      src={uploadedSigDataUrl}
                      alt="Signaturvorschau"
                      className="max-h-24 object-contain"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mt-2">Noch kein Signaturbild ausgewählt.</p>
                )}
              </div>
            )}

            {hasSavedAdminSignature && (
              <label className="mt-3 flex items-start gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={useSavedAdminSignature}
                  onChange={(e) => setUseSavedAdminSignature(e.target.checked)}
                  className="mt-0.5"
                />
                Gespeicherte Admin-Unterschrift verwenden, wenn keine lokale Unterschrift eingegeben wurde.
              </label>
            )}
            {(uploadedSigDataUrl || !sigEmpty) && (
              <label className="mt-3 flex items-start gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={saveSignatureForFuture}
                  onChange={(e) => setSaveSignatureForFuture(e.target.checked)}
                  className="mt-0.5"
                />
                Diese Signatur speichern und für zukünftige Verwendung sperren
              </label>
            )}
            <p className="text-xs text-gray-400 mt-1">
              Unterschrift wird im PDF über der Namenszeile eingebettet.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 mt-6 pt-6 border-t">
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-white bg-svu-600 rounded-lg hover:bg-svu-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {loading ? "Wird erstellt..." : "PDF erstellen & herunterladen"}
            </button>
            <button
              onClick={handleReset}
              disabled={loading}
              className="px-5 py-3 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              Zurücksetzen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Helper component ---- */

function FormField({
  label,
  value,
  error,
  required,
  placeholder,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`w-full px-3 py-2 border rounded-lg text-sm outline-none transition-colors ${
          error
            ? "border-red-400 focus:ring-2 focus:ring-red-300"
            : "border-gray-300 focus:ring-2 focus:ring-svu-500 focus:border-svu-500"
        }`}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
