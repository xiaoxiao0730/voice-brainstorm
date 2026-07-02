import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { readEnv } from "@/lib/env";
import { createSupabaseServerClient } from "./serverClient";

const LOCAL_USER_ID =
  readEnv("LOCAL_USER_ID") ?? "00000000-0000-0000-0000-000000000001";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const supabaseUrl = readEnv("SUPABASE_URL");
    const publishableKey = readEnv("SUPABASE_PUBLISHABLE_KEY");
    const secretKey =
      readEnv("SUPABASE_SECRET_KEY") ?? readEnv("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl) throw new Error("Missing SUPABASE_URL.");

    if (readEnv("VITE_ENABLE_AUTH") !== "true") {
      if (!secretKey) {
        throw new Error(
          "Local no-auth mode requires SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.",
        );
      }
      const supabase = createSupabaseServerClient({
        url: supabaseUrl,
        key: secretKey,
        label: "No-auth Supabase client",
      });

      return next({
        context: {
          supabase,
          userId: LOCAL_USER_ID,
        },
      });
    }

    if (!publishableKey) {
      throw new Error("Missing SUPABASE_PUBLISHABLE_KEY for authenticated requests.");
    }

    const request = getRequest();
    if (!request?.headers) throw new Error("Unauthorized: No request headers available");

    const authHeader = request.headers.get("authorization");
    if (!authHeader) throw new Error("Unauthorized: No authorization header provided");
    if (!authHeader.startsWith("Bearer ")) {
      throw new Error("Unauthorized: Only Bearer tokens are supported");
    }

    const token = authHeader.replace("Bearer ", "");
    if (!token) throw new Error("Unauthorized: No token provided");

    const supabase = createSupabaseServerClient({
      url: supabaseUrl,
      key: publishableKey,
      label: "Authenticated Supabase client",
    });

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) throw new Error("Unauthorized: Invalid token");
    if (!data.claims.sub) throw new Error("Unauthorized: No user ID found in token");

    const userSupabase = createSupabaseServerClient({
      url: supabaseUrl,
      key: publishableKey,
      label: "User Supabase client",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return next({
      context: {
        supabase: userSupabase,
        userId: data.claims.sub,
      },
    });
  },
);
