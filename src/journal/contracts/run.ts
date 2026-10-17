import { z } from "zod";

/** Every role in the pipeline. The publisher is code only; the others are model calls. */
export const AGENTS = ["ideator", "strategist", "researcher", "writer", "editor", "seo", "critic", "publisher"] as const;
export type AgentName = (typeof AGENTS)[number];

/** A link the articles may use: a real page on the site, built by code (lib/links.ts). */
export const SiteLinkSchema = z.object({
  href: z.string().regex(/^\/[a-z0-9\-/]*$/i),
  label: z.string().max(120),
  kind: z.enum(["product", "category", "house", "concierge", "collection"]),
});
export type SiteLink = z.infer<typeof SiteLinkSchema>;

/** One of the shop's own photos of a published piece (from the catalogue), offered to the strategist. */
export const SitePhotoSchema = z.object({
  id: z.string().regex(/^P[0-9]{1,3}$/),
  /** The piece, e.g. "Hermès Kelly Dépêches 25". Captions come from here, never from a model. */
  piece: z.string().max(120),
  /** What the photo shows ("front", "in its box"…). */
  alt: z.string().max(200),
  href: z.string(),
  src: z.string(),
  width: z.number(),
  height: z.number(),
});
export type SitePhoto = z.infer<typeof SitePhotoSchema>;

/** A video from a house's official YouTube channel, verified by code (lib/videos.ts). */
export const VideoSchema = z.object({
  id: z.string().regex(/^[\w-]{11}$/),
  title: z.string().max(200),
  channel: z.string().max(80),
  house: z.string().max(40),
});
export type Video = z.infer<typeof VideoSchema>;

/** Photos and videos as saved with an article (journal_posts.media). */
export type Media = ({ type: "photo" } & SitePhoto) | ({ type: "video" } & Video);

/** An article that already exists (published or draft), so ideas and slugs don't repeat. */
export const PastPostSchema = z.object({
  slug: z.string(),
  title: z.string(),
  primaryKeyword: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  publishedAt: z.string().nullable(),
});
export type PastPost = z.infer<typeof PastPostSchema>;

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** One model call or code step, stored for debugging (journal_steps). */
export interface StepRecord {
  agent: AgentName | "search" | "checks";
  /** Writer/editor round (1 = first draft), SEO attempt, …; 1 when not applicable. */
  round: number;
  input: unknown;
  output: unknown;
  usage: Usage | null;
  durationMs: number;
  error: string | null;
}

export type RunStatus = "published" | "draft" | "failed";
