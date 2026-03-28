import { useState, useEffect, useRef, useCallback } from "react";
import { lookupPlz, searchStreets } from "../services/api";
import type { StreetResult } from "../services/api";
import { MapPin, Loader2, Check, AlertCircle } from "lucide-react";

interface AddressFieldsProps {
  strasse: string;
  plz: string;
  ort: string;
  onStrasseChange: (v: string) => void;
  onPlzChange: (v: string) => void;
  onOrtChange: (v: string) => void;
  errors: Record<string, string>;
  clearError: (field: string) => void;
}

/**
 * Address fields with German PLZ→Ort auto-fill and street autocomplete.
 */
export default function AddressFields({
  strasse,
  plz,
  ort,
  onStrasseChange,
  onPlzChange,
  onOrtChange,
  errors,
  clearError,
}: AddressFieldsProps) {
  // --- PLZ lookup state ---
  const [plzLoading, setPlzLoading] = useState(false);
  const [plzValid, setPlzValid] = useState<boolean | null>(null);
  const [ortOptions, setOrtOptions] = useState<string[]>([]);
  const [showOrtDropdown, setShowOrtDropdown] = useState(false);

  // --- Street autocomplete state ---
  const [streetSuggestions, setStreetSuggestions] = useState<StreetResult[]>([]);
  const [showStreetDropdown, setShowStreetDropdown] = useState(false);
  const [streetLoading, setStreetLoading] = useState(false);

  // Refs for click-outside handling
  const ortDropdownRef = useRef<HTMLDivElement>(null);
  const streetDropdownRef = useRef<HTMLDivElement>(null);
  const streetInputRef = useRef<HTMLInputElement>(null);

  // Debounce timers
  const plzTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const streetTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Track if ort was auto-filled (to avoid overwriting user's manual choice)
  const ortAutoFilled = useRef(false);

  // ========================
  // PLZ → Ort lookup
  // ========================
  const doPlzLookup = useCallback(async (plzValue: string) => {
    if (plzValue.length !== 5 || !/^\d{5}$/.test(plzValue)) {
      setPlzValid(null);
      setOrtOptions([]);
      return;
    }

    setPlzLoading(true);
    try {
      const result = await lookupPlz(plzValue);
      if (result.found && result.orte.length > 0) {
        setPlzValid(true);
        setOrtOptions(result.orte);

        // Auto-fill Ort if there's exactly one match
        if (result.orte.length === 1) {
          onOrtChange(result.orte[0]);
          ortAutoFilled.current = true;
          clearError("ort");
          setShowOrtDropdown(false);
        } else {
          // Multiple Orte → show dropdown
          setShowOrtDropdown(true);
          ortAutoFilled.current = false;
        }
      } else {
        setPlzValid(false);
        setOrtOptions([]);
      }
    } catch {
      setPlzValid(null);
      setOrtOptions([]);
    } finally {
      setPlzLoading(false);
    }
  }, [onOrtChange, clearError]);

  // Trigger PLZ lookup with debounce when PLZ changes
  useEffect(() => {
    if (plzTimerRef.current) clearTimeout(plzTimerRef.current);

    if (plz.length === 5 && /^\d{5}$/.test(plz)) {
      plzTimerRef.current = setTimeout(() => doPlzLookup(plz), 300);
    } else {
      setPlzValid(null);
      setOrtOptions([]);
    }

    return () => {
      if (plzTimerRef.current) clearTimeout(plzTimerRef.current);
    };
  }, [plz, doPlzLookup]);

  // ========================
  // Street autocomplete
  // ========================
  const doStreetSearch = useCallback(async (query: string) => {
    if (query.length < 3) {
      setStreetSuggestions([]);
      setShowStreetDropdown(false);
      return;
    }

    setStreetLoading(true);
    try {
      const result = await searchStreets(query, plz || undefined, ort || undefined);
      setStreetSuggestions(result.results);
      setShowStreetDropdown(result.results.length > 0);
    } catch {
      setStreetSuggestions([]);
    } finally {
      setStreetLoading(false);
    }
  }, [plz, ort]);

  // Trigger street search with debounce
  useEffect(() => {
    if (streetTimerRef.current) clearTimeout(streetTimerRef.current);

    // Strip trailing house number before searching (Nominatim works better with just the street name)
    const streetQuery = strasse.replace(/\s+\d+\s*[a-zA-Z]?\s*$/, "").trim();

    if (streetQuery.length >= 3) {
      streetTimerRef.current = setTimeout(() => doStreetSearch(streetQuery), 400);
    } else {
      setStreetSuggestions([]);
      setShowStreetDropdown(false);
    }

    return () => {
      if (streetTimerRef.current) clearTimeout(streetTimerRef.current);
    };
  }, [strasse, doStreetSearch]);

  // ========================
  // Click-outside handlers
  // ========================
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ortDropdownRef.current && !ortDropdownRef.current.contains(e.target as Node)) {
        setShowOrtDropdown(false);
      }
      if (streetDropdownRef.current && !streetDropdownRef.current.contains(e.target as Node)) {
        setShowStreetDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ========================
  // Select handlers
  // ========================
  const selectOrt = (ortName: string) => {
    onOrtChange(ortName);
    ortAutoFilled.current = true;
    clearError("ort");
    setShowOrtDropdown(false);
  };

  const selectStreet = (result: StreetResult) => {
    let streetValue: string;
    if (result.hausnummer) {
      // API returned a house number — use it
      streetValue = `${result.strasse} ${result.hausnummer}`;
    } else {
      // No house number from API — check if user already typed one
      // e.g. input "Triebweg 9" → street "Triebweg", keep " 9"
      const currentInput = strasse.trim();
      const streetName = result.strasse;
      if (currentInput.toLowerCase().startsWith(streetName.toLowerCase())) {
        const rest = currentInput.slice(streetName.length).trim();
        // If the remainder looks like a house number (starts with digit), keep it
        if (rest && /^\d/.test(rest)) {
          streetValue = `${streetName} ${rest}`;
        } else {
          streetValue = streetName;
        }
      } else {
        streetValue = streetName;
      }
    }
    onStrasseChange(streetValue);
    clearError("strasse");

    // Also fill PLZ and Ort from the street result if available
    if (result.plz && result.plz !== plz) {
      onPlzChange(result.plz);
      clearError("plz");
      setPlzValid(true);
    }
    if (result.ort && result.ort !== ort) {
      onOrtChange(result.ort);
      clearError("ort");
    }
    setShowStreetDropdown(false);

    // Give the address an instant look of validation
    setOrtOptions(result.ort ? [result.ort] : ortOptions);
  };

  // ========================
  // PLZ status icon
  // ========================
  const plzStatusIcon = plzLoading ? (
    <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
  ) : plzValid === true ? (
    <Check className="w-4 h-4 text-green-500" />
  ) : plzValid === false ? (
    <AlertCircle className="w-4 h-4 text-red-500" />
  ) : null;

  return (
    <>
      {/* Street field with autocomplete */}
      <div className="sm:col-span-2 relative" ref={streetDropdownRef}>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Straße und Hausnummer *
        </label>
        <div className="relative">
          <input
            ref={streetInputRef}
            type="text"
            value={strasse}
            onChange={(e) => {
              onStrasseChange(e.target.value);
              clearError("strasse");
            }}
            onFocus={() => {
              if (streetSuggestions.length > 0) setShowStreetDropdown(true);
            }}
            placeholder="z.B. Triebweg 9"
            className={`field-glow w-full px-3 py-2 border rounded-lg text-sm outline-none transition-all duration-200 pr-8 ${
              errors.strasse ? "border-red-400 bg-red-50" : "border-gray-300"
            }`}
          />
          {streetLoading && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
            </div>
          )}
        </div>
        {errors.strasse && (
          <p className="text-red-600 text-xs mt-1">{errors.strasse}</p>
        )}

        {/* Street suggestions dropdown */}
        {showStreetDropdown && streetSuggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
            {streetSuggestions.map((s, i) => (
              <button
                key={`${s.strasse}-${s.plz}-${i}`}
                type="button"
                onClick={() => selectStreet(s)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-svu-50 transition-colors flex items-center gap-2 border-b border-gray-50 last:border-0"
              >
                <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span>
                  <span className="font-medium text-gray-900">{s.strasse}</span>
                  {s.hausnummer && (
                    <span className="text-gray-600"> {s.hausnummer}</span>
                  )}
                  <span className="text-gray-400 ml-1">
                    · {s.plz} {s.ort}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* PLZ field with validation indicator */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          PLZ *
        </label>
        <div className="relative">
          <input
            type="text"
            value={plz}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 5);
              onPlzChange(v);
              clearError("plz");
              if (v.length < 5) {
                setPlzValid(null);
                setOrtOptions([]);
              }
            }}
            maxLength={5}
            placeholder="z.B. 97508"
            className={`field-glow w-full px-3 py-2 border rounded-lg text-sm outline-none transition-all duration-200 pr-8 ${
              errors.plz
                ? "border-red-400 bg-red-50"
                : plzValid === true
                ? "border-green-400 bg-green-50/30"
                : plzValid === false
                ? "border-amber-400 bg-amber-50/30"
                : "border-gray-300"
            }`}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            {plzStatusIcon}
          </div>
        </div>
        {errors.plz && (
          <p className="text-red-600 text-xs mt-1">{errors.plz}</p>
        )}
        {plzValid === false && !errors.plz && (
          <p className="text-amber-600 text-xs mt-1">PLZ nicht gefunden – bitte prüfen</p>
        )}
      </div>

      {/* Ort field with dropdown for multiple matches */}
      <div className="relative" ref={ortDropdownRef}>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Ort *
        </label>
        <div className="relative">
          <input
            type="text"
            value={ort}
            onChange={(e) => {
              onOrtChange(e.target.value);
              clearError("ort");
              ortAutoFilled.current = false;
            }}
            onFocus={() => {
              if (ortOptions.length > 1) setShowOrtDropdown(true);
            }}
            placeholder={plzValid ? "Ort wird automatisch ausgefüllt" : "z.B. Grettstadt"}
            readOnly={ortOptions.length === 1 && ortAutoFilled.current}
            className={`field-glow w-full px-3 py-2 border rounded-lg text-sm outline-none transition-all duration-200 ${
              errors.ort
                ? "border-red-400 bg-red-50"
                : ortAutoFilled.current && ort
                ? "border-green-400 bg-green-50/30"
                : "border-gray-300"
            } ${ortOptions.length === 1 && ortAutoFilled.current ? "bg-gray-50" : ""}`}
          />
          {ortAutoFilled.current && ort && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <Check className="w-4 h-4 text-green-500" />
            </div>
          )}
        </div>
        {errors.ort && (
          <p className="text-red-600 text-xs mt-1">{errors.ort}</p>
        )}

        {/* Ort dropdown for multiple PLZ matches */}
        {showOrtDropdown && ortOptions.length > 1 && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-auto">
            <div className="px-3 py-1.5 text-xs text-gray-500 bg-gray-50 border-b">
              Mehrere Orte für PLZ {plz} – bitte wählen:
            </div>
            {ortOptions.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => selectOrt(o)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-svu-50 transition-colors ${
                  ort === o ? "bg-svu-50 font-medium text-svu-700" : "text-gray-700"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
