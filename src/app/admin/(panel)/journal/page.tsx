import Link from "next/link";
import { select } from "@/lib/concierge/db";
import { requireOwner } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { JournalBody } from "@/components/JournalBody";
import type { JournalMedia } from "@/lib/journal";
import { when } from "@/lib/admin/labels";
import { deleteJournalLesson, deleteJournalPost, setJournalStatus, updateJournalPost } from "../../actions";
import "../../../journal.css";

export const metadata = { title: "Journal" };

interface Post {
  id: string;
  slug: string;
  status: "draft" | "published" | "archived";
  title: string;
  body_md: string;
  meta_title: string | null;
  meta_description: string | null;
  summary: string | null;
  score: number;
  subscores: Record<string, number>;
  issues: { id: string; severity: string; section: string; quote: string; problem: string; fix: string }[];
  reasons: string[];
  sources: { url: string; title: string }[];
  media: JournalMedia[];
  published_at: string | null;
  published_manually: boolean;
  created_at: string;
}

interface Lesson {
  id: string;
  agent: string;
  rule: string;
  evidence: string;
  status: "active" | "retired" | "deleted";
  created_at: string;
}

interface Run {
  id: string;
  started_at: string;
  status: string;
  score: number | null;
  rewrites: number | null;
  cost_usd: string | null;
  error: string | null;
  critic: { wentWell: string[]; wentBadly: string[] } | null;
}

function StatusButton({ id, status, label, dark = false }: { id: string; status: string; label: string; dark?: boolean }) {
  return (
    <form action={setJournalStatus} className="adm-inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={`adm-btn${dark ? " adm-btn--dark" : ""}`}>{label}</button>
    </form>
  );
}

function Editor({ p }: { p: Post }) {
  return (
    <details>
      <summary>Edit</summary>
      <form action={updateJournalPost} className="adm-form">
        <input type="hidden" name="id" value={p.id} />
        <label>Title<input name="title" required defaultValue={p.title} maxLength={120} /></label>
        <div className="adm-row">
          <label>Address (/journal/…)<input name="slug" required defaultValue={p.slug} maxLength={70} pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label>
          <label>Meta title (30–60 characters)<input name="meta_title" defaultValue={p.meta_title ?? ""} maxLength={120} /></label>
        </div>
        <label>Meta description (120–160 characters)<textarea name="meta_description" rows={2} defaultValue={p.meta_description ?? ""} maxLength={300} /></label>
        <label>Summary<textarea name="summary" rows={2} defaultValue={p.summary ?? ""} maxLength={400} /></label>
        <label>Article (Markdown)<textarea name="body_md" rows={18} defaultValue={p.body_md} maxLength={40000} /></label>
        <button type="submit" className="adm-btn">Save</button>
      </form>
    </details>
  );
}

const AGENT_ORDER = ["ideator", "strategist", "researcher", "writer", "editor", "seo"];

