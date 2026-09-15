export type CueStage = {
  key: "hook" | "context" | "concept1" | "concept2" | "evidence" | "close";
  label: string;
  durationSec: number;
  genericPrompt: string;
};

// Deterministic six-stage plan summing to 300 seconds (5 minutes).
export const SIX_STAGES: readonly CueStage[] = [
  { key: "hook", label: "Frame the question", durationSec: 30, genericPrompt: "Pose the question or problem your topic addresses. Keep it concrete." },
  { key: "context", label: "Set the context", durationSec: 45, genericPrompt: "Explain why this matters and who it affects." },
  { key: "concept1", label: "Explain a key idea", durationSec: 60, genericPrompt: "Introduce the first key concept in plain language." },
  { key: "concept2", label: "Add depth", durationSec: 60, genericPrompt: "Introduce a supporting or contrasting idea and how it connects." },
  { key: "evidence", label: "Bring in evidence", durationSec: 60, genericPrompt: "Point to the strongest supporting evidence or example." },
  { key: "close", label: "Close with implication", durationSec: 45, genericPrompt: "State the implication or open question you would leave your audience with." },
];

export const TOTAL_DURATION_SEC = SIX_STAGES.reduce((total, stage) => total + stage.durationSec, 0);

export function stageForElapsed(elapsedSec: number) {
  let running = 0;
  for (let index = 0; index < SIX_STAGES.length; index += 1) {
    running += SIX_STAGES[index].durationSec;
    if (elapsedSec < running) return { index, stage: SIX_STAGES[index], stageStartSec: running - SIX_STAGES[index].durationSec, stageEndSec: running };
  }
  const last = SIX_STAGES[SIX_STAGES.length - 1];
  return { index: SIX_STAGES.length - 1, stage: last, stageStartSec: TOTAL_DURATION_SEC - last.durationSec, stageEndSec: TOTAL_DURATION_SEC };
}

export function formatMmSs(seconds: number) {
  const clamped = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(clamped / 60).toString().padStart(2, "0");
  const ss = (clamped % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
