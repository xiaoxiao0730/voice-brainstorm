// Adapter to bridge existing lovable API calls to the new private auth package (@voice-brainstorm/auth) or a custom implementation.
// This adapter exposes `createLovableAuth()` so existing code that imports
// `createLovableAuth` from the previous Lovable SDK can keep working with minimal changes.

export function createLovableAuth() {
  // Return an object with the same surface as the old lovable client: at minimum `signInWithOAuth`.
  return {
    async signInWithOAuth(provider: "google" | "apple" | "microsoft" | "lovable", opts?: any) {
      try {
        // Try to dynamically import the private npm package. If it's not installed yet,
        // the dynamic import will fail and we'll return a helpful error instead of crashing the app.
        const mod = await import("@voice-brainstorm/auth");
        // The private package should expose a compatible API. Here we try a common shape:
        // - createAuthClient() -> client with signInWithOAuth(provider, opts)
        // Adjust according to your actual package export.
        if (mod?.createAuthClient) {
          const client = mod.createAuthClient();
          if (typeof client.signInWithOAuth === "function") {
            return await client.signInWithOAuth(provider, opts);
          }
        }

        // If the package shape is different, try to call a direct helper
        if (typeof mod.signInWithOAuth === "function") {
          return await mod.signInWithOAuth(provider, opts);
        }

        return { error: new Error("@voice-brainstorm/auth is installed but does not expose a compatible API") };
      } catch (e) {
        return { error: e instanceof Error ? e : new Error(String(e)) };
      }
    },
  } as const;
}
