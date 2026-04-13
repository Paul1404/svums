import { getAdminDistinctIdHeader } from "../lib/analytics";

// ---- Types ----

export interface ClientConfig {
  posthog_enabled: boolean;
  posthog_key: string | null;
  posthog_host: string | null;
  club: Record<string, unknown>;
}

export interface ChildData {
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  abteilungen: string[];
}

export interface ApplicationData {
  antragstyp: "einzel" | "kind" | "familie";
  geschlecht: "Herr" | "Frau" | "keine Angabe" | null;
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  strasse: string;
  plz: string;
  ort: string;
  telefon: string;
  email: string;
  abteilungen: string[];
  mitgliedschaft_typ: string;
  elternteil_mitglied: boolean | null;
  erziehungsberechtigter_vorname: string;
  erziehungsberechtigter_nachname: string;
  partner_vorname: string;
  partner_nachname: string;
  partner_geburtsdatum: string | null;
  partner_abteilungen: string[];
  kinder: ChildData[] | null;
  kontoinhaber: string;
  iban: string;
  bic: string;
  kreditinstitut: string;
  /** Base64 data-URL of the drawn signature PNG (Option B – inline signing). */
  unterschrift_base64?: string | null;
  /** Legal consent checkboxes (DSGVO) */
  datenschutz_accepted: boolean;
  satzung_accepted: boolean;
  /** Test mode flag — set when submitting via admin test mode */
  is_test?: boolean;
}

export interface ApplicationResponse {
  id: number;
  antragsnummer: string | null;
  antragstyp: string;
  geschlecht: string | null;
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  strasse: string;
  plz: string;
  ort: string;
  telefon: string | null;
  email: string;
  erziehungsberechtigter_vorname: string | null;
  erziehungsberechtigter_nachname: string | null;
  partner_vorname: string | null;
  partner_nachname: string | null;
  partner_geburtsdatum: string | null;
  partner_abteilungen: string[] | null;
  kinder: Array<{ vorname: string; nachname: string; geburtsdatum: string; abteilungen: string[] }> | null;
  abteilungen: string[];
  mitgliedschaft_typ: string;
  elternteil_mitglied: boolean | null;
  jahresbeitrag: number;
  kontoinhaber: string | null;
  iban: string;
  bic: string | null;
  kreditinstitut: string | null;
  mandatsreferenz: string | null;
  status: string;
  notes: string | null;
  email_sent: boolean;
  uploaded_file: string | null;
  uploaded_at: string | null;
  admin_decline_reason: string | null;
  admin_approved_file: string | null;
  mitgliedsnummer: string | null;
  consent_at: string | null;
  datenschutz_accepted: boolean | null;
  satzung_accepted: boolean | null;
  consent_ip: string | null;
  is_test: boolean;
  created_at: string;
}

export interface ApplicationListResponse {
  items: ApplicationResponse[];
  total: number;
  page: number;
  per_page: number;
}

export interface AdminStatsResponse {
  total: number;
  by_status: Record<string, number>;
  revenue_approved: number | string;
  applications_this_month: number;
  by_abteilung: Record<string, number>;
  by_age_group: Record<string, number>;
  by_membership_type: Record<string, number>;
  by_gender: Record<string, number>;
}

export interface StatusLookupResponse {
  antragsnummer: string;
  status: string;
  status_label: string;
  created_at: string | null;
  uploaded_at: string | null;
  has_upload: boolean;
  admin_decline_reason?: string;
}

export interface FeeResponse {
  jahresbeitrag: number;
  mitgliedschaft_typ: string;
  label: string;
}

export interface IbanLookupResponse {
  valid: boolean;
  iban: string;
  bic: string | null;
  bank_name: string | null;
  country?: string;
}

export interface SettingsData {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password_configured: boolean;
  smtp_from: string;
  smtp_use_tls: boolean;
  notification_email: string;
  admin_signature_base64: string | null;
}

export interface SettingsUpdateData {
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_password?: string;
  clear_smtp_password?: boolean;
  smtp_from?: string;
  smtp_use_tls?: boolean;
  notification_email?: string;
  admin_signature_base64?: string | null;
}

export interface ClubConfigData {
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
  fees: Array<{
    typ: string;
    betrag: string;
    label: string;
    elternteil_mitglied: boolean | null;
  }>;
  departments: string[];
  primary_color: string;
  primary_color_dark: string;
  primary_color_light: string;
  logo_url: string;
  email_subject_prefix: string;
}

