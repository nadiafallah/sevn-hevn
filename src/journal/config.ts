/**
 * The journal pipeline's fixed rules. Everything that decides *whether* something happens lives
 * here and in code, never in a model's hands: the quality threshold, the rewrite cap, the lesson
 * caps, the metadata limits and the cost cap.
 */

/** An article must reach this editor score (0–100) to be published automatically. */
export const QUALITY_THRESHOLD = 75;

/** Rewrites after the first draft: at most 3 drafts and 3 editor reviews per run. */
export const MAX_REWRITES = 2;

/** The ideator is asked for this many ideas; the strategist chooses among the best TOP_IDEAS. */
export const IDEAS_REQUESTED = 6;
export const MIN_VALID_IDEAS = 3;
export const TOP_IDEAS = 3;

/** Allowed range for the brief's target length (words). Owner, Oct 2026: short and easy to read. */
export const WORDS = { min: 450, max: 750 } as const;
/** Sections (H2) per article. */
export const SECTIONS = { min: 3, max: 5 } as const;
/** Readability, counted by code: average sentence length, and the longest sentence allowed. */
export const MAX_AVG_SENTENCE_WORDS = 20;
export const MAX_SENTENCE_WORDS = 35;

/** Photos: only the shop's own photos of published pieces (never other websites' images). */
export const MAX_PHOTOS = 3;
/** Videos: at most one, embedded from a house's official YouTube channel, checked by code. */
export const MAX_VIDEOS = 1;
/**
 * The houses' official YouTube channels (checked 17 Oct 2026 with YouTube's oEmbed `author_url`).
 * A video is offered to the writer only if YouTube says it belongs to one of these channels and
 * allows embedding.
 */
export const OFFICIAL_CHANNELS: Record<string, string> = {
  "https://www.youtube.com/@hermes": "Hermès",
  "https://www.youtube.com/@chanel": "Chanel",
  "https://www.youtube.com/@louisvuitton": "Louis Vuitton",
  "https://www.youtube.com/@gucci": "Gucci",
  "https://www.youtube.com/@cartier": "Cartier",
  "https://www.youtube.com/@vancleefarpels": "Van Cleef & Arpels",
  "https://www.youtube.com/@bvlgariofficial": "Bvlgari",
};
/** How far a draft may stray from the brief's target before the check fails. */
export const WORD_TOLERANCE = 0.1;

/** SEO metadata limits (counted in characters by code). */
export const META_TITLE = { min: 30, max: 60 } as const;
export const META_DESCRIPTION = { min: 120, max: 160 } as const;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 70;
/** The SEO agent gets one more try with the exact errors; after that the article stays a draft. */
export const SEO_ATTEMPTS = 2;

/** Research. */
export const MAX_SEARCH_QUERIES = 6;
export const RESULTS_PER_QUERY = 5;

/** Self-improvement: lessons the critic may add per run, and active lessons kept per agent. */
export const LESSONS_PER_RUN = 3;
export const ACTIVE_LESSONS_PER_AGENT = 5;

/** A run that has spent more than this (US dollars, model usage) stops and publishes nothing. */
export const MAX_RUN_COST_USD = 1;

/**
 * How often an article is written. The weekly job runs every Monday; code skips the run when the
 * last article is more recent than this. Owner decision (Oct 2026): every 14 days for the first two
 * months, to keep costs down while the site grows; then 7 (set JOURNAL_EVERY_DAYS=7).
 */
export const EVERY_DAYS = 14;

/** Whether an article is due: none yet, or the last one is at least EVERY_DAYS old (a day's slack for run times). */
export function isDue(lastPostAt: string | null, now: Date, everyDays = EVERY_DAYS) {
  if (!lastPostAt) return true;
  return (now.getTime() - new Date(lastPostAt).getTime()) / 86_400_000 >= everyDays - 1;
}

/** A model output that fails its contract is asked for once more, with the exact errors. */
export const CONTRACT_RETRIES = 1;

export const DEFAULT_MODEL = "claude-opus-5-5";

/**
 * Model per agent (owner decision, Oct 2026: the low-cost mix). Writing and judging use Claude
 * Sonnet 5.5; the shorter structured jobs use Claude Haiku 5.5 ($0.10 / $0.50 per million tokens).
 * JOURNAL_MODEL=<id> runs every agent on one model instead (e.g. claude-opus-5-5 for the highest quality).
 */
export const MODELS = {
  ideator: "claude-haiku-5-5",
  strategist: "claude-haiku-5-5",
  researcher: "claude-haiku-5-5",
  writer: "claude-sonnet-5-5",
  editor: "claude-sonnet-5-5",
  seo: "claude-haiku-5-5",
  critic: "claude-haiku-5-5",
} as const;

export function modelFor(agent: string, forced?: string) {
  return forced ?? (MODELS as Record<string, string>)[agent] ?? DEFAULT_MODEL;
}

/** Price per million tokens (input, output), for the run's cost ledger. Unknown models use the highest row. */
export const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  // Prompts up to 100,000 tokens (every journal prompt is far shorter).
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};
