import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Search,
  CheckCircle2,
  Clock,
  FileCheck,
  XCircle,
  Upload,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { ApiError, lookupStatus, type StatusLookupResponse } from "../services/api";
import {
  captureEvent,
  identifyApplicant,
  normalizeFailureReason,
} from "../lib/analytics";

const STEPS = [
  {
    key: "neu",
    label: "Eingegangen",
    description: "Antrag wurde eingereicht",
  },
  {
    key: "dokument_hochgeladen",
    label: "Dokument erhalten",
    description: "Unterschriebenes Dokument wurde hochgeladen",
  },
  {
    key: "in_bearbeitung",
    label: "In Bearbeitung",
    description: "Antrag wird vom Verein geprüft",
  },
  {
    key: "genehmigt",
    label: "Genehmigt",
    description: "Mitgliedschaft wurde bestätigt",
  },
];

const STATUS_INDEX: Record<string, number> = {
  neu: 0,
  dokument_hochgeladen: 1,
  in_bearbeitung: 2,
  genehmigt: 3,
};

export default function StatusPage() {
  const [searchParams] = useSearchParams();
  const [input, setInput] = useState(searchParams.get("nr") || "");
  const [data, setData] = useState<StatusLookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  // Auto-search if ?nr= param provided
  useEffect(() => {
    const nr = searchParams.get("nr");
    if (nr) {
      setInput(nr);
      doSearch(nr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSearch(nr?: string) {
    const query = (nr || input).trim();
    if (!query) return;

    setLoading(true);
    setError("");
    setData(null);
    setSearched(true);
    captureEvent("membership_status_lookup_requested", {
      app_area: "public",
      prefilled_query: Boolean(nr || searchParams.get("nr")),
    });

    try {
      const result = await lookupStatus(query);
      setData(result);
      identifyApplicant(result.antragsnummer, { app_area: "public" });
    } catch (err: any) {
      captureEvent("membership_status_lookup_failed", {
        app_area: "public",
        http_status: err instanceof ApiError ? err.status : null,
        reason:
          err instanceof ApiError
            ? normalizeFailureReason(err.status)
            : "server_error",
      });
      setError(
        err.message?.includes("404")
          ? "Antragsnummer nicht gefunden. Bitte überprüfen Sie die Eingabe."
          : err.message || "Ein Fehler ist aufgetreten."
      );
    } finally {
      setLoading(false);
    }
  }

  const isDeclined = data?.status === "abgelehnt";
  const currentIndex = data ? STATUS_INDEX[data.status] ?? -1 : -1;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-svu-600 text-white shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center gap-4">
          <img
            src="/logo_svu-241x300.png"
            alt="Sportverein 1945 Untereuerheim e.V."
            className="h-14 w-auto drop-shadow-md"
          />
          <div>
            <h1 className="text-2xl font-bold">
              Sportverein 1945 Untereuerheim e.V.
            </h1>
            <p className="text-svu-200 mt-0.5 text-sm">Antragsstatus prüfen</p>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 mt-8">
        {/* Search card */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-1">
            Status Ihrer Beitrittserklärung
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Geben Sie Ihre Antragsnummer ein, um den aktuellen Bearbeitungsstand
            zu sehen.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              doSearch();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder="z.B. ANT-2026-00001"
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex items-center gap-2 px-5 py-2.5 bg-svu-600 text-white text-sm font-medium rounded-lg hover:bg-svu-700 disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Suchen
            </button>
          </form>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-6 text-center">
            <XCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Result */}
        {data && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
            {/* Header bar */}
            <div className="bg-gray-50 border-b px-6 py-4 flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Antragsnummer
                </span>
                <p className="font-mono font-bold text-svu-600 text-lg">
                  {data.antragsnummer}
                </p>
              </div>
              <span className="text-sm font-medium text-gray-600">
                {data.status_label}
              </span>
            </div>

            <div className="p-6">
              {isDeclined ? (
                /* Declined state */
                <div className="text-center py-6">
                  <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <XCircle className="w-7 h-7 text-red-500" />
                  </div>
                  <h3 className="text-xl font-bold text-red-700 mb-1">
                    Abgelehnt
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Ihr Antrag wurde leider abgelehnt. Bei Fragen wenden Sie sich
                    bitte an{" "}
                    <a
                      href="mailto:mitgliedschaft@sv-untereuerheim.de"
                      className="text-svu-600 hover:underline"
                    >
                      mitgliedschaft@sv-untereuerheim.de
                    </a>
                    .
                  </p>
                  {data.admin_decline_reason && (
                    <div className="mt-4 text-left bg-red-50 border border-red-200 rounded-lg p-4">
                      <p className="text-xs font-medium text-red-800 mb-1">Begründung:</p>
                      <p className="text-sm text-red-900 whitespace-pre-wrap">
                        {data.admin_decline_reason}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* Workflow timeline */
                <div className="space-y-0">
                  {STEPS.map((step, i) => {
                    const isDone = currentIndex >= i;
                    const isCurrent = currentIndex === i;
                    const isLast = i === STEPS.length - 1;

                    return (
                      <div key={step.key} className="flex gap-4">
                        {/* Timeline column */}
                        <div className="flex flex-col items-center">
                          <div
                            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all ${
                              isDone
                                ? isCurrent && !isLast
                                  ? "bg-svu-600 border-svu-600 text-white"
                                  : step.key === "genehmigt" && isDone
                                  ? "bg-green-500 border-green-500 text-white"
                                  : "bg-svu-100 border-svu-300 text-svu-600"
                                : "bg-gray-100 border-gray-200 text-gray-400"
                            }`}
                          >
                            {isDone ? (
                              step.key === "genehmigt" ? (
                                <CheckCircle2 className="w-5 h-5" />
                              ) : isCurrent ? (
                                <StepIcon step={step.key} />
                              ) : (
                                <CheckCircle2 className="w-5 h-5" />
                              )
                            ) : (
                              <StepIcon step={step.key} />
                            )}
                          </div>
                          {!isLast && (
                            <div
                              className={`w-0.5 flex-1 min-h-[32px] ${
                                currentIndex > i
                                  ? "bg-svu-300"
                                  : "bg-gray-200"
                              }`}
                            />
                          )}
                        </div>

                        {/* Content column */}
                        <div className={`pb-6 ${isLast ? "pb-0" : ""}`}>
                          <h4
                            className={`font-semibold text-sm ${
                              isDone
                                ? isCurrent
                                  ? "text-svu-700"
                                  : "text-gray-700"
                                : "text-gray-400"
                            }`}
                          >
                            {step.label}
                          </h4>
                          <p
                            className={`text-xs mt-0.5 ${
                              isDone ? "text-gray-500" : "text-gray-300"
                            }`}
                          >
                            {step.description}
                          </p>
                          {/* Timestamps */}
                          {step.key === "neu" && data.created_at && isDone && (
                            <p className="text-xs text-gray-400 mt-1">
                              {new Date(data.created_at).toLocaleDateString(
                                "de-DE",
                                {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )}
                            </p>
                          )}
                          {step.key === "dokument_hochgeladen" &&
                            data.uploaded_at &&
                            isDone && (
                              <p className="text-xs text-gray-400 mt-1">
                                {new Date(data.uploaded_at).toLocaleDateString(
                                  "de-DE",
                                  {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )}
                              </p>
                            )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Eingereicht info */}
            {data.created_at && (
              <div className="bg-gray-50 border-t px-6 py-3 text-xs text-gray-500 flex justify-between">
                <span>
                  Eingereicht am{" "}
                  {new Date(data.created_at).toLocaleDateString("de-DE")}
                </span>
                {!data.has_upload && data.status === "neu" && (
                  <span className="text-amber-600 font-medium">
                    Unterschriebenes Dokument noch ausstehend
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!data && !error && !loading && !searched && (
          <div className="text-center py-12 text-gray-400">
            <Search className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              Geben Sie Ihre Antragsnummer ein, um den Status abzufragen.
            </p>
            <p className="text-xs mt-1">
              Sie finden die Nummer in Ihrer Bestätigungs-E-Mail.
            </p>
          </div>
        )}

        {/* Back link */}
        <div className="text-center mb-4">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-svu-600 hover:text-svu-700 font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Zurück zur Beitrittserklärung
          </Link>
        </div>

        <footer className="text-center text-xs text-gray-400 py-8 space-y-1">
          <p className="font-medium text-gray-500">
            Sportverein 1945 Untereuerheim e.V.
          </p>
          <p>Triebweg 9 · 97508 Grettstadt/Untereuerheim</p>
          <p>1. Vorsitzender: Alexander Eckert · Tel: 09729/432</p>
          <p>
            E-Mail:{" "}
            <a
              href="mailto:info@sv-untereuerheim.de"
              className="hover:text-svu-600"
            >
              info@sv-untereuerheim.de
            </a>
          </p>
          <p>Registergericht: Amtsgericht Schweinfurt · Registernummer: VR 31 · Steuer-ID: 249/111/20506</p>
          <p className="pt-2 space-x-3">
            <a
              href="https://sv-untereuerheim.de/impressum/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-svu-600 underline"
            >
              Impressum
            </a>
            <a
              href="https://sv-untereuerheim.de/datenschutz/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-svu-600 underline"
            >
              Datenschutz
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}

function StepIcon({ step }: { step: string }) {
  switch (step) {
    case "neu":
      return <Clock className="w-4 h-4" />;
    case "dokument_hochgeladen":
      return <Upload className="w-4 h-4" />;
    case "in_bearbeitung":
      return <FileCheck className="w-4 h-4" />;
    case "genehmigt":
      return <CheckCircle2 className="w-4 h-4" />;
    default:
      return <Clock className="w-4 h-4" />;
  }
}
