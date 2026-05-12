import { useState, useRef, useMemo, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Copy,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ScanText,
  Trash2,
  Upload,
} from "lucide-react";
import {
  createLegacyApplication,
  getApplication,
  getApplicationOcr,
  ocrPreview,
  type ApplicationResponse,
  type ChildData,
  type LegacyApplicationData,
} from "../services/api";
import { useClubConfig } from "../context/ClubConfigContext";
import { errorMessage } from "../lib/utils";

type Antragstyp = "einzel" | "kind" | "familie";

const TYP_LABEL: Record<string, string> = {
  kind: "Kind (bis 14 Jahre)",
  jugendlich: "Jugendlich (bis 18 Jahre)",
  junger_erwachsener: "Junger Erwachsener (bis 25 Jahre)",
  erwachsener: "Erwachsener",
  familie: "Familie",
};

const ALLOWED_EXTS = [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif"];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

function calcAgeStichtag(birth: string): number {
  if (!birth) return 0;
  const b = new Date(birth);
  const stichtag = new Date(new Date().getFullYear(), 0, 1);
  let age = stichtag.getFullYear() - b.getFullYear();
  if (
    stichtag.getMonth() < b.getMonth() ||
    (stichtag.getMonth() === b.getMonth() && stichtag.getDate() < b.getDate())
  )
    age--;
  return age;
}

function determineMitgliedschaftTyp(birth: string, antragstyp: Antragstyp): string {
  if (antragstyp === "familie") return "familie";
  const age = calcAgeStichtag(birth);
  if (age < 14) return "kind";
  if (age < 18) return "jugendlich";
  if (age < 25) return "junger_erwachsener";
  return "erwachsener";
}

function emptyChild(): ChildData {
  return { vorname: "", nachname: "", geburtsdatum: "", abteilungen: [] };
}

export default function AdminLegacyApplication() {
  const navigate = useNavigate();
  const club = useClubConfig();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchParams] = useSearchParams();

  // When ?from=<id> is set we replace an existing placeholder application
  // (created by the public /papier-antrag upload) in-place: same antragsnummer,
  // same scan, but the admin transcribes the data. No re-upload required.
  const fromIdRaw = searchParams.get("from");
  const fromId = fromIdRaw && /^\d+$/.test(fromIdRaw) ? parseInt(fromIdRaw, 10) : null;
  const [placeholder, setPlaceholder] = useState<ApplicationResponse | null>(null);
  const [placeholderLoading, setPlaceholderLoading] = useState<boolean>(fromId !== null);
  const [placeholderError, setPlaceholderError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // OCR state — for the picked file (fresh upload) or for the placeholder's
  // existing scan (replace mode).
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrAvailable, setOcrAvailable] = useState<boolean | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const [antragstyp, setAntragstyp] = useState<Antragstyp>("einzel");
  const [geschlecht, setGeschlecht] = useState<"Herr" | "Frau" | "keine Angabe" | "">("");
  const [vorname, setVorname] = useState("");
  const [nachname, setNachname] = useState("");
  const [geburtsdatum, setGeburtsdatum] = useState("");
  const [strasse, setStrasse] = useState("");
  const [plz, setPlz] = useState("");
  const [ort, setOrt] = useState("");
  const [telefon, setTelefon] = useState("");
  const [email, setEmail] = useState("");
  const [abteilungen, setAbteilungen] = useState<string[]>([]);
  const [elternteilMitglied, setElternteilMitglied] = useState<boolean | null>(null);

  const [erzVorname, setErzVorname] = useState("");
  const [erzNachname, setErzNachname] = useState("");

  const [partnerVorname, setPartnerVorname] = useState("");
  const [partnerNachname, setPartnerNachname] = useState("");
  const [partnerGeburtsdatum, setPartnerGeburtsdatum] = useState("");
  const [partnerAbteilungen, setPartnerAbteilungen] = useState<string[]>([]);
  const [kinder, setKinder] = useState<ChildData[]>([emptyChild()]);

  const [kontoinhaber, setKontoinhaber] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [kreditinstitut, setKreditinstitut] = useState("");

  const [signedOn, setSignedOn] = useState("");

  const mitgliedschaftTyp = useMemo(
    () => (geburtsdatum ? determineMitgliedschaftTyp(geburtsdatum, antragstyp) : ""),
    [geburtsdatum, antragstyp]
  );

  // Load the placeholder application when ?from=<id> is set. Prefill the
  // applicant email if the public uploader provided one and validate that
  // the row is actually a paper-scan placeholder.
  useEffect(() => {
    if (fromId === null) return;
    let cancelled = false;
    setPlaceholderLoading(true);
    setPlaceholderError(null);
    getApplication(fromId)
      .then((app) => {
        if (cancelled) return;
        if (app.status !== "scan_eingegangen" || app.source !== "legacy") {
          setPlaceholderError(
            "Dieser Antrag ist kein Papier-Platzhalter — bitte regulär bearbeiten."
          );
          setPlaceholder(null);
          return;
        }
        setPlaceholder(app);
        if (app.email) setEmail(app.email);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPlaceholderError(errorMessage(err, "Platzhalter konnte nicht geladen werden"));
      })
      .finally(() => {
        if (!cancelled) setPlaceholderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromId]);

  const handleFile = (f: File | null) => {
    // Reset OCR state on every (re)selection — stale text for the previous
    // file would mislead the admin.
    setOcrText(null);
    setOcrAvailable(null);
    setOcrError(null);

    if (!f) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      toast.error(`Nicht erlaubtes Dateiformat. Erlaubt: ${ALLOWED_EXTS.join(", ")}`);
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      toast.error("Datei zu groß (max. 20 MB)");
      return;
    }
    setFile(f);
    // Preview both images and PDFs via blob URL — admins can read the scan
    // while transcribing fields below.
    if (f.type.startsWith("image/") || f.type === "application/pdf") {
      const url = URL.createObjectURL(f);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
    if (errors.file) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.file;
        return next;
      });
    }
  };

  const toggleAbteilung = (
    abt: string,
    selected: string[],
    setSelected: (v: string[]) => void
  ) => {
    if (selected.includes(abt)) setSelected(selected.filter((a) => a !== abt));
    else setSelected([...selected, abt]);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!file && !placeholder) {
      errs.file = "Bitte einen Scan der Beitrittserklärung hochladen";
    }
    if (!vorname.trim()) errs.vorname = "Pflichtfeld";
    if (!nachname.trim()) errs.nachname = "Pflichtfeld";
    if (!geburtsdatum) errs.geburtsdatum = "Pflichtfeld";
    if (!strasse.trim() || strasse.trim().length < 5)
      errs.strasse = "Bitte vollständige Straße und Hausnummer angeben";
    if (!/^\d{5}$/.test(plz)) errs.plz = "PLZ muss 5 Ziffern haben";
    if (!ort.trim()) errs.ort = "Pflichtfeld";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Ungültige E-Mail";
    if (abteilungen.length === 0) errs.abteilungen = "Mindestens eine Abteilung wählen";
    if (!iban.trim()) errs.iban = "Pflichtfeld";

    if (antragstyp === "kind") {
      if (!erzVorname.trim()) errs.erzVorname = "Pflichtfeld";
      if (!erzNachname.trim()) errs.erzNachname = "Pflichtfeld";
    }
    if (antragstyp === "familie") {
      if (!partnerVorname.trim()) errs.partnerVorname = "Pflichtfeld";
      if (!partnerNachname.trim()) errs.partnerNachname = "Pflichtfeld";
      if (!partnerGeburtsdatum) errs.partnerGeburtsdatum = "Pflichtfeld";
      const validKinder = kinder.filter(
        (k) => k.vorname.trim() && k.nachname.trim() && k.geburtsdatum
      );
      if (validKinder.length === 0) errs.kinder = "Mindestens ein Kind erforderlich";
      validKinder.forEach((k, i) => {
        if (k.abteilungen.length === 0)
          errs[`kind_${i}_abteilungen`] = "Abteilung wählen";
      });
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      toast.error("Bitte überprüfen Sie die rot markierten Felder");
      return;
    }
    // Either a freshly uploaded scan OR a placeholder whose scan we reuse.
    if (!file && !placeholder) return;

    setSubmitting(true);
    try {
      const data: LegacyApplicationData = {
        antragstyp,
        geschlecht: geschlecht || null,
        vorname: vorname.trim(),
        nachname: nachname.trim(),
        geburtsdatum,
        strasse: strasse.trim(),
        plz: plz.trim(),
        ort: ort.trim(),
        telefon: telefon.trim() || null,
        email: email.trim() || null,
        abteilungen,
        mitgliedschaft_typ: mitgliedschaftTyp,
        elternteil_mitglied: antragstyp === "kind" ? elternteilMitglied : null,
        erziehungsberechtigter_vorname: antragstyp === "kind" ? erzVorname.trim() : null,
        erziehungsberechtigter_nachname: antragstyp === "kind" ? erzNachname.trim() : null,
        partner_vorname: antragstyp === "familie" ? partnerVorname.trim() : null,
        partner_nachname: antragstyp === "familie" ? partnerNachname.trim() : null,
        partner_geburtsdatum: antragstyp === "familie" ? partnerGeburtsdatum : null,
        partner_abteilungen: antragstyp === "familie" ? partnerAbteilungen : null,
        kinder:
          antragstyp === "familie"
            ? kinder
                .filter((k) => k.vorname.trim() && k.nachname.trim() && k.geburtsdatum)
                .map((k) => ({
                  vorname: k.vorname.trim(),
                  nachname: k.nachname.trim(),
                  geburtsdatum: k.geburtsdatum,
                  abteilungen: k.abteilungen,
                }))
            : null,
        kontoinhaber: kontoinhaber.trim() || null,
        iban: iban.replace(/\s/g, "").toUpperCase(),
        bic: bic.trim().toUpperCase() || null,
        kreditinstitut: kreditinstitut.trim() || null,
        signed_on: signedOn || null,
      };

      const created = await createLegacyApplication(
        data,
        file,
        placeholder ? placeholder.id : undefined
      );
      toast.success(
        placeholder
          ? "Papier-Antrag erfasst"
          : "Legacy-Antrag erfolgreich angelegt"
      );
      navigate(`/admin/applications/${created.id}`);
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Antrag konnte nicht angelegt werden"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/admin"
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Zurück zur Übersicht"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Papier-Antrag erfassen</h1>
            <p className="text-xs text-gray-500">
              Gescannte Beitrittserklärung hochladen und Daten manuell erfassen
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {placeholderLoading && (
          <div className="bg-white rounded-xl shadow-sm border p-10 flex items-center justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Platzhalter wird geladen…
          </div>
        )}
        {placeholderError && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {placeholderError}{" "}
            <Link to="/admin" className="underline font-medium">
              Zurück zur Übersicht
            </Link>
          </div>
        )}
        {!placeholderLoading && !placeholderError && (
        <div className="bg-white rounded-xl shadow-sm border p-6 space-y-6">
          {/* Info box */}
          <div className="flex gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <FileText className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 space-y-1">
              {placeholder ? (
                <>
                  <p>
                    <strong>
                      Sie erfassen einen vom Antragsteller hochgeladenen Papier-Scan
                      ({placeholder.antragsnummer}).
                    </strong>{" "}
                    Der Scan unten ist bereits hinterlegt — Sie können ihn
                    weiterverwenden oder optional durch eine bessere Version
                    ersetzen.
                  </p>
                  <p>
                    Beim Speichern wird der Platzhalter <em>an Ort und Stelle</em>{" "}
                    durch den vollständigen Antrag ersetzt. Antragsnummer und Scan
                    bleiben dabei erhalten.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <strong>Für papierhafte Beitrittserklärungen.</strong> Es werden
                    keine automatischen Bestätigungs-E-Mails versandt — die
                    unterschriebene Papier-Erklärung gilt als rechtsgültiger Beleg
                    und wird hochgeladen.
                  </p>
                  <p>
                    Die Datenschutz- und Satzungserklärung gelten durch die
                    Unterschrift auf dem Papier-Formular automatisch als anerkannt.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* File upload */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">
              1. Scan der Beitrittserklärung{" "}
              {placeholder ? (
                <span className="text-xs text-gray-500 normal-case">
                  (bereits hochgeladen)
                </span>
              ) : (
                <span className="text-red-500">*</span>
              )}
            </h3>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_EXTS.join(",")}
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            {placeholder && !file && (
              <div className="mb-3 rounded-lg border border-gray-200 p-2 bg-gray-50">
                <ExistingScanPreview applicationId={placeholder.id} filename={placeholder.uploaded_file ?? ""} />
              </div>
            )}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
                errors.file
                  ? "border-red-400 bg-red-50"
                  : file
                  ? "border-green-400 bg-green-50"
                  : "border-gray-300 hover:border-svu-400 hover:bg-gray-50"
              }`}
            >
              <Upload className="w-6 h-6 text-gray-500" />
              {file ? (
                <>
                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB · Klicken zum Ersetzen
                  </p>
                </>
              ) : placeholder ? (
                <>
                  <p className="text-sm font-medium text-gray-700">
                    Scan ersetzen (optional)
                  </p>
                  <p className="text-xs text-gray-500">
                    Nur falls der bereits hochgeladene Scan nicht ausreicht — PDF,
                    JPG, PNG, HEIC · max. 20 MB
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-700">
                    Datei auswählen oder hierher ziehen
                  </p>
                  <p className="text-xs text-gray-500">
                    PDF, JPG, PNG, HEIC · max. 20 MB
                  </p>
                </>
              )}
            </div>
            {errors.file && (
              <p className="mt-1.5 text-xs text-red-600">{errors.file}</p>
            )}
            {previewUrl && (
              <div className="mt-3 rounded-lg border border-gray-200 p-2 bg-gray-50">
                {file?.type === "application/pdf" ? (
                  <iframe
                    src={previewUrl}
                    title="Scan-Vorschau"
                    className="w-full h-[600px] rounded border border-gray-200 bg-white"
                  />
                ) : (
                  <img
                    src={previewUrl}
                    alt="Vorschau"
                    className="max-h-[600px] w-full object-contain"
                  />
                )}
              </div>
            )}
            {(file || (placeholder && !file)) && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      setOcrLoading(true);
                      setOcrError(null);
                      try {
                        const res = file
                          ? await ocrPreview(file)
                          : placeholder
                          ? await getApplicationOcr(placeholder.id, false)
                          : null;
                        if (!res) return;
                        setOcrAvailable(res.available);
                        setOcrText(res.text);
                        if (!res.available) {
                          setOcrError(res.error ?? "OCR nicht verfügbar.");
                        }
                      } catch (err: unknown) {
                        const msg =
                          err instanceof Error
                            ? err.message
                            : "OCR fehlgeschlagen";
                        setOcrError(msg);
                        setOcrAvailable(false);
                      } finally {
                        setOcrLoading(false);
                      }
                    }}
                    disabled={ocrLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-svu-700 bg-svu-50 hover:bg-svu-100 border border-svu-200 rounded transition-colors disabled:opacity-50"
                    title="Text aus dem Scan auslesen (zum Abtippen)"
                  >
                    {ocrLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ScanText className="w-3.5 h-3.5" />
                    )}
                    {ocrText !== null && !ocrLoading
                      ? "OCR neu auslesen"
                      : "Text per OCR auslesen"}
                  </button>
                  {ocrText && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(ocrText);
                          toast.success("OCR-Text kopiert");
                        } catch {
                          toast.error("Kopieren fehlgeschlagen");
                        }
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:text-svu-700 hover:bg-gray-100 rounded transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" /> Alles kopieren
                    </button>
                  )}
                </div>
                {ocrLoading && (
                  <div className="rounded-lg border border-gray-200 p-3 bg-white text-xs text-gray-500 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Text wird ausgelesen…
                  </div>
                )}
                {!ocrLoading && ocrAvailable === false && (
                  <div className="rounded-lg border border-amber-200 p-3 bg-amber-50 text-xs text-amber-800">
                    <strong>OCR nicht verfügbar:</strong>{" "}
                    {ocrError ?? "Tesseract ist auf diesem Server nicht installiert."}
                  </div>
                )}
                {!ocrLoading && ocrAvailable !== false && ocrText !== null && (
                  <div className="rounded-lg border border-gray-200 bg-white">
                    <div className="px-3 py-2 border-b text-[11px] text-gray-500 flex items-center gap-2">
                      <RefreshCw className="w-3 h-3" />
                      Maschinell ausgelesen — bitte mit dem Scan abgleichen, bevor
                      Sie etwas übernehmen.
                    </div>
                    {ocrText.trim() ? (
                      <pre className="max-h-72 overflow-auto p-3 whitespace-pre-wrap font-mono text-xs text-gray-800 select-text">
                        {ocrText}
                      </pre>
                    ) : (
                      <p className="p-3 text-xs text-gray-400">
                        Kein lesbarer Text erkannt.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Antragstyp */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">
              2. Antragstyp
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "einzel", label: "Einzel" },
                { value: "kind", label: "Kind / Jugendl." },
                { value: "familie", label: "Familie" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAntragstyp(opt.value as Antragstyp)}
                  className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                    antragstyp === opt.value
                      ? "bg-svu-600 text-white border-svu-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Personal data */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">
              3. Persönliche Daten
              {antragstyp === "kind" && (
                <span className="ml-2 text-xs text-gray-500 normal-case">
                  (des Kindes)
                </span>
              )}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Anrede
                </label>
                <div className="flex gap-3 flex-wrap">
                  {(["Herr", "Frau", "keine Angabe"] as const).map((g) => (
                    <label key={g} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        checked={geschlecht === g}
                        onChange={() => setGeschlecht(g)}
                      />
                      {g}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField
                  label="Vorname"
                  required
                  value={vorname}
                  onChange={setVorname}
                  error={errors.vorname}
                />
                <FormField
                  label="Nachname"
                  required
                  value={nachname}
                  onChange={setNachname}
                  error={errors.nachname}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField
                  label="Geburtsdatum"
                  type="date"
                  required
                  value={geburtsdatum}
                  onChange={setGeburtsdatum}
                  error={errors.geburtsdatum}
                />
                {mitgliedschaftTyp && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Kategorie (auto)
                    </label>
                    <div className="px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                      {TYP_LABEL[mitgliedschaftTyp] || mitgliedschaftTyp}
                    </div>
                  </div>
                )}
              </div>

              <FormField
                label="Straße und Hausnummer"
                required
                value={strasse}
                onChange={setStrasse}
                error={errors.strasse}
              />
              <div className="grid grid-cols-3 gap-3">
                <FormField
                  label="PLZ"
                  required
                  value={plz}
                  onChange={(v) => setPlz(v.replace(/\D/g, "").slice(0, 5))}
                  error={errors.plz}
                  className="col-span-1"
                />
                <FormField
                  label="Ort"
                  required
                  value={ort}
                  onChange={setOrt}
                  error={errors.ort}
                  className="col-span-2"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField
                  label="Telefon"
                  type="tel"
                  value={telefon}
                  onChange={setTelefon}
                />
                <FormField
                  label="E-Mail"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  error={errors.email}
                  placeholder="Optional — leer lassen wenn nicht angegeben"
                />
              </div>
            </div>
          </section>

          {/* Guardian for Kind */}
          {antragstyp === "kind" && (
            <section>
              <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">
                Erziehungsberechtigte/r
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField
                  label="Vorname"
                  required
                  value={erzVorname}
                  onChange={setErzVorname}
                  error={errors.erzVorname}
                />
                <FormField
                  label="Nachname"
                  required
                  value={erzNachname}
                  onChange={setErzNachname}
                  error={errors.erzNachname}
                />
              </div>
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Elternteil ist Mitglied?
                </label>
                <div className="flex gap-3">
                  {[
                    { v: true, label: "Ja" },
                    { v: false, label: "Nein" },
                  ].map((o) => (
                    <label key={o.label} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        checked={elternteilMitglied === o.v}
                        onChange={() => setElternteilMitglied(o.v)}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Partner + Kinder for Familie */}
          {antragstyp === "familie" && (
            <>
              <section>
                <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">
                  Partner / 2. Elternteil
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField
                    label="Vorname"
                    required
                    value={partnerVorname}
                    onChange={setPartnerVorname}
                    error={errors.partnerVorname}
                  />
                  <FormField
                    label="Nachname"
                    required
                    value={partnerNachname}
                    onChange={setPartnerNachname}
                    error={errors.partnerNachname}
                  />
                </div>
                <div className="mt-3">
                  <FormField
                    label="Geburtsdatum"
                    type="date"
                    required
                    value={partnerGeburtsdatum}
                    onChange={setPartnerGeburtsdatum}
                    error={errors.partnerGeburtsdatum}
                  />
                </div>
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    Abteilungen Partner
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {club.departments.map((abt) => (
                      <button
                        key={abt}
                        type="button"
                        onClick={() =>
                          toggleAbteilung(abt, partnerAbteilungen, setPartnerAbteilungen)
                        }
                        className={`px-2.5 py-1 text-xs font-medium rounded-full border ${
                          partnerAbteilungen.includes(abt)
                            ? "bg-svu-600 text-white border-svu-600"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {abt}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">
                    Kinder
                  </h3>
                  <button
                    type="button"
                    onClick={() => setKinder([...kinder, emptyChild()])}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-svu-700 bg-svu-50 border border-svu-200 rounded hover:bg-svu-100"
                  >
                    <Plus className="w-3 h-3" /> Kind hinzufügen
                  </button>
                </div>
                {errors.kinder && (
                  <p className="mb-2 text-xs text-red-600">{errors.kinder}</p>
                )}
                <div className="space-y-3">
                  {kinder.map((k, i) => (
                    <div
                      key={i}
                      className="border border-gray-200 rounded-lg p-3 bg-gray-50"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-600">
                          Kind {i + 1}
                        </span>
                        {kinder.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setKinder(kinder.filter((_, j) => j !== i))}
                            className="p-1 text-red-500 hover:text-red-700 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <FormField
                          label="Vorname"
                          value={k.vorname}
                          onChange={(v) => {
                            const next = [...kinder];
                            next[i] = { ...k, vorname: v };
                            setKinder(next);
                          }}
                          dense
                        />
                        <FormField
                          label="Nachname"
                          value={k.nachname}
                          onChange={(v) => {
                            const next = [...kinder];
                            next[i] = { ...k, nachname: v };
                            setKinder(next);
                          }}
                          dense
                        />
                      </div>
                      <div className="mt-2">
                        <FormField
                          label="Geburtsdatum"
                          type="date"
                          value={k.geburtsdatum}
                          onChange={(v) => {
                            const next = [...kinder];
                            next[i] = { ...k, geburtsdatum: v };
                            setKinder(next);
                          }}
                          dense
                        />
                      </div>
                      <div className="mt-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Abteilungen
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {club.departments.map((abt) => (
                            <button
                              key={abt}
                              type="button"
                              onClick={() => {
                                const next = [...kinder];
                                const sel = k.abteilungen.includes(abt)
                                  ? k.abteilungen.filter((a) => a !== abt)
                                  : [...k.abteilungen, abt];
                                next[i] = { ...k, abteilungen: sel };
                                setKinder(next);
                              }}
                              className={`px-2 py-0.5 text-xs font-medium rounded-full border ${
                                k.abteilungen.includes(abt)
                                  ? "bg-svu-600 text-white border-svu-600"
                                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                              }`}
                            >
                              {abt}
                            </button>
                          ))}
                        </div>
                        {errors[`kind_${i}_abteilungen`] && (
                          <p className="mt-1 text-xs text-red-600">
                            {errors[`kind_${i}_abteilungen`]}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* Abteilungen */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">
              4. Abteilung(en){" "}
              {antragstyp === "familie" && (
                <span className="text-xs text-gray-500 normal-case">
                  (Hauptmitglied)
                </span>
              )}
            </h3>
            <div className="flex flex-wrap gap-2">
              {club.departments.map((abt) => (
                <button
                  key={abt}
                  type="button"
                  onClick={() => toggleAbteilung(abt, abteilungen, setAbteilungen)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-full border ${
                    abteilungen.includes(abt)
                      ? "bg-svu-600 text-white border-svu-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {abt}
                </button>
              ))}
            </div>
            {errors.abteilungen && (
              <p className="mt-1.5 text-xs text-red-600">{errors.abteilungen}</p>
            )}
          </section>

          {/* SEPA */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">
              5. SEPA-Daten
            </h3>
            <div className="space-y-3">
              <FormField
                label="Kontoinhaber"
                value={kontoinhaber}
                onChange={setKontoinhaber}
                placeholder="Falls abweichend von Antragsteller"
              />
              <FormField
                label="IBAN"
                required
                value={iban}
                onChange={setIban}
                error={errors.iban}
                mono
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="BIC" value={bic} onChange={setBic} mono />
                <FormField
                  label="Kreditinstitut"
                  value={kreditinstitut}
                  onChange={setKreditinstitut}
                />
              </div>
            </div>
          </section>

          {/* Signed on */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">
              6. Datum der Unterschrift{" "}
              <span className="text-xs text-gray-500 normal-case">(optional)</span>
            </h3>
            <FormField
              label="Datum der Original-Unterschrift auf dem Papier-Antrag"
              type="date"
              value={signedOn}
              onChange={setSignedOn}
            />
            <p className="mt-1 text-xs text-gray-500">
              Falls leer, wird das heutige Datum verwendet.
            </p>
          </section>

          {/* Submit */}
          <div className="pt-4 border-t flex gap-3">
            <Link
              to={placeholder ? `/admin/applications/${placeholder.id}` : "/admin"}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 text-center"
            >
              Abbrechen
            </Link>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-svu-600 rounded-lg hover:bg-svu-700 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {placeholder ? "Antrag speichern" : "Antrag anlegen"}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function ExistingScanPreview({
  applicationId,
  filename,
}: {
  applicationId: number;
  filename: string;
}) {
  const src = `/api/admin/applications/${applicationId}/upload`;
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const isPdf = ext === "pdf";
  const isImage = ["jpg", "jpeg", "png", "heic", "heif"].includes(ext);
  return (
    <div>
      <div className="px-2 py-1 text-[11px] text-gray-500 font-medium flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" />
        Bereits hochgeladener Scan ({filename || "unbekannte Datei"})
      </div>
      {isPdf ? (
        <iframe
          src={src}
          title="Hochgeladener Scan"
          className="w-full h-[600px] rounded border border-gray-200 bg-white"
        />
      ) : isImage ? (
        <img
          src={src}
          alt="Hochgeladener Scan"
          className="max-h-[600px] w-full object-contain rounded border border-gray-200 bg-white"
        />
      ) : (
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="block p-4 text-sm text-svu-700 underline"
        >
          Vorschau für dieses Format nicht möglich — im neuen Tab öffnen
        </a>
      )}
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  error,
  placeholder,
  className,
  mono = false,
  dense = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  error?: string;
  placeholder?: string;
  className?: string;
  mono?: boolean;
  dense?: boolean;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 ${dense ? "py-1.5" : "py-2"} text-sm border rounded-lg focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none ${
          mono ? "font-mono" : ""
        } ${error ? "border-red-400" : "border-gray-300"}`}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
