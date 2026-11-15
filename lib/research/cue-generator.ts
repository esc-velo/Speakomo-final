/**
 * Cue generation orchestrator.
 * Retrieves research from Supabase, constructs prompts, calls the AI adapter,
 * validates output, persists cues, and manages input hashing / deduplication.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CuePoint,
  CueSet,
  CueGenerationResult,
  SourceMapping,
  ResearchAIConfig,
  EditedCueMap,
  CueEditPayload,
  SessionCuesResponse,
  StageKey,
} from "./types";
import { STAGE_KEYS } from "./types";
import { validateCueOutput, flattenCueOutput, validateCuePhrase, type RawCueOutputShape } from "./cue-schema";
import { buildSystemPrompt, buildUserPrompt, buildRepairPrompt, PROMPT_VERSION } from "./prompts";
import { callGroqChatCompletion, callGroqRepair, GroqResearchAIError } from "./groq-adapter";

/** Maximum combined research text length sent to the model (chars). */
const MAX_INPUT_CHARS = 30_000;

/** Stable ID prefix for original research notes (not a DB evidence row). */
const NOTES_SOURCE_ID = "research-notes";

/**
 * Normalizes cue_points from whatever shape is stored in DB into a canonical CuePoint[] array.
 * Handles:
 * 1. An array of CuePoint objects.
 * 2. A serialized JSON string of an array or object.
 * 3. A stage-keyed object { hook: [...], context: [...], ... }.
 */
export function normalizeCuePoints(raw: unknown): CuePoint[] {
  if (!raw) return [];

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  // If already an array of cue points
  if (Array.isArray(parsed)) {
    return parsed
      .filter((item): item is CuePoint => Boolean(item && typeof item === "object" && typeof item.stageKey === "string" && typeof item.phrase === "string"))
      .map((item) => ({
        stageKey: item.stageKey as StageKey,
        phrase: String(item.phrase || "").trim(),
        evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.map(String) : [],
      }));
  }

  // If a stage-keyed object
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const hasAnyStage = STAGE_KEYS.some((key) => Array.isArray(obj[key]));
    if (hasAnyStage) {
      return flattenCueOutput(obj as RawCueOutputShape);
    }
  }

  return [];
}

/**
 * Resolves the effective cue set by combining original AI-generated cues
 * with user-saved edits.
 * - If an edit exists for `${stageKey}_${index}`, use the edited phrase.
 * - Otherwise, keep the original AI-generated phrase.
 * - Evidence IDs and stage order are strictly preserved.
 */
export function resolveEffectiveCues(
  generatedCues: CuePoint[],
  editedCues: EditedCueMap | null | undefined
): CuePoint[] {
  if (!editedCues || Object.keys(editedCues).length === 0) {
    return [...generatedCues];
  }

  // Group by stage key to know the 0 vs 1 index per stage
  const stageCounter: Record<string, number> = {};

  return generatedCues.map((cue) => {
    const stage = cue.stageKey;
    const index = stageCounter[stage] ?? 0;
    stageCounter[stage] = index + 1;

    const editKey = `${stage}_${index}`;
    const customPhrase = editedCues[editKey];

    if (typeof customPhrase === "string" && customPhrase.trim().length > 0) {
      return {
        ...cue,
        phrase: customPhrase.trim(),
      };
    }

    return { ...cue };
  });
}


/**
 * Returns the Research AI config from environment variables.
 */
export function getResearchAIConfig(): ResearchAIConfig {
  return {
    provider: (process.env.RESEARCH_AI_PROVIDER || "").trim(),
    apiKey: (process.env.RESEARCH_AI_API_KEY || "").trim(),
    model: (process.env.RESEARCH_AI_MODEL || "").trim(),
  };
}

/**
 * Computes a deterministic input hash to detect when research has changed.
 */
function computeInputHash(
  topic: string,
  extractedText: string,
  sourceMappings: SourceMapping[],
  model: string
): string {
  const hash = createHash("sha256");
  hash.update(topic || "");
  hash.update("\n---\n");
  hash.update(extractedText || "");
  hash.update("\n---\n");
  for (const src of sourceMappings) {
    hash.update(`${src.id}:${src.excerpt}\n`);
  }
  hash.update("\n---\n");
  hash.update(PROMPT_VERSION);
  hash.update("\n---\n");
  hash.update(model);
  return hash.digest("hex");
}

