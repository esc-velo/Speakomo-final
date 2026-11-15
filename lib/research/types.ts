/**
 * Shared types for the Speakomo research-to-cue pipeline.
 * These types are framework-agnostic and never reference Groq-specific details.
 */

/** Exact stage keys – must match SIX_STAGES in lib/speech/stages.ts */
export type StageKey = "hook" | "context" | "concept1" | "concept2" | "evidence" | "close";

export const STAGE_KEYS: readonly StageKey[] = [
  "hook",
  "context",
  "concept1",
  "concept2",
  "evidence",
  "close",
] as const;

/** A single cue phrase linked to research evidence. */
export interface CuePoint {
  /** One of the six stage keys */
  stageKey: StageKey;
  /** Short, speakable cue phrase (8–25 words) */
  phrase: string;
  /** IDs of evidence rows that ground this cue */
  evidenceIds: string[];
}

/** A complete set of 12 cues (2 per stage, ordered). */
export interface CueSet {
  cues: CuePoint[];
  model: string;
  promptVersion: string;
  inputHash: string;
  generatedAt: string;
}

/** The source mapping sent into the prompt so the model can reference evidence. */
export interface SourceMapping {
  id: string;
  label: string;
  excerpt: string;
}

/** Result returned by the cue generator. */
export interface CueGenerationResult {
  success: boolean;
  cueSet?: CueSet;
  effectiveCues?: CuePoint[];
  editedCues?: EditedCueMap;
  hasEdits?: boolean;
  error?: string;
  /** Number of repair attempts needed (0 = first try) */
  repairAttempts: number;
}

/** Shape of the raw model output before Zod validation. */
export interface RawCueOutput {
  cues: Array<{
    stageKey: string;
    phrase: string;
    evidenceIds: string[];
  }>;
}

/** Research AI adapter interface (provider-agnostic). */
export interface ResearchAIAdapter {
  generateCues(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<RawCueOutput>;
}

/** Configuration for the research AI provider. */
export interface ResearchAIConfig {
  provider: string;
  apiKey: string;
  model: string;
}

/** Map of user-edited cue phrases, keyed by `${stageKey}_${cueIndex}` (e.g. `hook_0`). */
export type EditedCueMap = Record<string, string>;

/** Payload for editing a single cue phrase. */
export interface CueEditPayload {
  stageKey: StageKey;
  cueIndex: number; // 0 or 1
  phrase: string;
}

/** Standardized response returned by cue retrieval endpoints. */
export interface SessionCuesResponse {
  cueSet: CueSet | null;
  effectiveCues: CuePoint[] | null;
  editedCues: EditedCueMap;
  hasEdits: boolean;
  cueStatus: string;
  cueError: string | null;
}

