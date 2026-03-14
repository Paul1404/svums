import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import SignatureCanvas from "react-signature-canvas";
import {
  ApiError,
  submitApplication,
  calculateFee,
  lookupIban,
  checkDuplicate,
  formatFee,
} from "../services/api";
import AddressFields from "../components/AddressFields";
import type { ApplicationData, ChildData, FeeResponse } from "../services/api";
import {
  captureEvent,
  identifyApplicant,
  normalizeFailureReason,
} from "../lib/analytics";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Upload,
  User,
} from "lucide-react";

const ABTEILUNGEN = [
  "Fußball",
  "Gymnastik",
  "Combo",
  "Kinderturnen",
  "Korbball",
  "Tischtennis",
  "Yoga",
  "Dart",
  "Lauftreff",
  "PingPongParkinson",
  "Keine Abteilung",
];

type Antragstyp = "einzel" | "kind" | "familie";

/**
 * Calculate age as of Jan 1st of the current year (Stichtag).
 * Used for membership category / fee determination.
 */
function calculateAge(birthDateStr: string): number {
  const birth = new Date(birthDateStr);
  const stichtag = new Date(new Date().getFullYear(), 0, 1); // Jan 1st
  let age = stichtag.getFullYear() - birth.getFullYear();
  if (
    stichtag.getMonth() < birth.getMonth() ||
    (stichtag.getMonth() === birth.getMonth() &&
      stichtag.getDate() < birth.getDate())
  )
    age--;
  return age;
}

/**
 * Calculate actual age as of today (for validation purposes, not fee categories).
 */
function calculateRealAge(birthDateStr: string): number {
  const birth = new Date(birthDateStr);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function determineMitgliedschaftTyp(
  birthDateStr: string,
  antragstyp: Antragstyp
): string {
  if (antragstyp === "familie") return "familie";
  const age = calculateAge(birthDateStr); // Stichtag-based
  if (age < 14) return "kind";
  if (age < 18) return "jugendlich";
  if (age < 25) return "junger_erwachsener";
  return "erwachsener";
}

function formatIban(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return cleaned.replace(/(.{4})/g, "$1 ").trim();
}

function validateIbanChecksum(iban: string): boolean {
  const cleaned = iban.replace(/\s/g, "").toUpperCase();
  if (cleaned.length < 15 || cleaned.length > 34) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cleaned)) return false;
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  let numStr = "";
  for (const ch of rearranged) {
    numStr += ch >= "A" && ch <= "Z" ? (ch.charCodeAt(0) - 55).toString() : ch;
  }
  let remainder = 0;
  for (let i = 0; i < numStr.length; i += 7) {
    remainder = parseInt(String(remainder) + numStr.slice(i, i + 7)) % 97;
  }
  return remainder === 1;
}

const IBAN_LENGTHS: Record<string, number> = {
  DE: 22, AT: 20, CH: 21, FR: 27, NL: 18, BE: 16, IT: 27, ES: 24,
  LU: 20, GB: 22, PL: 28, CZ: 24, SE: 24, DK: 18, NO: 15, FI: 18,
};

const NAME_REGEX = /^[a-zA-Z\u00C0-\u024F\s\-'.]+$/;

const emptyChild = (): ChildData => ({
  vorname: "",
  nachname: "",
  geburtsdatum: "",
  abteilungen: [],
});

const typLabel: Record<string, string> = {
  kind: "Kind (bis 14 Jahre)",
  jugendlich: "Jugendlich (bis 18 Jahre)",
  junger_erwachsener: "Junger Erwachsener (bis 25 Jahre)",
  erwachsener: "Erwachsener",
  familie: "Familie",
};

// ---- SessionStorage helpers for form draft persistence ----
const DRAFT_KEY = "svums_form_draft_v3";

function loadDraft(): Record<string, any> | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft(data: Record<string, any>) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch {}
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {}
}

