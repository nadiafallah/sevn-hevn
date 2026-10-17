import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { critic } from "./agents/critic";
import { editor } from "./agents/editor";
import { ideator } from "./agents/ideator";
import { publisher } from "./agents/publisher";
import { extractResearch, planSearch } from "./agents/researcher";
import { seo } from "./agents/seo";
import { strategist } from "./agents/strategist";
import { writer } from "./agents/writer";
import { EVERY_DAYS, isDue } from "./config";
import { BriefSchema, StrategistInputSchema } from "./contracts/brief";
import { IdeatorInputSchema, rankIdeas } from "./contracts/idea";
import { CriticInputSchema } from "./contracts/lesson";
import { ResearcherInputSchema, SearchResultSchema } from "./contracts/research";
import { DraftChecksSchema, EditorInputSchema, WriterInputSchema } from "./contracts/review";
import { SeoInputSchema, seoProblems } from "./contracts/seo";
import { AnthropicClient } from "./lib/anthropic";
import { checkDraft } from "./lib/checks";
import { FixedSearch, ScriptedClient, demoResults, demoScript } from "./lib/fake";
import { loadSite, staticLinks } from "./lib/links";
import { Llm, type ModelClient } from "./lib/llm";
import { TavilySearch, type Search } from "./lib/search";
import { FileStore, SupabaseStore, type Store } from "./lib/store";
import { runPipeline } from "./orchestrator";

const USAGE = `SEVN HEVN journal pipeline

  npm run journal -- run                 full run against the database (scheduled job; skips if not due)
  npm run journal -- run --force         write an article now, even if the last one is recent
  npm run journal -- run --dry           real model and search, results in .journal/dry-run.json only
  npm run journal -- run --fake          scripted model and search (no network, no cost), local file only
  npm run journal -- run --fake --db     scripted model and search, written to the database (local test stack)
  npm run journal -- step <name> --in input.json [--out output.json] [--fake]
        names: ideator, strategist, research-plan, search, research-extract, writer, checks, editor, seo, publisher, critic
  npm run journal -- lessons list [--dry]
  npm run journal -- lessons delete <id> [--dry]
`;

