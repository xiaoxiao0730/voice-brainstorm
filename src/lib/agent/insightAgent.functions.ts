// B1 — InsightAgent.
//
// Pure reasoning lane (no web). Triggered on thought_turn.finalized and
// research.completed. Input: recent ThoughtTurns + current brief snapshot
// + optional latest research result. Output: 0–2 InsightPackets
// (observation / contradiction / suggestion / question / conclusion).
//
// Two downstream consumers (wired in insightCoordinator):
//   - Brief side: high-priority packets with bulletText become pending bullets.
//   - Realtime side (B2/C1): packets are injected into instructions; the
//     intervention policy decides whether to actually speak.
//
// Best-effort: any failure returns [].

import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const SnapshotLine = z.object({
  id: z.string(),
  kind: z.enum(["h2", "p"]),
  text: z.string().default(""),
  locked: z.boolean().default(false),
});

const RecentTurn = z.object({
  turnId: z.string(),
  text: z.string(),
});

const ResearchLite = z.object({
  taskId: z.string().optional(),
  query: z.string().default(""),
  title: z.string().default(""),
  summary: z.string().default(""),
  findings: z.array(z.string()).default([]),
});

const InputSchema = z.object({
  trigger: z.enum(["thought_turn", "research"]).default("thought_turn"),
  recentTurns: z.array(RecentTurn).max(6).default([]),
  snapshot: z.array(SnapshotLine).max(80).default([]),
  research: ResearchLite.nullable().default(null),
  model: z.string().default("openai/gpt-5-mini"),
});

const PacketSchema = z.object({
  kind: z.enum(["observation", "contradiction", "suggestion", "question", "conclusion"]),
  text: z.string().default(""),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  shouldSpeak: z.boolean().default(false),
  bulletText: z.string().default(""),
});

const OutputSchema = z.object({
  packets: z.array(PacketSchema).max(2).default([]),
});

const SYSTEM = `You are the INSIGHT AGENT in a real-time co-thinking workspace. A separate voice agent speaks; a separate slow-lane writes the brief. You produce SHORT, HIGH-SIGNAL insights that bridge the two.

WHAT TO PRODUCE
- 0, 1, or at most 2 InsightPackets. Empty array is the correct answer most of the time.
- Each packet is ONE of: observation | contradiction | suggestion | question | conclusion.

WHEN TO EMIT
- contradiction: the user's recent turn conflicts with an earlier turn OR with the brief OR with research findings. (high priority, shouldSpeak=true)
- conclusion: the user just converged on a clear decision worth pinning. (high)
- question: a sharp clarifying question that would unlock the next step. (medium)
- suggestion: a concrete next move grounded in what the user just said. (medium)
- observation: a pattern across turns the user may not have noticed. (low)

HARD RULES
- Ground STRICTLY in user words / brief / research. Never invent facts.
- Skip filler, greetings, restating, self-talk.
- Skip if the recent turn merely elaborates something already in the brief without new tension.
- text: 1–2 short sentences, voice-ready, in the user's language.
- bulletText: ≤ 20 chars (chinese chars count as 1), telegraphic. Set ONLY for priority=high or for conclusions worth pinning. Empty string means "do not pin".
- shouldSpeak=true ONLY for high-priority contradiction / conclusion, or a sharp question that obviously unblocks the user.

Return STRICT JSON: { "packets": [ { "kind": "...", "text": "...", "priority": "...", "shouldSpeak": false, "bulletText": "" } ] }. No code fences, no prose.`;

export const insightAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const docStr = data.snapshot.length
      ? data.snapshot
          .map((l) => {
            const tag = l.locked ? "[user]" : "[ai]";
            const prefix = l.kind === "h2" ? "## " : "";
            return `  ${tag} ${prefix}${l.text}`;
          })
          .join("\n")
      : "  (empty document)";

    const turnsStr = data.recentTurns.length
      ? data.recentTurns
          .map((t, i) => `  [${i + 1}] ${t.text}`)
          .join("\n")
      : "  (none)";

    const researchStr = data.research
      ? `LATEST RESEARCH (query="${data.research.query}", title="${data.research.title}"):
${data.research.summary}
${data.research.findings.map((f) => `- ${f}`).join("\n")}`
      : "(no fresh research)";

    const userPrompt = `TRIGGER: ${data.trigger}

RECENT THOUGHT TURNS (oldest → newest):
${turnsStr}

LIVE BRIEF (in order):
${docStr}

${researchStr}

Return STRICT JSON only. Empty packets array is acceptable.`;

    const gateway = createLovableAiGatewayProvider(key);
    try {
      const { text } = await generateText({
        model: gateway(data.model),
        system: SYSTEM,
        prompt: userPrompt,
      });

      let raw = (text ?? "").trim();
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) raw = fence[1].trim();
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first >= 0 && last > first) raw = raw.slice(first, last + 1);

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { packets: [] as Array<z.infer<typeof PacketSchema>> };
      }
      const out = OutputSchema.parse(parsed);
      const packets = out.packets
        .map((p) => ({
          kind: p.kind,
          text: (p.text ?? "").trim(),
          priority: p.priority,
          shouldSpeak: !!p.shouldSpeak,
          bulletText: (p.bulletText ?? "").trim().slice(0, 40),
        }))
        .filter((p) => p.text.length > 0);
      return { packets };
    } catch (e) {
      console.warn("[insightAgent] failed", e instanceof Error ? e.message : String(e));
      return { packets: [] as Array<z.infer<typeof PacketSchema>> };
    }
  });
