import { SeoSchema, type SeoInput } from "../contracts/seo";
import type { Llm } from "../lib/llm";
import { block, systemPrompt } from "../lib/prompts";

/** SEO specialist: metadata only. Lengths and slug rules are counted by code (seoProblems). */
export function seo(input: SeoInput, deps: { llm: Llm }) {
  return deps.llm.structured({
    agent: "seo",
    schema: SeoSchema,
    effort: "medium",
    system: systemPrompt("seo", input.lessons),
    input: [
      block("brief", { title: input.brief.title, primaryKeyword: input.brief.primaryKeyword, secondaryKeywords: input.brief.secondaryKeywords, audience: input.brief.audience }),
      block("article", input.draft),
      block("used_slugs", input.usedSlugs),
      ...(input.previousErrors?.length ? [block("errors_from_previous_attempt", input.previousErrors)] : []),
      "Write the metadata.",
    ].join("\n\n"),
  });
}
