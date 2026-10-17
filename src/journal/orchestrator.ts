import { MAX_REWRITES, MIN_VALID_IDEAS, SEO_ATTEMPTS, TOP_IDEAS } from "./config";
import { critic } from "./agents/critic";
import { editor } from "./agents/editor";
import { ideator } from "./agents/ideator";
import { publisher } from "./agents/publisher";
import { extractResearch, planSearch } from "./agents/researcher";
import { seo as seoAgent } from "./agents/seo";
import { strategist } from "./agents/strategist";
import { writer } from "./agents/writer";
import type { Brief } from "./contracts/brief";
import { rankIdeas } from "./contracts/idea";
import type { RunReport } from "./contracts/lesson";
import type { PostRecord } from "./contracts/publish";
import { keepSourced, type ResearchPack, type SearchResult } from "./contracts/research";
import { draftProblems, type DraftChecks, type Issue, type ScoredReview } from "./contracts/review";
import { seoProblems, slugProblems, type Seo } from "./contracts/seo";
import type { Media, RunStatus, SiteLink, SitePhoto, StepRecord, Usage, Video } from "./contracts/run";
import { checkDraft } from "./lib/checks";
import { lessonsFor, planLessons } from "./lib/lessons";
import { CostCapError, StepError, type Llm } from "./lib/llm";
import type { Search } from "./lib/search";
import type { Store } from "./lib/store";

/**
 * The pipeline, in plain code: order, conditions and loops are here and nowhere else.
 * No agent decides what runs next. Every step's input and output is stored (journal_steps).
 *
 *   ideator → rank (code) → strategist → researcher.plan → search (code) → researcher.extract
 *   → sources check (code) → writer ⇄ editor (≤ MAX_REWRITES rewrites; code checks each draft)
 *   → seo (≤ SEO_ATTEMPTS; lengths counted by code) → publisher (code) → save → critic → lessons (code)
 */

export interface Deps {
  llm: Llm;
  search: Search;
  store: Store;
  links: SiteLink[];
  /** The shop's own photos of published pieces, and the pieces themselves (lib/links.ts). */
  photos?: SitePhoto[];
  pieces?: string[];
  /** ISO date of the run. */
  today: string;
  autoPublish: boolean;
  log?: (line: string) => void;
}

export interface RunSummary {
  runId: string;
  status: RunStatus;
  postId: string | null;
  slug: string | null;
  title: string | null;
  score: number | null;
  rewrites: number;
  costUsd: number;
  reasons: string[];
  error: string | null;
}

/** The gate between editor and writer: the editor approves (score and blockers checked by code) and every code check passes. */
export function passesGate(review: ScoredReview, checks: DraftChecks) {
  return review.approved && draftProblems(checks).length === 0;
}

/** What the writer receives for a rewrite: the editor's issues plus every failed code check. */
export function issuesForRewrite(review: ScoredReview, checks: DraftChecks): Issue[] {
  const code = draftProblems(checks).map((problem, i) => ({
    id: `C${i + 1}`,
    severity: "blocker" as const,
    section: "(code check)",
    quote: "(whole article)",
    problem,
    fix: "Fix exactly this; code checks it again.",
  }));
  return [...review.issues, ...code];
}

/** A draft whose slug failed still needs a unique address; the person reviewing it can change it. */
export function fallbackSlug(runId: string) {
  return `draft-${runId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`;
}

type StepOut<T> = { value: T; usage: Usage | null; remaining?: string[] };

