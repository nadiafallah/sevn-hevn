// The journal pipeline end to end with a scripted model and search: run with `npm run test:unit`.
// Checks the orchestration rules: order, the rewrite cap, the quality gate, publishing and lessons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_REWRITES } from "../src/journal/config";
import type { Lesson } from "../src/journal/contracts/lesson";
import type { AgentName, SitePhoto, Video } from "../src/journal/contracts/run";
import { demoBrief, demoDraft, demoIdeas, demoResults, demoReview, demoScript, demoSeo, FixedSearch, ScriptedClient, type Answer } from "../src/journal/lib/fake";
import { staticLinks } from "../src/journal/lib/links";
import { Ledger, Llm } from "../src/journal/lib/llm";
import { FileStore } from "../src/journal/lib/store";
import { runPipeline } from "../src/journal/orchestrator";

const links = staticLinks();
const brief = demoBrief(links);
const dir = mkdtempSync(join(tmpdir(), "journal-test-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
async function run(overrides: Partial<Record<AgentName, Answer[]>> = {}, opts: { autoPublish?: boolean; cap?: number; lessons?: Lesson[]; photos?: SitePhoto[]; videos?: Video[] } = {}) {
  const store = new FileStore(join(dir, `run-${++n}.json`));
  if (opts.lessons) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(store.path, JSON.stringify({ runs: [], steps: [], posts: [], lessons: opts.lessons }));
  }
  const client = new ScriptedClient({ ...demoScript(links), ...overrides });
  const summary = await runPipeline({
    llm: new Llm(client, new Ledger(opts.cap ?? 3)),
    search: new FixedSearch(demoResults, opts.videos ?? []),
    store,
    links,
    photos: opts.photos ?? [],
    today: "2026-10-19",
    autoPublish: opts.autoPublish ?? true,
  });
  const calls = (agent: AgentName) => client.calls.filter((c) => c.agent === agent);
  return { summary, data: store.read(), calls, client };
}

const approve = demoReview("approve", 17); // 85
const rewrite = demoReview("rewrite", 14); // 70

test("a first draft that passes is published without rewrites", async () => {
  const { summary, data, calls } = await run({ writer: [demoDraft(brief)], editor: [approve] });
  assert.equal(summary.status, "published");
  assert.equal(summary.rewrites, 0);
  assert.equal(summary.score, 85);
  assert.equal(calls("writer").length, 1);
  assert.equal(data.posts[0].status, "published");
  assert.equal(data.posts[0].slug, demoSeo.slug);
  assert.equal(data.runs[0].status, "published");
});

test(`the rewrite cap is in code: at most ${MAX_REWRITES} rewrites, then the article stays a draft`, async () => {
  const { summary, data, calls } = await run({
    writer: [demoDraft(brief), demoDraft(brief), demoDraft(brief), demoDraft(brief)],
    editor: [rewrite, rewrite, rewrite, rewrite],
  });
  assert.equal(calls("writer").length, MAX_REWRITES + 1);
  assert.equal(calls("editor").length, MAX_REWRITES + 1);
  assert.equal(summary.rewrites, MAX_REWRITES);
  assert.equal(summary.status, "draft");
  assert.equal(data.posts[0].status, "draft");
  assert.ok(data.posts[0].reasons.some((r) => /below 75/.test(r)));
  // Each rewrite gets the previous draft and the editor's issues.
  assert.match(calls("writer")[1].input, /<issues_to_fix>[\s\S]*Placeholder problem/);
  assert.match(calls("writer")[1].input, /<draft>/);
});

test("an editor 'approve' below the threshold is not accepted by code", async () => {
  const lowApprove = demoReview("approve", 14);
  const { summary, calls } = await run({ writer: [demoDraft(brief), demoDraft(brief), demoDraft(brief)], editor: [lowApprove, lowApprove, lowApprove] });
  assert.equal(calls("writer").length, 3);
  assert.equal(summary.status, "draft");
});

test("a 'rewrite' verdict is respected even with a high score", async () => {
  const highRewrite = demoReview("rewrite", 18);
  const { calls, summary } = await run({ writer: [demoDraft(brief), demoDraft(brief)], editor: [highRewrite, approve] });
  assert.equal(calls("writer").length, 2);
  assert.equal(summary.status, "published");
});

test("failed code checks send the draft back even when the editor approves", async () => {
  const { calls, summary } = await run({ writer: [demoDraft(brief, { withLinks: false }), demoDraft(brief)], editor: [approve, approve] });
  assert.equal(calls("writer").length, 2);
  assert.match(calls("writer")[1].input, /"id": "C1"[\s\S]*call to action/);
  assert.equal(summary.status, "published");
});

test("SEO gets one more try with the exact errors; still wrong means a draft", async () => {
  const long = { ...demoSeo, metaTitle: "A meta title that is far too long to fit in a search result line" };
  const fixedOnSecond = await run({ writer: [demoDraft(brief)], editor: [approve], seo: [long, demoSeo] });
  assert.equal(fixedOnSecond.summary.status, "published");
  assert.match(fixedOnSecond.calls("seo")[1].input, /errors_from_previous_attempt[\s\S]*metaTitle has 64 characters/);

  const stillWrong = await run({ writer: [demoDraft(brief)], editor: [approve], seo: [long, long] });
  assert.equal(stillWrong.summary.status, "draft");
  assert.ok(stillWrong.data.posts[0].reasons.some((r) => r.startsWith("SEO: metaTitle")));
  assert.equal(stillWrong.data.posts[0].slug, demoSeo.slug);
});

test("with automatic publishing off, a passing article stays a draft", async () => {
  const { summary } = await run({ writer: [demoDraft(brief)], editor: [approve] }, { autoPublish: false });
  assert.equal(summary.status, "draft");
  assert.match(summary.reasons.join(), /JOURNAL_AUTO_PUBLISH/);
});

test("the strategist sees the top 3 ideas sorted by code, and a choice outside them is sent back", async () => {
  const outside = { ...brief, chosenIdeaId: "I1" };
  const { calls, data, summary } = await run({ strategist: [outside, brief], writer: [demoDraft(brief)], editor: [approve] });
  const input = calls("strategist")[0].input;
  const ids = [...input.matchAll(/"id": "(I\d)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["I4", "I2", "I3"]);
  assert.match(calls("strategist")[1].input, /chosenIdeaId "I1" is not one of I4, I2, I3/);
  assert.equal(summary.status, "published");
  assert.equal(data.steps.find((s) => s.agent === "strategist")?.error, null);
});

test("too few valid ideas: the run fails, nothing is saved, the critic still reviews it", async () => {
  const { ideas } = demoIdeas();
  const invalid = ideas.map((i) => ({ ...i, category: "watches" as const, houses: ["cartier" as const] }));
  const valid = ideas.slice(0, 2).map((i, k) => ({ ...i, id: `I${7 + k}` }));
  const { summary, data, calls } = await run({ ideator: [{ ideas: [...invalid.slice(0, 4), ...valid] }] });
  assert.equal(summary.status, "failed");
  assert.match(summary.error ?? "", /only 2 valid ideas/);
  assert.equal(data.posts.length, 0);
  assert.equal(calls("critic").length, 1);
});

test("a failure after drafting keeps the article as a draft (nothing paid for is lost)", async () => {
  const { summary, data } = await run({ writer: [demoDraft(brief)], editor: [approve], seo: [] });
  assert.equal(summary.status, "failed");
  assert.equal(data.posts.length, 1);
  assert.equal(data.posts[0].status, "draft");
  assert.match(data.posts[0].slug, /^draft-[a-z0-9]{8}$/);
});

test("the cost cap stops the run and skips the critic", async () => {
  const { summary, calls } = await run({}, { cap: 0.035 });
  assert.equal(summary.status, "failed");
  assert.match(summary.error ?? "", /cap/);
  assert.equal(calls("critic").length, 0);
});

test("a critic failure does not change the outcome", async () => {
  const { summary } = await run({ writer: [demoDraft(brief)], editor: [approve], critic: ["not json", "still not json"] });
  assert.equal(summary.status, "published");
});

test("lessons: active ones reach their agent's prompt next run; deleted ones never do; new ones are stored", async () => {
  const lessons: Lesson[] = [
    { id: "a", agent: "writer", rule: "Open every section with the piece's name.", evidence: "", runId: null, status: "active", createdAt: "2026-10-01T00:00:00Z" },
    { id: "b", agent: "writer", rule: "A lesson a person deleted.", evidence: "", runId: null, status: "deleted", createdAt: "2026-10-02T00:00:00Z" },
  ];
  const { calls, data } = await run({ writer: [demoDraft(brief)], editor: [approve] }, { lessons });
  assert.match(calls("writer")[0].system, /Open every section with the piece's name/);
  assert.doesNotMatch(calls("writer")[0].system, /a person deleted/);
  assert.doesNotMatch(calls("editor")[0].system, /Open every section/);
  assert.match(calls("critic")[0].input, /deleted_lessons[\s\S]*A lesson a person deleted/);
  assert.equal(data.lessons.filter((l) => l.status === "active").length, 2);
});

test("every step is stored with its input and output, in order", async () => {
  const { data } = await run({ writer: [demoDraft(brief)], editor: [approve] });
  assert.deepEqual(
    data.steps.map((s) => s.agent),
    ["ideator", "checks", "strategist", "researcher", "search", "researcher", "checks", "writer", "checks", "editor", "seo", "publisher", "critic", "checks"],
  );
  assert.ok(data.steps.every((s) => s.input !== undefined));
  assert.ok(data.runs[0].costUsd! > 0);
});

test("photos and an official video chosen by the agents are saved with the article; captions come from code", async () => {
  const photos: SitePhoto[] = [
    { id: "P1", piece: "Hermès Kelly Dépêches 25", alt: "front", href: "/product/SH-0001", src: "https://x.example/1.jpg", width: 1200, height: 1600 },
    { id: "P2", piece: "Hermès Oz mules", alt: "pair", href: "/product/SH-0002", src: "https://x.example/2.jpg", width: 1200, height: 1600 },
  ];
  const videos: Video[] = [{ id: "RjSJ8TsFWhQ", title: "Training artisans", channel: "Hermès", house: "Hermès" }];
  const withPhotos = { ...brief, photos: ["P1"] };
  const draft = demoDraft(withPhotos, { extra: "\n\n![Any words](photo:P1)\n\n![Film](video:RjSJ8TsFWhQ)" });
  const plan = { queries: [{ q: "leather craft", why: "facts" }], videoQueries: ["Hermès savoir-faire"] };
  const pack = { facts: [{ id: "F1", claim: "A fact.", sourceUrl: "https://example.com/craft" }], examples: [], readerQuestions: [], gaps: [] };
  const { summary, data, calls } = await run({ strategist: [withPhotos], researcher: [plan, pack], writer: [draft], editor: [approve] }, { photos, videos });
  assert.equal(summary.status, "published");
  assert.match(calls("strategist")[0].input, /"shows": "front"/);
  assert.match(calls("writer")[0].input, /photo:P1[\s\S]*video:RjSJ8TsFWhQ/);
  assert.deepEqual(data.posts[0].media.map((m) => [m.type, m.id]), [["photo", "P1"], ["video", "RjSJ8TsFWhQ"]]);
  assert.equal((data.posts[0].media[0] as SitePhoto).piece, "Hermès Kelly Dépêches 25");
});
