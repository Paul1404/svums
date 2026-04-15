import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface FeeEntry {
  typ: string;
  betrag: string;
  label: string;
  elternteil_mitglied: boolean | null;
}

export interface ClubConfig {
  club_name: string;
  club_short_name: string;
  club_abbreviation: string;
  club_city: string;
  club_address: string;
  club_website: string;
  contact_name: string;
  contact_role: string;
  contact_phone: string;
  contact_email: string;
  registergericht: string;
  registernummer: string;
  steuernummer: string;
  datenschutz_url: string;
  satzung_url: string;
  impressum_url: string;
  sepa_glaeubiger_id: string;
  sepa_mandate_prefix: string;
  fees: FeeEntry[];
  departments: string[];
  primary_color: string;
  primary_color_dark: string;
  primary_color_light: string;
  logo_url: string;
  email_subject_prefix: string;
}

const ClubConfigContext = createContext<ClubConfig | null>(null);

export function ClubConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ClubConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(() => {
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    fetch("/api/club-config", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setConfig(data))
      .catch((err) => {
        if (err.name === "AbortError") {
          setError("Zeitüberschreitung beim Laden der Konfiguration.");
        } else {
          setError("Konfiguration konnte nicht geladen werden.");
        }
        console.error("Failed to load club config:", err);
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    return loadConfig();
  }, [loadConfig]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-red-600">{error}</p>
        <button
          onClick={loadConfig}
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400" />
      </div>
    );
  }

  return (
    <ClubConfigContext.Provider value={config}>
      {children}
    </ClubConfigContext.Provider>
  );
}

export function useClubConfig(): ClubConfig {
  const ctx = useContext(ClubConfigContext);
  if (!ctx) throw new Error("useClubConfig must be used within ClubConfigProvider");
  return ctx;
}
