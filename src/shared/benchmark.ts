// Benchmark file format and graders. Shared by the agent (grading inside the TEE)
// and the web app (validating a file before it is encrypted in the browser).

export type Grader = "exact" | "contains" | "number" | "choice";

export interface BenchmarkItem {
  prompt: string;
  answer: string;
  grader?: Grader;
}

export interface BenchmarkFile {
  name?: string;
  /** Optional instruction prepended to every prompt as the system message */
  system?: string;
  items: BenchmarkItem[];
}

export const LIMITS = {
  maxItems: 10_000,
  maxPromptChars: 8_000,
  maxAnswerChars: 500,
  maxSystemChars: 2_000,
  maxFileBytes: 5 * 1024 * 1024,
};

const GRADERS: Grader[] = ["exact", "contains", "number", "choice"];

/** Parse and validate a benchmark file. Throws a readable error on the first problem. */
export function parseBenchmark(text: string): BenchmarkFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Benchmark is not valid JSON");
  }
  const b = data as BenchmarkFile;
  if (!b || typeof b !== "object" || !Array.isArray(b.items)) {
    throw new Error('Benchmark must be an object with an "items" array');
  }
  if (b.items.length < 1 || b.items.length > LIMITS.maxItems) {
    throw new Error(`Benchmark must have 1-${LIMITS.maxItems} items`);
  }
  if (b.system !== undefined && (typeof b.system !== "string" || b.system.length > LIMITS.maxSystemChars)) {
    throw new Error(`"system" must be a string of at most ${LIMITS.maxSystemChars} characters`);
  }
  b.items.forEach((item, i) => {
    if (!item || typeof item.prompt !== "string" || !item.prompt.trim()) {
      throw new Error(`Item ${i}: "prompt" must be a non-empty string`);
    }
    if (item.prompt.length > LIMITS.maxPromptChars) {
      throw new Error(`Item ${i}: prompt is longer than ${LIMITS.maxPromptChars} characters`);
    }
    if (typeof item.answer !== "string" || !item.answer.trim()) {
      throw new Error(`Item ${i}: "answer" must be a non-empty string`);
    }
    if (item.answer.length > LIMITS.maxAnswerChars) {
      throw new Error(`Item ${i}: answer is longer than ${LIMITS.maxAnswerChars} characters`);
    }
    if (item.grader !== undefined && !GRADERS.includes(item.grader)) {
      throw new Error(`Item ${i}: grader must be one of ${GRADERS.join(", ")}`);
    }
  });
  return b;
}

export const DEFAULT_SYSTEM =
  "You are being evaluated on a hidden benchmark. Reply with only the final answer: no explanation, no working, no formatting.";

/** Remove reasoning blocks some open models emit before their answer. */
export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "").trim();
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`"'“”‘’]/g, "")
    .replace(/^(final answer|answer)\s*[:\-]\s*/i, "")
    .replace(/[\s.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastNumber(s: string): number | null {
  const matches = s.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
  if (!matches) return null;
  const n = Number(matches[matches.length - 1]);
  return Number.isFinite(n) ? n : null;
}

function choiceLetter(s: string): string | null {
  const explicit = s.match(/answer\s*(?:is)?\s*[:\-]?\s*\(?([A-J])\)?\b/i);
  if (explicit) return explicit[1].toUpperCase();
  const lone = s.trim().match(/^\(?([A-J])\)?(?:[.):\s]|$)/i);
  return lone ? lone[1].toUpperCase() : null;
}

/** Grade one model response against the reference answer. */
export function grade(item: BenchmarkItem, rawResponse: string): boolean {
  const response = stripReasoning(rawResponse);
  const grader = item.grader ?? "exact";
  switch (grader) {
    case "exact":
      return normalize(response) === normalize(item.answer);
    case "contains":
      return normalize(response).includes(normalize(item.answer));
    case "number": {
      const got = lastNumber(response);
      const want = Number(item.answer.replace(/,/g, ""));
      if (got === null || !Number.isFinite(want)) return false;
      return Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want));
    }
    case "choice":
      return choiceLetter(response) === item.answer.trim().toUpperCase();
  }
}
