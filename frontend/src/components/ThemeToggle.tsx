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

  return (
    <div
      className={`theme-toggle ${floating ? "theme-toggle-floating" : ""} ${className}`}
      role="group"
      aria-label="Farbschema auswählen"
    >
      {OPTIONS.map((opt) => {
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMode(opt.value)}
            aria-pressed={active}
            aria-label={opt.label}
            title={opt.label}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}
