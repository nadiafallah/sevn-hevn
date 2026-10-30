// The journal pipeline's code rules (no model, no network): run with `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { publisher } from "../src/journal/agents/publisher";
import { ACTIVE_LESSONS_PER_AGENT, EVERY_DAYS, MODELS, OFFICIAL_CHANNELS, QUALITY_THRESHOLD, isDue, modelFor } from "../src/journal/config";
import { briefProblems } from "../src/journal/contracts/brief";
import { rankIdeas, type Idea } from "../src/journal/contracts/idea";
import type { Lesson } from "../src/journal/contracts/lesson";
import { keepSourced } from "../src/journal/contracts/research";
import { draftProblems, scoreReview } from "../src/journal/contracts/review";
import { chars, seoProblems } from "../src/journal/contracts/seo";
import { checkDraft, numbersIn, sitePath, tidyDraft, wordCount } from "../src/journal/lib/checks";
import { demoBrief, demoDraft, demoIdeas, demoReview, demoSeo, ScriptedClient } from "../src/journal/lib/fake";
import { lessonsFor, planLessons } from "../src/journal/lib/lessons";
import { videoId } from "../src/journal/lib/videos";
import { staticLinks } from "../src/journal/lib/links";
import { Ledger, Llm, StepError, CostCapError, costOf } from "../src/journal/lib/llm";
import { systemPrompt } from "../src/journal/lib/prompts";

const links = staticLinks();
const brief = demoBrief(links);
const research = {
  facts: [{ id: "F1", claim: "The house was founded in 1837 and 25% of …", sourceUrl: "https://example.com/a" }],
  examples: [],
  readerQuestions: [],
  gaps: [],
};

test("ideas: sorted by score in code, whatever order the model used; invalid and repeated ideas dropped", () => {
  const { ideas } = demoIdeas();
  const miuMiuWatch: Idea = { ...ideas[0], id: "I7", category: "watches", houses: ["miu-miu"], score: 99 };
  const repeat: Idea = { ...ideas[0], id: "I8", primaryKeyword: "Already Written", score: 98 };
  const { ranked, dropped } = rankIdeas([...ideas, miuMiuWatch, repeat], [{ title: "x", primaryKeyword: "already written" }]);
  assert.deepEqual(ranked.map((i) => i.id), ["I4", "I2", "I3", "I1", "I6", "I5"]);
  assert.deepEqual(dropped.map((d) => d.id), ["I7", "I8"]);
  // Equal scores keep a stable order by id.
  const tie = rankIdeas([{ ...ideas[0], id: "I3", score: 50 }, { ...ideas[0], id: "I1", score: 50 }], []).ranked;
  assert.deepEqual(tie.map((i) => i.id), ["I1", "I3"]);
});

test("brief: chosen idea must be in the top list; every href must be a real page of the right kind", () => {
  assert.deepEqual(briefProblems(brief, { topIdeaIds: ["I4", "I2", "I3"], links }), []);
  const bad = { ...brief, chosenIdeaId: "I5", cta: { ...brief.cta, href: "/made-up" }, productLinks: ["/chat"], targetWords: { min: 500, max: 3000 } };
  const p = briefProblems(bad, { topIdeaIds: ["I4", "I2", "I3"], links });
  assert.equal(p.length, 4);
  assert.match(p.join("\n"), /I5/);
  assert.match(p.join("\n"), /made-up/);
  assert.match(p.join("\n"), /concierge page, not a product/);
});

test("site links: only houses offered in each category (never Miu Miu watches)", () => {
  const hrefs = links.map((l) => l.href);
  assert.ok(hrefs.includes("/bags/hermes"));
  assert.ok(hrefs.includes("/shoes/miu-miu"));
  assert.ok(!hrefs.includes("/watches/miu-miu"));
  assert.ok(hrefs.includes("/chat"));
});

