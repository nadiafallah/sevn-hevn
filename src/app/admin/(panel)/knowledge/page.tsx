import { select } from "@/lib/concierge/db";
import { requireOwner } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { day, knowledgeTopics, when } from "@/lib/admin/labels";
import { saveKnowledge, setKnowledgeStatus } from "../../actions";

export const metadata = { title: "Store knowledge" };

interface Entry {
  id: string;
  topic: string;
  country_code: string | null;
  locale: string;
  title: string;
  body: string;
  source: string;
  source_url: string | null;
  status: string;
  approved_at: string | null;
  approval_note: string | null;
  review_by: string | null;
  updated_at: string;
}

function Fields({ e }: { e?: Entry }) {
  return (
    <>
      <div className="adm-row">
        <label>Topic<select name="topic" defaultValue={e?.topic ?? "shipping"}>{knowledgeTopics.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label>Language<select name="locale" defaultValue={e?.locale ?? "en"}><option value="en">English</option><option value="ar">Arabic</option></select></label>
        <label>Country (blank = all)<input name="country_code" defaultValue={e?.country_code ?? ""} maxLength={2} pattern="[A-Za-z]{2}" placeholder="AE" /></label>
      </div>
      <label>Title<input name="title" required defaultValue={e?.title ?? ""} maxLength={160} /></label>
      <label>Text the chat may quote<textarea name="body" required rows={4} defaultValue={e?.body ?? ""} maxLength={2000} dir="auto" /></label>
      <div className="adm-row">
        <label>Source<input name="source" required defaultValue={e?.source ?? ""} maxLength={300} placeholder="e.g. Owner, 6 Oct 2026" /></label>
        <label>Source link (https, optional)<input name="source_url" type="url" defaultValue={e?.source_url ?? ""} pattern="https://.*" maxLength={500} /></label>
        <label>Review by (optional)<input name="review_by" type="date" defaultValue={e?.review_by ?? ""} /></label>
      </div>
    </>
  );
}

export default async function Knowledge({ searchParams }: { searchParams: SP }) {
  const { api, token } = await requireOwner();
  const sp = await searchParams;
  const rows = await select<Entry[]>(api, "knowledge_entries", { select: "*", order: "topic.asc,locale.asc,updated_at.desc" }, token);
  return (
    <>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <h1 className="adm-h1">Store knowledge</h1>
      <p className="adm-muted">
        The chat may quote only <strong>approved</strong> entries, word for word, with no additions. It never states prices, stock, delivery times, customs costs or warranties on its own;
        anything not covered here is passed to the team. After the “review by” date an entry is no longer quoted. Editing an entry sends it back to draft.
      </p>
      <details className="adm-card">
        <summary>Add an entry</summary>
        <form action={saveKnowledge} className="adm-form"><Fields /><button type="submit" className="adm-btn adm-btn--dark">Save as draft</button></form>
      </details>
      {rows.map((e) => (
        <section key={e.id} className="adm-card">
          <h2>
            {e.title} <span className={`adm-badge adm-badge--k-${e.status}`}>{e.status}</span>
          </h2>
          <p className="adm-muted adm-small">
            {e.topic} · {e.locale === "ar" ? "Arabic" : "English"} · {e.country_code ?? "all destinations"} · source: {e.source}
            {e.source_url && <> (<a href={e.source_url} target="_blank" rel="noopener noreferrer">link</a>)</>} · updated {when(e.updated_at)}
            {e.approved_at && ` · approved ${when(e.approved_at)}`}{e.review_by && ` · review by ${day(e.review_by)}`}
          </p>
          <p className="adm-quote" dir="auto">{e.body}</p>
          <div className="adm-actions">
            {e.status !== "approved" && (
              <form action={setKnowledgeStatus} className="adm-inline">
                <input type="hidden" name="id" value={e.id} /><input type="hidden" name="status" value="approved" />
                <input name="note" placeholder="Approval note (optional)" maxLength={300} />
                <button type="submit" className="adm-btn adm-btn--dark">Approve</button>
              </form>
            )}
            {e.status !== "retired" && (
              <form action={setKnowledgeStatus} className="adm-inline">
                <input type="hidden" name="id" value={e.id} /><input type="hidden" name="status" value="retired" />
                <button type="submit" className="adm-btn">Retire</button>
              </form>
            )}
          </div>
          <details>
            <summary>Edit</summary>
            <form action={saveKnowledge} className="adm-form"><input type="hidden" name="id" value={e.id} /><Fields e={e} /><button type="submit" className="adm-btn">Save as draft</button></form>
          </details>
        </section>
      ))}
    </>
  );
}
