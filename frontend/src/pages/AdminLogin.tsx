import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAdmin } from "../context/AdminContext";
import { useClubConfig } from "../context/ClubConfigContext";
import { Lock, LogIn } from "lucide-react";

export default function AdminLogin() {
  const { login, isAuthenticated } = useAdmin();
  const club = useClubConfig();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    navigate("/admin", { replace: true });
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    try {
      await login(password);
      navigate("/admin", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Falsches Passwort");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm step-enter">
        <div className="text-center mb-8">
          <div className="w-16 h-16 brand-gradient-bg rounded-2xl flex items-center justify-center mx-auto mb-4 btn-primary-glow">
            <Lock className="w-8 h-8 text-white drop-shadow" />
          </div>
          <h1 className="text-2xl font-bold brand-gradient-text tracking-tight">
            {club.club_abbreviation} Admin
          </h1>
          <p className="text-sm text-gray-500 mt-1">{club.club_name}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="glass-card shine p-6"
        >
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Passwort
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            className="field-glow w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none transition bg-white"
            placeholder="Admin-Passwort eingeben"
          />
          <button
            type="submit"
            disabled={loading}
            className="btn-spring btn-primary-glow w-full mt-5 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white brand-gradient-bg rounded-lg"
          >
            <LogIn className="w-4 h-4" />
            {loading ? "Wird angemeldet..." : "Anmelden"}
          </button>
        </form>
      </div>
    </div>
  );
}