export default async function Journal({ searchParams }: { searchParams: SP }) {
  const { api, token } = await requireOwner();
  const sp = await searchParams;
  const [posts, lessons, runs] = await Promise.all([
    select<Post[]>(api, "journal_posts", { select: "*", order: "created_at.desc", limit: "100" }, token).catch(() => null),
    select<Lesson[]>(api, "journal_lessons", { select: "*", order: "created_at.asc" }, token).catch(() => []),
    select<Run[]>(api, "journal_runs", { select: "id,started_at,status,score,rewrites,cost_usd,error,critic", order: "started_at.desc", limit: "12" }, token).catch(() => []),
  ]);

  if (posts === null) {
    return (
      <>
        <h1 className="adm-h1">Journal</h1>
        <p className="adm-empty">The journal’s database setup hasn’t been run yet (supabase/migrations/20261017120000_journal.sql). See docs/JOURNAL.md.</p>
      </>
    );
  }

  const drafts = posts.filter((p) => p.status === "draft");
  const published = posts.filter((p) => p.status === "published");
  const archived = posts.filter((p) => p.status === "archived");
  const active = lessons.filter((l) => l.status === "active").sort((a, b) => AGENT_ORDER.indexOf(a.agent) - AGENT_ORDER.indexOf(b.agent));
  const past = lessons.filter((l) => l.status !== "active").reverse();

  return (
    <>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <h1 className="adm-h1">Journal</h1>
      <p className="adm-muted">
        The journal pipeline writes a new article every two weeks for now (weekly later; JOURNAL_EVERY_DAYS). An article that passes the quality gate (editor score of at least 75, approved, every check
        passed) is published automatically; everything else waits here as a draft for your decision. You can edit any article before publishing it.
      </p>

      <h2 className="journal-adm__h">Drafts waiting for you ({drafts.length})</h2>
      {drafts.length === 0 && <p className="adm-empty">No drafts.</p>}
      {drafts.map((p) => (
        <section key={p.id} className="adm-card">
          <h2>
            {p.title} <span className="adm-badge adm-badge--k-draft">score {p.score}</span>
          </h2>
          <p className="adm-muted adm-small">
            /journal/{p.slug} · written {when(p.created_at)}
            {Object.keys(p.subscores).length > 0 && ` · ${Object.entries(p.subscores).map(([k, v]) => `${k} ${v}`).join(", ")}`}
          </p>
          {p.reasons.length > 0 && (
            <>
              <p className="adm-small"><strong>Why it wasn’t published automatically</strong></p>
              <ul className="adm-small">{p.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </>
          )}
          {p.issues.length > 0 && (
            <details>
              <summary>The editor’s open issues ({p.issues.length})</summary>
              <ul className="adm-small">
                {p.issues.map((i) => (
                  <li key={i.id}>
                    <strong>{i.severity}</strong> · {i.section} · “{i.quote}” — {i.problem} <em>Fix: {i.fix}</em>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary>Read the article</summary>
            <div className="journal-body">
              <JournalBody md={p.body_md} href={(path) => path} media={p.media} />
            </div>
          </details>
          {p.sources.length > 0 && (
            <details>
              <summary>Research sources ({p.sources.length})</summary>
              <ul className="adm-small">{p.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>)}</ul>
            </details>
          )}
          <Editor p={p} />
          <div className="adm-actions">
            <StatusButton id={p.id} status="published" label="Publish" dark />
            <StatusButton id={p.id} status="archived" label="Archive" />
            <form action={deleteJournalPost} className="adm-inline">
              <input type="hidden" name="id" value={p.id} />
              <button type="submit" className="adm-btn adm-btn--danger">Delete</button>
            </form>
          </div>
        </section>
      ))}

      <h2 className="journal-adm__h">Published ({published.length})</h2>
      {published.length === 0 && <p className="adm-empty">Nothing published yet.</p>}
      {published.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Article</th><th>Score</th><th>Published</th><th /></tr></thead>
            <tbody>
              {published.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/journal/${p.slug}`} target="_blank">{p.title}</Link></td>
                  <td>{p.score}{p.published_manually ? " (by you)" : ""}</td>
                  <td>{when(p.published_at)}</td>
                  <td><StatusButton id={p.id} status="draft" label="Unpublish" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {published.map((p) => (
        <section key={p.id} className="adm-card">
          <h2>{p.title}</h2>
          <Editor p={p} />
        </section>
      ))}

      <h2 className="journal-adm__h">Lessons for the agents ({active.length} active)</h2>
      <p className="adm-muted adm-small">
        After each run the critic may add up to 3 lessons; each agent keeps at most 5 (the oldest is retired). Active lessons are added to that agent’s
        instructions on the next run. Delete a lesson that is wrong: it will never be given to an agent or proposed again.
      </p>
      {active.length === 0 && <p className="adm-empty">No lessons yet.</p>}
      {active.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Agent</th><th>Lesson</th><th>Evidence</th><th>Added</th><th /></tr></thead>
            <tbody>
              {active.map((l) => (
                <tr key={l.id}>
                  <td>{l.agent}</td>
                  <td>{l.rule}</td>
                  <td className="adm-small">{l.evidence}</td>
                  <td>{when(l.created_at)}</td>
                  <td>
                    <form action={deleteJournalLesson}>
                      <input type="hidden" name="id" value={l.id} />
                      <button type="submit" className="adm-link adm-link--danger">Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {past.length > 0 && (
        <details>
          <summary>Retired and deleted lessons ({past.length})</summary>
          <ul className="adm-small">{past.map((l) => <li key={l.id}>{l.status} · {l.agent} · {l.rule}</li>)}</ul>
        </details>
      )}

      <h2 className="journal-adm__h">Recent runs</h2>
      {runs.length === 0 && <p className="adm-empty">No runs yet.</p>}
      {runs.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Started</th><th>Outcome</th><th>Score</th><th>Rewrites</th><th>Cost</th><th>Critic</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.started_at)}</td>
                  <td>{r.status}{r.error && <div className="adm-small adm-danger">{r.error}</div>}</td>
                  <td>{r.score ?? "—"}</td>
                  <td>{r.rewrites ?? "—"}</td>
                  <td>{r.cost_usd !== null ? `$${Number(r.cost_usd).toFixed(2)}` : "—"}</td>
                  <td className="adm-small">
                    {r.critic?.wentWell.map((x, i) => <div key={`w${i}`}>+ {x}</div>)}
                    {r.critic?.wentBadly.map((x, i) => <div key={`b${i}`}>− {x}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {archived.length > 0 && (
        <details>
          <summary>Archived articles ({archived.length})</summary>
          {archived.map((p) => (
            <div key={p.id} className="adm-actions">
              <span>{p.title}</span>
              <StatusButton id={p.id} status="draft" label="Back to drafts" />
              <form action={deleteJournalPost} className="adm-inline">
                <input type="hidden" name="id" value={p.id} />
                <button type="submit" className="adm-btn adm-btn--danger">Delete</button>
              </form>
            </div>
          ))}
        </details>
      )}
    </>
  );
}
