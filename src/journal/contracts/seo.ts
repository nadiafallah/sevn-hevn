import { z } from "zod";
import { META_DESCRIPTION, META_TITLE, SLUG_MAX, SLUG_PATTERN } from "../config";
import { BriefSchema } from "./brief";

export const SeoInputSchema = z.object({
  brief: BriefSchema,
  draft: z.string().min(1),
  usedSlugs: z.array(z.string()),
  /** Second attempt only: the exact problems code found in the first. */
  previousErrors: z.array(z.string()).optional(),
  lessons: z.array(z.string()).default([]),
});
export type SeoInput = z.infer<typeof SeoInputSchema>;

// Lengths here are loose on purpose: the real limits are counted by code (seoProblems), so a
// near miss comes back to the agent as a precise error instead of failing the whole call.
export const SeoSchema = z.object({
  slug: z.string().min(3).max(120).describe(`Lower-case words joined by hyphens, at most ${SLUG_MAX} characters`),
  metaTitle: z.string().min(10).max(120).describe(`${META_TITLE.min}–${META_TITLE.max} characters`),
  metaDescription: z.string().min(50).max(300).describe(`${META_DESCRIPTION.min}–${META_DESCRIPTION.max} characters`),
  summary: z.string().min(40).max(300).describe("Two sentences for the journal index and sharing"),
  keywords: z.array(z.string().min(2).max(60)).min(3).max(8),
  faq: z
    .array(z.object({ q: z.string().min(5).max(160), a: z.string().min(10).max(600).describe("Answer using only what the article says") }))
    .min(3)
    .max(5),
});
export type Seo = z.infer<typeof SeoSchema>;

/** Characters as people count them (an accented "è" is one), not UTF-16 units. */
export const chars = (s: string) => [...s].length;

export function slugProblems(slug: string, usedSlugs: string[]): string[] {
  const out: string[] = [];
  if (!SLUG_PATTERN.test(slug) || slug.length > SLUG_MAX) out.push(`slug "${slug}" must be lower-case letters and digits joined by single hyphens, at most ${SLUG_MAX} characters`);
  if (usedSlugs.includes(slug)) out.push(`slug "${slug}" is already used by another article`);
  return out;
}

export function seoProblems(seo: Seo, usedSlugs: string[]): string[] {
  const out = slugProblems(seo.slug, usedSlugs);
  const t = chars(seo.metaTitle.trim());
  if (t < META_TITLE.min || t > META_TITLE.max) out.push(`metaTitle has ${t} characters; it must have ${META_TITLE.min}–${META_TITLE.max}`);
  const d = chars(seo.metaDescription.trim());
  if (d < META_DESCRIPTION.min || d > META_DESCRIPTION.max) out.push(`metaDescription has ${d} characters; it must have ${META_DESCRIPTION.min}–${META_DESCRIPTION.max}`);
  const kw = seo.keywords.map((k) => k.trim().toLowerCase());
  if (new Set(kw).size !== kw.length) out.push("keywords must not repeat");
  return out;
}
