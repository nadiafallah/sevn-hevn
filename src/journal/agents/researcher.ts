import type { Brief } from "../contracts/brief";
import { QueryPlanSchema, ResearchPackSchema, type ResearcherInput, type SearchResult } from "../contracts/research";
import type { Llm } from "../lib/llm";
import { block, systemPrompt } from "../lib/prompts";

/** Researcher, step 1: the model writes the search queries (code runs them, lib/search.ts). */
export function planSearch(input: ResearcherInput, deps: { llm: Llm }) {
  return deps.llm.structured({
    agent: "researcher",
    schema: QueryPlanSchema,
    effort: "low",
    system: systemPrompt("researcher", input.lessons),
    input: [block("brief", input.brief), "Step 1: write the search plan."].join("\n\n"),
  });
}

/** Researcher, step 2: facts, examples and reader questions from the results. Sources are checked by code. */
export function extractResearch(input: { brief: Brief; results: SearchResult[]; lessons: string[] }, deps: { llm: Llm }) {
  const urls = new Set(input.results.map((r) => r.url));
  return deps.llm.structured({
    agent: "researcher",
    schema: ResearchPackSchema,
    effort: "medium",
    system: systemPrompt("researcher", input.lessons),
    input: [
      block("brief", input.brief),
      block("search_results", input.results.map((r) => ({ url: r.url, title: r.title, content: r.content }))),
      "Step 2: write the research pack from these results.",
    ].join("\n\n"),
    // An unknown url is a contract problem once (the model gets to fix it); what remains is dropped by code.
    check: (pack) => [...pack.facts, ...pack.examples].filter((x) => x.sourceUrl !== null && !urls.has(x.sourceUrl)).map((x) => `${x.id}: sourceUrl "${x.sourceUrl}" is not one of the search result urls`),
    onRemaining: "accept",
  });
}
