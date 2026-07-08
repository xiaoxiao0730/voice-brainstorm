// Browser-only Azure Speech recognizer wrapper.
// Uses short-lived auth tokens fetched from a server function.

export type SpeechEvent =
  | { kind: "partial"; text: string; offsetMs: number }
  | { kind: "final"; id: string; text: string; offsetMs: number; durationMs: number; lang?: string }
  | { kind: "error"; message: string }
  | { kind: "stopped" };

export type SpeechRecognizerHandle = {
  stop: () => Promise<void>;
};

export type StartOptions = {
  token: string;
  region: string;
  onEvent: (e: SpeechEvent) => void;
  languages?: string[]; // e.g. ["en-US", "zh-CN"]
  micStream?: MediaStream;
};

export async function startAzureRecognizer(opts: StartOptions): Promise<SpeechRecognizerHandle> {
  const sdk = await import("microsoft-cognitiveservices-speech-sdk");

  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(opts.token, opts.region);
  speechConfig.outputFormat = sdk.OutputFormat.Simple;

  const audioConfig = opts.micStream
    ? sdk.AudioConfig.fromStreamInput(opts.micStream)
    : sdk.AudioConfig.fromDefaultMicrophoneInput();

  const languages = opts.languages ?? ["zh-CN", "en-US"];
  const autoDetectConfig = sdk.AutoDetectSourceLanguageConfig.fromLanguages(languages);

  const recognizer = sdk.SpeechRecognizer.FromConfig(speechConfig, autoDetectConfig, audioConfig);

  recognizer.recognizing = (_s, e) => {
    if (!e.result.text) return;
    opts.onEvent({
      kind: "partial",
      text: e.result.text,
      offsetMs: Number(e.result.offset) / 10_000,
    });
  };

  recognizer.recognized = (_s, e) => {
    if (e.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
    if (!e.result.text) return;
    let lang: string | undefined;
    try {
      const detected = sdk.AutoDetectSourceLanguageResult.fromResult(e.result);
      lang = detected.language;
    } catch {
      // ignore
    }
    opts.onEvent({
      kind: "final",
      id: e.result.resultId || crypto.randomUUID(),
      text: e.result.text,
      offsetMs: Number(e.result.offset) / 10_000,
      durationMs: Number(e.result.duration) / 10_000,
      lang,
    });
  };

  recognizer.canceled = (_s, e) => {
    if (e.reason === sdk.CancellationReason.Error) {
      opts.onEvent({ kind: "error", message: e.errorDetails || "Recognition error" });
    } else {
      opts.onEvent({ kind: "stopped" });
    }
  };

  recognizer.sessionStopped = () => {
    opts.onEvent({ kind: "stopped" });
  };

  await new Promise<void>((resolve, reject) => {
    recognizer.startContinuousRecognitionAsync(
      () => resolve(),
      (err) => reject(new Error(err)),
    );
  });

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        recognizer.stopContinuousRecognitionAsync(
          () => {
            recognizer.close();
            resolve();
          },
          () => {
            try {
              recognizer.close();
            } catch {
              /* ignore */
            }
            resolve();
          },
        );
      }),
  };
}
