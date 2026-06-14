import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, OAuthProvider } from "firebase/auth";

// Optional: if your adapter needs to call a server endpoint to exchange Firebase token for Supabase session
const EXCHANGE_URL = (import.meta.env.VITE_AUTH_EXCHANGE_URL as string) || "";

function ensureFirebaseApp() {
  if (!getApps().length) {
    initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    } as any);
  }
  return getApp();
}

function mapProvider(provider: "google" | "apple" | "microsoft" | "lovable") {
  switch (provider) {
    case "google":
      return new GoogleAuthProvider();
    case "apple":
      return new OAuthProvider("apple.com");
    case "microsoft":
      return new OAuthProvider("microsoft.com");
    case "lovable":
    default:
      return new OAuthProvider("openid");
  }
}

export function createLovableAuth() {
  return {
    async signInWithOAuth(provider: "google" | "apple" | "microsoft" | "lovable", opts?: any) {
      try {
        ensureFirebaseApp();
        const auth = getAuth();
        const providerObj = mapProvider(provider as any);

        if (opts?.extraParams && typeof (providerObj as any).setCustomParameters === "function") {
          (providerObj as any).setCustomParameters({ ...opts.extraParams });
        }

        const cred = await signInWithPopup(auth, providerObj as any);
        const idToken = await cred.user.getIdToken();
        const accessToken = ((cred as any)?.credential?.accessToken) as string | undefined;

        // If an exchange endpoint is configured (server-side), call it to obtain Supabase-compatible tokens.
        if (EXCHANGE_URL) {
          try {
            const res = await fetch(EXCHANGE_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ idToken, provider, accessToken }),
            });
            if (!res.ok) {
              const txt = await res.text();
              return { error: new Error(`Exchange endpoint returned ${res.status}: ${txt}`) } as any;
            }
            const data = await res.json();
            // Expecting server to return Supabase session-like tokens under `tokens` or direct fields
            // Example response: { tokens: { access_token, refresh_token, expires_at } }
            const tokens = data.tokens ?? data;
            return { tokens } as any;
          } catch (e) {
            return { error: e instanceof Error ? e : new Error(String(e)) } as any;
          }
        }

        // No exchange endpoint configured -> return Firebase tokens (id_token, access_token)
        return {
          tokens: {
            id_token: idToken,
            access_token: accessToken,
          },
        } as any;
      } catch (e) {
        return { error: e instanceof Error ? e : new Error(String(e)) } as any;
      }
    },
  } as const;
}