test("research: facts whose url the search never returned are dropped by code", () => {
  const pack = {
    facts: [
      { id: "F1", claim: "Kept.", sourceUrl: "https://a.example/1" },
      { id: "F2", claim: "Invented source.", sourceUrl: "https://b.example/2" },
    ],
    examples: [{ id: "E1", text: "General styling.", sourceUrl: null }, { id: "E2", text: "Bad.", sourceUrl: "https://c.example" }],
    readerQuestions: [],
    gaps: [],
  };
  const r = keepSourced(pack, [{ url: "https://a.example/1", title: "", content: "", query: "" }]);
  assert.deepEqual(r.pack.facts.map((f) => f.id), ["F1"]);
  assert.deepEqual(r.pack.examples.map((e) => e.id), ["E1"]);
  assert.deepEqual(r.dropped, ["F2", "E2"]);
});

test("draft checks: words, sections, links, call to action and numbers are computed, not judged", () => {
  const md = demoDraft(brief);
  const c = checkDraft(md, brief, research, links);
  assert.ok(c.words >= c.wordRange.min && c.words <= c.wordRange.max, `words ${c.words}`);
  assert.ok(c.avgSentenceWords > 5 && c.avgSentenceWords <= 20);
  assert.deepEqual(c.longSentences, []);
  assert.deepEqual(c.missingSections, []);
  assert.ok(c.ctaFound && c.productLinkFound);
  assert.deepEqual(draftProblems(c), []);

  const noLinks = checkDraft(demoDraft(brief, { withLinks: false }), brief, research, links);
  assert.equal(noLinks.ctaFound, false);
  assert.equal(noLinks.productLinkFound, false);

  // Absolute site addresses count as site links; unknown pages and made-up sources don't.
  const mixed = checkDraft(`${md} [a](https://www.sevnhevn.ae/bags/hermes/) [b](/bags/rolex) [c](https://example.com/a) [d](https://evil.example)`, brief, research, links);
  assert.deepEqual(mixed.links.slice(-4).map((l) => l.kind), ["site", "unknown", "source", "unknown"]);

  // 1837 and 25% are in the research; 1921 and 40% are not; 2026 is allowed by the caller; small counts are ignored.
  const nums = checkDraft(`${md} Founded in 1837, 25% of pieces, since 1921, 40% more, in 2026, three or 3 ways.`, brief, research, links, ["2026"]);
  assert.deepEqual(nums.unsourcedNumbers, ["1921", "40%"]);
  assert.equal(draftProblems(nums).length, 2);
});

test("draft checks: helpers", () => {
  assert.equal(wordCount("## Heading\n\nOne [two words](/bags) three — 4."), 6);
  assert.equal(sitePath("https://www.sevnhevn.ae/bags/hermes/?x=1"), "/bags/hermes");
  assert.equal(sitePath("//evil.example"), null);
  assert.deepEqual(numbersIn("12,500 pieces, 7 tips, 3.5%"), ["12500", "3.5%"]);
  assert.equal(tidyDraft("```markdown\n# Title\n\nBody\n```"), "Body");
});

test("editor: the total is computed by code; quotes must be in the draft; approve needs >= threshold and no blocker", () => {
  const md = demoDraft(brief);
  const ok = scoreReview(demoReview("approve", 16), md);
  assert.equal(ok.score, 80);
  assert.equal(ok.approved, true);

  const low = scoreReview(demoReview("approve", 14), md);
  assert.equal(low.score, 70);
  assert.ok(low.score < QUALITY_THRESHOLD);
  assert.equal(low.approved, false);
  assert.equal(low.verdictOverridden, true);

  const r = demoReview("rewrite", 18);
  const blocker = scoreReview({ ...r, verdict: "approve", issues: [{ ...r.issues[0], severity: "blocker" }] }, md);
  assert.equal(blocker.approved, false);

  const ghost = scoreReview({ ...r, issues: [{ ...r.issues[0], quote: "words that are not there" }] }, md);
  assert.equal(ghost.issues.length, 0);
  assert.equal(ghost.invalidIssues.length, 1);
  // Quotes match across Markdown and typographic quotes.
  const fancy = scoreReview({ ...r, issues: [{ ...r.issues[0], quote: "See the house page and Ask our concierge" }] }, md);
  assert.equal(fancy.issues.length, 1);
});

