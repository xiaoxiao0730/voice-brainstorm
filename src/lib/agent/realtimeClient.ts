// Browser-side wrapper around the OpenAI Realtime WebRTC API.
//
// Realtime Lane responsibility (Stage 3 architecture):
//   * Native low-latency voice co-thinking. Server VAD owns turn-taking and
//     auto-creates responses so the agent can chat / barge in naturally.
//   * Acts as a Socratic brainstorming coach — short, conversational replies,
//     listens during connected speech, asks one light probe at pauses.
//   * NEVER touches the Live Brief or applyBriefPatch. The Background Canvas
//     Lane owns all structural updates in parallel.
//
// Cross-lane bridge: injectContext(note) sneaks a system-role conversation
// item into the live session so the next user turn benefits from background
// insights — without forcing the agent to speak.

export type RealtimeEvents = {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onAgentSpeakingStart?: () => void;
  onAgentSpeakingEnd?: () => void;
  onAgentTranscript?: (text: string) => void;
  onUserBargeIn?: () => void;
  onError?: (err: Error) => void;
};

export type RealtimeClient = {
  speak: (text: string) => void;
  cancel: () => void;
  injectContext: (note: string) => void;
  isAgentSpeaking: () => boolean;
  disconnect: () => Promise<void>;
};

export type ConnectOptions = {
  clientSecret: string;
  model: string;
  micStream: MediaStream;
  events?: RealtimeEvents;
};

const SOCRATIC_INSTRUCTIONS = `You are a Socratic brainstorming coach having a live voice conversation. Your job: help the user think out loud.

Voice style:
- Speak naturally, like a curious friend. Keep replies short (one or two sentences).
- Match the user's language (Chinese or English).
- No markdown, no lists, no preamble.

When to speak:
- Brief acknowledgements ("got it", "嗯") or one-line answers for greetings, small talk, and direct simple questions.
- When the user clearly pauses or trails off after a thought, ask ONE light probing question that pushes their idea forward.
- When the user is mid-thought and still flowing, stay quiet — let them finish.
- If barged in on, stop immediately.

Hard rules:
- You do NOT edit, summarize, or modify any document or canvas. A separate background process handles all written notes.
- Never read back long summaries or recite their words. Never list bullet points.
- If you receive a system note labelled "[background insight]", treat it as silent context you may weave into your next reply naturally — do not announce it.`;

export async function connectRealtime(opts: ConnectOptions): Promise<RealtimeClient> {
  const { clientSecret, model, micStream, events = {} } = opts;

  const pc = new RTCPeerConnection();
  let agentSpeaking = false;
  let disposed = false;

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
    // Native server-VAD + auto-create_response: OpenAI Realtime owns turn-taking.
    send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: SOCRATIC_INSTRUCTIONS,
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

  dc.onmessage = (e) => {
    let evt: { type?: string; [k: string]: unknown };
    try {
      evt = JSON.parse(e.data);
    } catch {
      return;
    }
    switch (evt.type) {
      case "response.created":
      case "response.output_audio.delta":
        if (!agentSpeaking) {
          agentSpeaking = true;
          events.onAgentSpeakingStart?.();
        }
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const t = (evt as { transcript?: unknown }).transcript;
        if (typeof t === "string" && t.trim()) events.onAgentTranscript?.(t.trim());
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
      case "error":
        events.onError?.(new Error(`Realtime error: ${JSON.stringify(evt)}`));
        break;
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      events.onDisconnected?.();
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpRes = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      "Content-Type": "application/sdp",
    },
    body: offer.sdp,
  });

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
    cancel() {
      if (disposed) return;
      send({ type: "response.cancel" });
    },
    injectContext(note: string) {
      if (disposed) return;
      const trimmed = note.trim();
      if (!trimmed) return;
      // Silent system note — does not trigger a response, only enriches future turns.
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: `[background insight] ${trimmed}` }],
        },
      });
    },
    isAgentSpeaking: () => agentSpeaking,
    async disconnect() {
      disposed = true;
      try { dc.close(); } catch { /* ignore */ }
      try { pc.close(); } catch { /* ignore */ }
      try { audioEl.remove(); } catch { /* ignore */ }
      events.onDisconnected?.();
    },
  };
}
