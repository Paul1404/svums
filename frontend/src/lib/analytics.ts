// Thin wrapper around Umami analytics. The Umami tracking script is loaded in
// index.html and exposes `window.umami` once ready. Pageviews (including SPA
// route changes) are tracked automatically by the script. These helpers send
// custom events for the membership funnel and strip personal data before it
// leaves the browser.

type Primitive = string | number | boolean | null | undefined;
type EventProperties = Record<string, Primitive>;

declare global {
  interface Window {
    umami?: {
      track: (eventName: string, data?: Record<string, string | number | boolean | null>) => void;
    };
  }
}

const DISALLOWED_KEYS = new Set([
  "vorname",
  "nachname",
  "email",
  "telefon",
  "strasse",
  "plz",
  "ort",
  "iban",
  "bic",
  "recipient",
  "subject",
  "error_message",
  "admin_decline_reason",
  "decline_reason",
  "filename",
  "uploaded_file",
  "admin_approved_file",
  "password",
  "smtp_password",
]);

function sanitizeProperties(properties?: EventProperties): Record<string, string | number | boolean | null> {
  const sanitized: Record<string, string | number | boolean | null> = {};
  if (!properties) return sanitized;
  for (const [key, value] of Object.entries(properties)) {
    if (DISALLOWED_KEYS.has(key)) continue;
    if (value === undefined) continue;
    sanitized[key] = value ?? null;
  }
  return sanitized;
}

export function normalizeFailureReason(status?: number | null): string {
  if (status === 400 || status === 422) return "validation_error";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 410) return "expired_link";
  if (status === 429) return "rate_limited";
  if (status && status >= 500) return "server_error";
  return "server_error";
}

export function captureEvent(event: string, properties?: EventProperties): void {
  window.umami?.track(event, sanitizeProperties({ source: "frontend", ...properties }));
}
