import { CriticSchema, type CriticInput } from "../contracts/lesson";
import type { Llm } from "../lib/llm";
import { block, systemPrompt } from "../lib/prompts";

/** Critic: what worked, what didn't, and at most three lessons. Code decides which are kept. */
export function critic(input: CriticInput, deps: { llm: Llm }) {
  return deps.llm.structured({
    agent: "critic",
    schema: CriticSchema,
    effort: "medium",
    system: systemPrompt("critic"),
    input: [block("run_report", input.report), block("active_lessons", input.activeLessons), block("deleted_lessons", input.deletedLessons), "Review the run."].join("\n\n"),
  });
}
