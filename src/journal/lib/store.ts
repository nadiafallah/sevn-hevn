import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CriticOutput, Lesson } from "../contracts/lesson";
import type { PostRecord } from "../contracts/publish";
import type { PastPost, RunStatus, StepRecord } from "../contracts/run";

export interface RunResult {
  status: RunStatus;
  score: number | null;
  rewrites: number;
  costUsd: number;
  error: string | null;
  postId: string | null;
  critic: { wentWell: string[]; wentBadly: string[] } | null;
}

/** Where runs, steps, articles and lessons are kept: the database, or a local file for dry runs. */
export interface Store {
  /** Past articles, lessons, and when the last article was written (for the every-N-days rule). */
  context(): Promise<{ pastPosts: PastPost[]; lessons: Lesson[]; lastPostAt: string | null }>;
  startRun(): Promise<string>;
  saveStep(runId: string, step: StepRecord): Promise<void>;
  savePost(runId: string, post: PostRecord): Promise<string>;
  finishRun(runId: string, result: RunResult): Promise<void>;
  applyLessons(runId: string, add: CriticOutput["lessons"], retire: string[]): Promise<void>;
  /** A person removes a wrong lesson; it is never offered to the agents again. */
  deleteLesson(id: string): Promise<boolean>;
}

// ── Local file (dry runs, tests, previews) ──────────────────────────────────────────

interface FileData {
  runs: ({ id: string; startedAt: string } & Partial<RunResult>)[];
  steps: ({ runId: string; at: string } & StepRecord)[];
  posts: ({ id: string; runId: string; createdAt: string; publishedAt: string | null } & PostRecord)[];
  lessons: Lesson[];
}

export class FileStore implements Store {
  constructor(readonly path: string) {}

  private load(): FileData {
    if (!existsSync(this.path)) return { runs: [], steps: [], posts: [], lessons: [] };
    return JSON.parse(readFileSync(this.path, "utf8")) as FileData;
  }

  private save(d: FileData) {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(d, null, 2));
  }

  /** Everything stored, for the CLI and tests. */
  read() {
    return this.load();
  }

  async context() {
    const d = this.load();
    return {
      pastPosts: d.posts.map((p) => ({ slug: p.slug, title: p.title, primaryKeyword: p.primaryKeyword, status: p.status, publishedAt: p.publishedAt })),
      lessons: d.lessons,
      lastPostAt: d.posts.map((p) => p.createdAt).sort().at(-1) ?? null,
    };
  }

  async startRun() {
    const d = this.load();
    const id = randomUUID();
    d.runs.push({ id, startedAt: new Date().toISOString() });
    this.save(d);
    return id;
  }

  async saveStep(runId: string, step: StepRecord) {
    const d = this.load();
    d.steps.push({ runId, at: new Date().toISOString(), ...step });
    this.save(d);
  }

  async savePost(runId: string, post: PostRecord) {
    const d = this.load();
    const id = randomUUID();
    const now = new Date().toISOString();
    d.posts.push({ id, runId, createdAt: now, publishedAt: post.status === "published" ? now : null, ...post });
    this.save(d);
    return id;
  }

  async finishRun(runId: string, result: RunResult) {
    const d = this.load();
    const run = d.runs.find((r) => r.id === runId);
    if (run) Object.assign(run, result, { finishedAt: new Date().toISOString() });
    this.save(d);
  }

  async applyLessons(runId: string, add: CriticOutput["lessons"], retire: string[]) {
    const d = this.load();
    for (const l of d.lessons) if (retire.includes(l.id) && l.status === "active") l.status = "retired";
    for (const l of add) d.lessons.push({ id: randomUUID(), agent: l.agent, rule: l.rule, evidence: l.evidence, runId, status: "active", createdAt: new Date().toISOString() });
    this.save(d);
  }

  async deleteLesson(id: string) {
    const d = this.load();
    const l = d.lessons.find((x) => x.id === id && x.status !== "deleted");
    if (!l) return false;
    l.status = "deleted";
    this.save(d);
    return true;
  }
}

// ── Supabase (production) ───────────────────────────────────────────────────────────

/**
 * Calls the journal_* database functions with the public key plus the pipeline's own server key.
 * The functions check the key (its SHA-256 hash is stored in private.server_keys under 'journal')
 * and can only touch the journal tables. See supabase/migrations/*_journal.sql.
 */
export class SupabaseStore implements Store {
  constructor(
    private readonly api: { url: string; key: string },
    private readonly serverKey: string,
  ) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.api.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: this.api.key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ p_key: this.serverKey, ...args }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { message?: string } | null;
      // The database's error code only; never the request body or the key.
      throw new Error(`${fn} failed (HTTP ${res.status}${err?.message ? `: ${err.message.slice(0, 120)}` : ""})`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async context() {
    const r = await this.rpc<{
      posts: { slug: string; title: string; primary_keyword: string; status: PastPost["status"]; published_at: string | null }[];
      lessons: { id: string; agent: Lesson["agent"]; rule: string; evidence: string; run_id: string | null; status: Lesson["status"]; created_at: string }[];
      last_post_at: string | null;
    }>("journal_context", {});
    return {
      pastPosts: r.posts.map((p) => ({ slug: p.slug, title: p.title, primaryKeyword: p.primary_keyword, status: p.status, publishedAt: p.published_at })),
      lessons: r.lessons.map((l) => ({ id: l.id, agent: l.agent, rule: l.rule, evidence: l.evidence, runId: l.run_id, status: l.status, createdAt: l.created_at })),
      lastPostAt: r.last_post_at,
    };
  }

  startRun() {
    return this.rpc<string>("journal_start_run", {});
  }

  async saveStep(runId: string, step: StepRecord) {
    await this.rpc("journal_save_step", {
      p_run: runId,
      p_step: { agent: step.agent, round: step.round, input: step.input, output: step.output, usage: step.usage, duration_ms: step.durationMs, error: step.error },
    });
  }

  savePost(runId: string, p: PostRecord) {
    return this.rpc<string>("journal_save_post", {
      p_run: runId,
      p_post: {
        status: p.status, title: p.title, slug: p.slug, body_md: p.bodyMd, meta_title: p.metaTitle, meta_description: p.metaDescription,
        summary: p.summary, keywords: p.keywords, faq: p.faq, primary_keyword: p.primaryKeyword, score: p.score, subscores: p.subscores,
        issues: p.issues, reasons: p.reasons, cta: p.cta, sources: p.sources, media: p.media,
      },
    });
  }

  async finishRun(runId: string, r: RunResult) {
    await this.rpc("journal_finish_run", {
      p_run: runId,
      p_result: { status: r.status, score: r.score, rewrites: r.rewrites, cost_usd: Number(r.costUsd.toFixed(4)), error: r.error, post_id: r.postId, critic: r.critic },
    });
  }

  async applyLessons(runId: string, add: CriticOutput["lessons"], retire: string[]) {
    await this.rpc("journal_apply_lessons", { p_run: runId, p_add: add, p_retire: retire });
  }

  deleteLesson(id: string) {
    return this.rpc<boolean>("journal_delete_lesson", { p_id: id });
  }
}