export async function runPipeline(deps: Deps): Promise<RunSummary> {
  const { llm, store, log = () => {} } = deps;
  const runId = await store.startRun();
  log(`run ${runId} started`);

  const { pastPosts, lessons } = await store.context();
  const lessonsOf = (a: Parameters<typeof lessonsFor>[0]) => lessonsFor(a, lessons);
  const usedSlugs = pastPosts.map((p) => p.slug);
  const report: RunReport = {
    outcome: "failed", reasons: [], ideas: [], droppedIdeas: [], chosen: null, research: null, rounds: [], seo: null,
    contractRetries: {}, error: null, costUsd: 0,
  };

  /** Runs one step and stores its input, output, cost and time, whether it succeeds or fails. */
  async function step<C extends StepOut<unknown>>(agent: StepRecord["agent"], round: number, input: unknown, fn: () => Promise<C>): Promise<C> {
    const t = Date.now();
    try {
      const c = await fn();
      const remaining = c.remaining ?? [];
      await store.saveStep(runId, {
        agent, round, input, output: c.value, usage: c.usage, durationMs: Date.now() - t,
        error: remaining.length ? `accepted with ${remaining.length} problem(s): ${remaining.join("; ").slice(0, 900)}` : null,
      });
      return c;
    } catch (e) {
      await store.saveStep(runId, { agent, round, input, output: null, usage: e instanceof StepError ? e.usage : null, durationMs: Date.now() - t, error: e instanceof Error ? e.message.slice(0, 1000) : "failed" });
      throw e;
    }
  }
  /** Code-only steps (no model) are stored the same way. */
  async function codeStep<T>(agent: StepRecord["agent"], round: number, input: unknown, fn: () => T | Promise<T>): Promise<T> {
    return (await step(agent, round, input, async () => ({ value: await fn(), usage: null }))).value;
  }

  let brief: Brief | null = null;
  let research: ResearchPack | null = null;
  let results: SearchResult[] = [];
  let videos: Video[] = [];
  const photos = deps.photos ?? [];
  // The latest draft, and its review only while it belongs to that draft.
  let draft: string | null = null;
  let review: ScoredReview | null = null;
  let seo: Seo | null = null;
  let seoErrors: string[] | null = null;
  let rewrites = 0;
  let status: RunStatus = "failed";
  let reasons: string[] = [];
  let error: string | null = null;
  let costCapped = false;

  try {
    // 1. Ideas, ranked by code.
    const ideaInput = { today: deps.today, pastPosts, pieces: deps.pieces ?? [], lessons: lessonsOf("ideator") };
    const ideas = await step("ideator", 1, ideaInput, () => ideator(ideaInput, { llm }));
    const { ranked, dropped } = await codeStep("checks", 1, { check: "rank ideas" }, () => rankIdeas(ideas.value.ideas, pastPosts));
    report.ideas = ranked.map((i) => ({ id: i.id, title: i.title, score: i.score }));
    report.droppedIdeas = dropped;
    if (ranked.length < MIN_VALID_IDEAS) throw new StepError("ideator", `only ${ranked.length} valid ideas (need ${MIN_VALID_IDEAS})`);
    log(`ideas: ${ranked.map((i) => `${i.id}=${i.score}`).join(", ")}`);

    // 2. Brief from one of the top ideas.
    const stratInput = { topIdeas: ranked.slice(0, TOP_IDEAS), pastPosts, links: deps.links, photos, lessons: lessonsOf("strategist") };
    const b = (await step("strategist", 1, stratInput, () => strategist(stratInput, { llm }))).value;
    brief = b;
    report.chosen = { id: b.chosenIdeaId, title: b.title, reason: b.choiceReason };
    log(`brief: "${b.title}" (${b.chosenIdeaId})`);

    // 3. Research: the model plans, code searches, the model extracts, code checks sources.
    const resInput = { brief: b, lessons: lessonsOf("researcher") };
    const plan = (await step("researcher", 1, resInput, () => planSearch(resInput, { llm }))).value;
    const queries = plan.queries.map((q) => q.q);
    results = await codeStep("search", 1, { queries }, () => deps.search.run(queries));
    // Videos: only from the houses' official YouTube channels, verified by code (lib/videos.ts).
    if (plan.videoQueries.length) {
      const vq = plan.videoQueries;
      videos = await codeStep("search", 2, { videoQueries: vq }, () => deps.search.videos(vq)).catch(() => []);
    }
    const extracted = await step("researcher", 2, { brief: b, results: results.length }, () => extractResearch({ brief: b, results, lessons: resInput.lessons }, { llm }));
    const sourced = await codeStep("checks", 2, { check: "research sources" }, () => keepSourced(extracted.value, results));
    const pack = sourced.pack;
    research = pack;
    report.research = { queries: queries.length, results: results.length, facts: pack.facts.length, droppedSources: sourced.dropped.length, gaps: pack.gaps };
    log(`research: ${results.length} results, ${pack.facts.length} facts (${sourced.dropped.length} dropped), ${videos.length} official video(s)`);

    // 4. Write, check, review; rewrite while the gate isn't passed, at most MAX_REWRITES times.
    const year = deps.today.slice(0, 4);
    const chosenPhotos = b.photos.map((id) => photos.find((p) => p.id === id)!).filter(Boolean);
    const wInput = { brief: b, research: pack, photos: chosenPhotos, videos, lessons: lessonsOf("writer") };
    const editorLessons = lessonsOf("editor");
    const write = async (round: number, previous?: { draft: string; issues: Issue[] }) => {
      const input = previous ? { ...wInput, previousDraft: previous.draft, issues: previous.issues } : wInput;
      draft = (await step("writer", round, input, () => writer(input, { llm }))).value;
      review = null;
      const d = draft;
      const c = await codeStep("checks", round, { check: "draft" }, () => checkDraft(d, b, pack, deps.links, [year], videos.map((v) => v.id)));
      const eInput = { brief: b, research: pack, draft: d, checks: c, lessons: editorLessons };
      const r = (await step("editor", round, eInput, () => editor(eInput, { llm }))).scored;
      review = r;
      report.rounds.push({
        round, words: c.words, codeProblems: draftProblems(c), score: r.score, subscores: r.subscores, verdict: r.verdict,
        verdictOverridden: r.verdictOverridden, issues: r.issues.map((i) => ({ severity: i.severity, section: i.section, problem: i.problem })), invalidIssues: r.invalidIssues.length,
      });
      log(`round ${round}: ${c.words} words, score ${r.score}, ${r.verdict}${r.verdictOverridden ? " (not accepted by code)" : ""}, ${draftProblems(c).length} code problem(s)`);
      return { draft: d, checks: c, review: r };
    };

    let round = 1;
    let cur = await write(round);
    while (!passesGate(cur.review, cur.checks) && rewrites < MAX_REWRITES) {
      rewrites++;
      round++;
      cur = await write(round, { draft: cur.draft, issues: issuesForRewrite(cur.review, cur.checks) });
    }

    // 5. SEO metadata, validated by code; one more try with the exact errors.
    report.seo = { attempts: 0, errors: [] };
    for (let attempt = 1; attempt <= SEO_ATTEMPTS; attempt++) {
      const input = { brief: b, draft: cur.draft, usedSlugs, previousErrors: seoErrors ?? undefined, lessons: lessonsOf("seo") };
      seo = (await step("seo", attempt, input, () => seoAgent(input, { llm }))).value;
      seoErrors = seoProblems(seo, usedSlugs);
      report.seo = { attempts: attempt, errors: seoErrors };
      if (!seoErrors.length) break;
    }

    // 6. Publish or keep as a draft (code only).
    const decision = await codeStep("publisher", 1, { score: cur.review.score, verdict: cur.review.verdict, seoErrors, autoPublish: deps.autoPublish }, () =>
      publisher({ review: cur.review, checks: cur.checks, seoErrors, autoPublish: deps.autoPublish }),
    );
    status = decision.decision;
    reasons = decision.reasons;
  } catch (e) {
    costCapped = e instanceof CostCapError;
    error = e instanceof Error ? e.message : "run failed";
    status = "failed";
    reasons = [error];
    log(`failed: ${error}`);
  }

  // Save the article whenever one was written, so nothing paid for is lost; after a failure it is a draft.
  let post: PostRecord | null = null;
  let postId: string | null = null;
  if (brief && draft) {
    post = postRecord({ runId, status: status === "published" ? "published" : "draft", brief, draft, review, seo, usedSlugs, reasons, research, results, photos, videos });
    try {
      postId = await store.savePost(runId, post);
    } catch (e) {
      status = "failed";
      error = `saving the article failed: ${e instanceof Error ? e.message : ""}`;
      reasons = [error];
      post = null;
    }
  }

  // 7. Critic and lessons. A critic failure never changes the outcome; a run stopped by the cost cap skips it.
  Object.assign(report, { outcome: status, reasons, error, contractRetries: { ...llm.ledger.retries }, costUsd: Number(llm.ledger.total.toFixed(4)) });
  let criticSummary: { wentWell: string[]; wentBadly: string[] } | null = null;
  if (!costCapped) {
    try {
      const input = {
        report,
        activeLessons: lessons.filter((l) => l.status === "active").map((l) => ({ agent: l.agent, rule: l.rule })),
        deletedLessons: lessons.filter((l) => l.status === "deleted").map((l) => ({ agent: l.agent, rule: l.rule })),
      };
      const c = await step("critic", 1, input, () => critic(input, { llm }));
      criticSummary = { wentWell: c.value.wentWell, wentBadly: c.value.wentBadly };
      const plan = await codeStep("checks", 99, { check: "lessons" }, () => planLessons(c.value.lessons, lessons));
      if (plan.add.length || plan.retire.length) await store.applyLessons(runId, plan.add, plan.retire);
      log(`lessons: ${plan.add.length} added, ${plan.retire.length} retired, ${plan.rejected.length} rejected`);
    } catch (e) {
      log(e instanceof CostCapError ? "critic skipped: cost cap" : `critic failed: ${e instanceof Error ? e.message : ""}`);
    }
  }

  const costUsd = llm.ledger.total;
  await store.finishRun(runId, { status, score: post?.score ?? null, rewrites, costUsd, error, postId, critic: criticSummary });
  log(`run ${runId} finished: ${status}, cost $${costUsd.toFixed(2)}`);
  return { runId, status, postId, slug: post?.slug ?? null, title: brief?.title ?? null, score: post?.score ?? null, rewrites, costUsd, reasons, error };
}

