import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  getSettings,
  updateSettings,
  testSmtp,
  type SettingsData,
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
} from "lucide-react";

export default function AdminSettings() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sigUploading, setSigUploading] = useState(false);

  useEffect(() => {
    getSettings()
      .then((data) => {
        setSettings(data);
        setTestEmail(data.notification_email);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await updateSettings(settings);
      setSettings(updated);
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
            <p className="text-xs text-gray-500">SMTP & E-Mail-Konfiguration</p>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
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
                  Passwort
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={settings.smtp_password}
                    onChange={(e) => update("smtp_password", e.target.value)}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none"
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
                placeholder="noreply@sv-untereuerheim.de"
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
              placeholder="mitgliedschaft@sv-untereuerheim.de"
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
      </div>
    </div>
  );
}
