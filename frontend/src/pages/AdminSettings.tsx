import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  getSettings,
  updateSettings,
  testSmtp,
  getClubConfig,
  updateClubConfig,
  type SettingsData,
  type SettingsUpdateData,
} from "../services/api";
import {
  ArrowLeft,
  Save,
  Send,
  Loader2,
  Eye,
  EyeOff,
  Upload,
  Trash2,
  Building2,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import type { ClubConfig, FeeEntry } from "../context/ClubConfigContext";

type Tab = "smtp" | "club";

export default function AdminSettings() {
  const [tab, setTab] = useState<Tab>("smtp");
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [clubConfig, setClubConfig] = useState<ClubConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingClub, setSavingClub] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [clearStoredPassword, setClearStoredPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [sigUploading, setSigUploading] = useState(false);

  useEffect(() => {
    Promise.all([
      getSettings(),
      getClubConfig() as unknown as Promise<ClubConfig>,
    ])
      .then(([s, c]) => {
        setSettings(s);
        setTestEmail(s.notification_email);
        setClubConfig(c);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const payload: SettingsUpdateData = {
        smtp_host: settings.smtp_host,
        smtp_port: settings.smtp_port,
        smtp_user: settings.smtp_user,
        smtp_from: settings.smtp_from,
        smtp_use_tls: settings.smtp_use_tls,
        notification_email: settings.notification_email,
        admin_signature_base64: settings.admin_signature_base64,
      };
      if (smtpPassword) {
        payload.smtp_password = smtpPassword;
      }
      if (clearStoredPassword) {
        payload.clear_smtp_password = true;
      }
      const updated = await updateSettings(payload);
      setSettings(updated);
      setSmtpPassword("");
      setClearStoredPassword(false);
      toast.success("Einstellungen gespeichert");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail.trim()) {
      toast.error("Bitte eine E-Mail-Adresse eingeben");
      return;
    }
    setTesting(true);
    try {
      await testSmtp(testEmail);
      toast.success("Test-E-Mail wurde gesendet!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setTesting(false);
    }
  };

  const update = (field: keyof SettingsData, value: any) => {
    setSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const updateClub = (field: keyof ClubConfig, value: any) => {
    setClubConfig((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSaveClub = async () => {
    if (!clubConfig) return;
    setSavingClub(true);
    try {
      const updated = await updateClubConfig(clubConfig as unknown as Record<string, unknown>) as unknown as ClubConfig;
      setClubConfig(updated);
      toast.success("Vereinsdaten gespeichert");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingClub(false);
    }
  };

  const handleSignatureUpload = (file: File) => {
    if (!settings) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Bitte ein Bild (PNG/JPG) auswählen");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Datei zu groß (max. 10 MB)");
      return;
    }
    setSigUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        update("admin_signature_base64", result);
      }
      setSigUploading(false);
    };
    reader.onerror = () => {
      toast.error("Signatur konnte nicht gelesen werden");
      setSigUploading(false);
    };
    reader.readAsDataURL(file);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-svu-600" />
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            to="/admin"
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Einstellungen</h1>
            <p className="text-xs text-gray-500">SMTP, E-Mail & Vereinsdaten</p>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-4 flex gap-1 -mb-px">
          <button
            onClick={() => setTab("smtp")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "smtp"
                ? "border-svu-600 text-svu-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            SMTP & E-Mail
          </button>
          <button
            onClick={() => setTab("club")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              tab === "club"
                ? "border-svu-600 text-svu-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            Vereinsdaten
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {tab === "club" && clubConfig && <ClubConfigTab config={clubConfig} updateClub={updateClub} saving={savingClub} onSave={handleSaveClub} />}
        {tab === "smtp" && <>
        {/* SMTP Settings */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            SMTP-Server
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  SMTP-Host
                </label>
                <input
                  value={settings.smtp_host}
                  onChange={(e) => update("smtp_host", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none"
                  placeholder="smtp.example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Port
                </label>
                <input
                  type="number"
                  value={settings.smtp_port}
                  onChange={(e) => update("smtp_port", parseInt(e.target.value) || 587)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Benutzername
                </label>
                <input
                  value={settings.smtp_user}
                  onChange={(e) => update("smtp_user", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none"
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Neues Passwort
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={smtpPassword}
                    onChange={(e) => {
                      setSmtpPassword(e.target.value);
                      if (e.target.value) setClearStoredPassword(false);
                    }}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none"
                    placeholder={settings.smtp_password_configured ? "Gespeichertes Passwort ersetzen" : "SMTP-Passwort eingeben"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className={settings.smtp_password_configured && !clearStoredPassword ? "text-green-700" : "text-gray-500"}>
                    {settings.smtp_password_configured && !clearStoredPassword
                      ? "Ein SMTP-Passwort ist gespeichert."
                      : "Kein SMTP-Passwort gespeichert."}
                  </span>
                  {settings.smtp_password_configured && (
                    <button
                      type="button"
                      onClick={() => {
                        setClearStoredPassword((prev) => !prev);
                        setSmtpPassword("");
                      }}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 ${
                        clearStoredPassword
                          ? "border-red-300 bg-red-50 text-red-700"
                          : "border-gray-300 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <Trash2 className="w-3 h-3" />
                      {clearStoredPassword ? "Passwort wird entfernt" : "Gespeichertes Passwort entfernen"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Absender-Adresse (From)
              </label>
              <input
                value={settings.smtp_from}
                onChange={(e) => update("smtp_from", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none"
                placeholder="noreply@example.com"
              />
            </div>

            <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={settings.smtp_use_tls}
                onChange={(e) => update("smtp_use_tls", e.target.checked)}
                className="w-4 h-4 text-svu-600 rounded border-gray-300 focus:ring-svu-500"
              />
              <span className="text-sm font-medium text-gray-700">
                STARTTLS verwenden
              </span>
            </label>
          </div>
        </div>

        {/* Notification email */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Benachrichtigung
          </h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Benachrichtigungs-E-Mail
            </label>
            <input
              value={settings.notification_email}
              onChange={(e) => update("notification_email", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none"
              placeholder="mitgliedschaft@example.com"
            />
            <p className="text-xs text-gray-500 mt-1">
              Neue Beitrittserklärungen werden an diese Adresse gesendet.
            </p>
          </div>
        </div>

        {/* Reusable admin signature */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Wiederverwendbare Unterschrift
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Diese Signatur kann bei Kündigungsbestätigungen automatisch verwendet werden.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
              <Upload className="w-3.5 h-3.5" />
              {sigUploading ? "Wird geladen..." : "Signaturbild hochladen"}
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
            {settings.admin_signature_base64 && (
              <button
                type="button"
                onClick={() => update("admin_signature_base64", null)}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Entfernen
              </button>
            )}
          </div>
          {settings.admin_signature_base64 ? (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-2">
              <img
                src={settings.admin_signature_base64}
                alt="Admin-Signatur"
                className="max-h-24 object-contain"
              />
            </div>
          ) : (
            <p className="text-xs text-gray-400 mt-3">Keine gespeicherte Signatur vorhanden.</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-svu-600 rounded-lg hover:bg-svu-700 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Einstellungen speichern
          </button>
        </div>

        {/* Test SMTP */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            SMTP testen
          </h2>
          <div className="flex gap-2">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none"
              placeholder="test@example.com"
            />
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Test senden
            </button>
          </div>
        </div>
        </>}
      </div>
    </div>
  );
}


/* ─── Helper: labelled input ─── */

function CField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none"
        placeholder={placeholder}
      />
    </div>
  );
}

/* ─── Collapsible section ─── */

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl shadow-sm border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-6 pb-6 space-y-4">{children}</div>}
    </div>
  );
}

/* ─── Club Config Tab ─── */

function ClubConfigTab({ config, updateClub, saving, onSave }: {
  config: ClubConfig;
  updateClub: (field: keyof ClubConfig, value: any) => void;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <>
      <Section title="Verein" defaultOpen>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CField label="Vereinsname (vollständig)" value={config.club_name} onChange={(v) => updateClub("club_name", v)} placeholder="Sportverein 1945 Musterstadt e.V." />
          <CField label="Kurzname" value={config.club_short_name} onChange={(v) => updateClub("club_short_name", v)} placeholder="SV 1945 Musterstadt e.V." />
          <CField label="Kürzel" value={config.club_abbreviation} onChange={(v) => updateClub("club_abbreviation", v)} placeholder="SVM" />
          <CField label="Ort" value={config.club_city} onChange={(v) => updateClub("club_city", v)} placeholder="Musterstadt" />
          <CField label="Adresse (einzeilig)" value={config.club_address} onChange={(v) => updateClub("club_address", v)} placeholder="Hauptstr. 1 · 12345 Musterstadt" />
          <CField label="Website" value={config.club_website} onChange={(v) => updateClub("club_website", v)} placeholder="https://example.com" />
        </div>
      </Section>

      <Section title="Kontaktperson">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CField label="Name" value={config.contact_name} onChange={(v) => updateClub("contact_name", v)} placeholder="Max Mustermann" />
          <CField label="Rolle / Amt" value={config.contact_role} onChange={(v) => updateClub("contact_role", v)} placeholder="1. Vorsitzender" />
          <CField label="Telefon" value={config.contact_phone} onChange={(v) => updateClub("contact_phone", v)} placeholder="01234/56789" />
          <CField label="E-Mail" value={config.contact_email} onChange={(v) => updateClub("contact_email", v)} placeholder="info@example.com" />
        </div>
      </Section>

      <Section title="Rechtliches">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CField label="Registergericht" value={config.registergericht} onChange={(v) => updateClub("registergericht", v)} placeholder="Amtsgericht Musterstadt" />
          <CField label="Registernummer" value={config.registernummer} onChange={(v) => updateClub("registernummer", v)} placeholder="VR 123" />
          <CField label="Steuernummer" value={config.steuernummer} onChange={(v) => updateClub("steuernummer", v)} placeholder="123/456/78901" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <CField label="Datenschutz-URL" value={config.datenschutz_url} onChange={(v) => updateClub("datenschutz_url", v)} />
          <CField label="Satzung-URL" value={config.satzung_url} onChange={(v) => updateClub("satzung_url", v)} />
          <CField label="Impressum-URL" value={config.impressum_url} onChange={(v) => updateClub("impressum_url", v)} />
        </div>
      </Section>

      <Section title="SEPA">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CField label="Gläubiger-ID" value={config.sepa_glaeubiger_id} onChange={(v) => updateClub("sepa_glaeubiger_id", v)} placeholder="DE98ZZZ09999999999" />
          <CField label="Mandatsreferenz-Präfix" value={config.sepa_mandate_prefix} onChange={(v) => updateClub("sepa_mandate_prefix", v)} placeholder="SVM-" />
        </div>
      </Section>

      <Section title="Abteilungen">
        <p className="text-xs text-gray-500 mb-2">Abteilungen, die im Antragsformular zur Auswahl stehen.</p>
        <div className="space-y-2">
          {config.departments.map((dept, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={dept}
                onChange={(e) => {
                  const updated = [...config.departments];
                  updated[i] = e.target.value;
                  updateClub("departments", updated);
                }}
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none"
              />
              <button type="button" onClick={() => {
                updateClub("departments", config.departments.filter((_, j) => j !== i));
              }} className="p-1.5 text-gray-400 hover:text-red-500">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => updateClub("departments", [...config.departments, ""])}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-svu-600 bg-svu-50 rounded-lg hover:bg-svu-100 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Abteilung hinzufügen
          </button>
        </div>
      </Section>

      <Section title="Mitgliedsbeiträge">
        <p className="text-xs text-gray-500 mb-2">Beitragsstruktur für die Beitragsberechnung und PDF-Anzeige.</p>
        <div className="space-y-3">
          {config.fees.map((fee, i) => (
            <div key={i} className="flex items-start gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  value={fee.label}
                  onChange={(e) => {
                    const updated = [...config.fees];
                    updated[i] = { ...fee, label: e.target.value };
                    updateClub("fees", updated);
                  }}
                  className="px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:ring-1 focus:ring-svu-500"
                  placeholder="Bezeichnung"
                />
                <input
                  value={fee.betrag}
                  onChange={(e) => {
                    const updated = [...config.fees];
                    updated[i] = { ...fee, betrag: e.target.value };
                    updateClub("fees", updated);
                  }}
                  className="px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:ring-1 focus:ring-svu-500"
                  placeholder="Betrag (z.B. 54.00)"
                />
                <select
                  value={fee.typ}
                  onChange={(e) => {
                    const updated = [...config.fees];
                    updated[i] = { ...fee, typ: e.target.value };
                    updateClub("fees", updated);
                  }}
                  className="px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:ring-1 focus:ring-svu-500"
                >
                  <option value="erwachsener">Erwachsener</option>
                  <option value="junger_erwachsener">Junger Erwachsener</option>
                  <option value="jugendlich">Jugendlich</option>
                  <option value="kind">Kind</option>
                  <option value="familie">Familie</option>
                </select>
              </div>
              <button type="button" onClick={() => {
                updateClub("fees", config.fees.filter((_, j) => j !== i));
              }} className="p-1.5 mt-0.5 text-gray-400 hover:text-red-500">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => updateClub("fees", [...config.fees, { typ: "erwachsener", betrag: "0.00", label: "", elternteil_mitglied: null }])}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-svu-600 bg-svu-50 rounded-lg hover:bg-svu-100 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Beitragskategorie hinzufügen
          </button>
        </div>
      </Section>

      <Section title="E-Mail & Branding">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CField label="E-Mail-Betreff-Präfix" value={config.email_subject_prefix} onChange={(v) => updateClub("email_subject_prefix", v)} placeholder="Vereinsname" />
          <CField label="Primärfarbe (Hex)" value={config.primary_color} onChange={(v) => updateClub("primary_color", v)} placeholder="#b91c1c" />
          <CField label="Primärfarbe dunkel" value={config.primary_color_dark} onChange={(v) => updateClub("primary_color_dark", v)} placeholder="#991b1b" />
          <CField label="Primärfarbe hell" value={config.primary_color_light} onChange={(v) => updateClub("primary_color_light", v)} placeholder="#dc2626" />
        </div>
      </Section>

      {/* Save button */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-svu-600 rounded-lg hover:bg-svu-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Vereinsdaten speichern
        </button>
      </div>
    </>
  );
}
