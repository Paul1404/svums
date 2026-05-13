import { useLocation, useNavigate, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ArrowLeft, Clock, Mail, Upload, Copy } from "lucide-react";
import { formatFee } from "../services/api";
import { captureEvent, identifyApplicant } from "../lib/analytics";
import { useClubConfig } from "../context/ClubConfigContext";

const CONFETTI_COLORS = ["#b91c1c", "#dc2626", "#f87171", "#f59e0b", "#22c55e", "#ffffff"];

function Confetti() {
  const [visible, setVisible] = useState(true);
  const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 3500);
    return () => clearTimeout(timer);
  }, []);

  if (!visible || prefersReducedMotion) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {Array.from({ length: 30 }).map((_, i) => (
        <div
          key={i}
          className="confetti-piece"
          style={{
            left: `${Math.random() * 100}%`,
            backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            width: `${6 + Math.random() * 8}px`,
            height: `${6 + Math.random() * 8}px`,
            borderRadius: Math.random() > 0.5 ? "50%" : "2px",
            "--confetti-delay": `${Math.random() * 0.8}s`,
            "--confetti-duration": `${2 + Math.random() * 1.5}s`,
            "--confetti-rotation": `${360 + Math.random() * 720}deg`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

export default function Success() {
  const location = useLocation();
  const navigate = useNavigate();
  const club = useClubConfig();
  const state = location.state as {
    id?: number;
    antragsnummer?: string;
    mandatsreferenz?: string;
    upload_url?: string;
    signedOnline?: boolean;
    form?: any;
    feeInfo?: any;
  } | null;

  useEffect(() => {
    if (!state?.antragsnummer) return;
    identifyApplicant(state.antragsnummer, { app_area: "public" });
    captureEvent("membership_success_viewed", {
      app_area: "public",
      signed_online: Boolean(state.signedOnline),
      has_upload_url: Boolean(state.upload_url),
      antragsnummer: state.antragsnummer,
    });
  }, [state?.antragsnummer, state?.signedOnline, state?.upload_url]);

  if (!state?.form) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Kein Antrag gefunden.</p>
          <Link
            to="/"
            className="text-svu-600 hover:underline font-medium"
          >
            Zurück zur Beitrittserklärung
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Confetti />
      <header className="bg-svu-600 text-white shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center gap-4">
          <img
            src="/logo_svu-241x300.png"
            alt={club.club_name}
            className="h-14 w-auto drop-shadow-md"
          />
          <div>
            <h1 className="text-2xl font-bold">{club.club_name}</h1>
            <p className="text-svu-200 mt-0.5 text-sm">Online Beitrittserklärung</p>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 mt-8">
        <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
          <div
            className="success-check w-20 h-20 mx-auto mb-4 text-svu-600"
            aria-hidden="true"
          >
            <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
              <circle className="ring" cx="32" cy="32" r="28" />
              <path className="tick" d="M20 33 L29 42 L45 24" />
            </svg>
          </div>

          <h2
            className="reveal-up text-2xl font-bold text-gray-900 mb-2"
            style={{ "--i": 0 } as React.CSSProperties}
          >
            Vielen Dank für Ihre Beitrittserklärung!
          </h2>

          <p
            className="reveal-up text-gray-600 mb-6"
            style={{ "--i": 1 } as React.CSSProperties}
          >
            Ihre Beitrittserklärung wurde erfolgreich eingereicht.
          </p>

          {state.form && (
            <div
              className="reveal-up bg-gray-50 rounded-lg p-4 text-left mb-6 text-sm"
              style={{ "--i": 2 } as React.CSSProperties}
            >
              <div className="grid grid-cols-2 gap-2">
                {state.antragsnummer && (
                  <>
                    <span className="text-gray-500">Antragsnummer:</span>
                    <span className="font-bold font-mono text-svu-600 inline-flex items-center gap-1.5">
                      {state.antragsnummer}
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(state.antragsnummer!);
                          toast.success("Antragsnummer kopiert!");
                        }}
                        className="text-gray-400 hover:text-svu-600 transition-colors p-0.5"
                        title="In Zwischenablage kopieren"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </>
                )}
                <span className="text-gray-500">Name:</span>
                <span className="font-medium">
                  {state.form.nachname}, {state.form.vorname}
                </span>
                <span className="text-gray-500">Abteilung(en):</span>
                <span className="font-medium">
                  {state.form.abteilungen?.join(", ")}
                </span>
                {state.feeInfo && (
                  <>
                    <span className="text-gray-500">Jahresbeitrag:</span>
                    <span className="font-medium text-svu-600">
                      {formatFee(state.feeInfo.jahresbeitrag)}
                    </span>
                  </>
                )}
                {state.mandatsreferenz && (
                  <>
                    <span className="text-gray-500">Mandatsreferenz:</span>
                    <span className="font-medium font-mono">
                      {state.mandatsreferenz}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Next steps timeline */}
          <div
            className="reveal-up bg-gray-50 rounded-lg p-5 text-left mb-6"
            style={{ "--i": 3 } as React.CSSProperties}
          >
            <h3 className="font-semibold text-gray-900 mb-4 text-sm">So geht es weiter:</h3>
            <div className="space-y-0">
              {/* Step 1: Email confirmation - always done */}
              <TimelineStep
                icon={<Mail className="w-4 h-4" />}
                title="Bestätigung per E-Mail"
                subtitle={`An ${state.form?.email}`}
                time="In wenigen Minuten"
                done
                last={false}
              />
              {/* Step 2: Document signing */}
              <TimelineStep
                icon={<Upload className="w-4 h-4" />}
                title="Dokument unterschreiben & hochladen"
                subtitle={state.signedOnline
                  ? "Digital unterschrieben"
                  : "PDF drucken, unterschreiben, als Scan hochladen"}
                time={state.signedOnline ? "Erledigt!" : "Innerhalb von 30 Tagen"}
                done={!!state.signedOnline}
                last={false}
              />
              {/* Step 3: Processing */}
              <TimelineStep
                icon={<Clock className="w-4 h-4" />}
                title="Bearbeitung durch den Verein"
                subtitle="Ihr Antrag wird geprüft und bestätigt"
                time="Wenige Werktage"
                done={false}
                last
              />
            </div>
          </div>

          {!state.signedOnline && state.upload_url && (
            <a
              href={state.upload_url}
              className="block w-full mb-6 py-3 px-4 bg-svu-600 text-white font-medium rounded-lg hover:bg-svu-700 transition-colors text-center flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Unterschriebenes Dokument jetzt hochladen
            </a>
          )}

          {state.antragsnummer && (
            <Link
              to={`/status?nr=${state.antragsnummer}`}
              className="block w-full mb-4 py-3 px-4 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors text-center text-sm"
            >
              Status Ihres Antrags online prüfen
            </Link>
          )}

          <Link
            to="/"
            className="inline-flex items-center gap-2 text-svu-600 hover:text-svu-700 font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> Neue Beitrittserklärung
          </Link>
        </div>

        <footer className="text-center text-xs text-gray-400 py-8 space-y-1">
          <p className="font-medium text-gray-500">{club.club_name}</p>
          <p>{club.club_address}</p>
          <p>{club.contact_role}: {club.contact_name} · Tel: {club.contact_phone}</p>
          <p>
            E-Mail:{" "}
            <a href={`mailto:${club.contact_email}`} className="hover:text-svu-600">
              {club.contact_email}
            </a>
          </p>
          <p>Registergericht: {club.registergericht} · Registernummer: {club.registernummer} · Steuer-ID: {club.steuernummer}</p>
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
      </div>
    </div>
  );
}

function TimelineStep({
  icon,
  title,
  subtitle,
  time,
  done,
  last,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  time: string;
  done: boolean;
  last: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 ${
            done
              ? "bg-green-500 border-green-500 text-white"
              : "bg-gray-100 border-gray-300 text-gray-400"
          }`}
        >
          {done ? <CheckCircle2 className="w-4 h-4" /> : icon}
        </div>
        {!last && (
          <div className={`w-0.5 flex-1 min-h-[24px] ${done ? "bg-green-300" : "bg-gray-200"}`} />
        )}
      </div>
      <div className={`pb-4 ${last ? "pb-0" : ""}`}>
        <h4 className={`font-semibold text-sm ${done ? "text-green-700" : "text-gray-700"}`}>
          {title}
        </h4>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
        <span className={`text-xs font-medium mt-1 inline-block ${done ? "text-green-600" : "text-svu-600"}`}>
          {time}
        </span>
      </div>
    </div>
  );
}
