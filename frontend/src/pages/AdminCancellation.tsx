import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Download, FileText, Loader2 } from "lucide-react";
import { extractApiError } from "../services/api";

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

    setLoading(true);
    try {
      const response = await fetch("/api/admin/cancellation-pdf", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          mitgliedsnummer: form.mitgliedsnummer || null,
          abteilung: form.abteilung || null,
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
    } catch (err: any) {
      toast.error(err.message || "PDF konnte nicht erstellt werden.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setForm({ ...EMPTY_FORM });
    setErrors({});
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

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 mt-8 pt-6 border-t">
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