function env(name: string) {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function modelClient(fake: boolean): ModelClient {
  if (fake) return new ScriptedClient(demoScript(staticLinks()));
  const key = env("ANTHROPIC_API_KEY");
  if (!key) fail("ANTHROPIC_API_KEY is not set (see docs/JOURNAL.md).");
  return new AnthropicClient(key, env("JOURNAL_MODEL"));
}

function searchClient(fake: boolean): Search {
  if (fake) return new FixedSearch(demoResults);
  const key = env("TAVILY_API_KEY");
  if (!key) fail("TAVILY_API_KEY is not set (see docs/JOURNAL.md).");
  return new TavilySearch(key);
}

const publicApi = () => {
  const url = env("SUPABASE_URL")?.replace(/\/+$/, "");
  const key = env("SUPABASE_PUBLISHABLE_KEY");
  return url && key ? { url, key } : null;
};

function store(local: boolean, file: string): Store {
  if (local) return new FileStore(file);
  const api = publicApi();
  const serverKey = env("JOURNAL_SERVER_KEY");
  if (!api || !serverKey) fail("SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and JOURNAL_SERVER_KEY are needed (or use --dry / --fake).");
  return new SupabaseStore(api, serverKey);
}

function readJson<S extends z.ZodType>(path: string | undefined, schema: S): z.infer<S> {
  if (!path) fail("--in <file.json> is required");
  const r = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!r.success) fail(`Input does not match the contract:\n${r.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  return r.data;
}

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      dry: { type: "boolean", default: false },
      fake: { type: "boolean", default: false },
      db: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      in: { type: "string" },
      out: { type: "string" },
      file: { type: "string" },
    },
  });
  const [command, sub, arg] = positionals;
  const local = values.dry || (values.fake && !values.db);
  const file = values.file ?? (values.fake ? ".journal/fake-run.json" : ".journal/dry-run.json");

  if (command === "run") {
    // The scheduled job skips quietly until it is configured, instead of failing every week.
    if (!local && ((!values.fake && !env("ANTHROPIC_API_KEY")) || !env("JOURNAL_SERVER_KEY"))) {
      console.log("Journal is not configured (ANTHROPIC_API_KEY / JOURNAL_SERVER_KEY); nothing to do.");
      return;
    }
    const s = store(local, file);
    // One article every EVERY_DAYS days (JOURNAL_EVERY_DAYS to change); --force writes one anyway.
    const everyDays = Number(env("JOURNAL_EVERY_DAYS") ?? EVERY_DAYS);
    const { lastPostAt } = await s.context();
    if (!values.force && !isDue(lastPostAt, new Date(), Number.isFinite(everyDays) && everyDays > 0 ? everyDays : EVERY_DAYS)) {
      console.log(`Not due yet: the last article was written ${lastPostAt?.slice(0, 10)}; one is written every ${everyDays} days.`);
      return;
    }
    const llm = new Llm(modelClient(values.fake));
    const site = values.fake ? { links: staticLinks(), photos: [], pieces: [] } : await loadSite(publicApi());
    const summary = await runPipeline({
      llm,
      search: searchClient(values.fake),
      store: s,
      links: site.links,
      photos: site.photos,
      pieces: site.pieces,
      today: new Date().toISOString().slice(0, 10),
      autoPublish: env("JOURNAL_AUTO_PUBLISH") !== "false",
      log: values.quiet ? undefined : (line) => console.log(`[journal] ${line}`),
    });
    // Public CI logs get the outcome only.
    if (values.quiet) console.log(JSON.stringify({ runId: summary.runId, status: summary.status, score: summary.score, rewrites: summary.rewrites, costUsd: Number(summary.costUsd.toFixed(2)) }));
    else console.log(JSON.stringify(summary, null, 2));
    if (local) console.log(`Stored in ${file}`);
    if (summary.status === "failed") process.exitCode = 1;
    return;
  }

  if (command === "step") {
    const llm = new Llm(modelClient(values.fake));
    const deps = { llm };
    const input = values.in;
    let output: unknown;
    switch (sub) {
      case "ideator": {
        const i = readJson(input, IdeatorInputSchema);
        const c = await ideator(i, deps);
        output = { ...c.value, ranked: rankIdeas(c.value.ideas, i.pastPosts) };
        break;
      }
      case "strategist":
        output = (await strategist(readJson(input, StrategistInputSchema), deps)).value;
        break;
      case "research-plan":
        output = (await planSearch(readJson(input, ResearcherInputSchema), deps)).value;
        break;
      case "search": {
        const i = readJson(input, z.object({ queries: z.array(z.string()).min(1) }));
        output = await searchClient(values.fake).run(i.queries);
        break;
      }
      case "research-extract": {
        const i = readJson(input, z.object({ brief: BriefSchema, results: z.array(SearchResultSchema), lessons: z.array(z.string()).default([]) }));
        output = (await extractResearch(i, deps)).value;
        break;
      }
      case "writer":
        output = (await writer(readJson(input, WriterInputSchema), deps)).value;
        break;
      case "checks": {
        const i = readJson(input, WriterInputSchema.pick({ brief: true, research: true }).extend({ draft: z.string() }));
        output = checkDraft(i.draft, i.brief, i.research, values.fake ? staticLinks() : (await loadSite(publicApi())).links, [new Date().getFullYear().toString()]);
        break;
      }
      case "editor":
        output = (await editor(readJson(input, EditorInputSchema), deps)).scored;
        break;
      case "seo": {
        const i = readJson(input, SeoInputSchema);
        const meta = (await seo(i, deps)).value;
        output = { ...meta, problems: seoProblems(meta, i.usedSlugs) };
        break;
      }
      case "publisher": {
        const i = readJson(input, z.object({ review: z.any(), checks: DraftChecksSchema, seoErrors: z.array(z.string()).nullable(), autoPublish: z.boolean() }));
        output = publisher(i);
        break;
      }
      case "critic":
        output = (await critic(readJson(input, CriticInputSchema), deps)).value;
        break;
      default:
        fail(USAGE);
    }
    const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
    if (values.out) writeFileSync(values.out, text);
    else console.log(text);
    console.error(`[journal] cost $${llm.ledger.total.toFixed(3)}`);
    return;
  }

  if (command === "lessons") {
    const s = store(values.dry, file);
    if (sub === "list") {
      const { lessons } = await s.context();
      for (const l of lessons) console.log(`${l.id}  ${l.status.padEnd(7)}  ${l.agent.padEnd(10)}  ${l.rule}`);
      if (!lessons.length) console.log("No lessons yet.");
      return;
    }
    if (sub === "delete" && arg) {
      console.log((await s.deleteLesson(arg)) ? "Deleted: it will not be given to any agent again." : "No active lesson with that id.");
      return;
    }
  }

  fail(USAGE);
}

main().catch((e) => fail(`[journal] ${e instanceof Error ? e.message : String(e)}`));
