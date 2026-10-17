# Journal: a new article every two weeks, written by agents and checked by code

A pipeline of agents writes one English article for `www.sevnhevn.ae/journal`. For the first two months it writes one every two weeks, to keep costs down while the site grows (owner decision, Oct 2026); after that, once a week. The job checks every Monday whether an article is due (`EVERY_DAYS` in `src/journal/config.ts`; set `JOURNAL_EVERY_DAYS=7` for weekly). An article that passes the quality gate is published automatically. Anything else stays a draft in the panel (`/admin/journal`) for the owner to decide.

The code is in `src/journal/`, and the site pages are `src/app/[locale]/journal/`. The database is `supabase/migrations/20261017120000_journal.sql`, and the weekly job is `.github/workflows/journal.yml`.

## 1. How a run works

The order, the conditions and the loops are plain code in `src/journal/orchestrator.ts`. No agent decides what runs next. Every step's input, output, cost and time is stored (`journal_steps`).

```
ideator → rank ideas (code) → strategist → researcher: search plan → search (code, Tavily)
→ official house videos (code: YouTube oEmbed checks the channel) → researcher: research pack
→ drop facts whose source wasn't returned (code)
→ writer → checks (code) → editor ⇄ writer: at most 2 rewrites (code)
→ SEO → length and slug checks (code), one more try with the exact errors
→ publisher (code): publish or keep as a draft → save
→ critic → lessons (code: at most 3 per run, at most 5 active per agent)
```

### The eight roles

The input and output contracts are zod schemas in `src/journal/contracts/`. The instructions are plain text in `src/journal/prompts/`. Every model output except the writer's is structured JSON, and code validates it. An output that breaks its contract is sent back once with the exact problems; if it is still wrong, the run fails and nothing is published.

| Role | Output | Tools | Code-enforced guardrails |
| --- | --- | --- | --- |
| Ideator | 5–8 ideas, each scored 0–100 with a reason | none (it is told which pieces are published) | Sorted by score in code; a house outside its category or a repeated keyword or title is dropped |
| Strategist | The brief: audience, keywords, 3–5 H2s, word range, call to action, product links, 1–3 photos | none | Must choose one of the top 3 ideas; every link must be a real page; photos only from the shop's own; 450–750 words |
| Researcher | Search queries and 2 video searches, then facts (with source URLs), examples, reader questions, gaps | Web search, run by code | At most 6 queries; a fact whose URL wasn't returned by the search is dropped; a video only from a house's official channel |
| Writer | The article in Markdown (the only free-text output), with the photo markers and at most one video | none | Checked by code after each draft: length, headings, links, call to action, numbers without a source, sentence length, photos and video |
| Editor | Five subscores (0–20 each), specific issues with quotes, and a verdict: approve or rewrite | the rubric (`prompts/editor-rubric.md`) | The total is added up by code; quotes must be in the draft; "approve" counts only with a total of at least 75 and no blocker; the rewrite cap is in code |
| SEO | Slug, meta title, meta description, summary, keywords, FAQ | none | Characters counted by code: title 30–60, description 120–160; slug format and uniqueness |
| Publisher | Published or draft, with reasons | code only, no model | Publishes only when every rule holds (below) |
| Critic | What went well and badly, and up to 3 lessons | none | Lessons only for the 6 model agents; no repeats; deleted lessons are never re-added |

### Fixed rules (`src/journal/config.ts`)

| Rule | Value |
| --- | --- |
| Quality threshold (editor total) | 75 / 100. The database enforces the same number for automatic publishing |
| Rewrites after the first draft | at most 2 (so at most 3 drafts) |
| Lessons per run / active per agent | 3 / 5 (the oldest is retired) |
| Cost cap per run | $1. Above it the run stops, nothing is published, and the critic is skipped |
| How often | One article every 14 days (`JOURNAL_EVERY_DAYS`); the Monday job skips until one is due. A manual run with `--force` writes one anyway |
| Models (low-cost mix) | Strategist, writer and editor on `claude-sonnet-5-5`; ideator, researcher, SEO and critic on `claude-haiku-5-5` (`MODELS`). `JOURNAL_MODEL=claude-opus-5-5` runs every agent on Opus for the highest quality (about 3× the cost). On Sonnet and Opus, a declined request is retried on another model by the API's server-side fallback |

**Published automatically only if all of these hold:**
- the editor approved;
- the score is at least 75;
- no blocker issue remains;
- every code check passed (length, sections, links, call to action, sourced numbers);
- the SEO metadata is valid;
- `JOURNAL_AUTO_PUBLISH` is not `false`.

Otherwise the article is saved as a draft, with the reasons listed.

**Short and easy to read** (owner, Oct 2026): 450–750 words and 3–5 sections. Code counts the sentences: at most 20 words on average, and none longer than 35.

