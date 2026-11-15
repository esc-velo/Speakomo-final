import { z } from "zod";
import type { StageKey, SourceMapping } from "./types";
import { STAGE_KEYS } from "./types";

/**
 * Zod schema for a single cue phrase object.
 */
const cuePointSchema = z.object({
  phrase: z
    .string()
    .min(1, "Cue phrase must not be empty")
    .refine(
      (p) => {
        const words = p.trim().split(/\s+/).length;
        return words >= 2 && words <= 25;
      },
      { message: "Cue phrase should contain 2–25 words" }
    ),
  evidenceIds: z.array(z.string().min(1)).min(1, "At least one evidence ID is required"),
});

/**
 * The raw JSON shape the model returns: an object keyed by stage key,
 * each value an array of exactly 2 cue objects.
 */
const rawCueOutputSchema = z.object({
  hook: z.array(cuePointSchema).length(2, "hook must have exactly 2 cues"),
  context: z.array(cuePointSchema).length(2, "context must have exactly 2 cues"),
  concept1: z.array(cuePointSchema).length(2, "concept1 must have exactly 2 cues"),
  concept2: z.array(cuePointSchema).length(2, "concept2 must have exactly 2 cues"),
  evidence: z.array(cuePointSchema).length(2, "evidence must have exactly 2 cues"),
  close: z.array(cuePointSchema).length(2, "close must have exactly 2 cues"),
});

export type RawCueOutputShape = z.infer<typeof rawCueOutputSchema>;

/**
 * Validates an edited cue phrase string.
 * Must be non-empty, trimmed, and between 2 and 25 words.
 */
export function validateCuePhrase(phraseRaw: unknown): { success: true; phrase: string } | { success: false; error: string } {
  if (typeof phraseRaw !== "string") {
    return { success: false, error: "Cue phrase must be a string." };
  }
  const phrase = phraseRaw.trim();
  if (!phrase) {
    return { success: false, error: "Cue phrase cannot be empty." };
  }
  if (phrase.length > 300) {
    return { success: false, error: "Cue phrase is too long (maximum 300 characters)." };
  }
  const words = phrase.split(/\s+/).filter(Boolean).length;
  if (words < 2) {
    return { success: false, error: "Cue phrase should contain at least 2 words." };
  }
  if (words > 25) {
    return { success: false, error: "Cue phrase should be concise (25 words or fewer)." };
  }
  return { success: true, phrase };
}

/** Schema for validating cue edit requests. */
export const cueEditRequestSchema = z.object({
  stageKey: z.enum(STAGE_KEYS as unknown as [string, ...string[]]),
  cueIndex: z.union([z.literal(0), z.literal(1)]),
  phrase: z.string().min(1),
});


/**
 * Validates model output against the cue schema and checks that every
 * evidenceId references a real source in the supplied mapping.
 *
 * Returns { success, data, errors }.
 */
export function validateCueOutput(
  raw: unknown,
  sourceMappings: SourceMapping[]
): { success: true; data: RawCueOutputShape } | { success: false; errors: string[] } {
  const parsed = rawCueOutputSchema.safeParse(raw);

  if (!parsed.success) {
    const errors = parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`
    );
    return { success: false, errors };
  }

  // Validate that every evidenceId exists in the source mapping
  const validIds = new Set(sourceMappings.map((s) => s.id));
  const invalidRefs: string[] = [];

  for (const stageKey of STAGE_KEYS) {
    const cues = parsed.data[stageKey];
    for (let i = 0; i < cues.length; i++) {
      for (const eid of cues[i].evidenceIds) {
        if (!validIds.has(eid)) {
          invalidRefs.push(
            `${stageKey}[${i}].evidenceIds contains unknown reference "${eid}"`
          );
        }
      }
    }
  }

  if (invalidRefs.length > 0) {
    return { success: false, errors: invalidRefs };
  }

  return { success: true, data: parsed.data };
}

/**
 * Converts the validated stage-keyed output into a flat CuePoint[] array
 * ordered by stage sequence.
 */
export function flattenCueOutput(
  data: RawCueOutputShape
): Array<{ stageKey: StageKey; phrase: string; evidenceIds: string[] }> {
  const result: Array<{ stageKey: StageKey; phrase: string; evidenceIds: string[] }> = [];
  for (const stageKey of STAGE_KEYS) {
    for (const cue of data[stageKey]) {
      result.push({ stageKey, phrase: cue.phrase, evidenceIds: cue.evidenceIds });
    }
  }
  return result;
}

/** JSON Schema representation for Groq structured output (response_format). */
export const CUE_JSON_SCHEMA = {
  type: "object" as const,
  properties: Object.fromEntries(
    STAGE_KEYS.map((key) => [
      key,
      {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            phrase: { type: "string" as const },
            evidenceIds: {
              type: "array" as const,
              items: { type: "string" as const },
            },
          },
          required: ["phrase", "evidenceIds"],
          additionalProperties: false,
        },
        minItems: 2,
        maxItems: 2,
      },
    ])
  ),
  required: [...STAGE_KEYS],
  additionalProperties: false,
};