// =============================================
// MAIN COMPONENT
// =============================================
export default function ApplicationForm() {
  const navigate = useNavigate();

  // Restore form draft from sessionStorage (only on initial mount)
  const [_d] = useState(loadDraft);

  const [step, setStep] = useState<number>(_d?.step ?? 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [consent, setConsent] = useState(false);
  const [feeInfo, setFeeInfo] = useState<FeeResponse | null>(null);
  const [duplicateChecked, setDuplicateChecked] = useState(false);

  // ---- Signature flow: "upload" (Option A, default) or "inline" (Option B)
  const [signatureMode, setSignatureMode] = useState<"upload" | "inline">("upload");
  const [sigEmpty, setSigEmpty] = useState(true);
  const sigCanvasRef = useRef<SignatureCanvas | null>(null);
  // Container ref + dynamic width so the canvas internal resolution always
  // matches its CSS size — prevents the touch-offset bug on mobile.
  const sigContainerRef = useRef<HTMLDivElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(600);

  // Keep canvas internal width in sync with its rendered container width.
  useEffect(() => {
    const el = sigContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0 && w !== canvasWidth) {
        setCanvasWidth(w);
        // Clear on resize — a stretched signature would look wrong.
        sigCanvasRef.current?.clear();
        setSigEmpty(true);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigContainerRef.current]);

  // ---- Fullscreen mobile signing
  const isMobile = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const [fullscreenSig, setFullscreenSig] = useState(false);
  const [isPortrait, setIsPortrait] = useState(
    typeof window !== "undefined" ? window.matchMedia("(orientation: portrait)").matches : true,
  );
  const fullscreenCanvasRef = useRef<SignatureCanvas | null>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);
  const [fsCanvasWidth, setFsCanvasWidth] = useState(800);
  const [fsCanvasHeight, setFsCanvasHeight] = useState(400);
  // Stores the data-URL captured from the fullscreen canvas after confirmation.
  const [capturedSigDataUrl, setCapturedSigDataUrl] = useState<string | null>(null);
  const [uploadedSignatureDataUrl, setUploadedSignatureDataUrl] = useState<string | null>(null);
  const formStartedTrackedRef = useRef(false);
  const lastFeeEventKeyRef = useRef<string | null>(null);

  // Track orientation changes so the overlay can prompt users to rotate.
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const handler = (e: MediaQueryListEvent) => setIsPortrait(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Keep the fullscreen canvas dimensions in sync with its container.
  useEffect(() => {
    const el = fullscreenContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const w = Math.floor(width);
      const h = Math.floor(height);
      if (w > 0) setFsCanvasWidth(w);
      if (h > 0) setFsCanvasHeight(h);
      fullscreenCanvasRef.current?.clear();
    });
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreenContainerRef.current]);

  // ---- Gender / salutation (contact person: applicant for Einzel/Familie, guardian for Kind)
  const [geschlecht, setGeschlecht] = useState<"Herr" | "Frau" | "keine Angabe" | null>(_d?.geschlecht ?? null);

  // ---- Person data (applicant for Einzel, child for Kind, parent for Familie)
  const [vorname, setVorname] = useState(_d?.vorname ?? "");
  const [nachname, setNachname] = useState(_d?.nachname ?? "");
  const [geburtsdatum, setGeburtsdatum] = useState(_d?.geburtsdatum ?? "");
  const [strasse, setStrasse] = useState(_d?.strasse ?? "");
  const [plz, setPlz] = useState(_d?.plz ?? "");
  const [ort, setOrt] = useState(_d?.ort ?? "");
  const [telefon, setTelefon] = useState(_d?.telefon ?? "");
  const [email, setEmail] = useState(_d?.email ?? "");
  const [abteilungen, setAbteilungen] = useState<string[]>(_d?.abteilungen ?? []);

  // ---- Kind-specific: parent/guardian
  const [erzVorname, setErzVorname] = useState(_d?.erzVorname ?? "");
  const [erzNachname, setErzNachname] = useState(_d?.erzNachname ?? "");
  const [elternteilMitglied, setElternteilMitglied] = useState<boolean | null>(_d?.elternteilMitglied ?? null);

  // ---- Familie-specific: children
  // Filter out empty children from draft (prevents stale draft triggering Familie)
  const [kinder, setKinder] = useState<ChildData[]>(
    (_d?.kinder ?? []).filter((k: any) => k.vorname || k.nachname || k.geburtsdatum)
  );

  // ---- Familie: which child card is expanded (-1 = all expanded when <=2)
  const [expandedChild, setExpandedChild] = useState<number | null>(null);

  // ---- Familie-specific: partner / second parent (optional)
  const [partnerVorname, setPartnerVorname] = useState(_d?.partnerVorname ?? "");
  const [partnerNachname, setPartnerNachname] = useState(_d?.partnerNachname ?? "");
  const [partnerGeburtsdatum, setPartnerGeburtsdatum] = useState(_d?.partnerGeburtsdatum ?? "");
  const [partnerAbteilungen, setPartnerAbteilungen] = useState<string[]>(_d?.partnerAbteilungen ?? []);

  // ---- SEPA
  const [kontoinhaber, setKontoinhaber] = useState(_d?.kontoinhaber ?? "");
  const [iban, setIban] = useState(_d?.iban ?? "");
  const [bic, setBic] = useState(_d?.bic ?? "");
  const [kreditinstitut, setKreditinstitut] = useState(_d?.kreditinstitut ?? "");

  // ---- IBAN lookup
  const [ibanLookup, setIbanLookup] = useState<{
    loading: boolean;
    valid: boolean | null;
    autoFilled: boolean;
  }>({ loading: false, valid: null, autoFilled: false });

  // ---- Derived: auto-detect antragstyp from person composition
  const isMinor = geburtsdatum ? calculateRealAge(geburtsdatum) < 18 : false;
  const isAdult = geburtsdatum ? calculateRealAge(geburtsdatum) >= 18 : false;

  // Partner counts as present only when both first and last name have ≥ 2 chars
  const hasPartner =
    partnerVorname.trim().length >= 2 && partnerNachname.trim().length >= 2;

  // Family membership requires BOTH children AND a partner/second adult.
  // If only children are present (no partner), the applicant stays "einzel"
  // so their individual fee is shown, and validation will block submission
  // until a partner is also entered.
  const antragstyp: Antragstyp | null = !geburtsdatum
    ? null
    : isMinor
    ? "kind"
    : kinder.length > 0 && hasPartner
    ? "familie"
    : "einzel";

  const mitgliedschaftTyp =
    antragstyp === "familie"
      ? "familie"
      : geburtsdatum
      ? determineMitgliedschaftTyp(geburtsdatum, antragstyp || "einzel")
      : "";

  const isChildType =
    mitgliedschaftTyp === "kind" || mitgliedschaftTyp === "jugendlich";

  // Step labels — 3-step flow (type is auto-detected)
  const STEPS = [
    { label: "Mitgliedsdaten", icon: User },
    { label: "SEPA-Lastschrift", icon: CreditCard },
    { label: "Zusammenfassung", icon: Send },
  ];

  // ---- Fee calculation
  useEffect(() => {
    if (!antragstyp) {
      setFeeInfo(null);
      return;
    }
    if (antragstyp === "familie") {
      setFeeInfo({ jahresbeitrag: 96, mitgliedschaft_typ: "familie", label: "Familie (2 Erwachsene + Kinder bis 18 Jahre)" });
      return;
    }
    if (!geburtsdatum || !mitgliedschaftTyp) {
      setFeeInfo(null);
      return;
    }
    if (antragstyp === "kind" && isChildType && elternteilMitglied === null) {
      setFeeInfo(null);
      return;
    }
    calculateFee(geburtsdatum, mitgliedschaftTyp, elternteilMitglied)
      .then(setFeeInfo)
      .catch(() => setFeeInfo(null));
  }, [geburtsdatum, mitgliedschaftTyp, elternteilMitglied, antragstyp, isChildType]);

  useEffect(() => {
    if (formStartedTrackedRef.current) return;
    if (_d) {
      captureEvent("membership_form_started", {
        app_area: "public",
        has_draft: true,
        entry_path: window.location.pathname,
      });
      formStartedTrackedRef.current = true;
    }
  }, [_d]);

  useEffect(() => {
    if (formStartedTrackedRef.current) return;
    const hasMeaningfulData = Boolean(vorname || nachname || geburtsdatum || email || iban);
    if (!hasMeaningfulData) return;
    captureEvent("membership_form_started", {
      app_area: "public",
      has_draft: false,
      entry_path: window.location.pathname,
    });
    formStartedTrackedRef.current = true;
  }, [vorname, nachname, geburtsdatum, email, iban]);

  useEffect(() => {
    if (!feeInfo || !antragstyp || !mitgliedschaftTyp) return;
    const feeEventKey = JSON.stringify([
      antragstyp,
      mitgliedschaftTyp,
      feeInfo.jahresbeitrag,
      elternteilMitglied,
    ]);
    if (feeEventKey === lastFeeEventKeyRef.current) return;
    lastFeeEventKeyRef.current = feeEventKey;
    captureEvent("membership_fee_calculated", {
      app_area: "public",
      antragstyp,
      mitgliedschaft_typ: mitgliedschaftTyp,
      jahresbeitrag: Number(feeInfo.jahresbeitrag),
      elternteil_mitglied:
        elternteilMitglied === null ? null : elternteilMitglied,
    });
  }, [feeInfo, antragstyp, mitgliedschaftTyp, elternteilMitglied]);

  // ---- IBAN lookup
  useEffect(() => {
    const cleaned = iban.replace(/\s/g, "").toUpperCase();
    if (cleaned.length < 15) {
      setIbanLookup({ loading: false, valid: null, autoFilled: false });
      return;
    }
    if (!validateIbanChecksum(cleaned)) {
      setIbanLookup({ loading: false, valid: false, autoFilled: false });
      return;
    }
    const country = cleaned.slice(0, 2);
    const expectedLen = IBAN_LENGTHS[country];
    if (expectedLen && cleaned.length !== expectedLen) {
      setIbanLookup({ loading: false, valid: null, autoFilled: false });
      return;
    }
    setIbanLookup((prev) => ({ ...prev, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const res = await lookupIban(cleaned);
        if (res.valid) {
          if (res.bic) setBic(res.bic);
          if (res.bank_name) setKreditinstitut(res.bank_name);
          setIbanLookup({
            loading: false,
            valid: true,
            autoFilled: !!(res.bic || res.bank_name),
          });
        } else {
          setIbanLookup({ loading: false, valid: false, autoFilled: false });
        }
      } catch {
        setIbanLookup({ loading: false, valid: true, autoFilled: false });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [iban]);

  // ---- Persist form state to sessionStorage (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      saveDraft({
        antragstyp, step, geschlecht, vorname, nachname, geburtsdatum, strasse, plz, ort,
        telefon, email, abteilungen, erzVorname, erzNachname, elternteilMitglied,
        kinder, partnerVorname, partnerNachname, partnerGeburtsdatum, partnerAbteilungen,
        kontoinhaber, iban, bic, kreditinstitut,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [
    antragstyp, step, geschlecht, vorname, nachname, geburtsdatum, strasse, plz, ort,
    telefon, email, abteilungen, erzVorname, erzNachname, elternteilMitglied,
    kinder, partnerVorname, partnerNachname, partnerGeburtsdatum, partnerAbteilungen,
    kontoinhaber, iban, bic, kreditinstitut,
  ]);

  // ---- Warn user before leaving page with unsaved form data
  useEffect(() => {
    const hasData = !!(vorname || nachname || geburtsdatum || email || iban);
    if (!hasData) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [vorname, nachname, geburtsdatum, email, iban]);

  // ---- Helpers
  const clearError = useCallback((key: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const toggleAbteilung = useCallback(
    (abt: string, list: string[], setList: (v: string[]) => void) => {
      if (abt === "Keine Abteilung") {
        setList(list.includes(abt) ? [] : [abt]);
      } else {
        const withoutKeine = list.filter((a) => a !== "Keine Abteilung");
        if (list.includes(abt)) {
          setList(withoutKeine.filter((a) => a !== abt));
        } else {
          setList([...withoutKeine, abt]);
        }
      }
    },
    []
  );

  const updateChild = useCallback(
    (index: number, field: keyof ChildData, value: any) => {
      setKinder((prev) => {
        const copy = [...prev];
        copy[index] = { ...copy[index], [field]: value };
        return copy;
      });
    },
    []
  );

  const addChild = useCallback(() => {
    setKinder((prev) => {
      const newList = [...prev, emptyChild()];
      setExpandedChild(newList.length - 1); // auto-expand new child
      return newList;
    });
  }, []);

  const removeChild = useCallback((index: number) => {
    setKinder((prev) => prev.filter((_, i) => i !== index));
    setExpandedChild(null);
  }, []);

  // ---- Validation
  const validateStep = (s: number): boolean => {
    const errs: Record<string, string> = {};

    // Step 0: All person data
    if (s === 0) {
      // Salutation
      if (!geschlecht) errs.geschlecht = "Bitte wählen Sie eine Anrede";

      // Main person
      if (!vorname.trim()) errs.vorname = "Vorname ist erforderlich";
      else if (vorname.trim().length < 2) errs.vorname = "Mindestens 2 Zeichen";
      else if (!NAME_REGEX.test(vorname.trim()))
        errs.vorname = "Nur Buchstaben, Leerzeichen und Bindestriche";

      if (!nachname.trim()) errs.nachname = "Nachname ist erforderlich";
      else if (nachname.trim().length < 2) errs.nachname = "Mindestens 2 Zeichen";
      else if (!NAME_REGEX.test(nachname.trim()))
        errs.nachname = "Nur Buchstaben, Leerzeichen und Bindestriche";

      if (!geburtsdatum) {
        errs.geburtsdatum = "Geburtsdatum ist erforderlich";
      } else {
        const bd = new Date(geburtsdatum);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (bd >= today) errs.geburtsdatum = "Muss in der Vergangenheit liegen";
        else if (calculateAge(geburtsdatum) > 120) errs.geburtsdatum = "Ungültig";
      }

      if (abteilungen.length === 0)
        errs.abteilungen = "Bitte mindestens eine Abteilung wählen";

      // Type-specific validation (only if DOB is valid → antragstyp is set)
      if (antragstyp === "einzel" || antragstyp === "familie") {
        // Adult path: address + contact
        if (!strasse.trim()) errs.strasse = "Straße und Hausnummer ist erforderlich";
        else if (strasse.trim().length < 5)
          errs.strasse = "Bitte vollständige Straße mit Hausnummer";
        if (!plz.trim()) errs.plz = "PLZ ist erforderlich";
        else if (!/^\d{5}$/.test(plz)) errs.plz = "PLZ muss 5 Ziffern haben";
        if (!ort.trim()) errs.ort = "Ort ist erforderlich";
        else if (ort.trim().length < 2) errs.ort = "Mindestens 2 Zeichen";
        if (!email.trim()) errs.email = "E-Mail ist erforderlich";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
          errs.email = "Ungültige E-Mail-Adresse";
        if (telefon && telefon.trim()) {
          const cp = telefon.replace(/[\s\-/()]/g, "");
          if (!/^\+?\d{6,15}$/.test(cp))
            errs.telefon = "Ungültige Telefonnummer";
        }
      }

      if (antragstyp === "kind") {
        // Minor path: guardian + contact
        if (isChildType && elternteilMitglied === null)
          errs.elternteil_mitglied = "Bitte angeben";

        if (!erzVorname.trim()) errs.erzVorname = "Vorname ist erforderlich";
        else if (erzVorname.trim().length < 2) errs.erzVorname = "Mindestens 2 Zeichen";
        if (!erzNachname.trim()) errs.erzNachname = "Nachname ist erforderlich";
        else if (erzNachname.trim().length < 2) errs.erzNachname = "Mindestens 2 Zeichen";

        if (!strasse.trim()) errs.strasse = "Straße und Hausnummer ist erforderlich";
        else if (strasse.trim().length < 5)
          errs.strasse = "Bitte vollständige Straße mit Hausnummer";
        if (!plz.trim()) errs.plz = "PLZ ist erforderlich";
        else if (!/^\d{5}$/.test(plz)) errs.plz = "PLZ muss 5 Ziffern haben";
        if (!ort.trim()) errs.ort = "Ort ist erforderlich";
        else if (ort.trim().length < 2) errs.ort = "Mindestens 2 Zeichen";
        if (!email.trim()) errs.email = "E-Mail ist erforderlich";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
          errs.email = "Ungültige E-Mail-Adresse";
        if (telefon && telefon.trim()) {
          const cp = telefon.replace(/[\s\-/()]/g, "");
          if (!/^\+?\d{6,15}$/.test(cp))
            errs.telefon = "Ungültige Telefonnummer";
        }
      }

      // Adult with children: validate children data AND require a partner.
      // Familie membership (flat 96 €/Jahr) only applies when BOTH children
      // AND a partner/second adult are provided.
      if (isAdult && kinder.length > 0) {
        // Validate each child
        if (kinder.length === 0) errs.kinder = "Mindestens ein Kind erforderlich";
        kinder.forEach((k, i) => {
          if (!k.vorname.trim())
            errs[`kind_${i}_vorname`] = "Vorname erforderlich";
          else if (k.vorname.trim().length < 2)
            errs[`kind_${i}_vorname`] = "Mindestens 2 Zeichen";
          if (!k.nachname.trim())
            errs[`kind_${i}_nachname`] = "Nachname erforderlich";
          else if (k.nachname.trim().length < 2)
            errs[`kind_${i}_nachname`] = "Mindestens 2 Zeichen";
          if (!k.geburtsdatum) {
            errs[`kind_${i}_geburtsdatum`] = "Geburtsdatum erforderlich";
          } else {
            const age = calculateRealAge(k.geburtsdatum);
            const kbd = new Date(k.geburtsdatum);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (kbd >= today)
              errs[`kind_${i}_geburtsdatum`] = "Muss in der Vergangenheit liegen";
            else if (age > 18)
              errs[`kind_${i}_geburtsdatum`] = "Kind muss 18 Jahre oder jünger sein";
          }
          if (k.abteilungen.length === 0)
            errs[`kind_${i}_abteilungen`] = "Mindestens eine Abteilung wählen";
        });

        // Partner is REQUIRED for Familienmitgliedschaft
        if (!partnerVorname.trim())
          errs.partnerVorname = "Für die Familienmitgliedschaft ist ein Partner/2. Elternteil erforderlich";
        else if (partnerVorname.trim().length < 2)
          errs.partnerVorname = "Mindestens 2 Zeichen";
        else if (!NAME_REGEX.test(partnerVorname.trim()))
          errs.partnerVorname = "Nur Buchstaben, Leerzeichen und Bindestriche";

        if (!partnerNachname.trim())
          errs.partnerNachname = "Nachname des Partners ist erforderlich";
        else if (partnerNachname.trim().length < 2)
          errs.partnerNachname = "Mindestens 2 Zeichen";
        else if (!NAME_REGEX.test(partnerNachname.trim()))
          errs.partnerNachname = "Nur Buchstaben, Leerzeichen und Bindestriche";

        if (!partnerGeburtsdatum) {
          errs.partnerGeburtsdatum = "Geburtsdatum des Partners ist erforderlich";
        } else {
          const pAge = calculateRealAge(partnerGeburtsdatum);
          const pBd = new Date(partnerGeburtsdatum);
          const today = new Date(); today.setHours(0, 0, 0, 0);
          if (pBd >= today) errs.partnerGeburtsdatum = "Muss in der Vergangenheit liegen";
          else if (pAge < 18) errs.partnerGeburtsdatum = "Partner muss mindestens 18 Jahre alt sein";
        }
      }
    }

    // Step 1: SEPA
    if (s === 1) {
      const cleanIban = iban.replace(/\s/g, "").toUpperCase();
      if (!cleanIban) {
        errs.iban = "IBAN ist erforderlich";
      } else if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cleanIban)) {
        errs.iban = "Ungültiges IBAN-Format (z.B. DE89...)";
      } else {
        const country = cleanIban.slice(0, 2);
        const expectedLen = IBAN_LENGTHS[country];
        if (expectedLen && cleanIban.length !== expectedLen) {
          errs.iban = `IBAN für ${country} muss ${expectedLen} Zeichen haben`;
        } else if (cleanIban.length < 15 || cleanIban.length > 34) {
          errs.iban = "IBAN muss zwischen 15 und 34 Zeichen haben";
        } else if (!validateIbanChecksum(cleanIban)) {
          errs.iban = "IBAN-Prüfsumme ist ungültig";
        }
      }
      if (bic && bic.trim()) {
        if (
          !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/i.test(bic.trim())
        )
          errs.bic = "Ungültiges BIC-Format";
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Central step navigation — always scrolls to top and clears errors.
  const goToStep = useCallback((target: number) => {
    setStep(target);
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const nextStep = () => {
    if (validateStep(step)) {
      captureEvent("membership_form_step_completed", {
        app_area: "public",
        step_index: step,
        antragstyp,
        mitgliedschaft_typ: mitgliedschaftTyp,
        has_children: kinder.length > 0,
        signature_mode: signatureMode === "inline" ? "inline" : "paper_upload",
      });
      goToStep(Math.min(step + 1, STEPS.length - 1));
    }
  };

  const prevStep = () => {
    setDuplicateChecked(false);
    goToStep(Math.max(step - 1, 0));
  };

  const handleSignatureImageUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Bitte ein Signaturbild (PNG/JPG) auswählen.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Signaturbild ist zu groß (max. 10 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setUploadedSignatureDataUrl(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!consent) {
      toast.error("Bitte stimmen Sie der Datenschutzerklärung zu.");
      return;
    }
    if (!antragstyp) return;

    // Option B: require either drawn or uploaded signature
    if (signatureMode === "inline") {
      const hasDrawn =
        !!capturedSigDataUrl || (sigCanvasRef.current && !sigCanvasRef.current.isEmpty());
      if (!hasDrawn && !uploadedSignatureDataUrl) {
        toast.error("Bitte unterschreiben Sie im Unterschriftsfeld oder laden Sie ein Signaturbild hoch (Option B).");
        return;
      }
    }

    setSubmitting(true);

    // Duplicate check (only once per submit attempt)
    if (!duplicateChecked) {
      try {
        const dupResult = await checkDuplicate(vorname, nachname, geburtsdatum);
        if (dupResult.duplicate) {
          setDuplicateChecked(true);
          setSubmitting(false);
          captureEvent("membership_duplicate_detected", {
            app_area: "public",
            antragstyp,
            mitgliedschaft_typ: mitgliedschaftTyp,
          });
          toast.warning(
            'Es könnte bereits ein Antrag mit gleichem Namen und Geburtsdatum existieren. Klicken Sie erneut auf "Beitritt erklären", um dennoch fortzufahren.',
            { duration: 10000 }
          );
          return;
        }
      } catch {
        // If check fails, proceed anyway
      }
    }
    try {
      // Option B: drawn (canvas/fullscreen) or uploaded image; Option A: no signature
      const drawn =
        capturedSigDataUrl ??
        (sigCanvasRef.current && !sigCanvasRef.current.isEmpty()
          ? sigCanvasRef.current.getTrimmedCanvas().toDataURL("image/png")
          : null);
      const unterschrift_base64 =
        signatureMode === "inline" ? (drawn ?? uploadedSignatureDataUrl) : null;

      const payload: ApplicationData = {
        antragstyp,
        geschlecht,
        vorname,
        nachname,
        geburtsdatum,
        strasse,
        plz,
        ort,
        telefon,
        email,
        abteilungen,
        mitgliedschaft_typ: mitgliedschaftTyp,
        elternteil_mitglied: antragstyp === "kind" ? elternteilMitglied : null,
        erziehungsberechtigter_vorname: antragstyp === "kind" ? erzVorname : "",
        erziehungsberechtigter_nachname: antragstyp === "kind" ? erzNachname : "",
        partner_vorname: antragstyp === "familie" ? partnerVorname : "",
        partner_nachname: antragstyp === "familie" ? partnerNachname : "",
        partner_geburtsdatum: antragstyp === "familie" && partnerGeburtsdatum ? partnerGeburtsdatum : null,
        partner_abteilungen: antragstyp === "familie" ? partnerAbteilungen : [],
        kinder: antragstyp === "familie" ? kinder : null,
        kontoinhaber,
        iban: iban.replace(/\s/g, ""),
        bic,
        kreditinstitut,
        unterschrift_base64,
      };

      const result = await submitApplication(payload);
      identifyApplicant(result.antragsnummer, { app_area: "public" });
      clearDraft();
      navigate("/erfolg", {
        state: {
          id: result.id,
          antragsnummer: result.antragsnummer,
          mandatsreferenz: result.mandatsreferenz,
          upload_url: result.upload_url,
          signedOnline: signatureMode === "inline" || !!uploadedSignatureDataUrl,
          form: {
            vorname: antragstyp === "kind" ? erzVorname : vorname,
            nachname: antragstyp === "kind" ? erzNachname : nachname,
            email,
            abteilungen,
          },
          feeInfo,
        },
      });
    } catch (err: any) {
      captureEvent("membership_submission_failed", {
        app_area: "public",
        http_status: err instanceof ApiError ? err.status : null,
        reason:
          err instanceof ApiError
            ? normalizeFailureReason(err.status)
            : "server_error",
        signature_mode: signatureMode === "inline" ? "inline" : "paper_upload",
      });
      toast.error(err.message || "Fehler beim Absenden");
    } finally {
      setSubmitting(false);
    }
  };

  // Payer display name
  const payerName =
    antragstyp === "kind"
      ? `${erzVorname} ${erzNachname}`.trim()
      : `${vorname} ${nachname}`.trim();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-svu-600 text-white shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center gap-4">
          <img
            src="/logo_svu-241x300.png"
            alt="Sportverein 1945 Untereuerheim e.V."
            className="h-14 w-auto drop-shadow-md"
          />
          <div>
            <h1 className="text-2xl font-bold">Sportverein 1945 Untereuerheim e.V.</h1>
            <p className="text-svu-200 mt-0.5 text-sm">Online Beitrittserklärung</p>
          </div>
        </div>
      </header>

      {/* Stepper */}
      <div className="max-w-3xl mx-auto px-4 mt-8">
        <div className="flex items-center justify-between mb-8">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            return (
              <div key={i} className="flex items-center flex-1">
                <div
                  className={`flex flex-col items-center flex-shrink-0 ${isDone ? "cursor-pointer group" : ""}`}
                  onClick={isDone ? () => goToStep(i) : undefined}
                  role={isDone ? "button" : undefined}
                  tabIndex={isDone ? 0 : undefined}
                  onKeyDown={isDone ? (e) => { if (e.key === "Enter" || e.key === " ") goToStep(i); } : undefined}
                  title={isDone ? `Zurück zu "${s.label}"` : undefined}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                      isDone
                        ? "bg-svu-500 text-white group-hover:bg-svu-400"
                        : isActive
                        ? "bg-svu-600 text-white ring-4 ring-svu-200"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : (
                      <Icon className="w-5 h-5" />
                    )}
                  </div>
                  <span
                    className={`text-xs mt-1 text-center hidden sm:block ${
                      isActive ? "text-svu-600 font-semibold" : isDone ? "text-svu-500 group-hover:text-svu-400" : "text-gray-500"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 ${
                      i < step ? "bg-svu-500" : "bg-gray-200"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-xl shadow-sm border p-6 sm:p-8">
          {/* ===================== STEP 0: MITGLIEDSDATEN ===================== */}
          {step === 0 && (
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Mitgliedsdaten
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Geben Sie die Daten der Person ein, die Mitglied werden soll.
                Der passende Tarif wird automatisch anhand des Alters ermittelt.
              </p>

              {/* Process overview */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">So funktioniert's – 3 einfache Schritte</p>
                <div className="grid grid-cols-3 gap-3 text-center text-xs text-gray-500">
                  <div>
                    <div className="w-7 h-7 rounded-full bg-svu-100 text-svu-600 font-bold flex items-center justify-center mx-auto mb-1">1</div>
                    <span>Daten eingeben</span>
                  </div>
                  <div>
                    <div className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 font-bold flex items-center justify-center mx-auto mb-1">2</div>
                    <span>Bankdaten für Lastschrift</span>
                  </div>
                  <div>
                    <div className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 font-bold flex items-center justify-center mx-auto mb-1">3</div>
                    <span>Prüfen & absenden</span>
                  </div>
                </div>
              </div>

              {/* Gender / salutation — shown for non-minor path (adult or unknown DOB yet) */}
              {!isMinor && (
                <GeschlechtPicker
                  value={geschlecht}
                  error={errors.geschlecht}
                  onChange={(v) => { setGeschlecht(v); clearError("geschlecht"); }}
                />
              )}

              {/* Main person fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Vorname *" error={errors.vorname} value={vorname}
                  onChange={(v) => { setVorname(v); clearError("vorname"); }} />
                <Field label="Nachname *" error={errors.nachname} value={nachname}
                  onChange={(v) => { setNachname(v); clearError("nachname"); }} />
                <Field label="Geburtsdatum *" type="date" error={errors.geburtsdatum}
                  value={geburtsdatum} onChange={(v) => { setGeburtsdatum(v); clearError("geburtsdatum"); }} />
                <div />
              </div>

              <AbteilungenPicker
                label="Abteilung(en) *"
                selected={abteilungen}
                error={errors.abteilungen}
                onToggle={(abt) => {
                  toggleAbteilung(abt, abteilungen, setAbteilungen);
                  clearError("abteilungen");
                }}
                hint='Wählen Sie „Keine Abteilung", wenn Sie den Verein nur passiv unterstützen möchten. Mehrfachauswahl ist möglich.'
              />

              {/* ============ ADULT PATH (>= 18) ============ */}
              {geburtsdatum && isAdult && (
                <>
                  {/* Auto-detection badge */}
                  <div className="flex items-center gap-2 p-3 bg-svu-50 border border-svu-200 rounded-lg mt-2 mb-4">
                    <CheckCircle2 className="w-4 h-4 text-svu-600 flex-shrink-0" />
                    <p className="text-sm text-svu-700">
                      {kinder.length > 0
                        ? hasPartner
                          ? <>Automatisch erkannt: <strong>Familienmitgliedschaft</strong> (96 €/Jahr pauschal)</>
                          : <>Kinder hinzugefügt – für die <strong>Familienmitgliedschaft</strong> bitte Partner/2. Elternteil eintragen.</>
                        : <>Automatisch erkannt: <strong>{typLabel[mitgliedschaftTyp]}</strong>{feeInfo ? <> – {formatFee(feeInfo.jahresbeitrag)}/Jahr</> : null}</>
                      }
                    </p>
                  </div>
                  {/* Category & Fee — shown for Einzel, or while children are present
                      but partner hasn't been entered yet (fee is still the adult's
                      individual rate at that point). */}
                  {(kinder.length === 0 || !hasPartner) && (
                    <CategoryFeeDisplay typ={mitgliedschaftTyp} feeInfo={feeInfo} />
                  )}

                  {/* Address & Contact */}
                  <div className="border-t pt-6 mt-6">
                    <h3 className="text-base font-semibold text-gray-800 mb-1">Adresse & Kontakt</h3>
                    <p className="text-xs text-gray-500 mb-3">An diese Adresse werden ggf. Vereinsmitteilungen versendet.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <AddressFields
                        strasse={strasse} plz={plz} ort={ort}
                        onStrasseChange={setStrasse} onPlzChange={setPlz} onOrtChange={setOrt}
                        errors={errors} clearError={clearError}
                      />
                      <Field label="Telefon" error={errors.telefon} value={telefon}
                        onChange={(v) => { setTelefon(v); clearError("telefon"); }} />
                      <Field label="E-Mail *" type="email" error={errors.email}
                        value={email} onChange={(v) => { setEmail(v); clearError("email"); }} />
                    </div>
                  </div>

                  {/* Familienmitglieder section */}
                  <div className="border-t pt-6 mt-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Familienmitglieder
                    </h3>

                    {kinder.length === 0 ? (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <p className="text-sm text-blue-800 mb-3">
                          Möchten Sie weitere Familienmitglieder anmelden? Die Familienmitgliedschaft
                          (<strong>96 €/Jahr</strong>) gilt für 2 Erwachsene und beliebig viele Kinder
                          bis 18 Jahre — unabhängig von der Kinderzahl.
                        </p>
                        <button type="button" onClick={addChild}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-svu-600 rounded-lg hover:bg-svu-700 transition-colors"
                        >
                          <Plus className="w-4 h-4" /> Kind hinzufügen
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* Partner / Second Parent (optional) */}
                        <div className="mb-6">
                          <h4 className="text-base font-semibold text-gray-800 mb-1">
                            Partner / 2. Elternteil <span className="text-sm font-normal text-gray-500">(optional)</span>
                          </h4>
                          <p className="text-xs text-gray-500 mb-3">
                            Die Familienmitgliedschaft gilt für 2 Erwachsene. Falls gewünscht, geben Sie hier die Daten des Partners an.
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Field label="Vorname" error={errors.partnerVorname} value={partnerVorname}
                              onChange={(v) => { setPartnerVorname(v); clearError("partnerVorname"); }} />
                            <Field label="Nachname" error={errors.partnerNachname} value={partnerNachname}
                              onChange={(v) => { setPartnerNachname(v); clearError("partnerNachname"); }} />
                            <Field label="Geburtsdatum" type="date" error={errors.partnerGeburtsdatum}
                              value={partnerGeburtsdatum}
                              onChange={(v) => { setPartnerGeburtsdatum(v); clearError("partnerGeburtsdatum"); }} />
                            <div />
                          </div>
                          {(partnerVorname.trim() || partnerNachname.trim() || partnerGeburtsdatum) && (
                            <AbteilungenPicker
                              label="Abteilung(en) Partner"
                              selected={partnerAbteilungen}
                              error={errors.partnerAbteilungen}
                              onToggle={(abt) => {
                                toggleAbteilung(abt, partnerAbteilungen, setPartnerAbteilungen);
                                clearError("partnerAbteilungen");
                              }}
                              compact
                            />
                          )}
                        </div>

                        {/* Children */}
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="text-base font-semibold text-gray-900">
                              Kinder ({kinder.length})
                            </h4>
                            <button type="button" onClick={addChild}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-svu-600 bg-svu-50 rounded-lg hover:bg-svu-100 transition-colors"
                            >
                              <Plus className="w-4 h-4" /> Kind hinzufügen
                            </button>
                          </div>
                          {errors.kinder && (
                            <p className="text-red-600 text-sm mb-3">{errors.kinder}</p>
                          )}

                          <div className="space-y-4">
                            {kinder.map((kind, i) => {
                              const isOpen = expandedChild === null || expandedChild === i;
                              const canToggle = kinder.length > 1;
                              return (
                              <div key={i} className="border rounded-lg p-4 bg-gray-50 relative">
                                <div
                                  className={`flex items-center justify-between ${isOpen ? "mb-3" : ""} ${canToggle ? "cursor-pointer select-none" : ""}`}
                                  onClick={canToggle ? () => setExpandedChild(expandedChild === i ? null : i) : undefined}
                                >
                                  <div className="flex items-center gap-2">
                                    {canToggle && (
                                      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                                    )}
                                    <span className="text-sm font-semibold text-svu-600">
                                      Kind {i + 1}
                                      {!isOpen && (kind.vorname || kind.nachname) && (
                                        <span className="text-gray-500 font-normal ml-1">
                                          – {kind.vorname} {kind.nachname}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <button type="button" onClick={(e) => {
                                        e.stopPropagation();
                                        if (kinder.length === 1) {
                                          setKinder([]); setExpandedChild(null);
                                          // Clear partner data when un-doing Familie
                                          setPartnerVorname(""); setPartnerNachname(""); setPartnerGeburtsdatum(""); setPartnerAbteilungen([]);
                                        } else {
                                          removeChild(i);
                                        }
                                      }}
                                      className="text-red-500 hover:text-red-700 p-1 rounded"
                                      title={kinder.length === 1 ? "Familienmitgliedschaft entfernen" : "Kind entfernen"}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                                {isOpen && (
                                  <>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <Field label="Vorname *" error={errors[`kind_${i}_vorname`]}
                                    value={kind.vorname}
                                    onChange={(v) => { updateChild(i, "vorname", v); clearError(`kind_${i}_vorname`); }}
                                  />
                                  <Field label="Nachname *" error={errors[`kind_${i}_nachname`]}
                                    value={kind.nachname}
                                    onChange={(v) => { updateChild(i, "nachname", v); clearError(`kind_${i}_nachname`); }}
                                  />
                                  <div>
                                    <Field label="Geburtsdatum *" type="date"
                                      error={errors[`kind_${i}_geburtsdatum`]}
                                      value={kind.geburtsdatum}
                                      onChange={(v) => { updateChild(i, "geburtsdatum", v); clearError(`kind_${i}_geburtsdatum`); }}
                                    />
                                    {kind.geburtsdatum && !errors[`kind_${i}_geburtsdatum`] && (
                                      <span className="text-xs text-gray-500 mt-1 block">
                                        {calculateAge(kind.geburtsdatum)} Jahre –{" "}
                                        {typLabel[determineMitgliedschaftTyp(kind.geburtsdatum, "kind")] || ""}
                                      </span>
                                    )}
                                  </div>
                                  <div />
                                </div>
                                <AbteilungenPicker
                                  label="Abteilung(en) *"
                                  selected={kind.abteilungen}
                                  error={errors[`kind_${i}_abteilungen`]}
                                  onToggle={(abt) => {
                                    const curr = kind.abteilungen;
                                    let newList: string[];
                                    if (abt === "Keine Abteilung") {
                                      newList = curr.includes(abt) ? [] : [abt];
                                    } else {
                                      const w = curr.filter((a) => a !== "Keine Abteilung");
                                      newList = curr.includes(abt)
                                        ? w.filter((a) => a !== abt)
                                        : [...w, abt];
                                    }
                                    updateChild(i, "abteilungen", newList);
                                    clearError(`kind_${i}_abteilungen`);
                                  }}
                                  compact
                                />
                                  </>
                                )}
                              </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Familie Fee – only once partner is complete */}
                        {hasPartner ? (
                          <div className="p-4 bg-svu-50 border-2 border-svu-500 rounded-xl text-center mt-6">
                            <div className="text-2xl font-bold text-svu-600">
                              {formatFee(96)} / Jahr
                            </div>
                            <div className="text-sm text-svu-700 mt-1">
                              Familie (2 Erwachsene + Kinder bis 18 Jahre) – unabhängig von der Kinderzahl
                            </div>
                          </div>
                        ) : (
                          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-center mt-6">
                            <p className="text-sm text-amber-800">
                              Die <strong>Familienmitgliedschaft (96 €/Jahr)</strong> gilt für 2 Erwachsene + Kinder.
                              Bitte Partner/2. Elternteil oben eintragen, um den Familientarif zu aktivieren.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}

              {/* ============ MINOR PATH (< 18 = Kind) ============ */}
              {geburtsdatum && isMinor && (
                <>
                  {/* Auto-detection badge for minors */}
                  <div className="flex items-center gap-2 p-3 bg-svu-50 border border-svu-200 rounded-lg mt-2 mb-4">
                    <CheckCircle2 className="w-4 h-4 text-svu-600 flex-shrink-0" />
                    <p className="text-sm text-svu-700">
                      Automatisch erkannt: <strong>{typLabel[mitgliedschaftTyp]}</strong> – die Angaben eines Erziehungsberechtigten sind erforderlich.
                    </p>
                  </div>
                  {mitgliedschaftTyp && (
                    <div className="p-3 bg-gray-50 rounded-lg mb-4 mt-4">
                      <span className="text-sm text-gray-600">Kategorie: </span>
                      <span className="font-semibold text-gray-800">
                        {typLabel[mitgliedschaftTyp]}
                      </span>
                    </div>
                  )}

                  {isChildType && (
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Ist mindestens ein Elternteil bereits Mitglied? *
                      </label>
                      <p className="text-xs text-gray-500 mb-3">Falls ja, erhalten Kinder und Jugendliche einen vergünstigten Beitrag.</p>
                      <div className="flex gap-3">
                        {[{ label: "Ja", value: true }, { label: "Nein", value: false }].map(
                          (opt) => (
                            <button key={String(opt.value)} type="button"
                              onClick={() => { setElternteilMitglied(opt.value); clearError("elternteil_mitglied"); }}
                              className={`px-6 py-2 rounded-lg border text-sm font-medium transition-colors ${
                                elternteilMitglied === opt.value
                                  ? "border-svu-500 bg-svu-50 text-svu-700"
                                  : "border-gray-200 hover:border-gray-300 text-gray-600"
                              }`}
                            >
                              {opt.label}
                            </button>
                          )
                        )}
                      </div>
                      {errors.elternteil_mitglied && (
                        <p className="text-red-600 text-sm mt-1">{errors.elternteil_mitglied}</p>
                      )}
                    </div>
                  )}

                  {feeInfo && (
                    <div className="p-4 bg-svu-50 border-2 border-svu-500 rounded-xl text-center mb-6">
                      <div className="text-2xl font-bold text-svu-600">
                        {formatFee(feeInfo.jahresbeitrag)} / Jahr
                      </div>
                      <div className="text-sm text-svu-700 mt-1">{feeInfo.label}</div>
                    </div>
                  )}

                  {/* Guardian section */}
                  <div className="border-t pt-6 mt-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      Erziehungsberechtigte/r (Zahlungspflichtig)
                    </h3>
                    <p className="text-xs text-gray-500 mb-4">
                      Diese Person unterschreibt die Beitrittserklärung, erteilt das SEPA-Mandat und ist Ansprechpartner für den Verein.
                    </p>
                    <GeschlechtPicker
                      value={geschlecht}
                      error={errors.geschlecht}
                      onChange={(v) => { setGeschlecht(v); clearError("geschlecht"); }}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                      <Field label="Vorname *" error={errors.erzVorname} value={erzVorname}
                        onChange={(v) => { setErzVorname(v); clearError("erzVorname"); }} />
                      <Field label="Nachname *" error={errors.erzNachname} value={erzNachname}
                        onChange={(v) => { setErzNachname(v); clearError("erzNachname"); }} />
                      <AddressFields
                        strasse={strasse} plz={plz} ort={ort}
                        onStrasseChange={setStrasse} onPlzChange={setPlz} onOrtChange={setOrt}
                        errors={errors} clearError={clearError}
                      />
                      <Field label="Telefon" error={errors.telefon} value={telefon}
                        onChange={(v) => { setTelefon(v); clearError("telefon"); }} />
                      <Field label="E-Mail *" type="email" error={errors.email}
                        value={email} onChange={(v) => { setEmail(v); clearError("email"); }} />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===================== STEP 1: SEPA ===================== */}
          {step === 1 && (
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                SEPA-Lastschriftmandat
              </h2>
              <p className="text-sm text-gray-500 mb-1">
                Zahlungspflichtig:{" "}
                <span className="font-semibold text-gray-700">
                  {payerName || "–"}
                </span>
              </p>
              <p className="text-xs text-gray-400 mb-4">
                Der Jahresbeitrag wird einmal jährlich per SEPA-Lastschrift eingezogen. BIC und Kreditinstitut werden nach IBAN-Eingabe automatisch ermittelt.
              </p>

              <div className="bg-gray-50 rounded-lg p-4 mb-6 text-sm text-gray-600">
                <div className="flex justify-between mb-1">
                  <span className="font-medium">Gläubiger-ID:</span>
                  <span className="font-mono">DE71ZZZ00000901082</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Mandatsreferenz:</span>
                  <span className="italic text-gray-400">wird automatisch vergeben</span>
                </div>
              </div>

              <p className="text-xs text-gray-500 mb-6 leading-relaxed">
                Ich ermächtige den Zahlungsempfänger Sportverein 1945 Untereuerheim e.V.
                widerruflich, die von mir zu entrichtenden Zahlungen von meinem
                Konto mittels Lastschrift einzuziehen. Zugleich weise ich mein
                Kreditinstitut an, die vom Zahlungsempfänger Sportverein 1945
                Untereuerheim e.V. auf mein Konto gezogenen Lastschriften
                einzulösen.
                <br /><br />
                <strong>Hinweis:</strong> Ich kann innerhalb von acht Wochen,
                beginnend mit dem Belastungsdatum, die Erstattung des belasteten
                Betrages verlangen. Es gelten dabei die mit meinem
                Kreditinstitut vereinbarten Bedingungen.
              </p>

              <div className="space-y-4">
                <Field
                  label="Kontoinhaber (falls abweichend)"
                  value={kontoinhaber}
                  onChange={setKontoinhaber}
                  placeholder={payerName}
                />
                <p className="text-xs text-gray-400 -mt-2 mb-2">Nur ausfüllen, wenn das Konto auf einen anderen Namen läuft.</p>
                <div>
                  <Field
                    label="IBAN *"
                    error={errors.iban}
                    value={formatIban(iban)}
                    onChange={(v) => { setIban(v); clearError("iban"); }}
                    placeholder="DE__ ____ ____ ____ ____ __"
                    maxLength={42}
                    className="font-mono tracking-wider"
                  />
                  {ibanLookup.loading && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-500">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>BIC wird ermittelt…</span>
                    </div>
                  )}
                  {!ibanLookup.loading && ibanLookup.valid === true && ibanLookup.autoFilled && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-green-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>BIC und Kreditinstitut automatisch ermittelt</span>
                    </div>
                  )}
                  {!ibanLookup.loading && ibanLookup.valid === true && !ibanLookup.autoFilled && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-green-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>IBAN gültig</span>
                    </div>
                  )}
                  {!ibanLookup.loading && ibanLookup.valid === false && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-red-600">
                      <AlertCircle className="w-3 h-3" />
                      <span>IBAN-Prüfsumme ungültig</span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label={`BIC${ibanLookup.autoFilled ? " ✓" : ""}`}
                    error={errors.bic}
                    value={bic}
                    onChange={setBic}
                    maxLength={11}
                    className="font-mono"
                  />
                  <Field
                    label={`Kreditinstitut${ibanLookup.autoFilled ? " ✓" : ""}`}
                    value={kreditinstitut}
                    onChange={setKreditinstitut}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ===================== STEP 2: SUMMARY ===================== */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Zusammenfassung &amp; Unterschrift
              </h2>
              <p className="text-sm text-gray-500 mb-6">
                Bitte prüfen Sie Ihre Angaben sorgfältig. Wählen Sie anschließend, wie Sie die Beitrittserklärung unterzeichnen möchten.
              </p>

              <div className="space-y-6">
                {antragstyp === "einzel" && (
                  <SummarySection title="Persönliche Daten" onEdit={() => goToStep(0)}>
                    {geschlecht && <SummaryRow label="Anrede" value={geschlecht} />}
                    <SummaryRow label="Name" value={`${nachname}, ${vorname}`} />
                    <SummaryRow label="Geburtsdatum"
                      value={new Date(geburtsdatum).toLocaleDateString("de-DE")} />
                    <SummaryRow label="Kategorie" value={typLabel[mitgliedschaftTyp] || ""} />
                    <SummaryRow label="Adresse" value={`${strasse}, ${plz} ${ort}`} />
                    {telefon && <SummaryRow label="Telefon" value={telefon} />}
                    <SummaryRow label="E-Mail" value={email} />
                    <SummaryRow label="Abteilung(en)" value={abteilungen.join(", ")} />
                  </SummarySection>
                )}

                {antragstyp === "kind" && (
                  <>
                    <SummarySection title="Kind / Jugendliche" onEdit={() => goToStep(0)}>
                      <SummaryRow label="Name" value={`${nachname}, ${vorname}`} />
                      <SummaryRow label="Geburtsdatum"
                        value={new Date(geburtsdatum).toLocaleDateString("de-DE")} />
                      <SummaryRow label="Kategorie" value={typLabel[mitgliedschaftTyp] || ""} />
                      <SummaryRow label="Abteilung(en)" value={abteilungen.join(", ")} />
                      {isChildType && (
                        <SummaryRow label="Elternteil Mitglied"
                          value={elternteilMitglied ? "Ja" : "Nein"} />
                      )}
                    </SummarySection>
                    <SummarySection title="Erziehungsberechtigte/r" onEdit={() => goToStep(0)}>
                      {geschlecht && <SummaryRow label="Anrede" value={geschlecht} />}
                      <SummaryRow label="Name" value={`${erzNachname}, ${erzVorname}`} />
                      <SummaryRow label="Adresse" value={`${strasse}, ${plz} ${ort}`} />
                      {telefon && <SummaryRow label="Telefon" value={telefon} />}
                      <SummaryRow label="E-Mail" value={email} />
                    </SummarySection>
                  </>
                )}

                {antragstyp === "familie" && (
                  <>
                    <SummarySection title="Elternteil (Antragsteller)" onEdit={() => goToStep(0)}>
                      {geschlecht && <SummaryRow label="Anrede" value={geschlecht} />}
                      <SummaryRow label="Name" value={`${nachname}, ${vorname}`} />
                      <SummaryRow label="Geburtsdatum"
                        value={new Date(geburtsdatum).toLocaleDateString("de-DE")} />
                      <SummaryRow label="Adresse" value={`${strasse}, ${plz} ${ort}`} />
                      {telefon && <SummaryRow label="Telefon" value={telefon} />}
                      <SummaryRow label="E-Mail" value={email} />
                      <SummaryRow label="Abteilung(en)" value={abteilungen.join(", ")} />
                    </SummarySection>
                    {partnerVorname.trim() && partnerNachname.trim() && (
                      <SummarySection title="Partner / 2. Elternteil" onEdit={() => goToStep(0)}>
                        <SummaryRow label="Name" value={`${partnerNachname}, ${partnerVorname}`} />
                        {partnerGeburtsdatum && (
                          <SummaryRow label="Geburtsdatum"
                            value={new Date(partnerGeburtsdatum).toLocaleDateString("de-DE")} />
                        )}
                        {partnerAbteilungen.length > 0 && (
                          <SummaryRow label="Abteilung(en)" value={partnerAbteilungen.join(", ")} />
                        )}
                      </SummarySection>
                    )}
                    <SummarySection title={`Kinder (${kinder.length})`} onEdit={() => goToStep(0)}>
                      {kinder.map((k, i) => (
                        <div key={i} className={i > 0 ? "pt-2 border-t mt-2" : ""}>
                          <SummaryRow label={`Kind ${i + 1}`}
                            value={`${k.nachname}, ${k.vorname}`} />
                          <SummaryRow label="Geburtsdatum"
                            value={k.geburtsdatum ?
                              `${new Date(k.geburtsdatum).toLocaleDateString("de-DE")} (${calculateAge(k.geburtsdatum)} J.)` : "–"} />
                          <SummaryRow label="Abteilung(en)"
                            value={k.abteilungen.join(", ")} />
                        </div>
                      ))}
                    </SummarySection>
                  </>
                )}

                {feeInfo && (
                  <div className="p-4 bg-svu-50 border-2 border-svu-500 rounded-xl text-center">
                    <div className="text-2xl font-bold text-svu-600">
                      {formatFee(feeInfo.jahresbeitrag)} / Jahr
                    </div>
                    <div className="text-sm text-svu-700">{feeInfo.label}</div>
                  </div>
                )}

                <SummarySection title="SEPA-Lastschrift" onEdit={() => goToStep(1)}>
                  <SummaryRow label="Gläubiger-ID" value="DE71ZZZ00000901082" />
                  <SummaryRow label="Mandatsreferenz" value="wird automatisch vergeben" />
                  <SummaryRow label="Kontoinhaber"
                    value={kontoinhaber || payerName} />
                  <SummaryRow label="IBAN" value={formatIban(iban)} />
                  {bic && <SummaryRow label="BIC" value={bic} />}
                  {kreditinstitut && (
                    <SummaryRow label="Kreditinstitut" value={kreditinstitut} />
                  )}
                </SummarySection>
              </div>

              {/* Consent */}
              <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="w-4 h-4 mt-0.5 text-svu-600 rounded border-gray-300 focus:ring-svu-500"
                  />
                  <span className="text-sm text-gray-700">
                    Mit Unterzeichnung willige ich in die Erhebung, Verarbeitung
                    und Nutzung meiner personenbezogenen Daten zum Zwecke der
                    Mitgliederverwaltung und des Vereinsbetriebs ein. Es gilt die
                    aktuelle Datenschutzerklärung des SVU, die unter{" "}
                    <a
                      href="https://sv-untereuerheim.de/datenschutz/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-svu-600 underline hover:text-svu-700"
                    >
                      sv-untereuerheim.de/datenschutz
                    </a>{" "}
                    eingesehen werden kann. Ein Austritt ist nur zum Ende eines
                    Kalenderjahres unter Einhaltung einer Frist von sechs Wochen
                    in Textform (per E-Mail an mitgliedschaft@sv-untereuerheim.de
                    oder postalisch) zulässig.
                  </span>
                </label>
              </div>

              {/* ---- Signature flow choice ---- */}
              <div className="mt-6">
                <p className="text-sm font-semibold text-gray-800 mb-3">
                  Wie möchten Sie die Beitrittserklärung unterzeichnen?
                </p>
                <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-200">

                  {/* Option A – primary (default) */}
                  <button
                    type="button"
                    onClick={() => {
                      setSignatureMode("upload");
                      setUploadedSignatureDataUrl(null);
                    }}
                    className={`w-full text-left p-4 flex items-start gap-3 transition-colors ${
                      signatureMode === "upload"
                        ? "bg-svu-50"
                        : "bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
                      signatureMode === "upload" ? "border-svu-600" : "border-gray-300"
                    }`}>
                      {signatureMode === "upload" && (
                        <div className="w-2.5 h-2.5 rounded-full bg-svu-600" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        Option A: PDF erhalten, drucken, unterschreiben &amp; hochladen
                        <span className="px-1.5 py-0.5 text-xs bg-svu-100 text-svu-700 rounded font-normal">
                          Standard
                        </span>
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Sie erhalten das Dokument per E-Mail, unterschreiben es handschriftlich und laden den Scan über den beigefügten Link hoch.
                      </p>
                    </div>
                  </button>

                  {/* Option B – inline */}
                  <button
                    type="button"
                    onClick={() => {
                      setSignatureMode("inline");
                      setSigEmpty(true);
                      sigCanvasRef.current?.clear();
                      setCapturedSigDataUrl(null);
                      setUploadedSignatureDataUrl(null);
                    }}
                    className={`w-full text-left p-4 flex items-start gap-3 transition-colors ${
                      signatureMode === "inline"
                        ? "bg-green-50"
                        : "bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
                      signatureMode === "inline" ? "border-green-600" : "border-gray-300"
                    }`}>
                      {signatureMode === "inline" && (
                        <div className="w-2.5 h-2.5 rounded-full bg-green-600" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        Option B: Jetzt direkt online unterschreiben
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Zeichnen Sie Ihre Unterschrift im Browser. Der Antrag wird sofort als unterzeichnet eingereicht – kein Upload nötig.
                      </p>
                    </div>
                  </button>
                </div>

                {/* Inline signature panel (Option B) */}
                {signatureMode === "inline" && (
                  <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl">
                    {/* Optional: upload signature image instead of drawing */}
                    <p className="text-xs text-green-800 mb-3">
                      Optional: Sie können hier ein Foto/Scan Ihrer Unterschrift hochladen oder unten zeichnen.
                    </p>
                    <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 border border-green-300 rounded-lg cursor-pointer hover:bg-green-100/50 transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      Signaturbild auswählen
                      <input
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleSignatureImageUpload(file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {uploadedSignatureDataUrl ? (
                      <div className="mt-3 rounded-lg border border-green-300 bg-white p-2">
                        <img
                          src={uploadedSignatureDataUrl}
                          alt="Signaturvorschau"
                          className="max-h-24 object-contain"
                        />
                        <button
                          type="button"
                          onClick={() => setUploadedSignatureDataUrl(null)}
                          className="mt-2 text-xs text-gray-500 hover:text-gray-800 underline"
                        >
                          Entfernen
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 mt-2">Kein Signaturbild ausgewählt.</p>
                    )}

                    {/* Confirmation text – non-skippable, always shown */}
                    <p className="text-sm text-green-900 leading-relaxed mb-4 border-l-4 border-green-400 pl-3">
                      Mit meiner Unterschrift erkläre ich meinen Beitritt zum SV Untereuerheim e.V. und erteile das SEPA-Lastschriftmandat zur Einziehung des Mitgliedsbeitrags.
                    </p>

                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Unterschrift *
                    </label>

                    {/* When a fullscreen signature was captured, show its preview instead of the canvas */}
                    {capturedSigDataUrl ? (
                      <div className="border-2 border-green-400 rounded-lg bg-white overflow-hidden flex items-center justify-center" style={{ height: 220 }}>
                        <img
                          src={capturedSigDataUrl}
                          alt="Unterschrift"
                          className="max-h-full max-w-full object-contain p-2"
                        />
                      </div>
                    ) : (
                      <div
                        ref={sigContainerRef}
                        className="border-2 border-gray-300 rounded-lg bg-white overflow-hidden touch-none"
                      >
                        <SignatureCanvas
                          ref={sigCanvasRef}
                          penColor="#1a1a1a"
                          canvasProps={{
                            // Internal resolution matches the rendered container
                            // width exactly — eliminates the touch-offset on mobile.
                            width: canvasWidth,
                            height: 220,
                            style: { width: "100%", height: "220px", display: "block" },
                          }}
                          onEnd={() => setSigEmpty(false)}
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-gray-500">
                        {capturedSigDataUrl
                          ? "Unterschrift aus Vollbildmodus übernommen."
                          : "Zeichnen Sie Ihre Unterschrift mit der Maus oder dem Finger."}
                      </p>
                      <div className="flex items-center gap-3">
                        {isMobile && (
                          <button
                            type="button"
                            onClick={() => setFullscreenSig(true)}
                            className="flex items-center gap-1 text-xs text-green-700 hover:text-green-900 font-medium underline transition-colors"
                          >
                            <Maximize2 className="w-3 h-3" />
                            {capturedSigDataUrl ? "Neu zeichnen" : "Vollbild"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { sigCanvasRef.current?.clear(); setSigEmpty(true); setCapturedSigDataUrl(null); }}
                          className="text-xs text-gray-500 hover:text-gray-800 underline transition-colors"
                        >
                          Löschen
                        </button>
                      </div>
                    </div>
                    {sigEmpty && !capturedSigDataUrl && !uploadedSignatureDataUrl && (
                      <p className="text-xs text-amber-700 mt-2">
                        Das Unterschriftsfeld ist noch leer – bitte unterschreiben oder ein Signaturbild hochladen.
                      </p>
                    )}
                    {(capturedSigDataUrl || uploadedSignatureDataUrl) && (
                      <p className="text-xs text-green-700 mt-2 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Unterschrift gespeichert – Sie können jetzt den Antrag absenden.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8 pt-6 border-t">
            {step > 0 ? (
              <button type="button" onClick={prevStep}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>
                  Zurück
                  <span className="hidden sm:inline text-gray-400 font-normal ml-1">
                    · {STEPS[step - 1]?.label}
                  </span>
                </span>
              </button>
            ) : (
              <div />
            )}

            {step < STEPS.length - 1 ? (
              <button type="button" onClick={nextStep}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-svu-600 rounded-lg hover:bg-svu-700 transition-colors"
              >
                Weiter <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button type="button" onClick={handleSubmit}
                disabled={submitting || !consent || (signatureMode === "inline" && sigEmpty && !capturedSigDataUrl && !uploadedSignatureDataUrl)}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-svu-600 rounded-lg hover:bg-svu-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {submitting
                  ? "Wird gesendet..."
                  : signatureMode === "inline"
                  ? "Jetzt unterzeichnen & absenden"
                  : "Beitritt erklären"}
              </button>
            )}
          </div>
        </div>

        {/* Footer / Impressum */}
        <footer className="text-center text-xs text-gray-400 py-8 space-y-1">
          <p className="font-medium text-gray-500">Sportverein 1945 Untereuerheim e.V.</p>
          <p>Triebweg 9 · 97508 Grettstadt/Untereuerheim</p>
          <p>1. Vorsitzender: Alexander Eckert · Tel: 09729/432</p>
          <p>
            E-Mail:{" "}
            <a href="mailto:info@sv-untereuerheim.de" className="hover:text-svu-600">
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
            <a
              href="/status"
              className="text-gray-500 hover:text-svu-600 underline"
            >
              Antragsstatus prüfen
            </a>
          </p>
        </footer>
      </div>

      {/* ---- Fullscreen signing overlay (mobile) ---- */}
      {fullscreenSig && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-white"
          style={{ touchAction: "none" }}
        >
          {/* Header bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
            <span className="text-sm font-semibold text-gray-800">Unterschrift</span>
            <button
              type="button"
              onClick={() => setFullscreenSig(false)}
              className="text-sm text-gray-500 hover:text-gray-800 underline transition-colors"
            >
              Abbrechen
            </button>
          </div>

          {/* Rotate-to-landscape prompt */}
          {isPortrait && (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-6 bg-amber-50 border-b border-amber-200 shrink-0">
              <div className="flex items-center gap-2 text-amber-800">
                <RotateCcw className="w-5 h-5 animate-spin" style={{ animationDuration: "3s" }} />
                <span className="text-sm font-medium">
                  Bitte Gerät ins Querformat drehen für mehr Platz
                </span>
              </div>
            </div>
          )}

          {/* Canvas area – fills all remaining space */}
          <div
            ref={fullscreenContainerRef}
            className="flex-1 overflow-hidden touch-none relative"
          >
            <SignatureCanvas
              ref={fullscreenCanvasRef}
              penColor="#1a1a1a"
              canvasProps={{
                width: fsCanvasWidth,
                height: fsCanvasHeight,
                style: { width: "100%", height: "100%", display: "block" },
              }}
            />
            {/* Signature baseline – purely visual, does not capture pointer events */}
            <div
              className="absolute inset-x-8 pointer-events-none"
              style={{ top: "68%", borderTop: "1.5px solid #9ca3af" }}
            />
          </div>

          {/* Footer bar */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50 shrink-0">
            <button
              type="button"
              onClick={() => fullscreenCanvasRef.current?.clear()}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Löschen
            </button>
            <button
              type="button"
              onClick={() => {
                const canvas = fullscreenCanvasRef.current;
                if (!canvas || canvas.isEmpty()) {
                  toast.error("Bitte unterschreiben Sie zuerst.");
                  return;
                }
                const dataUrl = canvas.getTrimmedCanvas().toDataURL("image/png");
                setCapturedSigDataUrl(dataUrl);
                setSigEmpty(false);
                setFullscreenSig(false);
              }}
              className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              Unterschrift übernehmen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================
// SUB-COMPONENTS
// =============================================

function GeschlechtPicker({
  value,
  error,
  onChange,
}: {
  value: "Herr" | "Frau" | "keine Angabe" | null;
  error?: string;
  onChange: (v: "Herr" | "Frau" | "keine Angabe") => void;
}) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Anrede *
      </label>
      <div className="flex flex-wrap gap-3">
        {(["Herr", "Frau"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-8 py-2 rounded-lg border text-sm font-medium transition-colors ${
              value === opt
                ? "border-svu-500 bg-svu-50 text-svu-700"
                : "border-gray-200 hover:border-gray-300 text-gray-600"
            }`}
          >
            {opt}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange("keine Angabe")}
          className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
            value === "keine Angabe"
              ? "border-svu-500 bg-svu-50 text-svu-700"
              : "border-gray-200 hover:border-gray-300 text-gray-600"
          }`}
        >
          Keine Angabe
        </button>
      </div>
      {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
    </div>
  );
}

function AbteilungenPicker({
  label,
  selected,
  error,
  onToggle,
  compact = false,
  hint,
}: {
  label: string;
  selected: string[];
  error?: string;
  onToggle: (abt: string) => void;
  compact?: boolean;
  hint?: string;
}) {
  return (
    <div className={compact ? "mt-3" : "mt-6 mb-4"}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      {hint && <p className="text-xs text-gray-500 mb-2">{hint}</p>}
      <div className={`grid ${compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"} gap-2`}>
        {ABTEILUNGEN.map((abt) => (
          <label
            key={abt}
            className={`flex items-center ${compact ? "p-2" : "p-3"} rounded-lg border cursor-pointer transition-colors ${
              selected.includes(abt)
                ? "border-svu-500 bg-svu-50 text-svu-700"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <input
              type="checkbox"
              checked={selected.includes(abt)}
              onChange={() => onToggle(abt)}
              className="w-4 h-4 text-svu-600 rounded border-gray-300 focus:ring-svu-500"
            />
            <span className={`ml-2 ${compact ? "text-xs" : "text-sm"} font-medium`}>
              {abt}
            </span>
          </label>
        ))}
      </div>
      {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
    </div>
  );
}

function CategoryFeeDisplay({
  typ,
  feeInfo,
}: {
  typ: string;
  feeInfo: FeeResponse | null;
}) {
  if (!typ) return null;
  return (
    <div className="mt-4 space-y-3">
      <div className="p-3 bg-gray-50 rounded-lg">
        <span className="text-sm text-gray-600">Mitgliedschaftskategorie: </span>
        <span className="font-semibold text-gray-800">{typLabel[typ]}</span>
      </div>
      {feeInfo && (
        <div className="p-4 bg-svu-50 border-2 border-svu-500 rounded-xl text-center">
          <div className="text-2xl font-bold text-svu-600">
            {formatFee(feeInfo.jahresbeitrag)} / Jahr
          </div>
          <div className="text-sm text-svu-700 mt-1">{feeInfo.label}</div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  type = "text",
  placeholder,
  maxLength,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  className?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-svu-500 focus:border-svu-500 outline-none transition-colors ${
          error ? "border-red-400 bg-red-50" : "border-gray-300"
        } ${className}`}
      />
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
      {type === "date" && !error && !value && (
        <p className="text-gray-400 text-xs mt-1">Format: TT.MM.JJJJ</p>
      )}
    </div>
  );
}

function SummarySection({
  title,
  children,
  onEdit,
}: {
  title: string;
  children: React.ReactNode;
  onEdit?: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-svu-600 uppercase tracking-wide">
          {title}
        </h3>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 text-xs text-svu-600 hover:text-svu-800 underline underline-offset-2 transition-colors"
          >
            <Pencil className="w-3 h-3" />
            Bearbeiten
          </button>
        )}
      </div>
      <div className="bg-gray-50 rounded-lg p-4 space-y-2">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium text-right">{value}</span>
    </div>
  );
}
