import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Safely extract a human-readable message from anything caught in a `catch`.
 * Covers Error instances, strings, and unknown non-Error throwables so that
 * toast.error() never shows `undefined` when a non-Error slips through.
 */
export function errorMessage(err: unknown, fallback = "Ein Fehler ist aufgetreten"): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return fallback;
}

/**
 * Validate a phone number. Returns an error message string or null if valid.
 */
export function validatePhone(telefon: string, optOut: boolean): string | null {
  if (optOut) return null;
  if (!telefon.trim())
    return "Bitte geben Sie eine Telefonnummer an oder wählen Sie \u201EIch möchte keine angeben\u201C.";
  const cleaned = telefon.replace(/[\s\-/()]/g, "");
  if (!/^\+?\d{6,15}$/.test(cleaned))
    return "Ungültige Telefonnummer";
  return null;
}
