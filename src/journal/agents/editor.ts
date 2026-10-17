import { ReviewSchema, plain, scoreReview, type EditorInput } from "../contracts/review";
import type { Llm } from "../lib/llm";
import { block, systemPrompt } from "../lib/prompts";

/** Editor: scores against the rubric and lists specific issues. Never rewrites. */
export async function editor(input: EditorInput, deps: { llm: Llm }) {
  const text = plain(input.draft);
  const call = await deps.llm.structured({
    agent: "editor",
    schema: ReviewSchema,
    effort: "high",
    system: systemPrompt("editor", input.lessons),
    input: [block("brief", input.brief), block("research", input.research), block("code_checks", input.checks), block("draft", input.draft), "Review this draft."].join("\n\n"),
    // A quote that isn't in the draft gets one correction; any still missing are set aside by code.
    check: (r) => r.issues.filter((i) => !text.includes(plain(i.quote))).map((i) => `${i.id}: the quote "${i.quote}" is not in the draft; copy the words exactly`),
    onRemaining: "accept",
  });
  return { ...call, scored: scoreReview(call.value, input.draft) };
}
