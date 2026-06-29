// Browser-side wrapper around the OpenAI Realtime WebRTC API.
//
// Stage 4 — Fast voice lane (Lane A).
//   * Long-form peer voice: 3–6 sentence replies (~30s), no interviewer fillers.
//   * Server VAD owns turn-taking. create_response stays ON.
//   * Registers two tools the agent can invoke mid-conversation:
//       - stay_silent({ reason })          → cancel in-flight response, emit event
//       - request_research({ query, reason }) → emit research.requested event;
//         the researchQueue (PR5) actually runs the search.
//   * Emits SessionEvents (voice.response_started, voice.spoke, …) on the
//     active session bus so the slow-lane coordinator and ThoughtTurn buffer
//     can react (e.g. early-finalize a turn when the agent starts speaking).
//
// The brief/canvas is owned by the slow lane. Voice never writes the brief.

import { sessionStore } from "@/lib/orchestrator/sessionStore";
import type { SessionEvent } from "@/lib/pipeline/types";

export type RealtimeEvents = {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onAgentSpeakingStart?: () => void;
  onAgentSpeakingEnd?: () => void;
  onAgentTranscript?: (text: string) => void;
  onUserBargeIn?: () => void;
  onError?: (err: Error) => void;
  /** Fired when the agent invokes the request_research tool. */
  onResearchRequested?: (args: { query: string; reason?: string; callId: string }) => void;
  /** Fired when the agent invokes the stay_silent tool. */
  onStaySilent?: (reason: string) => void;
  /** Fired when the agent proposes canvas writes. Workbench validates/applies them. */
  onCanvasOpsProposed?: (args: { reason?: string; ops: CanvasToolOp[]; callId: string }) => void;
};

export type CanvasToolOp = {
  action: "add_card" | "update_card" | "connect";
  kind?: "focus" | "idea" | "question" | "decision" | "risk" | "next";
  title?: string;
  body?: string;
  targetTitle?: string;
  sourceTitle?: string;
  label?: string;
};

export type RealtimeClient = {
  speak: (text: string) => void;
  promptResponse: () => void;
  cancel: () => void;
  injectContext: (note: string) => void;
  /** Push a fresh Live Brief canvas snapshot into the agent's instructions. */
  updateCanvasSnapshot: (canvasText: string) => void;
  isAgentSpeaking: () => boolean;
  disconnect: () => Promise<void>;
};

export type ConnectOptions = {
  clientSecret: string;
  model: string;
  micStream: MediaStream;
  /** Session this voice connection belongs to. Required for SessionEvent emission. */
  sessionId: string;
  events?: RealtimeEvents;
};