test("seo: lengths are counted in characters by code; slug rules; accents count once", () => {
  assert.deepEqual(seoProblems(demoSeo, []), []);
  assert.equal(chars("Hermès"), 6);
  const p = seoProblems({ ...demoSeo, slug: "Hermès Bags", metaTitle: "x".repeat(61), metaDescription: "short", keywords: ["a b", "A B", "c"] }, []);
  assert.equal(p.length, 4);
  assert.match(seoProblems(demoSeo, ["scripted-test-article"]).join(), /already used/);
  assert.deepEqual(seoProblems({ ...demoSeo, metaTitle: "é".repeat(60) }, []), []);
});

const lesson = (n: number, agent: Lesson["agent"], status: Lesson["status"] = "active"): Lesson => ({
  id: `L${n}`, agent, rule: `Rule number ${n}`, evidence: "e", runId: null, status, createdAt: `2026-10-${String(n).padStart(2, "0")}T00:00:00Z`,
});

test("lessons: at most 3 per run, no repeats, deleted ones never return, oldest retired past the cap", () => {
  const existing = [...[1, 2, 3, 4, 5].map((n) => lesson(n, "writer")), lesson(6, "editor", "deleted")];
  const plan = planLessons(
    [
      { agent: "writer", rule: "A new writer rule", evidence: "x" },
      { agent: "writer", rule: "rule NUMBER 2!", evidence: "x" },
      { agent: "editor", rule: "Rule number 6", evidence: "x" },
      { agent: "seo", rule: "A new seo rule", evidence: "x" },
      { agent: "ideator", rule: "A new ideator rule", evidence: "x" },
      { agent: "strategist", rule: "One too many", evidence: "x" },
    ],
    existing,
  );
  assert.deepEqual(plan.add.map((l) => l.agent), ["writer", "seo", "ideator"]);
  assert.deepEqual(plan.rejected.map((r) => r.reason), ["already active", "a person deleted this lesson", "more than 3 lessons in one run"]);
  // The writer had the maximum; its oldest lesson makes room.
  assert.equal(ACTIVE_LESSONS_PER_AGENT, 5);
  assert.deepEqual(plan.retire, ["L1"]);
  assert.deepEqual(lessonsFor("writer", existing), ["Rule number 1", "Rule number 2", "Rule number 3", "Rule number 4", "Rule number 5"]);
  assert.deepEqual(lessonsFor("editor", existing), []);
});

test("publisher: published only when every condition holds; otherwise a draft with reasons", () => {
  const md = demoDraft(brief);
  const checks = checkDraft(md, brief, research, links);
  const review = scoreReview(demoReview("approve", 16), md);
  assert.deepEqual(publisher({ review, checks, seoErrors: [], autoPublish: true }), { decision: "published", reasons: [] });
  assert.equal(publisher({ review, checks, seoErrors: [], autoPublish: false }).decision, "draft");
  assert.equal(publisher({ review: scoreReview(demoReview("approve", 14), md), checks, seoErrors: [], autoPublish: true }).decision, "draft");
  assert.equal(publisher({ review, checks, seoErrors: ["metaTitle has 70 characters"], autoPublish: true }).decision, "draft");
  assert.equal(publisher({ review, checks, seoErrors: null, autoPublish: true }).decision, "draft");
  const noCta = checkDraft(demoDraft(brief, { withLinks: false }), brief, research, links);
  assert.equal(publisher({ review, checks: noCta, seoErrors: [], autoPublish: true }).decision, "draft");
});

