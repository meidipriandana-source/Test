import React, { useState, useEffect } from "react";
import { 
  motion, AnimatePresence 
} from "motion/react";
import { 
  User, CheckCircle2, ShieldAlert, Users, QrCode, ClipboardCheck, Sparkles, LogIn, ArrowRight
} from "lucide-react";
import AttendeeForm from "./components/AttendeeForm";
import DashboardAdmin from "./components/DashboardAdmin";
import { initAuth, googleSignIn, logout } from "./lib/auth";
import { User as FirebaseUser } from "firebase/auth";

type ViewMode = "form" | "admin";

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("form");
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("admin_local_logged_in") === "true";
    }
    return false;
  });
  const [adminUser, setAdminUser] = useState<FirebaseUser | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("admin_local_logged_in") === "true" ? "bypass" : null;
    }
    return null;
  });
  const [isPublicSessionActive, setIsPublicSessionActive] = useState(false);
  const [localUsername, setLocalUsername] = useState("admin");
  const [localPassword, setLocalPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  // Success ticket state (when participant completes draw signature + check-in)
  const [successTicket, setSuccessTicket] = useState<{
    id: string;
    name: string;
    checkInTime: string;
  } | null>(null);

  // 1. Fetch backend state to see if public/smartphone form is open
  const checkPublicSession = async () => {
    try {
      const res = await fetch("/api/session-status");
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setIsPublicSessionActive(data.active);
      } else {
        console.warn("Backend not yet ready or returned non-JSON response for session-status. Defaulting to active for client-side demo.");
        // Fallback: If we are on static host or offline, read local state (active by default)
        const offlineActive = localStorage.getItem("offline_session_active") !== "false";
        setIsPublicSessionActive(offlineActive);
      }
    } catch (err) {
      console.error("Failed to fetch public session status:", err);
      // Fallback: If network is dry, read local state
      const offlineActive = localStorage.getItem("offline_session_active") !== "false";
      setIsPublicSessionActive(offlineActive);
    }
  };

  useEffect(() => {
    checkPublicSession();
    // Poll public session state every 8 seconds
    const statusInterval = setInterval(checkPublicSession, 8000);

    // 2. Initialize Firebase authentication listener
    const unsubscribe = initAuth(
      (user, token) => {
        setIsAdminLoggedIn(true);
        setAdminUser(user);
        setAdminToken(token);
        setIsPublicSessionActive(true); // If admin is logged in locally, session is active
        localStorage.removeItem("admin_local_logged_in"); // Prioritize real google active auth if done
      },
      () => {
        // Only log out if not explicitly logged in via local bypass
        if (localStorage.getItem("admin_local_logged_in") !== "true") {
          setIsAdminLoggedIn(false);
          setAdminUser(null);
          setAdminToken(null);
        }
      }
    );

    return () => {
      unsubscribe();
      clearInterval(statusInterval);
    };
  }, []);

  // Handle Admin Google Sign-In
  const handleAdminLogin = async () => {
    try {
      setLoginError(null);
      const result = await googleSignIn();
      if (result) {
        setIsAdminLoggedIn(true);
        setAdminUser(result.user);
        setAdminToken(result.accessToken);
        setIsPublicSessionActive(true);
        localStorage.removeItem("admin_local_logged_in");
        // Switch view to Admin panel directly
        setViewMode("admin");
      }
    } catch (err: any) {
      console.error("Login failure:", err);
      const rawMsg = err.message || "";
      if (rawMsg.includes("auth/unauthorized-domain") || rawMsg.includes("unauthorized") || rawMsg.includes("domain")) {
        setLoginError("⚠️ PROSES DIHENTIKAN: Domain preview ini belum didaftarkan di Authorized Domains Firebase Console Anda. Silakan abaikan Google Sign-In dan ketik PIN bypass di bawah: 'admin123' atau 'absenkita2026' untuk masuk instan.");
      } else {
        setLoginError(err.message || "Gagal masuk menggunakan Google Auth.");
      }
    }
  };

  // Handle Local Admin Password sign-in bypass
  const handleLocalAdminLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const usernameTrimmed = localUsername.trim();
    const passwordTrimmed = localPassword.trim();

    if (!usernameTrimmed) {
      setLoginError("Silakan masukkan Username Admin.");
      return;
    }
    if (!passwordTrimmed) {
      setLoginError("Silakan masukkan password Admin.");
      return;
    }

    try {
      setLoginError(null);
      const res = await fetch("/api/admin/local-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameTrimmed, password: passwordTrimmed })
      });
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        if (data.success) {
          localStorage.setItem("admin_local_logged_in", "true");
          localStorage.removeItem("offline_fallback_mode");
          setIsAdminLoggedIn(true);
          setAdminToken("bypass");
          setIsPublicSessionActive(data.session?.isSessionActive || false);
          setLocalPassword("");
          setViewMode("admin");
        } else {
          setLoginError(data.error || "Username atau password salah.");
        }
      } else {
        throw new Error("Endpoint did not return JSON. Falling back to offline bypass credentials.");
      }
    } catch (err) {
      console.warn("Using offline bypass credentials fallback:", err);
      // Fallback: Validate credentials client-side to run fully on static-only systems like Vercel
      const userText = usernameTrimmed.toLowerCase();
      if (userText === "admin" && (passwordTrimmed === "admin" || passwordTrimmed === "admin123" || passwordTrimmed === "absenkita2026")) {
        localStorage.setItem("admin_local_logged_in", "true");
        localStorage.setItem("offline_fallback_mode", "true");
        // Save initial offline session settings if they don't exist
        if (!localStorage.getItem("offline_session_active")) {
          localStorage.setItem("offline_session_active", "true");
        }
        setIsAdminLoggedIn(true);
        setAdminToken("bypass");
        setIsPublicSessionActive(localStorage.getItem("offline_session_active") !== "false");
        setLocalPassword("");
        setViewMode("admin");
      } else {
        setLoginError("Username atau password salah (Kunci Akses offline).");
      }
    }
  };

  // Handle Admin Log-Out
  const handleAdminLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error("Logout error:", err);
    }
    localStorage.removeItem("admin_local_logged_in");
    setIsAdminLoggedIn(false);
    setAdminUser(null);
    setAdminToken(null);
    setViewMode("form"); // Redirect back to form
    checkPublicSession();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col transition-all duration-300">
      
      {/* Dynamic Deep Indigo Header styled precisely based on user UI specifications */}
      <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-950 px-4 md:px-8 py-3.5 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/30">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm md:text-base font-extrabold text-white tracking-tight leading-none">Absen Peserta Kegiatan</h1>
            <span className="inline-block text-[9px] text-indigo-300 font-semibold tracking-wider uppercase mt-1">Smart Presence System</span>
          </div>
        </div>

        {/* Tab switcher Controls / Quick Actions */}
        <div className="flex items-center gap-1.5 bg-slate-950/40 p-1 rounded-xl border border-white/5">
          <button
            onClick={() => {
              setViewMode("form");
              setSuccessTicket(null); // Close active success card
            }}
            className={`px-4 py-1.8 rounded-lg text-xs font-bold transition-all relative cursor-pointer flex items-center gap-1.5 ${
              viewMode === "form" 
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20" 
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <User className="w-3.5 h-3.5" />
            Isi Absen
          </button>
          
          <button
            onClick={() => setViewMode("admin")}
            className={`px-4 py-1.8 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              viewMode === "admin" 
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20" 
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Dashboard Admin
            {isPublicSessionActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse self-center" title="Sesi publik aktif"></span>
            )}
          </button>
        </div>
      </header>

      {/* Main Container Stage */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {viewMode === "form" ? (
            <motion.div
              key="form-view"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="w-full"
            >
              {successTicket ? (
                /* Ticket success screen block - styled elegantly as a standard web modal card */
                <div className="max-w-md mx-auto my-6 bg-white rounded-3xl shadow-xl border border-slate-150 overflow-hidden text-center transition-all">
                  <div className="bg-emerald-600 p-6 text-white text-center flex flex-col items-center">
                    <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-3">
                      <CheckCircle2 className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="text-base font-bold">Presensi Berhasil Terdaftar</h3>
                    <p className="text-[10px] text-emerald-100 mt-0.5">ID: {successTicket.id}</p>
                  </div>
                  
                  <div className="p-5 space-y-4 text-left">
                    <div className="space-y-0.5">
                      <span className="text-[9px] text-slate-400 uppercase font-semibold tracking-wide">Nama Lengkap</span>
                      <p className="text-sm font-bold text-slate-800">{successTicket.name}</p>
                    </div>

                    <div className="space-y-0.5 border-t border-slate-100 pt-2.5">
                      <span className="text-[9px] text-slate-400 uppercase font-semibold tracking-wide">Waktu Registrasi</span>
                      <p className="text-xs font-mono font-semibold text-slate-600">{successTicket.checkInTime}</p>
                    </div>

                    <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 inline-block w-full text-center">
                      <p className="text-[10px] font-medium text-emerald-800 leading-relaxed">
                        Terima kasih! Kehadiran Anda telah direkam langsung ke Google Spreadsheet dan tanda tangan Anda aman tersimpan pada folder Google Drive.
                      </p>
                    </div>

                    <button
                      onClick={() => setSuccessTicket(null)}
                      className="w-full mt-2 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      Kembali / Absen Orang Lain <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                /* Elegant, clean full responsive form layout card (completely free of smartphone frame simulator restrictions) */
                <div className="max-w-2xl mx-auto my-4 bg-white rounded-3xl shadow-xl shadow-slate-100/50 border border-slate-150 overflow-hidden transition-all duration-300">
                  <AttendeeForm 
                    onSuccess={(ticket) => setSuccessTicket(ticket)} 
                    sessionActive={isPublicSessionActive} 
                  />
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="admin-view"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="w-full"
            >
              {isAdminLoggedIn ? (
                /* Authenticated Dashboard Admin */
                <DashboardAdmin
                  accessToken={adminToken}
                  onLogin={handleAdminLogin}
                  onLogout={handleAdminLogout}
                />
              ) : (
                /* Auth login gate for admin */
                <div className="bg-white rounded-2xl shadow-xl shadow-slate-100/40 border border-slate-100 p-6 sm:p-8 max-w-sm mx-auto text-center my-6">
                  <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <LogIn className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1">Otoritas Admin</h3>
                  
                  {/* Helpful alert about Firebase domain error */}
                  <div className="my-4 p-3 bg-amber-50 text-amber-850 rounded-xl text-[11px] text-left leading-relaxed border border-amber-200/60">
                    <span className="font-bold">💡 Masuk Instan (Sangat Direkomendasikan):</span>
                    <p className="mt-1 text-slate-600 font-normal">
                      Karena link preview ini dinamis, Google Auth mungkin mengalami error <code className="bg-amber-100 text-amber-900 px-1 rounded font-mono font-bold">unauthorized-domain</code>. Silakan langsung gunakan <strong className="text-slate-800 bg-amber-100/50 px-1 rounded">Sandi PIN Admin</strong> di bawah untuk masuk ke dashboard secara instan tanpa kendala.
                    </p>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed mb-6">
                    Akses terbatas. Masuk menggunakan akun Google Anda atau bypass dengan kata sandi panitia di bawah.
                  </p>

                  {loginError && (
                    <div className="mb-4 p-3 bg-rose-50 text-rose-700 rounded-xl text-xs text-left font-medium border border-rose-100">
                      {loginError}
                    </div>
                  )}

                  <div className="space-y-4 text-left">
                    <form onSubmit={handleLocalAdminLoginSubmit} className="space-y-4 bg-indigo-50/40 p-3.5 rounded-xl border border-indigo-100/70">
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-indigo-950 mb-1">Username Admin</label>
                        <input
                          type="text"
                          value={localUsername}
                          onChange={(e) => setLocalUsername(e.target.value)}
                          placeholder="Masukkan username admin..."
                          className="w-full bg-white border border-slate-200 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition font-medium"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-indigo-950 mb-1">Password Admin</label>
                        <input
                          type="password"
                          value={localPassword}
                          onChange={(e) => setLocalPassword(e.target.value)}
                          placeholder="Masukkan password admin..."
                          className="w-full bg-white border border-slate-200 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition flex items-center justify-center gap-1 cursor-pointer shadow-md shadow-indigo-600/10"
                      >
                        Buka Dashboard Admin
                      </button>
                    </form>

                    <div className="bg-slate-50 border border-slate-150/70 p-3 rounded-xl text-center">
                      <p className="text-[10px] text-slate-500 leading-normal">
                        Kunci Akses Default:<br />
                        Username: <code className="bg-slate-200 px-1 py-0.5 rounded font-mono font-bold text-slate-700">admin</code><br />
                        Password: <code className="bg-slate-200 px-1 py-0.5 rounded font-mono font-bold text-slate-700">admin123</code>
                      </p>
                    </div>
                  </div>


                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Humble Footer branding */}
      <footer className="py-5 border-t border-slate-150/50 bg-white text-center text-[10px] text-slate-450 mt-10">
        <p className="font-medium">AbsenKehadiran digital &middot; Google Workspace Cloud Integration</p>
        <p className="text-[9px] text-slate-400 mt-1">Google Sheets &amp; Drive Cloud Integration Active</p>
      </footer>
    </div>
  );
}
