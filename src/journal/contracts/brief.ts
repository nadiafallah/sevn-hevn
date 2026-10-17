import { z } from "zod";
import { MAX_PHOTOS, SECTIONS, WORDS } from "../config";
import { IdeaSchema } from "./idea";
import { PastPostSchema, SiteLinkSchema, SitePhotoSchema, type SiteLink, type SitePhoto } from "./run";

// ── Strategist: input ───────────────────────────────────────────────────────────────

export const StrategistInputSchema = z.object({
  /** The best ideas, already sorted by code (best first). */
  topIdeas: z.array(IdeaSchema).min(1),
  pastPosts: z.array(PastPostSchema),
  /** Real pages on the site the article may link to. */
  links: z.array(SiteLinkSchema).min(1),
  /** The shop's own photos of published pieces (may be empty). */
  photos: z.array(SitePhotoSchema).default([]),
  lessons: z.array(z.string()).default([]),
});
export type StrategistInput = z.infer<typeof StrategistInputSchema>;

// ── Strategist: output (the brief) ──────────────────────────────────────────────────

export const BriefSchema = z.object({
  chosenIdeaId: z.string().describe("The id of one of the ideas you were given"),
  choiceReason: z.string().min(10).max(400),
  title: z.string().min(10).max(90).describe("Final article title, English"),
  audience: z.string().min(10).max(300),
  primaryKeyword: z.string().min(2).max(60),
  secondaryKeywords: z.array(z.string().min(2).max(60)).min(2).max(6),
  outline: z
    .array(
      z.object({
        h2: z.string().min(3).max(90).describe("Section heading, exactly as it should appear"),
        goal: z.string().min(5).max(200).describe("What this section must achieve for the reader"),
        points: z.array(z.string().min(3).max(200)).min(1).max(6),
      }),
    )
    .min(SECTIONS.min)
    .max(SECTIONS.max),
  targetWords: z.object({ min: z.number().int(), max: z.number().int() }),
  cta: z.object({
    text: z.string().min(3).max(120).describe("The invitation to buy or enquire, in the article's voice"),
    href: z.string().max(200).describe("One href from the list of site links"),
  }),
  productLinks: z.array(z.string().max(200)).min(1).max(4).describe("hrefs from the site links (product, category or house pages)"),
  avoid: z.array(z.string().min(3).max(200)).max(8).describe("Things the writer must not do or say in this article"),
  photos: z.array(z.string()).max(MAX_PHOTOS).describe("Ids of the shop's photos to show (from the photo list); empty only if there are none"),
});
export type Brief = z.infer<typeof BriefSchema>;

/** Contract rules the schema can't express; any error sends the output back to the strategist once. */
export function briefProblems(brief: Brief, ctx: { topIdeaIds: string[]; links: SiteLink[]; photos?: SitePhoto[] }): string[] {
  const out: string[] = [];
  if (!ctx.topIdeaIds.includes(brief.chosenIdeaId)) out.push(`chosenIdeaId "${brief.chosenIdeaId}" is not one of ${ctx.topIdeaIds.join(", ")}`);
  const { min, max } = brief.targetWords;
  if (min < WORDS.min || max > WORDS.max || min >= max) out.push(`targetWords must satisfy ${WORDS.min} <= min < max <= ${WORDS.max} (got ${min}–${max})`);
  const byHref = new Map(ctx.links.map((l) => [l.href, l]));
  if (!byHref.has(brief.cta.href)) out.push(`cta.href "${brief.cta.href}" is not one of the site links`);
  for (const href of brief.productLinks) {
    const link = byHref.get(href);
    if (!link) out.push(`productLinks: "${href}" is not one of the site links`);
    else if (!["product", "category", "house"].includes(link.kind)) out.push(`productLinks: "${href}" is a ${link.kind} page, not a product, category or house page`);
  }
  const photoIds = new Set((ctx.photos ?? []).map((p) => p.id));
  for (const id of brief.photos) if (!photoIds.has(id)) out.push(`photos: "${id}" is not one of the photo ids`);
  if (photoIds.size > 0 && brief.photos.length === 0) out.push("photos: choose at least one of the shop's photos");
  if (new Set(brief.photos).size !== brief.photos.length) out.push("photos: each photo only once");
  const headings = brief.outline.map((s) => s.h2.trim().toLowerCase());
  if (new Set(headings).size !== headings.length) out.push("outline headings must be unique");
  return out;
}