const SOCRATIC_INSTRUCTIONS_BASE = `You are a thinking partner in a live voice conversation. Talk like a sharp colleague who is genuinely engaged — not an interviewer collecting requirements, not a coach with a script.

CADENCE
- Default reply: 2 to 3 sentences, roughly 10–20 seconds of speech. No hard word caps.
- When directly asked a factual question, answer it directly. Conclusion first, then one sentence of reasoning or context.
- It's fine to stay quiet by calling the stay_silent tool when the user is clearly mid-thought.

LANGUAGE
- Start the conversation in English.
- After the user speaks, reply in the language the user is actually using.
- If the user mixes languages, follow the dominant language of their latest message and keep product/technical terms in their original form.
- Do not switch to unrelated languages such as French or Spanish because of transcription noise.
- If the user's speech transcript is noisy or the language is unclear, briefly ask for clarification in English.
- Keep proper nouns and product names exactly as the user says them.

VOICE
- Sound like a peer thinking out loud with the user.
- Build on what they just said before you push back or probe.
- Offer a frame, a concrete possibility, a tradeoff, or a missing assumption. Then maybe one focused question.
- Never use generic filler probes like "Can you tell me more?", "What's the main problem?", "What slows them down most?".
- Don't restate the user's idea back to them as a question.

CO-THINKING TURN CONTRACT
- For each completed user thought, your goal is not just to answer; it is to move the thinking forward.
- Choose one action mode for the reply:
  - reflect: restate the structure.
  - frame: give a useful frame.
  - challenge: point out a risk or hidden assumption.
  - extend: add a grounded new direction.
  - decide_next: converge on the next step.
  - stay_silent: do not speak when the user is still mid-thought.
- Default spoken reply structure:
  1. Current state: one compact sentence explaining where the discussion now stands.
  2. Next directions: name 2-3 concrete options the user could explore next.
  3. Choice prompt: ask which direction they want to open first.
- If a system message named [co-thinking turn] appears, treat it as the shared plan between voice and canvas. Use its state and directions; do not invent a different set.
- If a system message named [session thinking state] appears, treat it as the cross-turn source of truth for the user's goal, intent, assumptions, open questions, promising directions, and decision points.
- Keep the voice concise. The canvas carries the structure; your spoken reply should make that structure actionable.

GROUNDING
- Never invent facts, topics, or examples the user has not raised. If the user has not mentioned a topic, do NOT bring it up as if they had.
- If you are unsure about a date, number, name, or recent event, say so plainly or call request_research. Do not guess.

SHARED THINKING STATE (CRITICAL)
- You and the Live Brief canvas share a SINGLE evolving thinking state. The canvas is the source of truth for what currently exists in this conversation's external memory.
- The [Current Live Brief Canvas] section below is refreshed continuously. Treat it as authoritative ground truth — it reflects every patch the slow lane has applied, every research card written, and every manual edit the user just made.
- When the user references the canvas ("I just deleted X", "look at the new search result", "what's on the doc now"), READ from [Current Live Brief Canvas] and respond from what you actually see there. Quote or paraphrase real content.
- If the user references something that is NOT in the snapshot, say honestly: "I don't see that on the canvas yet — the slow lane may still be writing it." Then wait or ask. NEVER invent canvas content that isn't shown.
- If the snapshot is empty, say so plainly instead of fabricating.

TOOLS
- stay_silent({ reason }): call this when you detect the user is still developing their thought and you would otherwise interrupt. Pass a short reason ("mid-list", "trailing off", etc.).
- request_research({ query, reason }): call this when answering well requires fresh external facts (specific numbers, recent events, current pricing, named sources, technical details you're not confident about). Say a brief acknowledgment out loud like "Let me look that up" — then stop. The research result will appear in the Live Brief; you do not need to read it aloud unless the user asks.
- propose_canvas_ops({ reason, ops }): call this only when the user explicitly asks you to add, update, or connect cards on the canvas. Keep changes small and grounded in [Current Canvas Context]. Prefer exact existing card titles for targetTitle/sourceTitle.

CANVAS WRITING RULES
- Use add_card for new user-requested notes.
- Use update_card only when targetTitle exactly names an existing card from [Current Canvas Context].
- Use connect only when sourceTitle and targetTitle exactly match visible card titles.
- If you cannot find the requested target on the canvas, say you don't see it instead of inventing one.
- Do not write to the canvas merely because you have a suggestion; speak first unless the user gave a command.

WHEN A RESEARCH RESULT COMES BACK
- Speak only the conclusion, the key piece of evidence, and one implication.
- Never read sources or full report aloud — that lives in the Live Brief.`;

function formatCanvasBlock(canvasText: string | undefined): string {
  const trimmed = (canvasText ?? "").trim();
  if (!trimmed) {
    return `[Current Live Brief Canvas]\n(empty — nothing has been written to the canvas yet in this session)`;
  }
  // Cap to keep prompt under control; agent only needs current shape.
  const capped = trimmed.length > 4000 ? trimmed.slice(0, 4000) + "\n…(truncated)" : trimmed;
  return `[Current Live Brief Canvas]\n${capped}`;
}

function buildSocraticInstructions(canvasText?: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const isoDate = now.toISOString().slice(0, 10);
  return `TIME ANCHOR (authoritative — overrides any prior belief about the date)
- The current real-world date is ${dateStr} (${isoDate}).
- Do not invent holidays, seasons, or recent events that contradict this date.

${SOCRATIC_INSTRUCTIONS_BASE}

${formatCanvasBlock(canvasText)}`;
}

function parseCanvasToolOps(value: unknown): CanvasToolOp[] {
  if (!Array.isArray(value)) return [];
  const validKinds = new Set(["focus", "idea", "question", "decision", "risk", "next"]);
  const validActions = new Set(["add_card", "update_card", "connect"]);
  return value
    .slice(0, 5)
    .map((item) => (typeof item === "object" && item ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => !!item)
    .flatMap((item) => {
      const action = typeof item.action === "string" ? item.action : "";
      if (!validActions.has(action)) return [];
      const kind =
        typeof item.kind === "string" && validKinds.has(item.kind) ? item.kind : undefined;
      return [
        {
          action: action as CanvasToolOp["action"],
          ...(kind ? { kind: kind as NonNullable<CanvasToolOp["kind"]> } : {}),
          ...(typeof item.title === "string" ? { title: item.title.trim() } : {}),
          ...(typeof item.body === "string" ? { body: item.body.trim() } : {}),
          ...(typeof item.targetTitle === "string" ? { targetTitle: item.targetTitle.trim() } : {}),
          ...(typeof item.sourceTitle === "string" ? { sourceTitle: item.sourceTitle.trim() } : {}),
          ...(typeof item.label === "string" ? { label: item.label.trim() } : {}),
        },
      ];
    });
}

const TOOLS = [
  {
    type: "function" as const,
    name: "stay_silent",
    description:
      "Suppress your own voice response because the user is still in the middle of their thought. Use sparingly.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Short reason you're staying silent." },
      },
      required: ["reason"],
    },
  },
  {
    type: "function" as const,
    name: "request_research",
    description:
      "Trigger an asynchronous web research task. Use when answering needs fresh external facts you don't reliably know. Acknowledge briefly out loud, then stop speaking.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Focused search query." },
        reason: { type: "string", description: "Why this needs external research." },
      },
      required: ["query"],
    },
  },
  {
    type: "function" as const,
    name: "propose_canvas_ops",
    description:
      "Propose small canvas write operations when the user explicitly commands you to add, update, or connect canvas cards.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Brief reason for these canvas changes." },
        ops: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["add_card", "update_card", "connect"] },
              kind: {
                type: "string",
                enum: ["focus", "idea", "question", "decision", "risk", "next"],
              },
              title: { type: "string", description: "Card title for add/update." },
              body: { type: "string", description: "Card body/detail." },
              targetTitle: {
                type: "string",
                description: "Existing card title to update or connect to.",
              },
              sourceTitle: {
                type: "string",
                description: "Existing source card title for connect.",
              },
              label: { type: "string", description: "Relationship label for connect." },
            },
            required: ["action"],
          },
        },
      },
      required: ["ops"],
    },
  },
];

