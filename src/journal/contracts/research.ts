import { z } from "zod";
import { MAX_SEARCH_QUERIES } from "../config";
import { BriefSchema } from "./brief";

// ── Researcher, call 1: search plan ─────────────────────────────────────────────────

export const ResearcherInputSchema = z.object({
  brief: BriefSchema,
  lessons: z.array(z.string()).default([]),
});
export type ResearcherInput = z.infer<typeof ResearcherInputSchema>;

export const QueryPlanSchema = z.object({
  queries: z
    .array(
      z.object({
        q: z.string().min(3).max(200).describe("A web search query, English"),
        why: z.string().min(3).max(400).describe("What this query should find"),
      }),
    )
    .min(1)
    .max(MAX_SEARCH_QUERIES),
  videoQueries: z
    .array(z.string().min(3).max(200))
    .max(2)
    .describe("Up to 2 searches for a short video from the house's own YouTube channel that suits the article; empty if none fits"),
});
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

/** One result returned by the search API (code, not the model). */
export const SearchResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  content: z.string(),
  query: z.string(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

// ── Researcher, call 2: research pack ───────────────────────────────────────────────

export const ResearchPackSchema = z.object({
  facts: z
    .array(
      z.object({
        id: z.string().regex(/^F[0-9]{1,2}$/).describe('"F1", "F2", …'),
        claim: z.string().min(5).max(700).describe("One checkable statement, as the source supports it"),
        sourceUrl: z.string().max(500).describe("The url of the search result that supports it, copied exactly"),
      }),
    )
    .max(20),
  examples: z
    .array(
      z.object({
        id: z.string().regex(/^E[0-9]{1,2}$/),
        text: z.string().min(5).max(700).describe("A concrete, vivid example the writer can use"),
        sourceUrl: z.string().max(500).nullable().describe("Source url, or null for a general styling example with no factual claim"),
      }),
    )
    .max(10),
  readerQuestions: z
    .array(z.object({ q: z.string().min(5).max(300), basis: z.string().min(3).max(600).describe("Why readers ask this (source or reasoning)") }))
    .max(10),
  gaps: z.array(z.string().max(600)).max(10).describe("What the search could not establish; the writer must not claim these"),
});
export type ResearchPack = z.infer<typeof ResearchPackSchema>;

/**
 * Code rule: a fact (or sourced example) is kept only if its url was actually returned by the
 * search. Anything else is dropped and reported, so the writer can't lean on an invented source.
 */
export function keepSourced(pack: ResearchPack, results: SearchResult[]) {
  const urls = new Set(results.map((r) => r.url));
  const dropped: string[] = [];
  const facts = pack.facts.filter((f) => (urls.has(f.sourceUrl) ? true : (dropped.push(f.id), false)));
  const examples = pack.examples.filter((e) => (e.sourceUrl === null || urls.has(e.sourceUrl) ? true : (dropped.push(e.id), false)));
  return { pack: { ...pack, facts, examples }, dropped };
}
