import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;
const SESSION_FILE = path.join(process.cwd(), "admin_session.json");

// Middleware to parse JSON payloads with Base64 signature images (up to 10MB)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

interface AdminSession {
  accessToken: string | null;
  savedAt: number;
  spreadsheetId?: string;
  driveFolderId?: string;
  isSessionActive?: boolean;
}

const ATTENDEES_FILE = path.join(process.cwd(), "attendees.json");

interface LocalAttendee {
  no: number;
  nip: string;
  name: string;
  instansi: string;
  jabatan: string;
  email: string;
  checkInTime: string;
  signature: string; // Base64 signature image
  signatureUrl: string; // Dynamic local serve url
  signatureFileId?: string; // Google Drive ID if synced
  sheetRowIndex?: number;
}

// Helper to load local attendees
function loadLocalAttendees(): LocalAttendee[] {
  try {
    if (fs.existsSync(ATTENDEES_FILE)) {
      const data = fs.readFileSync(ATTENDEES_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Error reading local attendees file:", err);
  }
  return [];
}

// Helper to save local attendees
function saveLocalAttendees(list: LocalAttendee[]) {
  try {
    fs.writeFileSync(ATTENDEES_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing local attendees file:", err);
  }
}

// Helper to load admin session from file
function loadSession(): AdminSession | null {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = fs.readFileSync(SESSION_FILE, "utf-8");
      const parsed = JSON.parse(data);
      // Local session timeout is larger (24h) than Google auth tokens to prevent random kickouts
      const expiry = parsed.accessToken ? 3 * 3600 * 1000 : 24 * 3600 * 1000;
      if (Date.now() - parsed.savedAt < expiry) {
        return parsed;
      }
    }
  } catch (err) {
    console.error("Error reading admin session file:", err);
  }
  return null;
}

// Helper to save admin session to file
function saveSession(accessToken: string | null, spreadsheetId?: string, driveFolderId?: string, isSessionActive?: boolean) {
  try {
    const existing = loadSession();
    const session: AdminSession = {
      accessToken: accessToken !== undefined ? accessToken : (existing ? existing.accessToken : null),
      savedAt: Date.now(),
      spreadsheetId: spreadsheetId || (existing ? existing.spreadsheetId : undefined),
      driveFolderId: driveFolderId || (existing ? existing.driveFolderId : undefined),
      isSessionActive: isSessionActive !== undefined ? isSessionActive : (existing ? existing.isSessionActive : false)
    };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), "utf-8");
    console.log("Admin session saved to file:", session);
  } catch (err) {
    console.error("Error writing admin session file:", err);
  }
}

// Helper to delete admin session
function clearSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
      console.log("Admin session file cleared.");
    }
  } catch (err) {
    console.error("Error deleting admin session file:", err);
  }
}

// ==========================================
// API ENDPOINTS
// ==========================================

// Get session status (checks if check-in mode is active)
app.get("/api/session-status", (req, res) => {
  const session = loadSession();
  if (session) {
    res.json({ 
      active: !!session.isSessionActive, 
      savedAt: session.savedAt,
      spreadsheetId: session.spreadsheetId || null,
      driveFolderId: session.driveFolderId || null
    });
  } else {
    res.json({ active: false });
  }
});

// Admin saves token/settings for public check-ins
app.post("/api/save-token", (req, res) => {
  const { accessToken, spreadsheetId, driveFolderId, isSessionActive } = req.body;
  const current = loadSession();
  
  saveSession(
    accessToken !== undefined ? accessToken : (current ? current.accessToken : null),
    spreadsheetId || (current ? current.spreadsheetId : undefined),
    driveFolderId || (current ? current.driveFolderId : undefined),
    isSessionActive !== undefined ? !!isSessionActive : (current ? !!current.isSessionActive : true)
  );
  res.json({ status: "success", message: "Admin session registered on server." });
});

// Admin logs in via local Username & Password fallback bypass
app.post("/api/admin/local-login", (req, res) => {
  const { username, password } = req.body;
  
  const userText = (username || "").trim().toLowerCase();
  const passText = (password || "").trim();

  if (!userText || !passText) {
    return res.status(400).json({ error: "Username dan Password harus diisi." });
  }

  // Accept user "admin" with valid passwords
  if (userText === "admin" && (passText === "admin" || passText === "admin123" || passText === "absenkita2026")) {
    const current = loadSession() || {
      accessToken: null,
      savedAt: Date.now(),
      isSessionActive: false
    };
    saveSession(
      current.accessToken,
      current.spreadsheetId,
      current.driveFolderId,
      current.isSessionActive
    );
    return res.json({ 
      success: true, 
      message: "Login admin lokal sukses.",
      session: loadSession()
    });
  } else {
    return res.status(401).json({ error: "Username atau Password salah. Gunakan Username: admin, Password: admin123" });
  }
});

