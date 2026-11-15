/**
 * Groq Chat Completions adapter for research AI.
 * Uses native fetch — no AI SDK dependency.
 * Completely independent from the ASR Groq adapter.
 */

import type { RawCueOutput, ResearchAIConfig } from "./types";
import { CUE_JSON_SCHEMA } from "./cue-schema";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 60_000;

export class GroqResearchAIError extends Error {
  public readonly statusCode: number | null;
  public readonly retryable: boolean;
  public readonly code: string;

  constructor(message: string, code: string, statusCode: number | null = null, retryable = false) {
    super(message);
    this.name = "GroqResearchAIError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

/**
 * Calls Groq Chat Completions API with structured JSON output.
 */
export async function callGroqChatCompletion(
  config: ResearchAIConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<RawCueOutput> {
  if (!config.apiKey) {
    throw new GroqResearchAIError(
      "Research AI API key is not configured. Set RESEARCH_AI_API_KEY in your environment.",
      "RESEARCH_AI_NOT_CONFIGURED"
    );
  }

  if (!config.model) {
    throw new GroqResearchAIError(
      "Research AI model is not configured. Set RESEARCH_AI_MODEL in your environment.",
      "RESEARCH_AI_MODEL_MISSING"
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "cue_output",
          strict: true,
          schema: CUE_JSON_SCHEMA,
        },
      },
    };

    const response = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");

      if (response.status === 429) {
        throw new GroqResearchAIError(
          "Research AI rate limit exceeded. Please wait a moment and try again.",
          "RESEARCH_AI_RATE_LIMITED",
          429,
          true
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new GroqResearchAIError(
          "Research AI authentication failed. Check your API key configuration.",
          "RESEARCH_AI_AUTH_FAILED",
          response.status
        );
      }

      if (response.status === 404) {
        throw new GroqResearchAIError(
          `The configured Research AI model "${config.model}" was not found. Verify RESEARCH_AI_MODEL.`,
          "RESEARCH_AI_MODEL_NOT_FOUND",
          404
        );
      }

      if (response.status >= 500) {
        throw new GroqResearchAIError(
          "Research AI service is temporarily unavailable. Try again shortly.",
          "RESEARCH_AI_SERVICE_ERROR",
          response.status,
          true
        );
      }

      // Try to extract a user-safe message from the error response
      let safeMsg = `Research AI request failed (HTTP ${response.status}).`;
      try {
        const errJson = JSON.parse(errorText);
        if (errJson?.error?.message && typeof errJson.error.message === "string") {
          // Only include the message if it doesn't leak secrets
          const msg = errJson.error.message as string;
          if (!msg.includes("key") && !msg.includes("token") && msg.length < 200) {
            safeMsg = `Research AI: ${msg}`;
          }
        }
      } catch {
        // ignore parse error
      }

      throw new GroqResearchAIError(safeMsg, "RESEARCH_AI_HTTP_ERROR", response.status);
    }

    const data = await response.json();

    // Extract content from the chat completions response
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new GroqResearchAIError(
        "Research AI returned an empty response. Try generating again.",
        "RESEARCH_AI_EMPTY_RESPONSE"
      );
    }

    // Parse the JSON content
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new GroqResearchAIError(
        "Research AI returned invalid JSON. A repair attempt will be made.",
        "RESEARCH_AI_INVALID_JSON"
      );
    }

    return parsed as RawCueOutput;
  } catch (error) {
    if (error instanceof GroqResearchAIError) throw error;

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new GroqResearchAIError(
        "Research AI request timed out. Try again.",
        "RESEARCH_AI_TIMEOUT",
        null,
        true
      );
    }

    throw new GroqResearchAIError(
      "Failed to connect to Research AI service.",
      "RESEARCH_AI_CONNECTION_ERROR",
      null,
      true
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sends a repair request to the model, including the validation errors.
 */
export async function callGroqRepair(
  config: ResearchAIConfig,
  systemPrompt: string,
  originalUserPrompt: string,
  repairPrompt: string
): Promise<RawCueOutput> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: originalUserPrompt },
        { role: "assistant", content: "(previous attempt was invalid)" },
        { role: "user", content: repairPrompt },
      ],
      temperature: 0.1,
      max_tokens: 2048,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "cue_output",
          strict: true,
          schema: CUE_JSON_SCHEMA,
        },
      },
    };

    const response = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new GroqResearchAIError(
        "Research AI repair request failed.",
        "RESEARCH_AI_REPAIR_FAILED",
        response.status
      );
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content || typeof content !== "string") {
      throw new GroqResearchAIError(
        "Research AI returned empty repair response.",
        "RESEARCH_AI_EMPTY_REPAIR"
      );
    }

    return JSON.parse(content) as RawCueOutput;
  } catch (error) {
    if (error instanceof GroqResearchAIError) throw error;
    throw new GroqResearchAIError(
      "Research AI repair attempt failed.",
      "RESEARCH_AI_REPAIR_ERROR"
    );
  } finally {
    clearTimeout(timeout);
  }
}