/**
 * Builds the source mapping array from research_evidence rows and notes.
 */
function buildSourceMappings(
  researchSessionId: string,
  notes: string,
  evidenceRows: Array<{
    id: string;
    file_name: string | null;
    type: string;
    text_content: string | null;
    extraction_status: string;
  }>
): SourceMapping[] {
  const mappings: SourceMapping[] = [];

  // Add research notes as a source if present
  const trimmedNotes = (notes || "").trim();
  if (trimmedNotes) {
    mappings.push({
      id: `${NOTES_SOURCE_ID}-${researchSessionId}`,
      label: "Original Research Notes",
      excerpt: trimmedNotes,
    });
  }

  // Add successfully extracted evidence rows
  for (const row of evidenceRows) {
    if (row.extraction_status === "extracted" && row.text_content?.trim()) {
      mappings.push({
        id: row.id,
        label: `${row.type === "image" ? "Image OCR" : "File"}: ${row.file_name || "evidence"}`,
        excerpt: row.text_content.trim(),
      });
    }
  }

  return mappings;
}

/**
 * Main entry point: generate cues for a research session.
 *
 * @param supabase Authenticated Supabase client
 * @param sessionId Parent session ID
 * @param userId Authenticated user ID
 * @param options.force If true, regenerate even if a valid cached result exists
 */
