import React, { useState, useEffect } from "react";
import { User, School, Hash, Mail, CheckCircle2, Loader2, Sparkles, AlertCircle, Briefcase } from "lucide-react";
import SignaturePad from "./SignaturePad";

interface AttendeeFormProps {
  onSuccess: (data: { id: string; name: string; checkInTime: string }) => void;
  sessionActive: boolean;
}

export default function AttendeeForm({ onSuccess, sessionActive }: AttendeeFormProps) {
  const [name, setName] = useState("");
  const [instansi, setInstansi] = useState("");
  const [nip, setNip] = useState("");
  const [jabatan, setJabatan] = useState("");
  const [email, setEmail] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load cached form values on mount
  useEffect(() => {
    const cachedName = localStorage.getItem("absen_cached_name");
    const cachedInstansi = localStorage.getItem("absen_cached_instansi");
    const cachedNip = localStorage.getItem("absen_cached_nip");
    const cachedJabatan = localStorage.getItem("absen_cached_jabatan");
    const cachedEmail = localStorage.getItem("absen_cached_email");

    if (cachedName) setName(cachedName);
    if (cachedInstansi) setInstansi(cachedInstansi);
    if (cachedNip) setNip(cachedNip);
    if (cachedJabatan) setJabatan(cachedJabatan);
    if (cachedEmail) setEmail(cachedEmail);
  }, []);

  // Cache updates to local storage
  useEffect(() => {
    localStorage.setItem("absen_cached_name", name);
  }, [name]);

  useEffect(() => {
    localStorage.setItem("absen_cached_instansi", instansi);
  }, [instansi]);

  useEffect(() => {
    localStorage.setItem("absen_cached_nip", nip);
  }, [nip]);

  useEffect(() => {
    localStorage.setItem("absen_cached_jabatan", jabatan);
  }, [jabatan]);

  useEffect(() => {
    localStorage.setItem("absen_cached_email", email);
  }, [email]);

  // Clear specific local storage keys
  const clearLocalStorageCache = () => {
    localStorage.removeItem("absen_cached_name");
    localStorage.removeItem("absen_cached_instansi");
    localStorage.removeItem("absen_cached_nip");
    localStorage.removeItem("absen_cached_jabatan");
    localStorage.removeItem("absen_cached_email");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Form Validations
    if (!name.trim()) return setErrorMessage("Nama Lengkap wajib diisi.");
    if (!instansi.trim()) return setErrorMessage("Instansi wajib diisi.");
    if (!nip.trim()) return setErrorMessage("NIP wajib diisi.");
    if (!jabatan.trim()) return setErrorMessage("Jabatan wajib diisi.");
    if (!signature) return setErrorMessage("Tanda Tangan Digital wajib digambar.");

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/submit-attendance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          instansi: instansi.trim(),
          nip: nip.trim(),
          jabatan: jabatan.trim(),
          email: email.trim(),
          signature,
        }),
      });

      const contentType = response.headers.get("content-type");
      if (response.ok && contentType && contentType.includes("application/json")) {
        const result = await response.json();
        // Clear local storage on success
        clearLocalStorageCache();

        // Trigger success screen
        onSuccess({
          id: result.data.id,
          name: result.data.name,
          checkInTime: result.data.checkInTime,
        });

        // Clear Form state keys for next person
        setName("");
        setInstansi("");
        setNip("");
        setJabatan("");
        setEmail("");
        setSignature(null);
      } else {
        if (!response.ok && contentType && contentType.includes("application/json")) {
          const result = await response.json();
          throw new Error(result.error || "Gagal mengirim data.");
        } else {
          throw new Error("Offline fallback triggered");
        }
      }
    } catch (err: any) {
      console.error("Attendance submission client error:", err);
      // If it is a real validation error from the API (e.g. Duplication), display it clearly
      if (err.message && (err.message.includes("sudah terdaftar") || err.message.includes("wajib diisi") || err.message.includes("Sesi registrasi belum diaktifkan"))) {
        setErrorMessage(err.message);
      } else {
        // Network refusal/offline fallback/Vercel static host fallback!
        try {
          console.log("Saving attendance record offline in localStorage...");
          const now = new Date();
          const pad = (n: number) => n.toString().padStart(2, "0");
          const checkInTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
          
          const localBackupStr = localStorage.getItem("local_fallback_attendees") || "[]";
          const localBackupList = JSON.parse(localBackupStr);
          
          // Check duplication offline
          const isDup = localBackupList.some(
            (a: any) => a.nip.trim().toLowerCase() === nip.trim().toLowerCase() && 
                       a.name.trim().toLowerCase() === name.trim().toLowerCase()
          );
          
          if (isDup) {
            setErrorMessage(`Peserta dengan nama "${name}" dan NIP "${nip}" sudah terdaftar (offline).`);
            setIsSubmitting(false);
            return;
          }
          
          const newLocalAttendee = {
            no: localBackupList.length + 1,
            nip: nip.trim(),
            name: name.trim(),
            instansi: instansi.trim(),
            jabatan: jabatan.trim(),
            email: email.trim() || "-",
            checkInTime,
            signature, // Base64 image
            signatureUrl: signature, // Inline Base64 image directly
            sheetRowIndex: localBackupList.length + 2
          };
          
          localBackupList.push(newLocalAttendee);
          localStorage.setItem("local_fallback_attendees", JSON.stringify(localBackupList));
          
          // Clear cached inputs
          clearLocalStorageCache();
          
          // Success ticket
          onSuccess({
            id: nip.trim(),
            name: name.trim(),
            checkInTime
          });
          
          // Clear form fields
          setName("");
          setInstansi("");
          setNip("");
          setJabatan("");
          setEmail("");
          setSignature(null);
        } catch (localErr: any) {
          console.error("Failed to write to local storage backup:", localErr);
          setErrorMessage("Terjadi kesalahan koneksi dan gagal menyimpan data cadangan offline.");
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!sessionActive) {
    return (
      <div className="bg-white rounded-2xl shadow-xl border border-rose-100 p-8 max-w-lg mx-auto text-center">
        <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Sesi Absensi Belum Aktif</h3>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          Sesi pengisian absensi mandiri melalui smartphone belum diaktifkan oleh Admin. 
          Silakan hubungi panitia acara atau minta Admin untuk mengaktifkan sesi publik di dashboard terlebih dahulu.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Top Professional Header Banner - matching user's requested mock visual style */}
      <div className="bg-indigo-950 bg-gradient-to-r from-indigo-950 to-slate-900 px-6 py-8 md:px-8 text-white">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-bold bg-indigo-900/60 text-indigo-300 border border-indigo-800/50 mb-3 uppercase tracking-wider">
          <Sparkles className="w-3 h-3 text-indigo-400 animate-pulse" /> Formulir Kehadiran Digital
        </span>
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">Selamat Datang!</h2>
        <p className="text-xs text-indigo-200 mt-1 leading-relaxed">
          Mohon lengkapi identitas &amp; tanda tangan digital Anda dengan benar.
        </p>
      </div>

      <div className="p-6 md:p-8 space-y-5">
        {errorMessage && (
          <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex items-start gap-2.5 text-rose-700 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-500" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Nama Lengkap - full width on md */}
            <div className="md:col-span-2">
              <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 select-none">
                Nama Lengkap <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4 text-indigo-600" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Budi Santoso, M.Kom"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3.5 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white text-slate-800 placeholder-slate-400 font-medium"
                />
              </div>
            </div>

            {/* Instansi - full width on md */}
            <div className="md:col-span-2">
              <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 select-none">
                Instansi / Universitas / Perusahaan <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <School className="w-4 h-4 text-indigo-600" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Universitas Indonesia / Dinas Kesehatan / Umum"
                  value={instansi}
                  onChange={(e) => setInstansi(e.target.value)}
                  className="w-full pl-10 pr-4 py-3.5 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white text-slate-800 placeholder-slate-400 font-medium"
                />
              </div>
            </div>

            {/* NIP - side-by-side */}
            <div className="col-span-1">
              <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 select-none">
                NIP <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Hash className="w-4 h-4 text-indigo-600" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="Contoh: 198203112009031002"
                  value={nip}
                  onChange={(e) => setNip(e.target.value)}
                  className="w-full pl-10 pr-4 py-3.5 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white text-slate-850 placeholder-slate-400 font-mono font-medium"
                />
              </div>
            </div>

            {/* Jabatan - side-by-side */}
            <div className="col-span-1">
              <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 select-none">
                Jabatan <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Briefcase className="w-4 h-4 text-indigo-600" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Kepala Seksi / Dosen / Peserta"
                  value={jabatan}
                  onChange={(e) => setJabatan(e.target.value)}
                  className="w-full pl-10 pr-4 py-3.5 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white text-slate-800 placeholder-slate-400 font-medium"
                />
              </div>
            </div>

            {/* Alamat Email - full width on md */}
            <div className="md:col-span-2">
              <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 select-none">
                Alamat Email <span className="text-slate-400 text-[10px] font-normal lowercase">(opsional)</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4 text-indigo-600" />
                </div>
                <input
                  type="email"
                  placeholder="Contoh: alamat@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3.5 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white text-slate-800 placeholder-slate-400 font-medium"
                />
              </div>
            </div>

          </div>

          <div className="pt-3">
            <SignaturePad onChange={(base64) => setSignature(base64)} />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full mt-6 bg-indigo-600 hover:bg-indigo-700 active:scale-[99] text-white font-bold py-3.5 px-5 rounded-2xl text-xs sm:text-sm transition-all focus:ring-4 focus:ring-indigo-100 flex items-center justify-center gap-2 cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed shadow-md shadow-indigo-600/10"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Memproses Kehadiran Anda...</span>
              </>
            ) : (
              <span>Hadir &amp; Kirim Absen</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