test("model contract: invalid output is sent back once with the exact problems, then the step fails", async () => {
  const schema = z.object({ n: z.number().int().max(5) });
  const fixed = new ScriptedClient({ ideator: ["not json", { n: 3 }] });
  const llm = new Llm(fixed);
  const r = await llm.structured({ agent: "ideator", system: "s", input: "i", schema, effort: "low" });
  assert.equal(r.value.n, 3);
  assert.equal(r.retries, 1);
  assert.match(fixed.calls[1].input, /not valid JSON/);
  assert.equal(llm.ledger.retries.ideator, 1);

  const broken = new Llm(new ScriptedClient({ ideator: [{ n: 9 }, { n: 8 }] }));
  await assert.rejects(broken.structured({ agent: "ideator", system: "s", input: "i", schema, effort: "low" }), StepError);

  const accepted = await new Llm(new ScriptedClient({ editor: [{ n: 1 }, { n: 2 }] })).structured({
    agent: "editor", system: "s", input: "i", schema, effort: "low", check: (v) => (v.n < 5 ? ["still small"] : []), onRemaining: "accept",
  });
  assert.deepEqual([accepted.value.n, accepted.remaining], [2, ["still small"]]);

  const capped = new Llm(new ScriptedClient({ ideator: [{ n: 1 }] }), new Ledger(0.001));
  await assert.rejects(capped.structured({ agent: "ideator", system: "s", input: "i", schema, effort: "low" }), CostCapError);
});

test("prompts: every agent has one; brand rules, houses and lessons are included", () => {
  for (const a of ["ideator", "strategist", "researcher", "writer", "editor", "seo", "critic"] as const) {
    const p = systemPrompt(a, ["Lesson text"], { TODAY: "2026-10-19" });
    assert.match(p, /SEVN HEVN/);
    assert.match(p, /Jewellery: Hermès, Chanel\b/);
    assert.match(p, /Shoes: Hermès, Chanel, Miu Miu, Loro Piana/);
    assert.match(p, /Lesson text/);
    assert.doesNotMatch(p, /\{\{[A-Z_]+\}\}/);
  }
  assert.match(systemPrompt("editor"), /briefFit/);
  assert.match(systemPrompt("editor"), new RegExp(`at least ${QUALITY_THRESHOLD}`));
});

test("schedule: an article every 14 days for now; the Monday job skips until one is due", () => {
  assert.equal(EVERY_DAYS, 14);
  const monday = new Date("2026-11-02T02:00:00Z");
  assert.equal(isDue(null, monday), true);
  assert.equal(isDue("2026-10-26T02:20:00Z", monday), false); // 7 days ago
  assert.equal(isDue("2026-10-19T02:20:00Z", monday), true); // 14 days ago, even if that run started a little later in the day
  assert.equal(isDue("2026-10-26T02:20:00Z", monday, 7), true); // weekly once JOURNAL_EVERY_DAYS=7
});

