import React, { createContext, useContext, useState, useEffect } from "react";

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

  useEffect(() => {
    fetch("/api/club-config")
      .then((r) => r.json())
      .then((data) => setConfig(data))
      .catch((err) => console.error("Failed to load club config:", err));
  }, []);

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
