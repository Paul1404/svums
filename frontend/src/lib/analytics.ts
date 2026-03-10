import posthog from "posthog-js";

type Primitive = string | number | boolean | null | undefined;
type EventProperties = Record<string, Primitive>;

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

let analyticsEnabled = false;
let initPromise: Promise<void> | null = null;
let lastPageViewKey: string | null = null;

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

export async function initAnalytics(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const response = await fetch("/api/client-config", { credentials: "include" });
      if (!response.ok) return;
      const config = await response.json() as {
        posthog_enabled?: boolean;
        posthog_key?: string | null;
        posthog_host?: string | null;
      };
      if (!config.posthog_enabled || !config.posthog_key) return;

      posthog.init(config.posthog_key, {
        api_host: config.posthog_host ?? "https://eu.i.posthog.com",
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
        capture_pageleave: true,
      });
      analyticsEnabled = true;
    } catch {
      analyticsEnabled = false;
    }
  })();
  return initPromise;
}

export function captureEvent(event: string, properties?: EventProperties): void {
  if (!analyticsEnabled) return;
  posthog.capture(event, sanitizeProperties({ source: "frontend", ...properties }));
}

export function capturePageView(routeName: string, properties?: EventProperties): void {
  if (!analyticsEnabled) return;
  const payload = sanitizeProperties({
    route_name: routeName,
    source: "frontend",
    ...properties,
  });
  const pageKey = JSON.stringify([
    window.location.pathname,
    window.location.search,
    routeName,
    payload,
  ]);
  if (pageKey === lastPageViewKey) return;
  lastPageViewKey = pageKey;
  posthog.capture("$pageview", payload);
}

export function identifyApplicant(antragsnummer: string, properties?: EventProperties): void {
  if (!analyticsEnabled || !antragsnummer.trim()) return;
  const distinctId = antragsnummer.trim();
  const currentDistinctId = posthog.get_distinct_id();
  if (currentDistinctId && currentDistinctId !== distinctId) {
    try {
      posthog.alias(distinctId, currentDistinctId);
    } catch {
      // Alias can fail when already linked; identify is still safe.
    }
  }
  posthog.identify(
    distinctId,
    sanitizeProperties({ source: "frontend", ...properties })
  );
}

export function identifyAdmin(properties?: EventProperties): void {
  if (!analyticsEnabled) return;
  const distinctId = posthog.get_distinct_id();
  if (!distinctId) return;
  posthog.identify(
    distinctId,
    sanitizeProperties({ role: "admin", source: "frontend", ...properties })
  );
}

export function resetAnalyticsIdentity(): void {
  if (!analyticsEnabled) return;
  posthog.reset();
}

export function getAdminDistinctIdHeader(): Record<string, string> {
  if (!analyticsEnabled) return {};
  const distinctId = posthog.get_distinct_id();
  return distinctId ? { "X-PostHog-Distinct-Id": distinctId } : {};
}
