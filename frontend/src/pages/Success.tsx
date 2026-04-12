import { useLocation, useNavigate, Link } from "react-router-dom";
import { useEffect } from "react";
import { toast } from "sonner";
import { CheckCircle2, ArrowLeft, Printer, Mail, Upload, Copy } from "lucide-react";
import { formatFee } from "../services/api";
import { captureEvent, identifyApplicant } from "../lib/analytics";
import { useClubConfig } from "../context/ClubConfigContext";

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
          <div className="w-16 h-16 bg-svu-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-svu-600" />
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Vielen Dank für Ihre Beitrittserklärung!
          </h2>

          <p className="text-gray-600 mb-6">
            Ihre Beitrittserklärung wurde erfolgreich eingereicht.
          </p>

          {state.form && (
            <div className="bg-gray-50 rounded-lg p-4 text-left mb-6 text-sm">
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

          {/* Next steps box — differs by flow */}
          {state.signedOnline ? (
            <div className="bg-green-50 border border-green-300 rounded-lg p-5 text-left mb-6">
              <h3 className="font-semibold text-green-900 mb-3 text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Antrag digital unterzeichnet – alles erledigt!
              </h3>
              <p className="text-sm text-green-800">
                Ihre Beitrittserklärung wurde mit Ihrer digitalen Unterschrift eingereicht und wird zeitnah bearbeitet.
                Sie erhalten eine Bestätigung mit dem unterzeichneten Dokument per E-Mail an{" "}
                <strong>{state.form?.email}</strong>.
              </p>
            </div>
          ) : (
            <>
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-5 text-left mb-6">
                <h3 className="font-semibold text-amber-900 mb-3 text-sm">So geht es weiter:</h3>
                <ol className="text-sm text-amber-800 space-y-2 list-decimal list-inside">
                  <li className="flex items-start gap-2">
                    <Printer className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
                    <span>Sie erhalten die Beitrittserklärung als PDF per E-Mail an <strong>{state.form?.email}</strong>.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600 font-bold text-center">✍</span>
                    <span>Bitte <strong>drucken</strong> Sie das PDF aus und <strong>unterschreiben</strong> Sie es (bei Minderjährigen: Erziehungsberechtigte/r).</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Upload className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
                    <span>Laden Sie das unterschriebene Dokument als Scan oder Foto über den Upload-Link hoch (Link auch in der E-Mail).</span>
                  </li>
                </ol>
              </div>

              {state.upload_url && (
                <a
                  href={state.upload_url}
                  className="block w-full mb-6 py-3 px-4 bg-svu-600 text-white font-medium rounded-lg hover:bg-svu-700 transition-colors text-center flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Unterschriebenes Dokument jetzt hochladen
                </a>
              )}
            </>
          )}

          {!state.signedOnline && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 mb-6">
              Eine Bestätigung mit Ihrer Beitrittserklärung als PDF wird per E-Mail an{" "}
              <strong>{state.form?.email}</strong> gesendet.
            </div>
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