test("models: the low-cost mix by default, one model when forced; costs priced by model family", () => {
  assert.equal(modelFor("writer"), "claude-sonnet-5-5");
  assert.equal(modelFor("editor"), "claude-sonnet-5-5");
  assert.equal(modelFor("strategist"), "claude-sonnet-5-5");
  for (const a of ["ideator", "researcher", "seo", "critic"]) assert.equal(modelFor(a), "claude-haiku-5-5");
  assert.equal(modelFor("writer", "claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(Object.keys(MODELS).length, 7);
  // $0.10/$0.50 per million for Haiku 5.5, $1/$5 for Haiku 4.5 (also by its dated id), $2/$10 for Sonnet 5.5; unknown models at the highest price.
  assert.equal(costOf("claude-haiku-5-5", 1_000_000, 1_000_000), 0.6);
  assert.equal(costOf("claude-haiku-4-5-20251001", 1_000_000, 0), 1);
  assert.equal(costOf("claude-sonnet-5-5", 0, 1_000_000), 10);
  assert.equal(costOf("claude-opus-5-5", 1_000_000, 0), 4);
  assert.equal(costOf("some-future-model", 1_000_000, 0), 10);
});

test("short and simple: sentence length is counted by code", () => {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ") + ".";
  const md = demoDraft(brief, { extra: ` ${long}` });
  const c = checkDraft(md, brief, research, links);
  assert.equal(c.longSentences.length, 1);
  assert.match(draftProblems(c).join(), /longer than 35 words/);
  const wordy = demoDraft(brief).replace(/\. /g, ", and ");
  assert.ok(checkDraft(wordy, brief, research, links).avgSentenceWords > 20);
});

test("photos and video: only the brief's photos and verified videos, each on its own line, every chosen photo shown", () => {
  const withPhotos = { ...brief, photos: ["P1", "P2"] };
  const md = demoDraft(withPhotos, { extra: "\n\n![Hermès Kelly](photo:P1)\n\n![A house film](video:abcdefghijk)\n\nInline ![x](photo:P2) is not allowed.\n\n![Other](https://elsewhere.example/pic.jpg)" });
  const c = checkDraft(md, withPhotos, research, links, [], ["abcdefghijk"]);
  assert.deepEqual(c.photosUsed, ["P1", "P2"]);
  assert.deepEqual(c.videosUsed, ["abcdefghijk"]);
  // P2 is inline (not on its own line) and the outside picture isn't ours: both are refused.
  assert.deepEqual(c.unknownMedia, ["photo:P2", "https://elsewhere.example/pic.jpg"]);
  assert.deepEqual(c.missingPhotos, []);
  // Image lines are not words, links or numbers.
  assert.equal(c.links.some((l) => l.href.startsWith("photo:")), false);
  const none = checkDraft(demoDraft(withPhotos), withPhotos, research, links);
  assert.deepEqual(none.missingPhotos, ["P1", "P2"]);
  assert.match(draftProblems(none).join(), /photo P1 from the brief is missing/);
  const unverified = checkDraft(demoDraft(brief, { extra: "\n\n![Film](video:zzzzzzzzzzz)" }), brief, research, links, [], []);
  assert.deepEqual(unverified.unknownMedia, ["video:zzzzzzzzzzz"]);
});

test("brief photos: chosen from the shop's own list, at least one when there are any", () => {
  const photos = [{ id: "P1", piece: "Hermès Kelly", alt: "front", href: "/product/SH-0001", src: "https://x/y.jpg", width: 1200, height: 1600 }];
  assert.match(briefProblems({ ...brief, photos: [] }, { topIdeaIds: ["I4"], links, photos }).join(), /choose at least one/);
  assert.match(briefProblems({ ...brief, photos: ["P9"] }, { topIdeaIds: ["I4"], links, photos }).join(), /"P9" is not one of the photo ids/);
  assert.deepEqual(briefProblems({ ...brief, photos: ["P1"] }, { topIdeaIds: ["I4"], links, photos }), []);
});

test("videos: a YouTube link's id is read by code", () => {
  assert.equal(videoId("https://www.youtube.com/watch?v=RjSJ8TsFWhQ&t=3"), "RjSJ8TsFWhQ");
  assert.equal(videoId("https://youtu.be/RjSJ8TsFWhQ"), "RjSJ8TsFWhQ");
  assert.equal(videoId("https://www.youtube.com/shorts/RjSJ8TsFWhQ"), "RjSJ8TsFWhQ");
  assert.equal(videoId("https://www.youtube.com/@hermes"), null);
  assert.equal(OFFICIAL_CHANNELS["https://www.youtube.com/@hermes"], "Hermès");
});

test("headings: a brief heading with words added after it still counts as that section", () => {
  const md = demoDraft(brief).replace("## First section", "## First section: a winter bag guide");
  assert.deepEqual(checkDraft(md, brief, research, links).missingSections, []);
  const changed = demoDraft(brief).replace("## First section", "## A different heading");
  assert.deepEqual(checkDraft(changed, brief, research, links).missingSections, ["First section"]);
});