export async function generateCuesForSession(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  options?: { force?: boolean; resetEdits?: boolean }
): Promise<CueGenerationResult> {
  const config = getResearchAIConfig();

  if (!config.apiKey) {
    return {
      success: false,
      error: "Research AI is not configured. Set RESEARCH_AI_API_KEY in your server environment.",
      repairAttempts: 0,
    };
  }

  if (!config.model) {
    return {
      success: false,
      error: "Research AI model is not configured. Set RESEARCH_AI_MODEL.",
      repairAttempts: 0,
    };
  }

  // 1. Verify session ownership
  const { data: session } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!session) {
    return { success: false, error: "Session not found or not owned by this account.", repairAttempts: 0 };
  }

  // 2. Fetch research session
  const { data: rs } = await supabase
    .from("research_sessions")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!rs) {
    return { success: false, error: "No research session found. Complete the research step first.", repairAttempts: 0 };
  }

  // 3. Check extraction status
  const processingStatus = rs.processing_status || "pending";
  if (processingStatus !== "extracted") {
    return {
      success: false,
      error: `Research extraction is not complete (status: ${processingStatus}). Run OCR extraction first.`,
      repairAttempts: 0,
    };
  }

  // 4. Fetch evidence rows
  const { data: evidenceRows } = await supabase
    .from("research_evidence")
    .select("id, file_name, type, text_content, extraction_status")
    .eq("research_session_id", rs.id)
    .order("created_at", { ascending: true });

  // 5. Build source mappings
  const sourceMappings = buildSourceMappings(rs.id, rs.notes || "", evidenceRows || []);

  if (sourceMappings.length === 0) {
    return {
      success: false,
      error: "Insufficient research material. Add research notes or upload images with readable text before generating cues.",
      repairAttempts: 0,
    };
  }

  // 6. Build extracted text and check size
  const extractedText = rs.extracted_text || "";
  const topic = rs.topic || "";

  if (extractedText.length > MAX_INPUT_CHARS) {
    return {
      success: false,
      error: `Research material exceeds the ${MAX_INPUT_CHARS.toLocaleString()} character limit for cue generation. Shorten your notes or use fewer images.`,
      repairAttempts: 0,
    };
  }

  // 7. Compute input hash
  const inputHash = computeInputHash(topic, extractedText, sourceMappings, config.model);

  // 8. Check for existing valid cues (skip if force=true)
  if (!options?.force) {
    const existingCueStatus = rs.cue_status;
    const existingHash = rs.cue_input_hash;

    if (existingCueStatus === "generated" && existingHash === inputHash && rs.cue_points) {
      const generatedCues = normalizeCuePoints(rs.cue_points);
      const editedCues = (rs.edited_cue_points as EditedCueMap) || {};
      const effectiveCues = resolveEffectiveCues(generatedCues, editedCues);

      // Return existing cues
      return {
        success: true,
        cueSet: {
          cues: generatedCues,
          model: rs.cue_model || config.model,
          promptVersion: rs.cue_prompt_version || PROMPT_VERSION,
          inputHash: existingHash,
          generatedAt: rs.cue_generated_at || new Date().toISOString(),
        },
        effectiveCues,
        editedCues,
        hasEdits: Object.keys(editedCues).length > 0,
        repairAttempts: 0,
      };
    }

    // If research changed, mark existing cues as stale
    if (existingCueStatus === "generated" && existingHash !== inputHash) {
      await supabase
        .from("research_sessions")
        .update({ cue_status: "stale" })
        .eq("id", rs.id);
    }
  }

  // 9. Prevent concurrent generation: set status to "generating"
  const { data: lockRow } = await supabase
    .from("research_sessions")
    .update({ cue_status: "generating", cue_error: null })
    .eq("id", rs.id)
    .not("cue_status", "eq", "generating")
    .select("id")
    .maybeSingle();

  // If another request is already generating, report it
  if (!lockRow) {
    // Double-check if it was locked by another request
    const { data: recheckRs } = await supabase
      .from("research_sessions")
      .select("cue_status")
      .eq("id", rs.id)
      .single();

    if (recheckRs?.cue_status === "generating") {
      return {
        success: false,
        error: "Cue generation is already in progress for this session. Please wait.",
        repairAttempts: 0,
      };
    }
    // If it's not generating, try the lock again
    await supabase
      .from("research_sessions")
      .update({ cue_status: "generating", cue_error: null })
      .eq("id", rs.id);
  }

  // 10. Generate cues via AI
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(topic, sourceMappings, extractedText);
  let repairAttempts = 0;

  try {
    let rawOutput = await callGroqChatCompletion(config, systemPrompt, userPrompt);
    let validation = validateCueOutput(rawOutput, sourceMappings);

    // One controlled repair attempt
    if (!validation.success) {
      repairAttempts = 1;
      const repairPrompt = buildRepairPrompt((validation as { errors: string[] }).errors, sourceMappings);
      rawOutput = await callGroqRepair(config, systemPrompt, userPrompt, repairPrompt);
      validation = validateCueOutput(rawOutput, sourceMappings);
    }

    if (!validation.success) {
      // Validation failed even after repair
      const errorMsg = `Cue validation failed after repair: ${(validation as { errors: string[] }).errors.slice(0, 3).join("; ")}`;
      await supabase
        .from("research_sessions")
        .update({ cue_status: "failed", cue_error: errorMsg })
        .eq("id", rs.id);

      return {
        success: false,
        error: "Generated cues did not pass validation. Please try again.",
        repairAttempts,
      };
    }

    // 11. Flatten and persist
    const flatCues = flattenCueOutput(validation.data);
    const generatedAt = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      cue_points: flatCues,
      cue_status: "generated",
      cue_model: config.model,
      cue_input_hash: inputHash,
      cue_generated_at: generatedAt,
      cue_error: null,
      cue_prompt_version: PROMPT_VERSION,
    };

    if (options?.resetEdits) {
      updatePayload.edited_cue_points = null;
    }

    await supabase
      .from("research_sessions")
      .update(updatePayload)
      .eq("id", rs.id);

    const editedCues = options?.resetEdits ? {} : ((rs.edited_cue_points as EditedCueMap) || {});
    const effectiveCues = resolveEffectiveCues(flatCues, editedCues);

    const cueSet: CueSet = {
      cues: flatCues,
      model: config.model,
      promptVersion: PROMPT_VERSION,
      inputHash,
      generatedAt,
    };

    return {
      success: true,
      cueSet,
      effectiveCues,
      editedCues,
      hasEdits: Object.keys(editedCues).length > 0,
      repairAttempts,
    };
  } catch (error) {
    const errorMsg =
      error instanceof GroqResearchAIError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Cue generation failed.";

    await supabase
      .from("research_sessions")
      .update({ cue_status: "failed", cue_error: errorMsg })
      .eq("id", rs.id);

    return {
      success: false,
      error: errorMsg,
      repairAttempts,
    };
  }
}

