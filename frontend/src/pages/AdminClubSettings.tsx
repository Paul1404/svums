import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  getClubConfig,
  updateClubConfig,
  type ClubConfigData,
} from "../services/api";
import {
  ArrowLeft,
  Save,
  Loader2,
  Plus,
  Trash2,
  GripVertical,
} from "lucide-react";

/* ── tiny helpers ─────────────────────────────────────────── */

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none";

const labelCls = "block text-sm font-medium text-gray-700 mb-1";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      {children}
    </div>
  );
}

/* ── fee type options ─────────────────────────────────────── */

const FEE_TYPES = [
  { value: "familie", label: "Familie" },
  { value: "kind", label: "Kind" },
  { value: "jugendlich", label: "Jugendlich" },
  { value: "junger_erwachsener", label: "Junger Erwachsener" },
  { value: "erwachsener", label: "Erwachsener" },
];

/* ── main component ───────────────────────────────────────── */

export default function AdminClubSettings() {
  const [config, setConfig] = useState<ClubConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    getClubConfig()
      .then(setConfig)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await updateClubConfig(config);
      setConfig(updated);
      toast.success("Vereinseinstellungen gespeichert");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof ClubConfigData>(
    field: K,
    value: ClubConfigData[K]
  ) => {
    setConfig((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  /* ── fee helpers ──────────────────────────────────── */

  const updateFee = (
    index: number,
    field: string,
    value: string | boolean | null
  ) => {
    if (!config) return;
    const fees = [...config.fees];
    fees[index] = { ...fees[index], [field]: value };
    update("fees", fees);
  };

  const addFee = () => {
    if (!config) return;
    update("fees", [
      ...config.fees,
      { typ: "erwachsener", betrag: "0.00", label: "", elternteil_mitglied: null },
    ]);
  };

  const removeFee = (index: number) => {
    if (!config) return;
    update(
      "fees",
      config.fees.filter((_, i) => i !== index)
    );
  };

  /* ── department helpers ───────────────────────────── */

  const updateDept = (index: number, value: string) => {
    if (!config) return;
    const deps = [...config.departments];
    deps[index] = value;
    update("departments", deps);
  };

  const addDept = () => {
    if (!config) return;
    update("departments", [...config.departments, ""]);
  };

  const removeDept = (index: number) => {
    if (!config) return;
    update(
      "departments",
      config.departments.filter((_, i) => i !== index)
    );
  };

  /* ── loading / empty state ────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-svu-600" />
      </div>
    );
  }

  if (!config) return null;

  /* ── render ────────────────────────────────────────── */

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
            <h1 className="text-lg font-bold text-gray-900">
              Vereinseinstellungen
            </h1>
            <p className="text-xs text-gray-500">
              Name, Kontakt, Gebühren, Abteilungen, Branding
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* ── Identity ───────────────────────────────── */}
        <Section title="Vereinsdaten">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Vereinsname</label>
                <input
                  value={config.club_name}
                  onChange={(e) => update("club_name", e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Kurzname</label>
                <input
                  value={config.club_short_name}
                  onChange={(e) => update("club_short_name", e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Abkürzung</label>
                <input
                  value={config.club_abbreviation}
                  onChange={(e) => update("club_abbreviation", e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Ort</label>
                <input
                  value={config.club_city}
                  onChange={(e) => update("club_city", e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Adresse</label>
              <input
                value={config.club_address}
                onChange={(e) => update("club_address", e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Website</label>
              <input
                value={config.club_website}
                onChange={(e) => update("club_website", e.target.value)}
                className={inputCls}
                placeholder="https://..."
              />
            </div>
          </div>
        </Section>

        {/* ── Contact ────────────────────────────────── */}
        <Section title="Kontaktperson">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Name</label>
                <input
                  value={config.contact_name}
                  onChange={(e) => update("contact_name", e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Rolle</label>
                <input
                  value={config.contact_role}
                  onChange={(e) => update("contact_role", e.target.value)}
                  className={inputCls}
                  placeholder="z.B. 1. Vorsitzender"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Telefon</label>
                <input
                  value={config.contact_phone}
                  onChange={(e) => update("contact_phone", e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>E-Mail</label>
                <input
                  type="email"
                  value={config.contact_email}
                  onChange={(e) => update("contact_email", e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </Section>

        {/* ── Legal ──────────────────────────────────── */}
        <Section title="Rechtliche Angaben">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Registergericht</label>
                <input
                  value={config.registergericht}
                  onChange={(e) => update("registergericht", e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Registernummer</label>
                <input
                  value={config.registernummer}
                  onChange={(e) => update("registernummer", e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Steuernummer</label>
              <input
                value={config.steuernummer}
                onChange={(e) => update("steuernummer", e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Datenschutz-URL</label>
                <input
                  value={config.datenschutz_url}
                  onChange={(e) => update("datenschutz_url", e.target.value)}
                  className={inputCls}
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className={labelCls}>Satzung-URL</label>
                <input
                  value={config.satzung_url}
                  onChange={(e) => update("satzung_url", e.target.value)}
                  className={inputCls}
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className={labelCls}>Impressum-URL</label>
                <input
                  value={config.impressum_url}
                  onChange={(e) => update("impressum_url", e.target.value)}
                  className={inputCls}
                  placeholder="https://..."
                />
              </div>
            </div>
          </div>
        </Section>

        {/* ── SEPA ───────────────────────────────────── */}
        <Section title="SEPA-Lastschrift">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Gläubiger-ID</label>
              <input
                value={config.sepa_glaeubiger_id}
                onChange={(e) => update("sepa_glaeubiger_id", e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Mandatsreferenz-Präfix</label>
              <input
                value={config.sepa_mandate_prefix}
                onChange={(e) => update("sepa_mandate_prefix", e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        </Section>

        {/* ── Fees ───────────────────────────────────── */}
        <Section title="Beiträge">
          <div className="space-y-3">
            {config.fees.map((fee, i) => (
              <div
                key={i}
                className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 bg-gray-50"
              >
                <GripVertical className="w-4 h-4 text-gray-300 mt-2.5 shrink-0" />
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-5 gap-2">
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-gray-500 mb-0.5">
                      Typ
                    </label>
                    <select
                      value={fee.typ}
                      onChange={(e) => updateFee(i, "typ", e.target.value)}
                      className={inputCls}
                    >
                      {FEE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">
                      Betrag (€)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={fee.betrag}
                      onChange={(e) => updateFee(i, "betrag", e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-gray-500 mb-0.5">
                      Bezeichnung
                    </label>
                    <input
                      value={fee.label}
                      onChange={(e) => updateFee(i, "label", e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <label className="block text-xs text-gray-500 mb-0.5">
                      Elternteil Mitglied?
                    </label>
                    <select
                      value={
                        fee.elternteil_mitglied === null
                          ? "null"
                          : fee.elternteil_mitglied
                            ? "true"
                            : "false"
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        updateFee(
                          i,
                          "elternteil_mitglied",
                          v === "null" ? null : v === "true"
                        );
                      }}
                      className={inputCls + " max-w-xs"}
                    >
                      <option value="null">Nicht relevant</option>
                      <option value="true">Ja</option>
                      <option value="false">Nein</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => removeFee(i)}
                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors mt-1.5 shrink-0"
                  title="Beitrag entfernen"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={addFee}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-svu-600 border border-svu-200 rounded-lg hover:bg-svu-50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Beitrag hinzufügen
            </button>
          </div>
        </Section>

        {/* ── Departments ────────────────────────────── */}
        <Section title="Abteilungen">
          <div className="space-y-2">
            {config.departments.map((dept, i) => (
              <div key={i} className="flex items-center gap-2">
                <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                <input
                  value={dept}
                  onChange={(e) => updateDept(i, e.target.value)}
                  className={inputCls}
                  placeholder="Abteilungsname"
                />
                <button
                  onClick={() => removeDept(i)}
                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors shrink-0"
                  title="Abteilung entfernen"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={addDept}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-svu-600 border border-svu-200 rounded-lg hover:bg-svu-50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Abteilung hinzufügen
            </button>
          </div>
        </Section>

        {/* ── Branding ───────────────────────────────── */}
        <Section title="Branding">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Primärfarbe</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={config.primary_color}
                    onChange={(e) => update("primary_color", e.target.value)}
                    className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    value={config.primary_color}
                    onChange={(e) => update("primary_color", e.target.value)}
                    className={inputCls}
                    placeholder="#b91c1c"
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Primärfarbe (dunkel)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={config.primary_color_dark}
                    onChange={(e) => update("primary_color_dark", e.target.value)}
                    className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    value={config.primary_color_dark}
                    onChange={(e) => update("primary_color_dark", e.target.value)}
                    className={inputCls}
                    placeholder="#991b1b"
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Primärfarbe (hell)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={config.primary_color_light}
                    onChange={(e) =>
                      update("primary_color_light", e.target.value)
                    }
                    className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    value={config.primary_color_light}
                    onChange={(e) =>
                      update("primary_color_light", e.target.value)
                    }
                    className={inputCls}
                    placeholder="#dc2626"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className={labelCls}>Logo-URL</label>
              <input
                value={config.logo_url}
                onChange={(e) => {
                  update("logo_url", e.target.value);
                  setLogoError(false);
                }}
                className={inputCls}
                placeholder="https://... oder leer lassen"
              />
              {config.logo_url && !logoError && (
                <div className="mt-2 p-2 border border-gray-200 rounded-lg bg-gray-50 inline-block">
                  <img
                    src={config.logo_url}
                    alt="Vereinslogo"
                    className="max-h-16 object-contain"
                    onError={() => setLogoError(true)}
                  />
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* ── Email ──────────────────────────────────── */}
        <Section title="E-Mail">
          <div>
            <label className={labelCls}>Betreff-Präfix</label>
            <input
              value={config.email_subject_prefix}
              onChange={(e) => update("email_subject_prefix", e.target.value)}
              className={inputCls}
              placeholder="Vereinsname e.V."
            />
            <p className="text-xs text-gray-500 mt-1">
              Wird als Präfix im Betreff aller ausgehenden E-Mails verwendet.
            </p>
          </div>
        </Section>

        {/* ── Save button ────────────────────────────── */}
        <div className="flex">
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
            Vereinseinstellungen speichern
          </button>
        </div>
      </div>
    </div>
  );
}
