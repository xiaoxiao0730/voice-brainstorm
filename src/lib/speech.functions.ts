import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Returns a short-lived (10 min) Azure Speech auth token so the browser
// never sees AZURE_SPEECH_KEY.
export const getSpeechToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    if (!key || !region) {
      throw new Error("Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION");
    }
    const res = await fetch(
      `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Length": "0",
        },
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Azure token issue failed (${res.status}): ${body}`);
    }
    const token = await res.text();
    return { token, region };
  });