/**
 * Retrieves the current canonical cue state for a session.
 * Used by both Research and Speaking pages to guarantee 100% contract parity.
 */
export async function getSessionCues(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string
): Promise<SessionCuesResponse> {
  // Verify ownership
  const { data: session } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!session) {
    return {
      cueSet: null,
      effectiveCues: null,
      editedCues: {},
      hasEdits: false,
      cueStatus: "error",
      cueError: "Session not found or not owned by this account.",
    };
  }

  const { data: rs, error: rsError } = await supabase
    .from("research_sessions")
    .select("cue_points, edited_cue_points, cue_status, cue_model, cue_input_hash, cue_generated_at, cue_error, cue_prompt_version")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (rsError || !rs) {
    return {
      cueSet: null,
      effectiveCues: null,
      editedCues: {},
      hasEdits: false,
      cueStatus: "pending",
      cueError: rsError?.message || null,
    };
  }

  const cueStatus = rs.cue_status || "pending";
  const cueError = rs.cue_error || null;
  const rawCuePoints = rs.cue_points;

  if (cueStatus === "generated" && rawCuePoints) {
    const normalized = normalizeCuePoints(rawCuePoints);
    const editedCues: EditedCueMap = (rs.edited_cue_points as EditedCueMap) || {};
    const effectiveCues = resolveEffectiveCues(normalized, editedCues);
    const hasEdits = Object.keys(editedCues).length > 0;

    return {
      cueSet: {
        cues: normalized,
        model: rs.cue_model || "",
        promptVersion: rs.cue_prompt_version || "",
        inputHash: rs.cue_input_hash || "",
        generatedAt: rs.cue_generated_at || "",
      },
      effectiveCues,
      editedCues,
      hasEdits,
      cueStatus,
      cueError: null,
    };
  }

  return {
    cueSet: null,
    effectiveCues: null,
    editedCues: {},
    hasEdits: false,
    cueStatus,
    cueError,
  };
}

/**
 * Persists an edited cue phrase for a specific stage and index (0 or 1).
 * Validates the phrase, maintains separation from original AI cues, and
 * returns the updated effective cue set.
 */
export async function saveCueEdit(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  payload: CueEditPayload
): Promise<{
  success: boolean;
  effectiveCues?: CuePoint[];
  editedCues?: EditedCueMap;
  hasEdits?: boolean;
  error?: string;
}> {
  // 1. Verify ownership
  const { data: session } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!session) {
    return { success: false, error: "Session not found or not owned by this account." };
  }

  // 2. Fetch research session
  const { data: rs } = await supabase
    .from("research_sessions")
    .select("id, cue_points, edited_cue_points, cue_status")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!rs || rs.cue_status !== "generated" || !rs.cue_points) {
    return { success: false, error: "Cannot edit cues before research cues are generated." };
  }

  // 3. Validate stageKey and cueIndex
  if (!STAGE_KEYS.includes(payload.stageKey)) {
    return { success: false, error: `Invalid stage key: ${payload.stageKey}` };
  }

  if (payload.cueIndex !== 0 && payload.cueIndex !== 1) {
    return { success: false, error: "Cue index must be 0 or 1 (exactly two cues per stage)." };
  }

  // 4. Validate phrase
  const phraseVal = validateCuePhrase(payload.phrase);
  if (!phraseVal.success) {
    return { success: false, error: (phraseVal as { error: string }).error };
  }

  // 5. Update edited_cue_points map
  const existingEdits: EditedCueMap = { ...((rs.edited_cue_points as EditedCueMap) || {}) };
  const editKey = `${payload.stageKey}_${payload.cueIndex}`;
  existingEdits[editKey] = (phraseVal as { phrase: string }).phrase;

  const { error: updateError } = await supabase
    .from("research_sessions")
    .update({ edited_cue_points: existingEdits })
    .eq("id", rs.id);

  if (updateError) {
    return { success: false, error: `Failed to save cue edit: ${updateError.message}` };
  }

  const normalized = normalizeCuePoints(rs.cue_points);
  const effectiveCues = resolveEffectiveCues(normalized, existingEdits);

  return {
    success: true,
    effectiveCues,
    editedCues: existingEdits,
    hasEdits: Object.keys(existingEdits).length > 0,
  };
}

