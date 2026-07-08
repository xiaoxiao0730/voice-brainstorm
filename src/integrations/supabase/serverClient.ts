import { createClient } from "@supabase/supabase-js";
import { describeError } from "@/lib/errorDiagnostics";
import type { Database } from "./types";

type SupabaseServerClientOptions = {
  url: string;
  key: string;
  label: string;
  headers?: Record<string, string>;
};

export function createSupabaseServerClient({ url, key, label, headers }: SupabaseServerClientOptions) {
  validateSupabaseUrl(url, label);

  return createClient<Database>(url, key, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers,
      fetch: async (input, init) => {
        try {
          return await fetch(input, init);
        } catch (error) {
          throw new Error(`${label} network request failed: ${describeError(error)}`);
        }
      },
    },
  });
}

function validateSupabaseUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} has an invalid SUPABASE_URL.`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${label} SUPABASE_URL must start with https://.`);
  }

  if (!url.hostname.endsWith(".supabase.co")) {
    throw new Error(`${label} SUPABASE_URL should look like https://<project-ref>.supabase.co.`);
  }
}
