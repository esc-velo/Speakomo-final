import type { SourceMapping } from "./types";

export const PROMPT_VERSION = "v1.0";

/**
 * Builds the system prompt for cue generation.
 */
export function buildSystemPrompt(): string {
  return `You are a speaking-cue generator for Speakomo, an academic speaking practice tool.

Your task: convert extracted research material into exactly 12 short cue phrases organized into 6 speaking stages. Each stage gets exactly 2 cues.

RULES:
- Each cue phrase must be 2–5 words. Never write full sentences.
- Cues must be concise, memorable, research-specific memory anchors.
- Cues remind the speaker WHAT to discuss, not HOW to say it.
- Every cue must reference at least one source from the provided evidence using its exact Source ID.
- Never invent statistics, citations or evidence not present in the source material.
- Never produce generic public-speaking advice.
- If the material lacks numerical statistics for the evidence stage, use qualitative findings from the material instead. Do not fabricate numbers.

THE 6 STAGES (in order):
1. "hook" — Frame the question: identify the central problem or research question.
2. "context" — Set the context: identify relevant background or definitions.
3. "concept1" — Explain a key idea: identify an important concept or finding.
4. "concept2" — Add depth: identify a related concept, contrast, or limitation.
5. "evidence" — Bring in evidence: identify actual data, findings or examples FROM the material.
6. "close" — Close with implication: identify the real takeaway or future implication.

OUTPUT FORMAT — strict JSON:
{
  "hook": [{"phrase": "...", "evidenceIds": ["source-id"]}, {"phrase": "...", "evidenceIds": ["source-id"]}],
  "context": [{"phrase": "...", "evidenceIds": ["source-id"]}, {"phrase": "...", "evidenceIds": ["source-id"]}],
  "concept1": [{"phrase": "...", "evidenceIds": ["source-id"]}, {"phrase": "...", "evidenceIds": ["source-id"]}],
  "concept2": [{"phrase": "...", "evidenceIds": ["source-id"]}, {"phrase": "...", "evidenceIds": ["source-id"]}],
  "evidence": [{"phrase": "...", "evidenceIds": ["source-id"]}, {"phrase": "...", "evidenceIds": ["source-id"]}],
  "close": [{"phrase": "...", "evidenceIds": ["source-id"]}, {"phrase": "...", "evidenceIds": ["source-id"]}]
}

Return ONLY the JSON object. No markdown, no explanation, no extra fields.`;
}

/**
 * Builds the user prompt with the actual research material and source mapping.
 */
export function buildUserPrompt(
  topic: string,
  sourceMappings: SourceMapping[],
  extractedText: string
): string {
  const sourceBlock = sourceMappings
    .map(
      (s) =>
        `Source ID: ${s.id}\nSource Label: ${s.label}\nExcerpt:\n${s.excerpt}`
    )
    .join("\n\n---\n\n");

  return `ACADEMIC TOPIC: ${topic || "General research topic"}

AVAILABLE SOURCES (use these exact Source IDs in evidenceIds):

${sourceBlock}

UNIFIED EXTRACTED RESEARCH:

${extractedText}

Generate exactly 12 cue phrases (2 per stage, 6 stages) grounded in the above material. Each phrase must be 2–5 words. Every evidenceId must be one of the Source IDs listed above.`;
}

/**
 * Builds a repair prompt when the first attempt fails validation.
 */
export function buildRepairPrompt(
  validationErrors: string[],
  sourceMappings: SourceMapping[]
): string {
  const validIds = sourceMappings.map((s) => s.id).join(", ");

  return `Your previous output failed validation. Fix these errors and return ONLY valid JSON:

ERRORS:
${validationErrors.map((e) => `- ${e}`).join("\n")}

VALID SOURCE IDS: ${validIds}

REQUIREMENTS:
- Exactly 6 stage keys: hook, context, concept1, concept2, evidence, close
- Exactly 2 cue objects per stage
- Each phrase: 2–25 words, non-empty
- Each evidenceIds: non-empty array of valid Source IDs from the list above
- Return ONLY the corrected JSON object`;
}