**Photos and video:**
- **Photos:** only the shop's own photos of its published pieces (`product_images`), offered to the strategist by code. The writer places them as `![…](photo:P1)`; captions and links come from the catalogue, never from a model.
- **Never other websites' images:** photos from other sites (brands, magazines) belong to their owners and are never used, even with credit.
- **Video:** at most one film from a house's official YouTube channel (`OFFICIAL_CHANNELS` in config: @hermes, @chanel, @louisvuitton, @gucci, @cartier, @vancleefarpels, @bvlgariofficial). Code verifies the channel through YouTube's oEmbed. The page shows a still and plays the film in YouTube's privacy-enhanced player only after a click.
- **Until pieces are published:** articles have no photos, because the photos come from the catalogue.

**Brand rules for every agent** (`prompts/brand-rules.md`):
- only the four categories and the permitted houses;
- no invented prices, stock, customer stories or reviews;
- no dealer or partnership claims, and no investment claims;
- facts only from the research.

## 2. Reviewing articles and lessons

`/admin/journal`, owner only:

- **Drafts:** the score, why the article wasn't published, the editor's open issues, the article itself, its sources, an editor for the text and metadata, and Publish / Archive / Delete. Publishing from here is the owner's decision, at any score; it needs the meta title, meta description and summary.
- **Published:** a link to each live article, Unpublish, and the editor.
- **Lessons:** each active lesson, with the evidence behind it and a Delete button. A deleted lesson leaves the prompts and is never proposed again.
- **Recent runs:** the outcome, score, rewrites, cost, and the critic's notes.

On the website, once at least one article is published:
- the home page shows the three latest articles, under "The Journal";
- there are links to `/journal` in the header (next to Contact), the phone menu and the footer;
- the journal is listed in the sitemap.

Each article ends with a box for joining the newsletter, using the same list as the footer form. Articles are rendered from Markdown into React elements, never as raw HTML.

## 3. Commands

Run these from the project root. `.env.local` is read if it exists.

```bash
npm run journal -- run --fake        # scripted model and search: no network, no cost; result in .journal/fake-run.json
npm run journal -- run --dry         # real model and search; result only in .journal/dry-run.json (about $1–1.5)
npm run journal -- run               # the weekly job: writes to the database and may publish
npm run journal -- step writer --in brief-and-research.json [--out draft.md] [--fake]
npm run journal -- lessons list [--dry]
npm run journal -- lessons delete <id> [--dry]
npm run test:unit                    # includes tests/journal-*.test.ts (scripted model, no cost)
npm run db:test                      # includes supabase/tests/journal.test.mjs
```

Each step can be run on its own: `step` reads a JSON input, checks it against that agent's input contract, and prints the output. The step names are `ideator`, `strategist`, `research-plan`, `search`, `research-extract`, `writer`, `checks`, `editor`, `seo`, `publisher` and `critic`.

## 4. Going live (owner steps, once)

1. **Database.** In Supabase → project `sevn-hevn` → SQL Editor, run `supabase/migrations/20261017120000_journal.sql`.
2. **The pipeline's key.** Generate it with `openssl rand -hex 32`, then store only its hash:

   ```sql
   insert into private.server_keys (name, sha256_hex)
   values ('journal', encode(sha256(convert_to('<the key>', 'UTF8')), 'hex'));
   ```

   Clear the editor afterwards. The key can only call the `journal_*` functions. They are rate limited to 6 runs a day and can't publish below a score of 75.
3. **Anthropic API key.**
   - At console.anthropic.com, buy a small prepaid credit (for example $5) and keep auto-reload off.
   - Set a monthly spend limit (for example $5).
   - Create a key named `sevn-hevn-journal`.
4. **Tavily key.** Sign up at tavily.com for the free Researcher plan, which needs no card.
5. **GitHub → Settings → Secrets and variables → Actions:**
   - secrets: `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `JOURNAL_SERVER_KEY`;
   - variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `JOURNAL_AUTO_PUBLISH` (optional, `false` = drafts only).
6. **First run.** Start it by hand: GitHub → Actions → "Journal (new article)" → Run workflow (tick "Write an article now"). After that the job checks every Monday at 06:00 Dubai time and writes one when it is due.

Until these are set, the weekly job skips with a notice, and the site shows no journal link.

Notes:
- The repository is public, so the job's log shows only the run id, outcome, score and cost.
- GitHub pauses scheduled jobs after 60 days without a commit. Re-enable it in the Actions tab if that happens.
- **Cost** (estimates; each run's real cost is shown in the panel):
  - with the low-cost mix, about $0.20–0.40 per article;
  - every two weeks, that is about $0.40–0.80 a month (weekly: about $0.90–1.70);
  - search stays within Tavily's free plan, at about 6 searches per run;
  - GitHub Actions is free for this public repository.

## 5. Rollback

`supabase/rollbacks/20261017120000_journal.down.sql` deletes every article, run and lesson. Export `journal_posts` first, and get the owner's written approval.