export interface CancellationLetterResponse {
  id: number;
  anrede: string;
  vorname: string;
  nachname: string;
  strasse: string;
  plz: string;
  ort: string;
  geburtsdatum: string;
  mitgliedsnummer: string | null;
  abteilung: string | null;
  austritt_datum: string;
  signature_source: "none" | "request" | "admin_saved" | string;
  filename: string;
  created_at: string;
}

// ---- Formatting helpers ----

/**
 * Formats a fee amount in German locale.
 * Whole euro amounts → "54,– €"
 * Amounts with cents  → "54,50 €"
 *
 * Accepts both `number` and `string` because Pydantic v2 serialises
 * Python `Decimal` fields as JSON strings (e.g. "54.00").
 */
export function formatFee(amount: number | string): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return "–";
  if (n % 1 === 0) {
    return `${Math.round(n).toString()},– €`;
  }
  return `${n.toFixed(2).replace(".", ",")} €`;
}

// ---- API helpers ----

/** Human-readable fallback messages for HTTP status codes (German). */
const HTTP_ERROR_MESSAGES: Record<number, string> = {
  400: "Die Anfrage war ungültig. Bitte überprüfen Sie Ihre Eingaben.",
  401: "Sie sind nicht angemeldet oder Ihre Sitzung ist abgelaufen.",
  403: "Zugriff verweigert. Sie haben keine Berechtigung für diese Aktion.",
  404: "Die angeforderte Seite wurde nicht gefunden.",
  408: "Die Anfrage hat zu lange gedauert. Bitte versuchen Sie es erneut.",
  409: "Ein Konflikt ist aufgetreten. Bitte laden Sie die Seite neu.",
  410: "Diese Ressource ist nicht mehr verfügbar.",
  413: "Die Datei ist zu groß.",
  422: "Die Eingabedaten sind ungültig. Bitte überprüfen Sie Ihre Angaben.",
  429: "Zu viele Anfragen. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
  500: "Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.",
  502: "Der Server ist vorübergehend nicht erreichbar. Bitte versuchen Sie es später erneut.",
  503: "Der Dienst ist vorübergehend nicht verfügbar. Bitte versuchen Sie es später erneut.",
  504: "Der Server hat zu lange nicht geantwortet. Bitte versuchen Sie es später erneut.",
};

function httpErrorFallback(status: number): string {
  return HTTP_ERROR_MESSAGES[status]
    ?? "Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.";
}

/**
 * Extracts a human-readable error message from a FastAPI error response body.
 * FastAPI can return `detail` as a plain string (most errors) or as an array
 * of Pydantic validation error objects (HTTP 422). This helper always returns
 * a plain string so it is safe to pass to `new Error()` or `toast.error()`.
 */
export function extractApiError(
  errorData: unknown,
  fallback: string
): string {
  if (errorData == null || typeof errorData !== "object") return fallback;
  const detail = (errorData as Record<string, unknown>).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // Pydantic v1/v2 validation errors: [{loc, msg, type}, ...]
    const messages = detail
      .map((e) => {
        if (!e || typeof e !== "object") return null;
        const obj = e as Record<string, unknown>;
        if (typeof obj.msg === "string") return obj.msg;
        if (Array.isArray(obj.loc) && obj.loc.length > 0) {
          const field = obj.loc[obj.loc.length - 1];
          return `Ungültige Eingabe im Feld "${field}"`;
        }
        return "Ungültige Eingabe";
      })
      .filter(Boolean);
    return messages.length > 0 ? messages.join("; ") : fallback;
  }
  if (detail != null) return String(detail);
  return fallback;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// ---- Session expiry callback ----

let _onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null) {
  _onSessionExpired = handler;
}

