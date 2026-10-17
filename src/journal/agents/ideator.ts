import { IDEAS_REQUESTED } from "../config";
import { IdeaListSchema, type IdeatorInput } from "../contracts/idea";
import type { Llm } from "../lib/llm";
import { block, systemPrompt } from "../lib/prompts";

/** Ideator: proposes ideas with a score and a reason each. Ranking happens in code (rankIdeas). */
export function ideator(input: IdeatorInput, deps: { llm: Llm }) {
  const past = input.pastPosts.length
    ? input.pastPosts.map((p) => `- "${p.title}" (keyword: ${p.primaryKeyword}; ${p.status}${p.publishedAt ? `, ${p.publishedAt.slice(0, 10)}` : ""})`).join("\n")
    : "(none yet)";
  return deps.llm.structured({
    agent: "ideator",
    schema: IdeaListSchema,
    effort: "medium",
    system: systemPrompt("ideator", input.lessons, { TODAY: input.today }),
    input: [
      `Today is ${input.today}.`,
      block("past_articles", past),
      block("pieces_we_list_now", input.pieces.length ? input.pieces.map((p) => `- ${p}`).join("\n") : "(none published yet: ideas can feature a category or a house instead)"),
      `Propose ${IDEAS_REQUESTED} ideas.`,
    ].join("\n\n"),
  });
}
