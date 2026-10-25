import { Buffer } from "node:buffer";
import {
  computeSpeechMetrics,
  calculateWordCount,
  countFillerWords,
  TARGET_FILLER_WORDS,
  FILLER_WORD_REGEX,
  type SpeechMetrics,
  type TranscriptionWord,
} from "./asr-metrics";

export {
  computeSpeechMetrics,
  calculateWordCount,
  countFillerWords,
  TARGET_FILLER_WORDS,
  FILLER_WORD_REGEX,
  type SpeechMetrics,
  type TranscriptionWord,
};

export type TranscriptionResult = {
  text: string;
  durationSeconds: number;
  wordCount: number;
  wpm: number;
  fillerCount: number;
  fillerBreakdown?: Record<string, number>;
  words?: TranscriptionWord[];
};

export interface AsrAdapter {
  transcribe(audioBuffer: Buffer, mimeType: string, options?: { durationSeconds?: number }): Promise<TranscriptionResult>;
}

function getAudioFileName(mimeType: string): string {
  if (mimeType.includes("webm")) return "audio.webm";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "audio.mp4";
  if (mimeType.includes("ogg")) return "audio.ogg";
  if (mimeType.includes("wav")) return "audio.wav";
  if (mimeType.includes("mp3") || mimeType.includes("mpeg")) return "audio.mp3";
  return "audio.webm";
}

/**
 * Groq Whisper Adapter (Fast inference using whisper-large-v3 on Groq Cloud LPU)
 */
export class GroqWhisperAdapter implements AsrAdapter {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = "whisper-large-v3") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async transcribe(audioBuffer: Buffer, mimeType: string, options?: { durationSeconds?: number }): Promise<TranscriptionResult> {
    const filename = getAudioFileName(mimeType);
    const audioFile = new File([audioBuffer], filename, { type: mimeType || "audio/webm" });

    const formData = new FormData();
    formData.append("file", audioFile);
    formData.append("model", this.model);
    formData.append("response_format", "verbose_json");
    formData.append("temperature", "0");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Groq Whisper transcription failed (${response.status}): ${errorText || response.statusText}`);
    }

    const data = await response.json();
    const text = (data.text || "").trim();
    const durationSeconds = typeof data.duration === "number" && data.duration > 0
      ? data.duration
      : (options?.durationSeconds || 60);

    const metrics = computeSpeechMetrics(text, durationSeconds);

    const words: TranscriptionWord[] | undefined = Array.isArray(data.words)
      ? data.words.map((w: { word?: string; start?: number; end?: number }) => ({
          word: String(w.word ?? ""),
          start: Number(w.start ?? 0),
          end: Number(w.end ?? 0),
        }))
      : undefined;

    return {
      text,
      durationSeconds: Math.round(durationSeconds * 10) / 10,
      wordCount: metrics.wordCount,
      wpm: metrics.wpm,
      fillerCount: metrics.fillerCount,
      fillerBreakdown: metrics.fillerBreakdown,
      words,
    };
  }
}

/**
 * OpenAI Whisper Adapter
 */
export class OpenAIWhisperAdapter implements AsrAdapter {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = "whisper-1") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async transcribe(audioBuffer: Buffer, mimeType: string, options?: { durationSeconds?: number }): Promise<TranscriptionResult> {
    const filename = getAudioFileName(mimeType);
    const audioFile = new File([audioBuffer], filename, { type: mimeType || "audio/webm" });

    const formData = new FormData();
    formData.append("file", audioFile);
    formData.append("model", this.model);
    formData.append("response_format", "verbose_json");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`OpenAI Whisper transcription failed (${response.status}): ${errorText || response.statusText}`);
    }

    const data = await response.json();
    const text = (data.text || "").trim();
    const durationSeconds = typeof data.duration === "number" && data.duration > 0
      ? data.duration
      : (options?.durationSeconds || 60);

    const metrics = computeSpeechMetrics(text, durationSeconds);

    const words: TranscriptionWord[] | undefined = Array.isArray(data.words)
      ? data.words.map((w: { word?: string; start?: number; end?: number }) => ({
          word: String(w.word ?? ""),
          start: Number(w.start ?? 0),
          end: Number(w.end ?? 0),
        }))
      : undefined;

    return {
      text,
      durationSeconds: Math.round(durationSeconds * 10) / 10,
      wordCount: metrics.wordCount,
      wpm: metrics.wpm,
      fillerCount: metrics.fillerCount,
      fillerBreakdown: metrics.fillerBreakdown,
      words,
    };
  }
}

/**
 * Deepgram Adapter (Nova-2 model)
 */
export class DeepgramAdapter implements AsrAdapter {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audioBuffer: Buffer, mimeType: string, options?: { durationSeconds?: number }): Promise<TranscriptionResult> {
    const response = await fetch("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&filler_words=true", {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": mimeType || "audio/webm",
      },
      body: audioBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Deepgram transcription failed (${response.status}): ${errorText || response.statusText}`);
    }

    const data = await response.json();
    const alternative = data?.results?.channels?.[0]?.alternatives?.[0];
    const text = (alternative?.transcript || "").trim();
    const durationSeconds = typeof data?.metadata?.duration === "number" && data.metadata.duration > 0
      ? data.metadata.duration
      : (options?.durationSeconds || 60);

    const metrics = computeSpeechMetrics(text, durationSeconds);

    const words: TranscriptionWord[] | undefined = Array.isArray(alternative?.words)
      ? alternative.words.map((w: { word?: string; start?: number; end?: number }) => ({
          word: String(w.word ?? ""),
          start: Number(w.start ?? 0),
          end: Number(w.end ?? 0),
        }))
      : undefined;

    return {
      text,
      durationSeconds: Math.round(durationSeconds * 10) / 10,
      wordCount: metrics.wordCount,
      wpm: metrics.wpm,
      fillerCount: metrics.fillerCount,
      fillerBreakdown: metrics.fillerBreakdown,
      words,
    };
  }
}

