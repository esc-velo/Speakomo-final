export type TranscriptionWord = {
  word: string;
  start: number;
  end: number;
};

export type SpeechMetrics = {
  wordCount: number;
  wpm: number;
  fillerCount: number;
  fillerBreakdown: Record<string, number>;
};

export const TARGET_FILLER_WORDS = ["um", "uh", "er", "ah", "like", "you know"] as const;
export const FILLER_WORD_REGEX = /\b(um|uh|er|ah|like|you know)\b/gi;

/**
 * Calculates total words in transcript by splitting on whitespace.
 */
export function calculateWordCount(text: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Counts occurrences of target filler words and returns total + breakdown.
 */
export function countFillerWords(text: string): { count: number; breakdown: Record<string, number> } {
  if (!text) return { count: 0, breakdown: {} };
  const matches = text.match(FILLER_WORD_REGEX) || [];
  const breakdown: Record<string, number> = {};
  for (const match of matches) {
    const token = match.toLowerCase();
    breakdown[token] = (breakdown[token] || 0) + 1;
  }
  return { count: matches.length, breakdown };
}

/**
 * Computes all key speech metrics from text and duration according to the ASR specification:
 * - wordCount: split normalized transcript by whitespace
 * - wpm: Math.round((wordCount / (durationSeconds / 60)) * 10) / 10
 * - fillerCount: regex match on target filler tokens \b(um|uh|er|ah|like|you know)\b
 */
export function computeSpeechMetrics(
  text: string,
  durationSeconds: number
): SpeechMetrics {
  const wordCount = calculateWordCount(text);
  const safeDuration = Math.max(0.1, durationSeconds || 0.1);
  const wpm = Math.round((wordCount / (safeDuration / 60)) * 10) / 10;
  const { count: fillerCount, breakdown: fillerBreakdown } = countFillerWords(text);

  return {
    wordCount,
    wpm,
    fillerCount,
    fillerBreakdown,
  };
}

/**
 * Formats transcript text with highlighted filler word tokens for display.
 * Returns an array of parts with highlight flags.
 */
export function parseTranscriptWithHighlights(text: string): Array<{ text: string; isFiller: boolean }> {
  if (!text) return [];

  const parts: Array<{ text: string; isFiller: boolean }> = [];
  const regex = new RegExp(FILLER_WORD_REGEX.source, "gi");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), isFiller: false });
    }
    parts.push({ text: match[0], isFiller: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isFiller: false });
  }

  return parts;
}