// Admin clears token
app.post("/api/clear-token", (req, res) => {
  const current = loadSession();
  if (current) {
    // Keep credentials, just deactivate active public check-in mode.
    saveSession(current.accessToken, current.spreadsheetId, current.driveFolderId, false);
  } else {
    clearSession();
  }
  res.json({ status: "success", message: "Admin session removed." });
});

// Get all attendees (stripped of huge base64 signatures to be ultra-fast)
app.get("/api/attendees", (req, res) => {
  const list = loadLocalAttendees();
  const stripped = list.map(({ signature, ...rest }) => rest);
  res.json(stripped);
});

// Fetch base64 signature as local PNG file bypassing Google Drive CORS
app.get("/api/signatures/:nip", (req, res) => {
  const { nip } = req.params;
  const list = loadLocalAttendees();
  const found = list.find(a => a.nip === nip);
  if (!found || !found.signature) {
    return res.status(404).send("Signature not found");
  }

  try {
    const base64Data = found.signature.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400"); // cache 24h
    res.send(buffer);
  } catch (err: any) {
    console.error("Local signature streaming error:", err);
    res.status(500).send("Gagal mengurai gambar tanda tangan");
  }
});

// Web attendee deletion endpoint (updates local database + optional Sheets)
app.delete("/api/attendees/:nip", async (req, res) => {
  const { nip } = req.params;
  const list = loadLocalAttendees();
  const index = list.findIndex(a => a.nip === nip);
  
  if (index === -1) {
    return res.status(404).json({ error: "Data peserta tidak ditemukan." });
  }

  const removed = list.splice(index, 1)[0];
  saveLocalAttendees(list);

  // Best-effort delete from Google Sheets if admin has loaded credentials
  const session = loadSession();
  if (session && session.accessToken && removed.sheetRowIndex) {
    try {
      const token = session.accessToken;
      const sheetId = session.spreadsheetId || "1Fu2MejKfS_Nm7AdqwERfaU22QBanPeYG8fQeILciwpw";
      const rowNum = removed.sheetRowIndex;

      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const firstTabId = meta.sheets[0].properties.sheetId ?? 0;
        
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId: firstTabId,
                    dimension: "ROWS",
                    startIndex: rowNum - 1,
                    endIndex: rowNum
                  }
                }
              }
            ]
          })
        });
        console.log(`[Google Sync] Row Deleted on Google Sheets for ${nip}`);
      }
    } catch (gErr) {
      console.error("[Google Sync] Best-effort Google Sheet row deletion failed:", gErr);
    }
  }

  res.json({ success: true, message: "Peserta berhasil dihapus dari data lokal." });
});

