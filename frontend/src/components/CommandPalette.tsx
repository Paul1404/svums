import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  LayoutDashboard,
  FileText,
  Mail,
  Settings,
  Building2,
  UserX,
  LogOut,
  FlaskConical,
  Sun,
  Moon,
  Monitor,
  CornerDownLeft,
  Database,
} from "lucide-react";
import { useAdmin } from "../context/AdminContext";
import { useTheme } from "../context/ThemeContext";
import { getTestData } from "../services/api";
import { toast } from "sonner";
import { useBodyOverlay } from "../lib/useBodyOverlay";

type Command = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  keywords?: string;
  run: () => void | Promise<void>;
};

function matches(cmd: Command, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const hay = `${cmd.label} ${cmd.hint ?? ""} ${cmd.keywords ?? ""}`.toLowerCase();
  return hay.includes(needle);
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  useBodyOverlay(open);
  const { isAuthenticated, logout } = useAdmin();
  const { setMode } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  };

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      navigate(path);
      close();
    };
    const list: Command[] = [
      {
        id: "nav-dashboard",
        label: "Übersicht",
        hint: "Anträge verwalten",
        icon: <LayoutDashboard className="w-4 h-4" />,
        keywords: "dashboard home start home anträge",
        run: go("/admin"),
      },
      {
        id: "nav-documents",
        label: "Dokumente",
        hint: "Genehmigte & unterschriebene Dateien",
        icon: <FileText className="w-4 h-4" />,
        keywords: "files pdf",
        run: go("/admin/documents"),
      },
      {
        id: "nav-imported",
        label: "Bestand",
        hint: "Linear Webverein Import",
        icon: <Database className="w-4 h-4" />,
        keywords: "linear webverein import sql bestand mitglieder",
        run: go("/admin/imported"),
      },
      {
        id: "nav-email-log",
        label: "E-Mail-Log",
        hint: "Gesendete E-Mails",
        icon: <Mail className="w-4 h-4" />,
        keywords: "mail history",
        run: go("/admin/email-log"),
      },
      {
        id: "nav-cancellation",
        label: "Kündigung",
        hint: "Mitgliedschaft beenden",
        icon: <UserX className="w-4 h-4" />,
        keywords: "austritt termination",
        run: go("/admin/cancellation"),
      },
      {
        id: "nav-settings",
        label: "Einstellungen",
        hint: "E-Mail & Admin-Signatur",
        icon: <Settings className="w-4 h-4" />,
        keywords: "smtp signatur",
        run: go("/admin/settings"),
      },
      {
        id: "nav-club",
        label: "Vereinsdaten",
        hint: "Name, Kontakt, Rechtliches",
        icon: <Building2 className="w-4 h-4" />,
        keywords: "club settings branding",
        run: go("/admin/club-settings"),
      },
      {
        id: "test-einzel",
        label: "Testantrag · Einzel",
        icon: <FlaskConical className="w-4 h-4" />,
        keywords: "test demo preview",
        run: async () => {
          try {
            const d = await getTestData("einzel");
            sessionStorage.setItem("svums_test_data", JSON.stringify(d));
            window.open("/", "_blank");
            close();
          } catch {
            toast.error("Testdaten konnten nicht geladen werden");
          }
        },
      },
      {
        id: "test-kind",
        label: "Testantrag · Kind",
        icon: <FlaskConical className="w-4 h-4" />,
        keywords: "test demo child",
        run: async () => {
          try {
            const d = await getTestData("kind");
            sessionStorage.setItem("svums_test_data", JSON.stringify(d));
            window.open("/", "_blank");
            close();
          } catch {
            toast.error("Testdaten konnten nicht geladen werden");
          }
        },
      },
      {
        id: "test-familie",
        label: "Testantrag · Familie",
        icon: <FlaskConical className="w-4 h-4" />,
        keywords: "test demo family",
        run: async () => {
          try {
            const d = await getTestData("familie");
            sessionStorage.setItem("svums_test_data", JSON.stringify(d));
            window.open("/", "_blank");
            close();
          } catch {
            toast.error("Testdaten konnten nicht geladen werden");
          }
        },
      },
      {
        id: "theme-light",
        label: "Helles Design",
        icon: <Sun className="w-4 h-4" />,
        keywords: "theme light hell",
        run: () => {
          setMode("light");
          close();
        },
      },
      {
        id: "theme-dark",
        label: "Dunkles Design",
        icon: <Moon className="w-4 h-4" />,
        keywords: "theme dark dunkel",
        run: () => {
          setMode("dark");
          close();
        },
      },
      {
        id: "theme-auto",
        label: "Automatisches Design",
        icon: <Monitor className="w-4 h-4" />,
        keywords: "theme auto system",
        run: () => {
          setMode("auto");
          close();
        },
      },
      {
        id: "logout",
        label: "Abmelden",
        icon: <LogOut className="w-4 h-4" />,
        keywords: "signout exit",
        run: async () => {
          await logout();
          navigate("/admin/login");
          close();
        },
      },
    ];
    return list;
  }, [navigate, logout, setMode]);

  const filtered = useMemo(
    () => commands.filter((c) => matches(c, query)),
    [commands, query],
  );

  // Global hotkey + custom "open palette" event
  useEffect(() => {
    if (!isAuthenticated) return;
    function onKey(e: KeyboardEvent) {
      const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (modifier && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("svums:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("svums:open-palette", onOpen);
    };
  }, [isAuthenticated]);

  // Focus input on open, reset selection when query changes
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep active item in view
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  if (!isAuthenticated || !open) return null;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) void cmd.run();
    }
  };

  return (
    <div
      className="command-palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Befehlspalette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="command-palette" onKeyDown={handleKey}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
          <Search className="w-4 h-4 text-[var(--fg-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Befehl oder Seite suchen…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-[var(--fg-subtle)]"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border border-[var(--border-subtle)] text-[var(--fg-muted)]">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[var(--fg-muted)]">
              Keine Treffer
            </div>
          )}
          {filtered.map((cmd, idx) => (
            <button
              key={cmd.id}
              data-idx={idx}
              type="button"
              onMouseEnter={() => setActiveIndex(idx)}
              onClick={() => void cmd.run()}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                idx === activeIndex
                  ? "bg-[var(--bg-surface-2)] text-[var(--fg-primary)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--bg-surface-2)]"
              }`}
            >
              <span className="text-[var(--fg-muted)]">{cmd.icon}</span>
              <span className="flex-1 truncate">{cmd.label}</span>
              {cmd.hint && (
                <span className="text-xs text-[var(--fg-subtle)] truncate hidden sm:inline">
                  {cmd.hint}
                </span>
              )}
              {idx === activeIndex && (
                <CornerDownLeft className="w-3.5 h-3.5 text-[var(--fg-muted)]" />
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border-subtle)] text-[11px] text-[var(--fg-muted)]">
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)]">↑</kbd>
            <kbd className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)]">↓</kbd>
            navigieren
          </span>
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)]">⏎</kbd>
            ausführen
          </span>
        </div>
      </div>
    </div>
  );
}