function postRecord(a: {
  runId: string;
  status: "published" | "draft";
  brief: Brief;
  draft: string;
  review: ScoredReview | null;
  seo: Seo | null;
  usedSlugs: string[];
  reasons: string[];
  research: ResearchPack | null;
  results: SearchResult[];
  photos: SitePhoto[];
  videos: Video[];
}): PostRecord {
  const titles = new Map(a.results.map((r) => [r.url, r.title]));
  const urls = new Set([...(a.research?.facts.map((f) => f.sourceUrl) ?? []), ...(a.research?.examples.flatMap((e) => (e.sourceUrl ? [e.sourceUrl] : [])) ?? [])]);
  return {
    status: a.status,
    title: a.brief.title,
    slug: a.seo && !slugProblems(a.seo.slug, a.usedSlugs).length ? a.seo.slug : fallbackSlug(a.runId),
    bodyMd: a.draft,
    metaTitle: a.seo?.metaTitle ?? null,
    metaDescription: a.seo?.metaDescription ?? null,
    summary: a.seo?.summary ?? null,
    keywords: a.seo?.keywords ?? [a.brief.primaryKeyword, ...a.brief.secondaryKeywords],
    faq: a.seo?.faq ?? [],
    primaryKeyword: a.brief.primaryKeyword,
    score: a.review?.score ?? 0,
    subscores: a.review?.subscores ?? {},
    issues: a.review?.issues ?? [],
    reasons: a.reasons,
    cta: a.brief.cta,
    sources: [...urls].map((url) => ({ url, title: titles.get(url) ?? url })),
    media: mediaOf(a.draft, a.photos, a.videos),
  };
}

/** The photos and videos the article actually shows, with everything the page needs to render them. */
export function mediaOf(md: string, photos: SitePhoto[], videos: Video[]): Media[] {
  const out: Media[] = [];
  for (const ref of new Set([...md.matchAll(/!\[[^\]\n]*\]\(((?:photo|video):[\w-]+)\)/g)].map((m) => m[1]))) {
    const [kind, id] = ref.split(":");
    const found = kind === "photo" ? photos.find((p) => p.id === id) : videos.find((v) => v.id === id);
    if (found) out.push(kind === "photo" ? { type: "photo", ...(found as SitePhoto) } : { type: "video", ...(found as Video) });
  }
  return out;
}