// Web attendee edit endpoint (updates local database + optional Sheets)
app.put("/api/attendees/:nip", async (req, res) => {
  const { nip } = req.params;
  const { name, instansi, jabatan, email } = req.body;
  const list = loadLocalAttendees();
  const index = list.findIndex(a => a.nip === nip);
  
  if (index === -1) {
    return res.status(404).json({ error: "Data peserta tidak ditemukan." });
  }

  list[index].name = name || list[index].name;
  list[index].instansi = instansi || list[index].instansi;
  list[index].jabatan = jabatan || list[index].jabatan;
  list[index].email = email || list[index].email;

  saveLocalAttendees(list);

  // Best-effort edit update on Google Sheets
  const session = loadSession();
  if (session && session.accessToken && list[index].sheetRowIndex) {
    try {
      const token = session.accessToken;
      const sheetId = session.spreadsheetId || "1Fu2MejKfS_Nm7AdqwERfaU22QBanPeYG8fQeILciwpw";
      const rowNum = list[index].sheetRowIndex;

      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const firstTabName = meta.sheets[0].properties.title;
        
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(firstTabName)}!A${rowNum}:H${rowNum}?valueInputOption=USER_ENTERED`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              range: `${firstTabName}!A${rowNum}:H${rowNum}`,
              majorDimension: "ROWS",
              values: [
                [
                  list[index].no,
                  nip,
                  list[index].name,
                  list[index].instansi,
                  list[index].jabatan,
                  list[index].email,
                  list[index].checkInTime,
                  list[index].signatureUrl,
                ],
              ],
            }),
          }
        );
        console.log(`[Google Sync] Row edited on Google Sheets for ${nip}`);
      }
    } catch (gErr) {
      console.error("[Google Sync] Best-effort Google Sheet row edit failed:", gErr);
    }
  }

  res.json({ success: true, message: "Perubahan peserta berhasil disimpan." });
});

// Admin clears all attendees
app.post("/api/clear-all", (req, res) => {
  saveLocalAttendees([]);
  res.json({ success: true, message: "Seluruh data lokal berhasil dikosongkan." });
});

// Public Submit Attendance
app.post("/api/submit-attendance", async (req, res) => {
  const session = loadSession();
  if (!session || !session.isSessionActive) {
    return res.status(401).json({
      error: "Sesi registrasi belum diaktifkan oleh admin. Harap minta panitia untuk mengaktifkan sesi absensi terlebih dahulu."
    });
  }

  const { name, instansi, nip, jabatan, email, signature } = req.body;

  if (!name || !instansi || !nip || !jabatan || !signature) {
    return res.status(400).json({ error: "Nama, Instansi, Jabatan, NIP, dan tanda tangan wajib diisi." });
  }

  try {
    const list = loadLocalAttendees();
    
    // Check duplication based on both NIP and Name to allow multiple dummy/unfilled NIP submissions with different names
    const alreadyRegistered = list.some(
      a => a.nip.trim().toLowerCase() === nip.trim().toLowerCase() && 
           a.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (alreadyRegistered) {
      return res.status(400).json({ error: `Peserta dengan nama "${name}" dan NIP "${nip}" sudah terdaftar.` });
    }

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const checkInTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const nextNo = list.length + 1;
    // Generate clean local signature URL
    const localSigUrl = `/api/signatures/${encodeURIComponent(nip)}?t=${Date.now()}`;

    const newAttendee: LocalAttendee = {
      no: nextNo,
      nip,
      name,
      instansi,
      jabatan,
      email: email || "-",
      checkInTime,
      signature,
      signatureUrl: localSigUrl,
      sheetRowIndex: nextNo + 1
    };

    let googleSynced = false;
    let signatureFileId = "";

    // If Google token is live, upload to sheets and drive!
    if (session.accessToken) {
      const token = session.accessToken;
      try {
        console.log(`[Google Sync] Uploading signature image to Drive for: ${name}`);
        signatureFileId = await uploadSignatureToDrive(token, name, signature, session.driveFolderId);
        newAttendee.signatureFileId = signatureFileId;
        
        // Use thumb image or drive direct link
        const driveUrl = `https://drive.google.com/thumbnail?id=${signatureFileId}&sz=w500`;
        newAttendee.signatureUrl = driveUrl; // Fallback to drive on sheets

        console.log(`[Google Sync] Appending row to Google Sheet value row: ${name}`);
        await appendAttendeeToSheet(token, {
          nip,
          name,
          instansi,
          jabatan,
          email: email || "-",
          checkInTime,
          signatureFileId
        }, session.spreadsheetId);

        googleSynced = true;
        console.log(`[Google Sync] Successfully synced to Google cloud: ${name}`);
      } catch (gErr) {
        console.error("[Google Sync] Best-effort sync to Google Drive & Google Sheets failed:", gErr);
        // Do not fail the attendance! It is saved locally.
        // Recover signature URL to the local serve URL
        newAttendee.signatureUrl = localSigUrl;
      }
    }

    list.push(newAttendee);
    saveLocalAttendees(list);

    res.json({
      success: true,
      data: {
        id: nip,
        name,
        checkInTime
      },
      syncedWithGoogle: googleSynced
    });
  } catch (error: any) {
    console.error("Attendance submission process failure:", error);
    res.status(500).json({
      error: `Pendaftaran gagal: ${error.message || "Terjadi kesalahan sistem internal."}`
    });
  }
});

