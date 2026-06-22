import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Mints a short-lived OpenAI Realtime ephemeral client_secret so the browser
// can open a WebRTC session to api.openai.com without ever seeing the real
// OPENAI_API_KEY. Token lifetime is ~1 minute server-side; refresh by calling
// this fn again before reconnecting.
export const getRealtimeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Missing OPENAI_API_KEY");

    const model = "gpt-realtime";
    const voice = "echo";

    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model,
          // We drive turn-taking ourselves; disable server VAD auto-responses.
          // The agent only speaks when our policy engine calls response.create.
          audio: {
            output: { voice },
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI Realtime token mint failed (${res.status}): ${body}`);
    }

    const json = (await res.json()) as { value?: string; expires_at?: number };
    if (!json.value) throw new Error("OpenAI Realtime token response missing 'value'");

    return { clientSecret: json.value, expiresAt: json.expires_at ?? 0, model };
  });