export function getCsrfTokenFromCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const { headers: extraHeaders, body, ...rest } = options;
  // Don't set Content-Type for FormData — the browser adds it with the correct boundary
  const baseHeaders: Record<string, string> = body instanceof FormData
    ? {}
    : { "Content-Type": "application/json" };
  const adminHeaders = url.startsWith("/api/admin")
    ? getAdminDistinctIdHeader()
    : {};
  // Include CSRF token on all state-changing requests (defense-in-depth)
  const method = (rest.method || "GET").toUpperCase();
  const csrfHeaders: Record<string, string> = {};
  if (method !== "GET" && method !== "HEAD") {
    let token = getCsrfTokenFromCookie();
    if (!token) {
      token = await getCsrfToken();
    }
    csrfHeaders["X-CSRF-Token"] = token;
  }
  const response = await fetch(url, {
    credentials: "include",
    body,
    ...rest,
    headers: {
      ...baseHeaders,
      ...adminHeaders,
      ...csrfHeaders,
      ...(extraHeaders as Record<string, string>),
    },
  });

  if (!response.ok) {
    if (response.status === 401 && url.startsWith("/api/admin")) {
      _onSessionExpired?.();
    }
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      extractApiError(errorData, httpErrorFallback(response.status)),
      response.status
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<T>;
  }

  const rawBody = await response.text();
  if (!rawBody.trim()) {
    return undefined as T;
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    // Be defensive: some endpoints can return plain text/html from proxies.
    return rawBody as T;
  }
}

// ---- CSRF ----

let _csrfToken: string | null = null;

export async function getClientConfig(): Promise<ClientConfig> {
  return apiRequest("/api/client-config");
}

export async function getCsrfToken(): Promise<string> {
  if (_csrfToken) return _csrfToken;
  const res = await apiRequest<{ csrf_token: string }>("/api/csrf-token");
  _csrfToken = res.csrf_token;
  return _csrfToken;
}

// ---- Public API ----

export async function submitApplication(
  data: ApplicationData
): Promise<{
  id: number;
  antragsnummer: string;
  mandatsreferenz: string;
  upload_url: string;
  message: string;
}> {
  const csrfToken = await getCsrfToken();
  return apiRequest("/api/apply", {
    method: "POST",
    body: JSON.stringify(data),
    headers: { "X-CSRF-Token": csrfToken },
  });
}

export async function calculateFee(
  geburtsdatum: string,
  mitgliedschaft_typ: string,
  elternteil_mitglied: boolean | null
): Promise<FeeResponse> {
  const params = new URLSearchParams({
    geburtsdatum,
    mitgliedschaft_typ,
  });
  if (elternteil_mitglied !== null) {
    params.set("elternteil_mitglied", String(elternteil_mitglied));
  }
  return apiRequest(`/api/fees/calculate?${params}`);
}

export async function lookupIban(iban: string): Promise<IbanLookupResponse> {
  return apiRequest(`/api/iban/lookup?iban=${encodeURIComponent(iban)}`);
}

export async function checkDuplicate(
  vorname: string,
  nachname: string,
  geburtsdatum: string
): Promise<{ duplicate: boolean }> {
  const params = new URLSearchParams({ vorname, nachname, geburtsdatum });
  return apiRequest(`/api/check-duplicate?${params}`);
}

export async function lookupStatus(
  antragsnummer: string
): Promise<StatusLookupResponse> {
  return apiRequest(
    `/api/status/${encodeURIComponent(antragsnummer.trim())}`
  );
}

// ---- Address API ----

export interface PlzLookupResponse {
  plz: string;
  orte: string[];
  found: boolean;
}

export interface StreetResult {
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  display: string;
}

export interface StreetSearchResponse {
  query: string;
  results: StreetResult[];
}

export async function lookupPlz(plz: string): Promise<PlzLookupResponse> {
  return apiRequest(`/api/address/plz/${encodeURIComponent(plz)}`);
}

export async function searchStreets(
  q: string,
  plz?: string,
  ort?: string
): Promise<StreetSearchResponse> {
  const params = new URLSearchParams({ q });
  if (plz) params.set("plz", plz);
  if (ort) params.set("ort", ort);
  return apiRequest(`/api/address/streets?${params}`);
}

// ---- Admin API ----

export async function adminLogin(
  password: string
): Promise<{ message: string }> {
  return apiRequest("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function adminLogout(): Promise<void> {
  await apiRequest("/api/admin/logout", { method: "POST" });
}

export async function adminCheck(): Promise<{ authenticated: boolean }> {
  return apiRequest("/api/admin/me");
}

export async function getApplications(
  page = 1,
  perPage = 25,
  status?: string,
  search?: string,
  showTest?: boolean | null
): Promise<ApplicationListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  if (showTest !== undefined && showTest !== null) {
    params.set("show_test", String(showTest));
  }
  return apiRequest(`/api/admin/applications?${params}`);
}