/**
 * Self-Hosted / Custom Whisper endpoint adapter
 */
export class CustomWhisperAdapter implements AsrAdapter {
  private endpointUrl: string;
  private apiKey?: string;

  constructor(endpointUrl: string, apiKey?: string) {
    this.endpointUrl = endpointUrl;
    this.apiKey = apiKey;
  }

  async transcribe(audioBuffer: Buffer, mimeType: string, options?: { durationSeconds?: number }): Promise<TranscriptionResult> {
    const filename = getAudioFileName(mimeType);
    const audioFile = new File([audioBuffer], filename, { type: mimeType || "audio/webm" });

    const formData = new FormData();
    formData.append("file", audioFile);

    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(this.endpointUrl, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Custom Whisper endpoint failed (${response.status}): ${errorText || response.statusText}`);
    }

    const data = await response.json();
    const text = (data.text || data.transcript || "").trim();
    const durationSeconds = typeof data.duration === "number" && data.duration > 0
      ? data.duration
      : (options?.durationSeconds || 60);

    const metrics = computeSpeechMetrics(text, durationSeconds);

    return {
      text,
      durationSeconds: Math.round(durationSeconds * 10) / 10,
      wordCount: metrics.wordCount,
      wpm: metrics.wpm,
      fillerCount: metrics.fillerCount,
      fillerBreakdown: metrics.fillerBreakdown,
    };
  }
}

/**
 * Mock ASR Adapter for development, testing, and offline preview.
 * Generates realistic academic speech transcription aligned with the 6-stage presentation structure.
 */
export class MockAsrAdapter implements AsrAdapter {
  async transcribe(_audioBuffer: Buffer, _mimeType: string, options?: { durationSeconds?: number }): Promise<TranscriptionResult> {
    const durationSeconds = Math.max(30, options?.durationSeconds || 180);
    const text =
      "Good morning, esteemed colleagues. Today I will present our evaluation of algorithmic robustness under severe domain shift. " +
      "To establish our thesis: standard supervised learning models, um, assume identical train and test distributions, which rarely holds in clinical deployment. " +
      "Moving directly to our methodology and primary empirical evidence: uh, across thirty-six multi-center hospital trials, model discrimination dropped by over thirty percent when evaluating external patient cohorts. " +
      "Furthermore, like we noted in section two, calibration error escalated dramatically. " +
      "Now, addressing the primary counterargument: proponents argue that continual domain adaptation mitigates this drift. " +
      "However, you know, unsupervised domain adaptation introduces latent feature distortion and catastrophic forgetting. " +
      "In conclusion, reliable deployment requires invariant causal representation rather than superficial empirical risk minimization. Thank you.";

    const metrics = computeSpeechMetrics(text, durationSeconds);

    return {
      text,
      durationSeconds: Math.round(durationSeconds),
      wordCount: metrics.wordCount,
      wpm: metrics.wpm,
      fillerCount: metrics.fillerCount,
      fillerBreakdown: metrics.fillerBreakdown,
    };
  }
}

/**
 * Factory function to retrieve the configured ASR adapter.
 * Provider choice is controlled by process.env.ASR_PROVIDER (groq, openai, deepgram, custom, mock).
 * If no key is configured in dev, falls back gracefully to MockAsrAdapter or descriptive error.
 */
export function getAsrAdapter(): AsrAdapter {
  const provider = (process.env.ASR_PROVIDER || "").toLowerCase().trim();
  const apiKey = process.env.ASR_API_KEY?.trim() || "";
  const model = process.env.ASR_MODEL?.trim();
  const endpoint = process.env.ASR_ENDPOINT_URL?.trim();

  // Explicit mock
  if (provider === "mock") {
    return new MockAsrAdapter();
  }

  // Explicit or auto-detected Groq
  if (provider === "groq" || (!provider && apiKey.startsWith("gsk_"))) {
    if (!apiKey) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("ASR_PROVIDER is 'groq' but ASR_API_KEY is not set. Using MockAsrAdapter for local preview.");
        return new MockAsrAdapter();
      }
      throw new Error("ASR_API_KEY is required for Groq Whisper provider.");
    }
    return new GroqWhisperAdapter(apiKey, model || "whisper-large-v3");
  }

  // Explicit or auto-detected OpenAI
  if (provider === "openai" || (!provider && apiKey.startsWith("sk-"))) {
    if (!apiKey) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("ASR_PROVIDER is 'openai' but ASR_API_KEY is not set. Using MockAsrAdapter for local preview.");
        return new MockAsrAdapter();
      }
      throw new Error("ASR_API_KEY is required for OpenAI Whisper provider.");
    }
    return new OpenAIWhisperAdapter(apiKey, model || "whisper-1");
  }

  // Deepgram
  if (provider === "deepgram") {
    if (!apiKey) {
      throw new Error("ASR_API_KEY is required for Deepgram provider.");
    }
    return new DeepgramAdapter(apiKey);
  }

  // Custom / Self-Hosted Whisper
  if (provider === "custom" || endpoint) {
    return new CustomWhisperAdapter(endpoint || "http://localhost:8000/transcribe", apiKey);
  }

  // If apiKey exists with no explicit provider, default to Groq
  if (apiKey) {
    return new GroqWhisperAdapter(apiKey, model || "whisper-large-v3");
  }

  // Default fallback in development/preview: Mock adapter
  return new MockAsrAdapter();
}
