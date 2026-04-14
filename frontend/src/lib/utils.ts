import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
