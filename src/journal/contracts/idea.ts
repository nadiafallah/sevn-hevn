import { z } from "zod";
import { brandAllowedIn, brandById, brands, type BrandId } from "@/data/brands";
import { isCategoryId } from "@/data/taxonomy";
import { IDEAS_REQUESTED } from "../config";
import { PastPostSchema } from "./run";

const brandIds = brands.map((b) => b.id) as [BrandId, ...BrandId[]];

// ── Ideator: input ──────────────────────────────────────────────────────────────────

export const IdeatorInputSchema = z.object({
  /** ISO date of the run, e.g. "2026-10-19" (season and occasions). */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pastPosts: z.array(PastPostSchema),
  /** Pieces published in the shop right now, e.g. "Hermès Kelly Dépêches 25 (bags)". */
  pieces: z.array(z.string()).default([]),
  lessons: z.array(z.string()).default([]),
});
export type IdeatorInput = z.infer<typeof IdeatorInputSchema>;

// ── Ideator: output ─────────────────────────────────────────────────────────────────

export const IdeaSchema = z.object({
  id: z.string().regex(/^I[0-9]{1,2}$/).describe('"I1", "I2", …'),
  title: z.string().min(10).max(90).describe("Working title, English"),
  angle: z.string().min(10).max(600).describe("What the article says that others don't (one or two sentences)"),
  reader: z.string().min(5).max(400).describe("Who it is for, concretely (one sentence)"),
  primaryKeyword: z.string().min(2).max(60).describe("The search phrase the article should rank for"),
  category: z.enum(["bags", "shoes", "watches", "jewellery", "mixed"]),
  houses: z.array(z.enum(brandIds)).max(4).describe("Permitted houses only; empty if none"),
  score: z.number().int().min(0).max(100),
  scoreReason: z.string().min(10).max(800).describe("Why this score: reader value, buying intent, fit with SEVN HEVN, freshness (two or three sentences)"),
});
export type Idea = z.infer<typeof IdeaSchema>;

export const IdeaListSchema = z.object({ ideas: z.array(IdeaSchema).min(1).max(IDEAS_REQUESTED + 2) });
export type IdeaList = z.infer<typeof IdeaListSchema>;

/** Code rule: a house must be permitted for the idea's category (e.g. never Cartier for watches). */
export function ideaProblems(idea: Idea): string[] {
  const out: string[] = [];
  if (isCategoryId(idea.category)) {
    for (const h of idea.houses) {
      if (!brandAllowedIn(idea.category, brandById[h].name)) out.push(`${brandById[h].name} is not offered in ${idea.category}`);
    }
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Valid ideas, best first. Sorting is done here, never by the order the model returned:
 * by score (high to low), then by id so equal scores keep a stable order.
 * Dropped: duplicate ids, houses outside the category's list, and ideas whose keyword or title
 * repeats an existing article.
 */
export function rankIdeas(ideas: Idea[], pastPosts: { title: string; primaryKeyword: string }[]) {
  const usedKeywords = new Set(pastPosts.map((p) => norm(p.primaryKeyword)));
  const usedTitles = new Set(pastPosts.map((p) => norm(p.title)));
  const seen = new Set<string>();
  const kept: Idea[] = [];
  const dropped: { id: string; reason: string }[] = [];
  for (const idea of ideas) {
    const problems = ideaProblems(idea);
    if (seen.has(idea.id)) dropped.push({ id: idea.id, reason: "duplicate id" });
    else if (problems.length) dropped.push({ id: idea.id, reason: problems.join("; ") });
    else if (usedKeywords.has(norm(idea.primaryKeyword))) dropped.push({ id: idea.id, reason: "keyword already used by an earlier article" });
    else if (usedTitles.has(norm(idea.title))) dropped.push({ id: idea.id, reason: "title already used by an earlier article" });
    else kept.push(idea);
    seen.add(idea.id);
  }
  kept.sort((a, b) => b.score - a.score || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  return { ranked: kept, dropped };
}
