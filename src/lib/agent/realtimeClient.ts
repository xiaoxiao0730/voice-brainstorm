// Browser-side wrapper around the OpenAI Realtime WebRTC API.
//
// Responsibilities:
//   * Establish a WebRTC peer connection to OpenAI Realtime using an ephemeral
//     client secret minted by getRealtimeSession.
//   * Stream the user's mic to OpenAI for barge-in detection (NOT for
//     transcription — Azure STT remains the source of truth for the Live Brief).
//   * Play the agent's TTS audio out through a hidden <audio> element.
//   * Expose speak(text), cancel(), and barge-in events.
//
// Turn-taking model: server-side VAD detects when the user starts speaking
// during agent speech and we send response.cancel to stop the agent.
// The agent NEVER auto-replies; it only speaks when we explicitly call speak().

export type RealtimeEvents = {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onAgentSpeakingStart?: () => void;
  onAgentSpeakingEnd?: () => void;
  onUserBargeIn?: () => void;
  onError?: (err: Error) => void;
};

export type RealtimeClient = {
  speak: (text: string) => void;
  cancel: () => void;
  isAgentSpeaking: () => boolean;
  disconnect: () => Promise<void>;
};

export type ConnectOptions = {
  clientSecret: string;
  model: string;
  micStream: MediaStream;
  events?: RealtimeEvents;
};

export async function connectRealtime(opts: ConnectOptions): Promise<RealtimeClient> {
  const { clientSecret, model, micStream, events = {} } = opts;

  const pc = new RTCPeerConnection();
  let agentSpeaking = false;
  let disposed = false;

  // Hidden audio sink for agent's voice.
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  audioEl.style.display = "none";
  document.body.appendChild(audioEl);

  pc.ontrack = (e) => {
    audioEl.srcObject = e.streams[0];
  };

  // Use a cloned track so the existing Azure recognizer keeps its own track.
  const micTrack = micStream.getAudioTracks()[0];
  if (!micTrack) throw new Error("No mic audio track available");
  pc.addTrack(micTrack.clone(), micStream);

  // Data channel for events.
  const dc = pc.createDataChannel("oai-events");

  const send = (msg: unknown) => {
    if (dc.readyState !== "open") return;
    dc.send(JSON.stringify(msg));
  };

  dc.onopen = () => {
    // Configure the session: silent by default, server-VAD for barge-in only.
    // NOTE: OpenAI Realtime GA requires `session.type: "realtime"`. Without
    // it the session.update is rejected and the server falls back to
    // defaults (which include create_response: true) — that causes the
    // agent to auto-reply to every user utterance.
    send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions:
          "You are a silent co-thinking partner. Do not speak unless given explicit instructions inside a response.create event. Never start a turn on your own. When you do speak, keep it to 1–2 short sentences.",
        turn_detection: {
          type: "server_vad",
          threshold: 0.55,
          prefix_padding_ms: 200,
          silence_duration_ms: 500,
          // Detect user speech but DO NOT auto-create a response.
          create_response: false,
          interrupt_response: true,
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
      case "response.done":
      case "response.cancelled":
        if (agentSpeaking) {
          agentSpeaking = false;
          events.onAgentSpeakingEnd?.();
        }
        break;
      case "input_audio_buffer.speech_started":
        if (agentSpeaking) {
          // User barged in — cancel the in-flight response.
          send({ type: "response.cancel" });
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
          conversation: "none",
          modalities: ["audio", "text"],
          instructions: text,
        },
      });
    },
    cancel() {
      if (disposed) return;
      send({ type: "response.cancel" });
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