export interface TestDataResponse {
  membership_type: string;
  geschlecht: string | null;
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  strasse: string;
  plz: string;
  ort: string;
  email: string;
  telefon: string;
  abteilungen: string[];
  kontoinhaber: string;
  iban: string;
  bic: string;
  kreditinstitut: string;
  erziehungsberechtigter_vorname?: string;
  erziehungsberechtigter_nachname?: string;
  elternteil_mitglied?: boolean;
  partner_vorname?: string;
  partner_nachname?: string;
  partner_geburtsdatum?: string;
  partner_abteilungen?: string[];
  kinder?: Array<{ vorname: string; nachname: string; geburtsdatum: string; abteilungen: string[] }>;
}

export async function getTestData(
  type: "einzel" | "kind" | "familie" = "einzel"
): Promise<TestDataResponse> {
  return apiRequest(`/api/admin/test-data?type=${type}`);
}

export async function getAdminStats(): Promise<AdminStatsResponse> {
  return apiRequest("/api/admin/stats");
}

export async function getApplication(
  id: number
): Promise<ApplicationResponse> {
  return apiRequest(`/api/admin/applications/${id}`);
}

export async function updateApplication(
  id: number,
  data: {
    status?: string;
    notes?: string;
    admin_unterschrift_base64?: string | null;
    use_saved_admin_signature?: boolean;
    admin_decline_reason?: string | null;
    mitgliedsnummer?: string | null;
  }
): Promise<ApplicationResponse> {
  return apiRequest(`/api/admin/applications/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteApplication(id: number): Promise<void> {
  await apiRequest(`/api/admin/applications/${id}`, { method: "DELETE" });
}

export async function resendEmail(
  id: number
): Promise<{ message: string }> {
  return apiRequest(`/api/admin/applications/${id}/resend-email`, {
    method: "POST",
  });
}

export async function getSettings(): Promise<SettingsData> {
  return apiRequest("/api/admin/settings");
}

export async function updateSettings(
  data: SettingsUpdateData
): Promise<SettingsData> {
  return apiRequest("/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function testSmtp(
  recipient: string
): Promise<{ message: string }> {
  return apiRequest("/api/admin/settings/test-smtp", {
    method: "POST",
    body: JSON.stringify({ recipient }),
  });
}

export interface EmailLogEntry {
  id: number;
  timestamp: string;
  email_type: string;
  recipient: string;
  subject: string | null;
  status: "success" | "failed";
  error_message: string | null;
  antragsnummer: string | null;
  vorname: string | null;
  nachname: string | null;
}

export async function adminUploadDocument(
  id: number,
  file: File
): Promise<ApplicationResponse> {
  const form = new FormData();
  form.append("file", file);
  return apiRequest(`/api/admin/applications/${id}/admin-upload`, {
    method: "POST",
    body: form,
  });
}

export async function deleteApplicationUpload(
  id: number
): Promise<{ ok: boolean }> {
  return apiRequest(`/api/admin/applications/${id}/upload`, {
    method: "DELETE",
  });
}

export async function deleteApplicationApproved(
  id: number
): Promise<{ ok: boolean }> {
  return apiRequest(`/api/admin/applications/${id}/approved`, {
    method: "DELETE",
  });
}

export async function deleteCancellationDocument(
  documentId: number
): Promise<{ ok: boolean }> {
  return apiRequest(`/api/admin/cancellation-documents/${documentId}`, {
    method: "DELETE",
  });
}

export async function getEmailLogs(params?: {
  status?: string;
  email_type?: string;
}): Promise<EmailLogEntry[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.email_type) qs.set("email_type", params.email_type);
  const query = qs.toString() ? `?${qs}` : "";
  return apiRequest(`/api/admin/email-logs${query}`);
}

export async function getCancellationDocuments(
  limit = 500
): Promise<CancellationLetterResponse[]> {
  return apiRequest(`/api/admin/cancellation-documents?limit=${limit}`);
}

// ---- Club Config API ----

export async function getClubConfig(): Promise<ClubConfigData> {
  return apiRequest("/api/admin/club-config");
}

export async function updateClubConfig(
  data: Partial<ClubConfigData>
): Promise<ClubConfigData> {
  return apiRequest("/api/admin/club-config", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
