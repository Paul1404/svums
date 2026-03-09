// ---- Types ----

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
  consent_at: string | null;
  created_at: string;
}

export interface ApplicationListResponse {
  items: ApplicationResponse[];
  total: number;
  page: number;
  per_page: number;
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
      .map((e) =>
        e && typeof e === "object" && typeof (e as Record<string, unknown>).msg === "string"
          ? (e as Record<string, unknown>).msg as string
          : JSON.stringify(e)
      )
      .filter(Boolean);
    return messages.length > 0 ? messages.join("; ") : fallback;
  }
  if (detail != null) return String(detail);
  return fallback;
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
  const response = await fetch(url, {
    credentials: "include",
    body,
    ...rest,
    headers: {
      ...baseHeaders,
      ...(extraHeaders as Record<string, string>),
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(extractApiError(errorData, `Fehler: ${response.status}`));
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
  search?: string
): Promise<ApplicationListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  return apiRequest(`/api/admin/applications?${params}`);
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
