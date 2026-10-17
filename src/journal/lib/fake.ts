import type { Brief } from "../contracts/brief";
import type { IdeaList } from "../contracts/idea";
import type { CriticOutput } from "../contracts/lesson";
import type { QueryPlan, ResearchPack, SearchResult } from "../contracts/research";
import type { Review } from "../contracts/review";
import type { AgentName, SiteLink, Video } from "../contracts/run";
import type { Seo } from "../contracts/seo";
import type { ModelClient, ModelRequest, ModelResponse } from "./llm";
import type { Search } from "./search";

/**
 * Scripted stand-ins for the model and the search, for tests and `--fake` runs: no network, no cost.
 * Each agent answers from its own queue, in order; an answer may be a function of the request.
 */
export type Answer = string | object | ((req: ModelRequest) => string | object);

export class ScriptedClient implements ModelClient {
  readonly calls: ModelRequest[] = [];
  constructor(private readonly script: Partial<Record<AgentName, Answer[]>>) {}

  async complete(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(req);
    const next = this.script[req.agent]?.shift();
    if (next === undefined) throw new Error(`no scripted answer left for ${req.agent}`);
    const value = typeof next === "function" ? next(req) : next;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return { text, usage: { model: "scripted", inputTokens: Math.ceil(req.input.length / 4), outputTokens: Math.ceil(text.length / 4), costUsd: 0.01 } };
  }
}

export class FixedSearch implements Search {
  readonly queries: string[][] = [];
  constructor(
    private readonly results: SearchResult[],
    private readonly found: Video[] = [],
  ) {}
  async run(queries: string[]) {
    this.queries.push(queries);
    return this.results;
  }
  async videos(queries: string[]) {
    this.queries.push(queries);
    return this.found;
  }
}

// ── A complete, consistent demo run (placeholder text, clearly not an article) ─────────

export const demoResults: SearchResult[] = [
  { url: "https://example.com/craft", title: "Example source on craftsmanship", content: "Placeholder content about leather craft.", query: "craft" },
  { url: "https://example.com/care", title: "Example source on care", content: "Placeholder content about caring for leather.", query: "care" },
];

export function demoIdeas(): IdeaList {
  const idea = (n: number, score: number) => ({
    id: `I${n}`,
    title: `Scripted test idea number ${n}`,
    angle: "A placeholder angle used only by scripted test runs.",
    reader: "A test reader",
    primaryKeyword: `scripted test keyword ${n}`,
    category: "bags" as const,
    houses: ["hermes" as const],
    score,
    scoreReason: "Placeholder reason for a scripted score.",
  });
  // Deliberately out of order: ranking is code's job.
  return { ideas: [idea(1, 61), idea(2, 88), idea(3, 74), idea(4, 92), idea(5, 40), idea(6, 55)] };
}

export function demoBrief(links: SiteLink[]): Brief {
  const site = (kind: SiteLink["kind"]) => links.find((l) => l.kind === kind)!.href;
  return {
    chosenIdeaId: "I4",
    choiceReason: "Highest score and no overlap with earlier articles.",
    title: "Scripted test article for the journal pipeline",
    audience: "Nobody: this is a scripted test run.",
    primaryKeyword: "scripted test keyword 4",
    secondaryKeywords: ["scripted test", "pipeline test"],
    outline: ["First section", "Second section", "Third section", "Fourth section", "Fifth section"].map((h2) => ({ h2, goal: "Placeholder goal.", points: ["Placeholder point."] })),
    targetWords: { min: 450, max: 700 },
    cta: { text: "Ask our concierge", href: site("concierge") },
    productLinks: [site("house")],
    avoid: ["Real claims"],
    photos: [],
  };
}

const plan: QueryPlan = { queries: [{ q: "leather craft", why: "craft facts" }, { q: "leather care", why: "care facts" }], videoQueries: [] };

const pack: ResearchPack = {
  facts: [
    { id: "F1", claim: "Placeholder fact from the first source.", sourceUrl: "https://example.com/craft" },
    { id: "F2", claim: "Placeholder fact with an invented source.", sourceUrl: "https://example.com/not-returned" },
  ],
  examples: [{ id: "E1", text: "Placeholder styling example.", sourceUrl: null }],
  readerQuestions: [{ q: "A placeholder question?", basis: "Placeholder basis." }],
  gaps: ["Placeholder gap."],
};

const SENTENCE = "This is placeholder text written for a scripted test run of the journal pipeline.";

export function demoDraft(brief: Brief, opts: { wordsPerSection?: number; withLinks?: boolean; extra?: string } = {}) {
  const per = opts.wordsPerSection ?? 90;
  const para = Array.from({ length: Math.ceil(per / 14) }, () => SENTENCE).join(" ");
  const links = opts.withLinks === false ? "" : ` See [the house page](${brief.productLinks[0]}) and [${brief.cta.text}](${brief.cta.href}).`;
  return [`${para}`, ...brief.outline.map((s) => `## ${s.h2}\n\n${para}`), `${SENTENCE}${links}${opts.extra ?? ""}`].join("\n\n");
}

export function demoReview(verdict: "approve" | "rewrite", each = 17): Review {
  const issue = { id: "R1", severity: "minor" as const, section: "First section", quote: "placeholder text written for a scripted test run", problem: "Placeholder problem.", fix: "Placeholder fix." };
  return { subscores: { briefFit: each, accuracy: each, fluency: each, voice: each, conversion: each }, issues: verdict === "approve" ? [] : [issue], verdict };
}

export const demoSeo: Seo = {
  slug: "scripted-test-article",
  metaTitle: "Scripted test article for the journal",
  metaDescription: "A scripted test article used to check the journal pipeline end to end, with no model and no network involved in producing it at all.",
  summary: "A scripted test article. It checks the pipeline end to end without a model.",
  keywords: ["scripted test", "pipeline test", "journal test"],
  faq: [
    { q: "Is this a real article?", a: "No, it is scripted test text." },
    { q: "Does it cost anything?", a: "No, no model is called." },
    { q: "Where is it stored?", a: "In a local file only." },
  ],
};

export const demoCritic: CriticOutput = {
  wentWell: ["The scripted run completed."],
  wentBadly: ["Nothing real was tested."],
  lessons: [{ agent: "writer", rule: "Name the piece in the first sentence of every section.", evidence: "Scripted evidence." }],
};

/** A whole run that is approved on the second draft. */
export function demoScript(links: SiteLink[]): Partial<Record<AgentName, Answer[]>> {
  const brief = demoBrief(links);
  return {
    ideator: [demoIdeas()],
    strategist: [brief],
    // The pack cites one url the search never returned: asked once more, then code drops that fact.
    researcher: [plan, pack, pack],
    writer: [demoDraft(brief), demoDraft(brief)],
    editor: [demoReview("rewrite", 14), demoReview("approve", 17)],
    seo: [demoSeo],
    critic: [demoCritic],
  };
}