export async function connectRealtime(opts: ConnectOptions): Promise<RealtimeClient> {
  const { clientSecret, model, micStream, sessionId, events = {} } = opts;

  const pc = new RTCPeerConnection();
  let agentSpeaking = false;
  let disposed = false;
  // Latest canvas snapshot — re-injected into instructions on every refresh.
  let currentCanvasText = "";

  // Buffer function-call arguments by call_id; the Realtime API streams them.
  const pendingToolArgs = new Map<string, { name: string; args: string }>();

  const emit = (event: SessionEvent) => {
    try {
      sessionStore.getOrCreate(sessionId).bus.emit(event);
    } catch (err) {
      console.warn("[realtime] emit failed", err);
    }
  };

  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  audioEl.style.display = "none";
  document.body.appendChild(audioEl);

  pc.ontrack = (e) => {
    audioEl.srcObject = e.streams[0];
  };

  const micTrack = micStream.getAudioTracks()[0];
  if (!micTrack) throw new Error("No mic audio track available");
  pc.addTrack(micTrack.clone(), micStream);

  const dc = pc.createDataChannel("oai-events");

  const send = (msg: unknown) => {
    if (dc.readyState !== "open") return;
    dc.send(JSON.stringify(msg));
  };

  dc.onopen = () => {
    send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: buildSocraticInstructions(currentCanvasText),
        tools: TOOLS,
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              threshold: 0.55,
              prefix_padding_ms: 200,
              silence_duration_ms: 600,
              create_response: true,
              interrupt_response: true,
            },
          },
        },
      },
    });
    events.onConnected?.();
  };

  const handleToolCall = (name: string, rawArgs: string, callId: string) => {
    let args: Record<string, unknown> = {};
    try {
      args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }

    if (name === "stay_silent") {
      const reason = typeof args.reason === "string" ? args.reason : "user mid-thought";
      // Only cancel if a response is actually active — otherwise OpenAI throws
      // `response_cancel_not_active` which surfaces as a spurious UI error.
      if (agentSpeaking && dc.readyState === "open") {
        try {
          send({ type: "response.cancel" });
        } catch {
          /* ignore */
        }
      }
      emit({ type: "voice.stayed_silent", sessionId, reason });
      events.onStaySilent?.(reason);
      // Return a noop tool output so the model doesn't hang on it.
      send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ ok: true }),
        },
      });
      return;
    }

    if (name === "request_research") {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const reason = typeof args.reason === "string" ? args.reason : undefined;
      if (!query) {
        send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ ok: false, error: "missing query" }),
          },
        });
        // Do NOT call response.create here — the in-flight response that
        // emitted this tool call is still active. A second response.create
        // would spawn a concurrent audio reply (two overlapping voices).
        return;
      }
      const taskId = crypto.randomUUID();
      emit({ type: "research.requested", sessionId, taskId, query, ...(reason ? {} : {}) });
      events.onResearchRequested?.({ query, reason, callId: taskId });
      send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            ok: true,
            taskId,
            note: "Research queued. Result will appear in the Live Brief.",
          }),
        },
      });
      // The model already spoke its short acknowledgment in the same
      // response that emitted this tool call. Do NOT call response.create —
      // it would start a second concurrent audio response and the user
      // would hear two voices replying at once.
      return;
    }

    if (name === "propose_canvas_ops") {
      const ops = parseCanvasToolOps(args.ops);
      const reason = typeof args.reason === "string" ? args.reason.trim() : undefined;
      if (ops.length === 0) {
        send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ ok: false, error: "missing valid canvas ops" }),
          },
        });
        return;
      }
      events.onCanvasOpsProposed?.({ reason, ops, callId });
      send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ ok: true, applied: ops.length }),
        },
      });
      return;
    }

    // Unknown tool — return an error output.
    send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ ok: false, error: `unknown tool ${name}` }),
      },
    });
  };

  dc.onmessage = (e) => {
    let evt: { type?: string; [k: string]: unknown };
    try {
      evt = JSON.parse(e.data);
    } catch {
      return;
    }
    switch (evt.type) {
      case "response.created": {
        emit({ type: "voice.response_started", sessionId });
        break;
      }
      case "response.output_audio.delta":
        if (!agentSpeaking) {
          agentSpeaking = true;
          events.onAgentSpeakingStart?.();
        }
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const t = (evt as { transcript?: unknown }).transcript;
        if (typeof t === "string" && t.trim()) {
          const text = t.trim();
          events.onAgentTranscript?.(text);
          emit({ type: "voice.spoke", sessionId, text });
        }
        break;
      }
      case "response.output_item.added": {
        const item = (evt as { item?: { type?: string; name?: string; call_id?: string } }).item;
        if (item?.type === "function_call" && item.name && item.call_id) {
          pendingToolArgs.set(item.call_id, { name: item.name, args: "" });
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        const callId = (evt as { call_id?: string }).call_id;
        const delta = (evt as { delta?: string }).delta;
        if (callId && typeof delta === "string") {
          const cur = pendingToolArgs.get(callId);
          if (cur) cur.args += delta;
        }
        break;
      }
      case "response.function_call_arguments.done": {
        const callId = (evt as { call_id?: string }).call_id;
        const finalArgs = (evt as { arguments?: string }).arguments;
        const nameFromEvt = (evt as { name?: string }).name;
        if (!callId) break;
        const buf = pendingToolArgs.get(callId);
        const name = nameFromEvt ?? buf?.name;
        const argsStr =
          typeof finalArgs === "string" && finalArgs.length > 0 ? finalArgs : (buf?.args ?? "");
        pendingToolArgs.delete(callId);
        if (name) handleToolCall(name, argsStr, callId);
        break;
      }
      case "response.done":
      case "response.cancelled":
        if (agentSpeaking) {
          agentSpeaking = false;
          events.onAgentSpeakingEnd?.();
        }
        break;
      case "input_audio_buffer.speech_started":
        if (agentSpeaking) {
          events.onUserBargeIn?.();
        }
        break;
      case "error": {
        const errorObj = (evt as { error?: { code?: unknown } }).error;
        // 过滤因打断时差导致的 response.cancel 报错（此时已经没有活动响应在运行）
        if (errorObj?.code === "response_cancel_not_active") {
          console.debug(
            "[Realtime] Mild race condition: response.cancel sent but no active response was running.",
          );
          return;
        }

        // other system errors:
        events.onError?.(new Error(`Realtime error: ${JSON.stringify(evt)}`));
        break;
      }
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      events.onDisconnected?.();
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpRes = await fetch(
    `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    },
  );

  if (!sdpRes.ok) {
    const body = await sdpRes.text().catch(() => "");
    pc.close();
    audioEl.remove();
    throw new Error(`Realtime SDP exchange failed (${sdpRes.status}): ${body}`);
  }

  const answerSdp = await sdpRes.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return {
    speak(text: string) {
      if (disposed) return;
      send({
        type: "response.create",
        response: {
          output_modalities: ["audio"],
          instructions: text,
        },
      });
    },
    promptResponse() {
      if (disposed) return;
      send({
        type: "response.create",
        response: { output_modalities: ["audio"] },
      });
    },
    cancel() {
      if (disposed) return;
      send({ type: "response.cancel" });
    },
    injectContext(note: string) {
      if (disposed) return;
      const trimmed = note.trim();
      if (!trimmed) return;
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: `[background insight] ${trimmed}` }],
        },
      });
    },
    updateCanvasSnapshot(canvasText: string) {
      if (disposed) return;
      const next = (canvasText ?? "").trim();
      if (next === currentCanvasText) return;
      currentCanvasText = next;
      // Re-push full instructions with the fresh canvas. The Realtime API
      // merges session.update; instructions string replaces the prior one.
      send({
        type: "session.update",
        session: {
          type: "realtime",
          instructions: buildSocraticInstructions(currentCanvasText),
        },
      });
    },
    isAgentSpeaking: () => agentSpeaking,
    async disconnect() {
      disposed = true;
      try {
        dc.close();
      } catch {
        /* ignore */
      }
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      try {
        audioEl.remove();
      } catch {
        /* ignore */
      }
      events.onDisconnected?.();
    },
  };
}
