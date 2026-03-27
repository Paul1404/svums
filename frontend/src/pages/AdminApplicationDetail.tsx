import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import SignatureCanvasType from "react-signature-canvas";
const SignatureCanvas: typeof SignatureCanvasType = typeof SignatureCanvasType === "function"
  ? SignatureCanvasType
  : (SignatureCanvasType as unknown as { default: typeof SignatureCanvasType }).default;
import {
  getApplication,
  updateApplication,
  deleteApplication,
  resendEmail,
  adminUploadDocument,
  getSettings,
  updateSettings,
  formatFee,
  type ApplicationResponse,
} from "../services/api";
import { captureEvent } from "../lib/analytics";
import {
  ArrowLeft,
  Download,
  Trash2,
  Save,
  Mail,
  MailX,
  Loader2,
  FileCheck,
  Eye,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";

const STATUS_OPTIONS = [
  { value: "neu", label: "Neu", color: "bg-blue-100 text-blue-700" },
  {
    value: "dokument_hochgeladen",
    label: "Dok. hochgeladen",
    color: "bg-cyan-100 text-cyan-700",
  },
  {
    value: "in_bearbeitung",
    label: "In Bearbeitung",
    color: "bg-amber-100 text-amber-700",
  },
  {
    value: "genehmigt",
    label: "Genehmigt",
    color: "bg-green-100 text-green-700",
  },
  {
    value: "abgelehnt",
    label: "Abgelehnt",
    color: "bg-red-100 text-red-700",
  },
];

const TYP_LABELS: Record<string, string> = {
  kind: "Kind (bis 14 Jahre)",
  jugendlich: "Jugendlich (bis 18 Jahre)",
  junger_erwachsener: "Junger Erwachsener (bis 25 Jahre)",
  erwachsener: "Erwachsener",
  familie: "Familie",
};

export default function AdminApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [app, setApp] = useState<ApplicationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadDragging, setUploadDragging] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showDenyModal, setShowDenyModal] = useState(false);
  const [adminDeclineReason, setAdminDeclineReason] = useState("");
  const sigCanvasRef = useRef<SignatureCanvasType | null>(null);
  const [sigEmpty, setSigEmpty] = useState(true);
  const [signatureInputMode, setSignatureInputMode] = useState<"draw" | "upload">("draw");
  const [uploadedSigDataUrl, setUploadedSigDataUrl] = useState<string | null>(null);
  const [hasSavedAdminSignature, setHasSavedAdminSignature] = useState(false);
  const [useSavedAdminSignature, setUseSavedAdminSignature] = useState(true);
  const [saveSignatureForFuture, setSaveSignatureForFuture] = useState(false);

  const handleAdminUpload = async (file: File) => {
    if (!app) return;
    setUploading(true);
    try {
      const updated = await adminUploadDocument(app.id, file);
      setApp(updated);
      setStatus(updated.status);
      toast.success("Dokument hochgeladen");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getApplication(Number(id))
      .then((data) => {
        setApp(data);
        setStatus(data.status);
        setNotes(data.notes || "");
        setAdminDeclineReason(data.admin_decline_reason || "");
        captureEvent("admin_application_viewed", {
          app_area: "admin",
          application_id: data.id,
          status: data.status,
          has_upload: Boolean(data.uploaded_file),
          has_approved_file: Boolean(data.admin_approved_file),
        });
      })
      .catch((err) => {
        toast.error(err.message);
        navigate("/admin");
      })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        setHasSavedAdminSignature(!!settings.admin_signature_base64);
        setUseSavedAdminSignature(!!settings.admin_signature_base64);
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

  const handleSave = async () => {
    if (!app) return;
    const isChangingToApproved = status === "genehmigt" && app.status !== "genehmigt";
    const isChangingToDenied = status === "abgelehnt" && app.status !== "abgelehnt";
    if (isChangingToApproved) {
      setShowApproveModal(true);
      return;
    }
    if (isChangingToDenied) {
      setShowDenyModal(true);
      return;
    }
    await doSave({ status, notes });
  };

  const doSave = async (extra?: {
    status?: string;
    notes?: string;
    admin_unterschrift_base64?: string | null;
    use_saved_admin_signature?: boolean;
    admin_decline_reason?: string | null;
  }) => {
    if (!app) return;
    setSaving(true);
    try {
      const payload: Parameters<typeof updateApplication>[1] = {
        status: extra?.status ?? status,
        notes: extra?.notes ?? notes,
      };
      if (extra?.admin_unterschrift_base64 !== undefined) payload.admin_unterschrift_base64 = extra.admin_unterschrift_base64;
      if (extra?.use_saved_admin_signature !== undefined) payload.use_saved_admin_signature = extra.use_saved_admin_signature;
      if (extra?.admin_decline_reason !== undefined) payload.admin_decline_reason = extra.admin_decline_reason;
      const updated = await updateApplication(app.id, payload);
      setApp(updated);
      setStatus(updated.status);
      setAdminDeclineReason(updated.admin_decline_reason || "");
      setShowApproveModal(false);
      setShowDenyModal(false);
      setAdminDeclineReason("");
      toast.success("Gespeichert");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmApprove = async () => {
    const unterschrift_base64 =
      uploadedSigDataUrl ||
      (!sigEmpty && sigCanvasRef.current && !sigCanvasRef.current.isEmpty()
        ? sigCanvasRef.current.getTrimmedCanvas().toDataURL("image/png")
        : null);
    if (!unterschrift_base64 && !useSavedAdminSignature) {
      toast.error("Bitte Signatur eingeben oder gespeicherte Admin-Signatur verwenden.");
      return;
    }
    await doSave({
      admin_unterschrift_base64: unterschrift_base64 || undefined,
      use_saved_admin_signature: useSavedAdminSignature,
    });
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
  };

  const handleConfirmDeny = async () => {
    if (!adminDeclineReason.trim()) {
      toast.error("Bitte Begründung für die Ablehnung angeben.");
      return;
    }
    await doSave({
      admin_decline_reason: adminDeclineReason.trim(),
    });
  };

  const handleDelete = async () => {
    if (!app) return;
    if (!window.confirm("Antrag wirklich löschen? Dies kann nicht rückgängig gemacht werden.")) return;
    try {
      await deleteApplication(app.id);
      toast.success("Antrag gelöscht");
      navigate("/admin");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-svu-600" />
      </div>
    );
  }

  if (!app) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/admin"
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-lg font-bold text-gray-900">
                {app.antragsnummer || `Antrag #${app.id}`}
              </h1>
              <p className="text-xs text-gray-500">
                {app.nachname}, {app.vorname}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/admin/applications/${app.id}/pdf`}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" /> PDF
            </a>
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Löschen
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main data */}
          <div className="lg:col-span-2 space-y-6">
            <Section title="Persönliche Daten">
              <DataRow label="Name" value={`${app.nachname}, ${app.vorname}`} />
              <DataRow
                label="Geburtsdatum"
                value={new Date(app.geburtsdatum).toLocaleDateString("de-DE")}
              />
              <DataRow label="Adresse" value={`${app.strasse}, ${app.plz} ${app.ort}`} />
              <DataRow label="Telefon" value={app.telefon || "–"} />
              <DataRow label="E-Mail" value={app.email} />
            </Section>

            <Section title="Mitgliedschaft">
              <DataRow label="Antragstyp" value={
                app.antragstyp === "einzel" ? "Einzel" :
                app.antragstyp === "kind" ? "Kind / Jugendliche" :
                app.antragstyp === "familie" ? "Familie" : (app.antragstyp || "–")
              } />
              <DataRow label="Abteilung(en)" value={app.abteilungen.join(", ")} />
              <DataRow
                label="Kategorie"
                value={TYP_LABELS[app.mitgliedschaft_typ] || app.mitgliedschaft_typ}
              />
              {app.elternteil_mitglied !== null && (
                <DataRow
                  label="Elternteil Mitglied"
                  value={app.elternteil_mitglied ? "Ja" : "Nein"}
                />
              )}
              <DataRow
                label="Jahresbeitrag"
                value={formatFee(app.jahresbeitrag)}
                highlight
              />
            </Section>

            {/* Guardian (Kind) */}
            {app.antragstyp === "kind" && app.erziehungsberechtigter_vorname && (
              <Section title="Erziehungsberechtigte/r">
                <DataRow
                  label="Name"
                  value={`${app.erziehungsberechtigter_nachname}, ${app.erziehungsberechtigter_vorname}`}
                />
              </Section>
            )}

            {/* Partner (Familie) */}
            {app.antragstyp === "familie" && app.partner_vorname && app.partner_nachname && (
              <Section title="Partner / 2. Elternteil">
                <DataRow
                  label="Name"
                  value={`${app.partner_nachname}, ${app.partner_vorname}`}
                />
                {app.partner_geburtsdatum && (
                  <DataRow
                    label="Geburtsdatum"
                    value={new Date(app.partner_geburtsdatum).toLocaleDateString("de-DE")}
                  />
                )}
                {app.partner_abteilungen && app.partner_abteilungen.length > 0 && (
                  <DataRow label="Abteilung(en)" value={app.partner_abteilungen.join(", ")} />
                )}
              </Section>
            )}

            {/* Kinder (Familie) */}
            {app.antragstyp === "familie" && app.kinder && app.kinder.length > 0 && (
              <Section title={`Kinder (${app.kinder.length})`}>
                {app.kinder.map((k, i) => (
                  <div key={i} className={i > 0 ? "pt-2 border-t mt-2" : ""}>
                    <DataRow label={`Kind ${i + 1}`} value={`${k.nachname}, ${k.vorname}`} />
                    <DataRow
                      label="Geburtsdatum"
                      value={k.geburtsdatum ? new Date(k.geburtsdatum).toLocaleDateString("de-DE") : "–"}
                    />
                    <DataRow label="Abteilung(en)" value={k.abteilungen.join(", ")} />
                  </div>
                ))}
              </Section>
            )}

            <Section title="SEPA-Daten">
              {app.mandatsreferenz && (
                <DataRow label="Mandatsreferenz" value={app.mandatsreferenz} mono />
              )}
              <DataRow
                label="Kontoinhaber"
                value={app.kontoinhaber || `${app.vorname} ${app.nachname}`}
              />
              <DataRow label="IBAN" value={app.iban} mono />
              <DataRow label="BIC" value={app.bic || "–"} />
              <DataRow label="Kreditinstitut" value={app.kreditinstitut || "–"} />
            </Section>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Status & Actions */}
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <h3 className="font-semibold text-gray-900 mb-4">Status</h3>
              <div className="space-y-3">
                {STATUS_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center p-3 rounded-lg border cursor-pointer transition-colors ${
                      status === opt.value
                        ? "border-svu-500 bg-svu-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="status"
                      value={opt.value}
                      checked={status === opt.value}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-4 h-4 text-svu-600 border-gray-300 focus:ring-svu-500"
                    />
                    <span
                      className={`ml-3 text-sm font-medium px-2 py-0.5 rounded-full ${opt.color}`}
                    >
                      {opt.label}
                    </span>
                  </label>
                ))}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notizen
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none resize-none"
                  placeholder="Interne Notizen..."
                />
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-svu-600 rounded-lg hover:bg-svu-700 disabled:opacity-50 transition-colors"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Speichern
              </button>
            </div>

            {/* Meta info */}
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Info</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Eingereicht:</span>
                  <span className="text-gray-900">
                    {new Date(app.created_at).toLocaleString("de-DE")}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">E-Mail gesendet:</span>
                  <div className="flex items-center gap-2">
                    {app.email_sent ? (
                      <span className="flex items-center gap-1 text-green-600">
                        <Mail className="w-3.5 h-3.5" /> Ja
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-600">
                        <MailX className="w-3.5 h-3.5" /> Nein
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        if (!app) return;
                        setResending(true);
                        try {
                          await resendEmail(app.id);
                          toast.success("E-Mail wird erneut gesendet");
                          // Refresh after a short delay
                          setTimeout(async () => {
                            const updated = await getApplication(app.id);
                            setApp(updated);
                          }, 3000);
                        } catch (err: any) {
                          toast.error(err.message);
                        } finally {
                          setResending(false);
                        }
                      }}
                      disabled={resending}
                      className="p-1 text-gray-400 hover:text-svu-600 rounded transition-colors"
                      title={app.email_sent ? "E-Mail erneut senden" : "E-Mail senden"}
                    >
                      {resending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Dokument hochgeladen:</span>
                  {app.uploaded_file ? (
                    <span className="flex items-center gap-1 text-green-600">
                      <FileCheck className="w-3.5 h-3.5" /> Ja
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-600">
                      <MailX className="w-3.5 h-3.5" /> Nein
                    </span>
                  )}
                </div>
                {app.uploaded_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Hochgeladen am:</span>
                  <span className="text-gray-900">
                    {new Date(app.uploaded_at).toLocaleString("de-DE")}
                  </span>
                </div>
                )}
                {app.admin_approved_file && (
                  <div className="pt-2 flex gap-2">
                    <a
                      href={`/api/admin/applications/${app.id}/approved`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
                    >
                      <FileCheck className="w-4 h-4" /> Genehmigungsdokument
                    </a>
                  </div>
                )}
                {app.uploaded_file ? (
                  <div className="pt-2 flex gap-2">
                    <a
                      href={`/api/admin/applications/${app.id}/upload`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-svu-600 rounded-lg hover:bg-svu-700 transition-colors"
                    >
                      <Eye className="w-4 h-4" /> Anzeigen
                    </a>
                    <a
                      href={`/api/admin/applications/${app.id}/upload`}
                      download
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                    <button
                      onClick={() => uploadInputRef.current?.click()}
                      title="Dokument ersetzen"
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="pt-2">
                    <input
                      ref={uploadInputRef}
                      type="file"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleAdminUpload(f);
                        e.target.value = "";
                      }}
                    />
                    <div
                      className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${
                        uploadDragging
                          ? "border-svu-500 bg-svu-50"
                          : "border-gray-300 hover:border-svu-400 hover:bg-gray-50"
                      }`}
                      onDragOver={(e) => { e.preventDefault(); setUploadDragging(true); }}
                      onDragLeave={() => setUploadDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setUploadDragging(false);
                        const f = e.dataTransfer.files[0];
                        if (f) handleAdminUpload(f);
                      }}
                      onClick={() => !uploading && uploadInputRef.current?.click()}
                    >
                      {uploading ? (
                        <Loader2 className="w-5 h-5 animate-spin text-svu-600" />
                      ) : (
                        <>
                          <Upload className="w-5 h-5 text-gray-400" />
                          <p className="text-xs text-gray-500">
                            Dokument hochladen<br />
                            <span className="text-gray-400">PDF, JPG, PNG, HEIC</span>
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {/* Hidden input for replace button */}
                {app.uploaded_file && (
                  <input
                    ref={uploadInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleAdminUpload(f);
                      e.target.value = "";
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Approve modal */}
      {showApproveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Genehmigung bestätigen</h3>
              <button
                onClick={() => {
                  setShowApproveModal(false);
                  setSaveSignatureForFuture(false);
                }}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600">
                Bitte signieren Sie die Genehmigung (wird dem Antragsteller zugestellt).
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSignatureInputMode("draw")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
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
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
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
                <label className="flex items-start gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={useSavedAdminSignature}
                    onChange={(e) => setUseSavedAdminSignature(e.target.checked)}
                    className="mt-0.5"
                  />
                  Gespeicherte Admin-Signatur verwenden, wenn keine lokale Unterschrift eingegeben wurde.
                </label>
              )}
              {(uploadedSigDataUrl || !sigEmpty) && (
                <label className="flex items-start gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={saveSignatureForFuture}
                    onChange={(e) => setSaveSignatureForFuture(e.target.checked)}
                    className="mt-0.5"
                  />
                  Diese Signatur speichern und für zukünftige Verwendung sperren
                </label>
              )}
            </div>
            <div className="p-5 border-t flex gap-3">
              <button
                onClick={() => {
                  setShowApproveModal(false);
                  setSaveSignatureForFuture(false);
                }}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Abbrechen
              </button>
              <button
                onClick={handleConfirmApprove}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-svu-600 rounded-lg hover:bg-svu-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Bestätigen und speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deny modal */}
      {showDenyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-5 border-b flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Ablehnung bestätigen</h3>
              <button
                onClick={() => setShowDenyModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Begründung für die Ablehnung (wird dem Antragsteller mitgeteilt)
              </label>
              <textarea
                value={adminDeclineReason}
                onChange={(e) => setAdminDeclineReason(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none resize-none"
                placeholder="Bitte Begründung eingeben..."
              />
            </div>
            <div className="p-5 border-t flex gap-3">
              <button
                onClick={() => setShowDenyModal(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Abbrechen
              </button>
              <button
                onClick={handleConfirmDeny}
                disabled={saving || !adminDeclineReason.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-svu-600 rounded-lg hover:bg-svu-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Bestätigen und speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-5">
      <h3 className="font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DataRow({
  label,
  value,
  mono = false,
  highlight = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span
        className={`text-right ${
          highlight
            ? "font-bold text-svu-600 text-base"
            : mono
            ? "font-mono text-gray-900"
            : "font-medium text-gray-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
