import { z } from "zod";
import { MAX_AVG_SENTENCE_WORDS, MAX_SENTENCE_WORDS, MAX_VIDEOS, QUALITY_THRESHOLD } from "../config";
import { BriefSchema } from "./brief";
import { ResearchPackSchema } from "./research";
import { SitePhotoSchema, VideoSchema } from "./run";

// ── Code checks on a draft (lib/checks.ts), shown to the editor and the writer ─────────

export const DraftChecksSchema = z.object({
  words: z.number(),
  wordRange: z.object({ min: z.number(), max: z.number() }),
  missingSections: z.array(z.string()),
  links: z.array(z.object({ text: z.string(), href: z.string(), kind: z.enum(["site", "source", "unknown"]) })),
  ctaFound: z.boolean(),
  productLinkFound: z.boolean(),
  unsourcedNumbers: z.array(z.string()),
  /** Readability: average words per sentence, and the opening words of sentences that are too long. */
  avgSentenceWords: z.number(),
  longSentences: z.array(z.string()),
  /** Photos and videos placed in the article (`![…](photo:P1)`, `![…](video:ID)`). */
  photosUsed: z.array(z.string()),
  videosUsed: z.array(z.string()),
  /** Media references that aren't in the brief's photos or the verified videos. */
  unknownMedia: z.array(z.string()),
  /** Photos the brief chose that the article doesn't show. */
  missingPhotos: z.array(z.string()),
});
export type DraftChecks = z.infer<typeof DraftChecksSchema>;

/** Failures that block publishing whatever the editor says; each one goes to the writer as an issue. */
export function draftProblems(c: DraftChecks): string[] {
  const out: string[] = [];
  if (c.words < c.wordRange.min || c.words > c.wordRange.max) out.push(`Length is ${c.words} words; it must be between ${c.wordRange.min} and ${c.wordRange.max}.`);
  for (const h of c.missingSections) out.push(`The section "${h}" from the brief is missing (use the heading exactly as written).`);
  for (const l of c.links.filter((l) => l.kind === "unknown")) out.push(`The link "${l.href}" is not a page on the site or a research source; remove it or use one from the list.`);
  if (!c.ctaFound) out.push("The call to action from the brief (its exact href) is missing.");
  if (!c.productLinkFound) out.push("There is no link to a product, category or house page.");
  for (const n of c.unsourcedNumbers) out.push(`The number "${n}" does not appear in the research or the brief; remove it or use a sourced figure.`);
  if (c.avgSentenceWords > MAX_AVG_SENTENCE_WORDS) out.push(`Sentences average ${c.avgSentenceWords} words; keep them short and simple (at most ${MAX_AVG_SENTENCE_WORDS} on average).`);
  for (const s of c.longSentences) out.push(`The sentence starting "${s}…" is longer than ${MAX_SENTENCE_WORDS} words; split it.`);
  for (const m of c.unknownMedia) out.push(`"${m}" is not one of the photos or videos you were given; use only those.`);
  for (const id of c.missingPhotos) out.push(`The photo ${id} from the brief is missing; place it on its own line as ![…](photo:${id}).`);
  if (c.videosUsed.length > MAX_VIDEOS) out.push(`Use at most ${MAX_VIDEOS} video.`);
  return out;
}

// ── Writer: input (output is free Markdown) ─────────────────────────────────────────

export const IssueSchema = z.object({
  id: z.string().regex(/^[RC][0-9]{1,2}$/).describe('"R1", "R2", …'),
  severity: z.enum(["blocker", "major", "minor"]),
  section: z.string().max(120).describe("The heading of the section, or \"Introduction\""),
  quote: z.string().min(3).max(200).describe("Words copied exactly from the draft, showing where the problem is"),
  problem: z.string().min(5).max(400),
  fix: z.string().min(5).max(400).describe("What the writer should change, concretely"),
});
export type Issue = z.infer<typeof IssueSchema>;

export const WriterInputSchema = z.object({
  brief: BriefSchema,
  research: ResearchPackSchema,
  /** Rounds 2 and 3: the previous draft and exactly what to fix. */
  previousDraft: z.string().optional(),
  issues: z.array(IssueSchema).optional(),
  /** The photos the brief chose (details) and the verified videos the writer may embed (at most one). */
  photos: z.array(SitePhotoSchema).default([]),
  videos: z.array(VideoSchema).default([]),
  lessons: z.array(z.string()).default([]),
});
export type WriterInput = z.infer<typeof WriterInputSchema>;

// ── Editor: input and output ────────────────────────────────────────────────────────

export const EditorInputSchema = z.object({
  brief: BriefSchema,
  research: ResearchPackSchema,
  draft: z.string().min(1),
  checks: DraftChecksSchema,
  lessons: z.array(z.string()).default([]),
});
export type EditorInput = z.infer<typeof EditorInputSchema>;

const part = z.number().int().min(0).max(20);

export const ReviewSchema = z.object({
  subscores: z.object({
    briefFit: part.describe("Follows the brief: audience, headings, length, keyword"),
    accuracy: part.describe("Every fact and number comes from the research; no invented claims; brand rules kept"),
    fluency: part.describe("Natural, polished English; easy to read"),
    voice: part.describe("SEVN HEVN's voice: the pleasure of choosing, memories of past purchases, personal style"),
    conversion: part.describe("Builds trust; product links and the call to action are clear and well placed"),
  }),
  issues: z.array(IssueSchema).max(15),
  verdict: z.enum(["approve", "rewrite"]),
});
export type Review = z.infer<typeof ReviewSchema>;

/** Text compared without Markdown, quote styles, case or spacing, so a fair quote is recognised. */
export function plain(s: string) {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface ScoredReview extends Review {
  /** Computed by code from the subscores, so the total can never contradict them. */
  score: number;
  /** Issues whose quote is not in the draft (not specific enough to act on). */
  invalidIssues: Issue[];
  /** Code's reading of the verdict: approve only with score >= threshold and no blocker. */
  approved: boolean;
  /** The editor said "approve" but code did not accept it. */
  verdictOverridden: boolean;
}

export function scoreReview(review: Review, draft: string): ScoredReview {
  const s = review.subscores;
  const score = s.briefFit + s.accuracy + s.fluency + s.voice + s.conversion;
  const text = plain(draft);
  const issues = review.issues.filter((i) => text.includes(plain(i.quote)));
  const invalidIssues = review.issues.filter((i) => !text.includes(plain(i.quote)));
  const approved = review.verdict === "approve" && score >= QUALITY_THRESHOLD && !issues.some((i) => i.severity === "blocker");
  return { ...review, issues, score, invalidIssues, approved, verdictOverridden: review.verdict === "approve" && !approved };
}
