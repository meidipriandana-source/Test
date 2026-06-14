import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Required Scopes for Spreadsheet and Drive integration
provider.addScope("https://www.googleapis.com/auth/spreadsheets");
provider.addScope("https://www.googleapis.com/auth/drive");

// Helper to determine if we should use Redirect flow instead of Popup flow
const shouldUseRedirect = (): boolean => {
  if (typeof window === "undefined" || !window.navigator) return false;
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
  const isMobilePattern = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  const isFramed = window.self !== window.top;
  // Inside an iframe, signInWithRedirect is completely blocked by Google Identity auth templates
  // due to frame restriction policy headers (e.g. X-Frame-Options/SameOrigin/Block).
  // Thus, inside any iframe (like the AI Studio preview frame), we MUST use popup.
  // We only use redirect on real mobile device browsers running as the top-level window.
  return isMobilePattern && !isFramed;
};

let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Attempt to load token from localStorage cache to persist state upon refresh
if (typeof window !== "undefined") {
  const savedToken = localStorage.getItem("google_access_token");
  if (savedToken) {
    cachedAccessToken = savedToken;
  }
}

// Initialize auth state listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // First, parse redirect results if returning from a mobile signInWithRedirect flow
  getRedirectResult(auth)
    .then(async (result) => {
      if (result) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
          cachedAccessToken = credential.accessToken;
          localStorage.setItem("google_access_token", cachedAccessToken);
          
          // Sync token to Express backend server
          try {
            await fetch("/api/save-token", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accessToken: cachedAccessToken })
            });
          } catch (apiErr) {
            console.error("Failed to sync access token to Express server after redirect:", apiErr);
          }

          if (auth.currentUser && onAuthSuccess) {
            onAuthSuccess(auth.currentUser, cachedAccessToken);
          }
        }
      }
    })
    .catch((err) => {
      console.error("Error processing getRedirectResult:", err);
    });

  // Watch auth state changes
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        // Fallback check: if user is logged in, check if we have cached token in localStorage
        const savedToken = localStorage.getItem("google_access_token");
        if (savedToken) {
          cachedAccessToken = savedToken;
          if (onAuthSuccess) onAuthSuccess(user, savedToken);
        } else if (!isSigningIn) {
          // If we are logged in from a previous session but lack an active OAuth token, allow some buffer
          setTimeout(() => {
            if (!cachedAccessToken && onAuthFailure) {
              onAuthFailure();
            }
          }, 1500);
        }
      }
    } else {
      cachedAccessToken = null;
      localStorage.removeItem("google_access_token");
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Start Google sign-in with web pop-up (or redirect on mobile/iframes)
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    
    // Choose flow dynamically depending on device/frame to prevent popup blocking in mobile apps/WebViews
    if (shouldUseRedirect()) {
      console.log("Mobile standalone browser detected: Executing signInWithRedirect flow...");
      await signInWithRedirect(auth, provider);
      // Flow redirects the page, so execution stops here. Handled by getRedirectResult upon reloading.
      return null;
    }

    console.log("Desktop browser detected: Executing standard signInWithPopup flow...");
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Gagal memperoleh access token OAuth dari akun Google Anda.");
    }

    cachedAccessToken = credential.accessToken;
    localStorage.setItem("google_access_token", cachedAccessToken);
    
    // Register the token with Express server so public checkin can write to our Sheet/Drive!
    try {
      await fetch("/api/save-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: cachedAccessToken })
      });
    } catch (apiErr) {
      console.error("Failed to sync access token to Express server:", apiErr);
    }

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Sign-in Google error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  try {
    await fetch("/api/clear-token", { method: "POST" });
  } catch (err) {
    console.error("Failed to clear backend token session on logout:", err);
  }
  await auth.signOut();
  cachedAccessToken = null;
  localStorage.removeItem("google_access_token");
};