// Helper for Google Drive Upload
async function uploadSignatureToDrive(token: string, name: string, signatureBase64: string, customFolderId?: string): Promise<string> {
  const folderId = customFolderId || '1UseBW7ICFFT-cUPD1HC3KrJUhLCVgEgR';
  
  // Create File Metadata
  const metaResponse = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: `TandaTangan_${name.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.png`,
      parents: [folderId],
      mimeType: "image/png"
    })
  });

  if (!metaResponse.ok) {
    const errorText = await metaResponse.text();
    throw new Error(`Google Drive Create Metadata Failed: ${errorText}`);
  }

  const metaData = (await metaResponse.json()) as { id: string };
  const fileId = metaData.id;

  // Upload Binary Media
  const base64Data = signatureBase64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  const uploadResponse = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "image/png"
    },
    body: buffer
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    throw new Error(`Google Drive Media Upload Failed: ${errText}`);
  }

  return fileId;
}

// Helper for Google Sheets Row Appending
async function appendAttendeeToSheet(token: string, data: {
  nip: string;
  name: string;
  instansi: string;
  jabatan: string;
  email: string;
  checkInTime: string;
  signatureFileId: string;
}, customSpreadsheetId?: string) {
  const spreadsheetId = customSpreadsheetId || '1Fu2MejKfS_Nm7AdqwERfaU22QBanPeYG8fQeILciwpw';

  // 1. Fetch sheet title
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: { "Authorization": `Bearer ${token}` }
  });

  if (!metaRes.ok) {
    const errText = await metaRes.text();
    throw new Error(`Google Sheets Metadata Fetch Failed: ${errText}`);
  }

  const spreadsheetMeta = (await metaRes.json()) as { sheets: any[] };
  const sheets = spreadsheetMeta.sheets || [];
  if (sheets.length === 0) {
    throw new Error("No sheets found in Google Spreadsheet");
  }
  const firstSheetTitle = sheets[0].properties.title;

  // 2. Read first row to see if headers are needed
  const readRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(firstSheetTitle)}!A1:H1`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  
  let needsHeaders = true;
  if (readRes.ok) {
    const readData = (await readRes.json()) as { values?: any[][] };
    if (readData.values && readData.values.length > 0) {
      needsHeaders = false;
    }
  }

  const rowsToAppend = [];
  if (needsHeaders) {
    rowsToAppend.push([
      "No",
      "NIP",
      "Nama Lengkap",
      "Instansi",
      "Jabatan",
      "Email",
      "Waktu Hadir",
      "Link Tanda Tangan"
    ]);
  }

  // Read A:A to determine next participant number
  const totalRowsRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(firstSheetTitle)}!A:A`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  let nextNo = 1;
  if (totalRowsRes.ok) {
    const rData = (await totalRowsRes.json()) as { values?: any[][] };
    const values = rData.values || [];
    const actualRowCount = values.length;
    // If we're writing headers, next No is 1. If headers exist, count number of records
    if (!needsHeaders) {
      nextNo = Math.max(1, actualRowCount); // Rows count matches next index (assuming header is index 1)
    }
  }

  const viewUrl = `https://drive.google.com/thumbnail?id=${data.signatureFileId}&sz=w500`;

  rowsToAppend.push([
    nextNo,
    data.nip,
    data.name,
    data.instansi,
    data.jabatan,
    data.email,
    data.checkInTime,
    viewUrl
  ]);

  // Append data row
  const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(firstSheetTitle)}!A:H:append?valueInputOption=USER_ENTERED`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      values: rowsToAppend
    })
  });

  if (!appendRes.ok) {
    const errText = await appendRes.text();
    throw new Error(`Google Sheets Append Values Failed: ${errText}`);
  }
}

// Proxy endpoint to fetch signature images and bypass CORS restrictions
app.get("/api/proxy-signature", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    // Resolve Authorization token (try request headers, and fallback to server session)
    let authHeader = req.headers.authorization;
    if (!authHeader) {
      const session = loadSession();
      if (session && session.accessToken) {
        authHeader = `Bearer ${session.accessToken}`;
      }
    }

    const headers: Record<string, string> = {};
    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    const fetchRes = await fetch(url, { headers });
    if (!fetchRes.ok) {
      throw new Error(`Failed to fetch image: ${fetchRes.statusText} (${fetchRes.status})`);
    }

    const contentType = fetchRes.headers.get("content-type") || "image/png";
    const arrayBuffer = await fetchRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=604800"); // Cache for 7 days
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(buffer);
  } catch (err: any) {
    console.error("Signature proxy error:", err);
    res.status(500).json({ error: `Gagal memproksi gambar tanda tangan: ${err.message}` });
  }
});

// ==========================================
// VITE AND STATIC SERVING MAIN SETUP
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Full-Stack Attendance app running on http://localhost:${PORT}`);
  });
}

startServer();
