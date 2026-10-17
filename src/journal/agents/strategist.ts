import { BriefSchema, briefProblems, type StrategistInput } from "../contracts/brief";
import type { Llm } from "../lib/llm";
import { block, systemPrompt } from "../lib/prompts";

/** Content strategist: picks one of the top ideas and writes the brief. Links are checked by code. */
export function strategist(input: StrategistInput, deps: { llm: Llm }) {
  return deps.llm.structured({
    agent: "strategist",
    schema: BriefSchema,
    effort: "medium",
    system: systemPrompt("strategist", input.lessons),
    input: [
      block("top_ideas_best_first", input.topIdeas),
      block("past_articles", input.pastPosts.map((p) => ({ title: p.title, keyword: p.primaryKeyword }))),
      block("site_links", input.links),
      block("photos", input.photos.length ? input.photos.map(({ id, piece, alt }) => ({ id, piece, shows: alt })) : "(no photos yet)"),
      "Write the brief.",
    ].join("\n\n"),
    check: (brief) => briefProblems(brief, { topIdeaIds: input.topIdeas.map((i) => i.id), links: input.links, photos: input.photos }),
  });
}
