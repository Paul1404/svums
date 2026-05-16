import { useRef } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "../context/ThemeContext";

type Props = {
  floating?: boolean;
  className?: string;
};

const OPTIONS: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Helles Design", icon: <Sun className="w-4 h-4" /> },
  { value: "auto", label: "Automatisch (Systemeinstellung)", icon: <Monitor className="w-4 h-4" /> },
  { value: "dark", label: "Dunkles Design", icon: <Moon className="w-4 h-4" /> },
];

export default function ThemeToggle({ floating = false, className = "" }: Props) {
  const { mode, setMode } = useTheme();
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const activeIndex = Math.max(
    0,
    OPTIONS.findIndex((o) => o.value === mode),
  );

  const focusAt = (index: number) => {
    const safe = ((index % OPTIONS.length) + OPTIONS.length) % OPTIONS.length;
    const btn = buttonsRef.current[safe];
    btn?.focus();
    setMode(OPTIONS[safe].value);
  };

  const handleKey = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(OPTIONS.length - 1);
        break;
    }
  };

  return (
    <div
      className={`theme-toggle ${floating ? "theme-toggle-floating" : ""} ${className}`}
      role="radiogroup"
      aria-label="Farbschema auswählen"
    >
      {OPTIONS.map((opt, i) => {
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              buttonsRef.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            // Only the active option is in the tab sequence; arrow keys
            // move focus between the rest, as per the radiogroup pattern.
            tabIndex={i === activeIndex ? 0 : -1}
            onClick={() => setMode(opt.value)}
            onKeyDown={(e) => handleKey(e, i)}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}
