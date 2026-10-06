import { select } from "@/lib/concierge/db";
import { aiConfig, conciergeServer, emailConfig, whatsappConfig } from "@/lib/concierge/config";
import { requireStaff } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { when } from "@/lib/admin/labels";
import { changePassword, testEmail } from "../../actions";

export const metadata = { title: "Settings" };

function State({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`adm-badge ${ok ? "adm-badge--n-sent" : "adm-badge--n-not_configured"}`}>{label}</span>;
}

export default async function Settings({ searchParams }: { searchParams: SP }) {
  const { api, token, isOwner } = await requireStaff();
  const sp = await searchParams;
  const ai = aiConfig();
  const email = emailConfig();
  const wa = whatsappConfig();
  const audit = isOwner
    ? await select<{ id: number; actor_label: string; action: string; entity: string; entity_id: string | null; created_at: string }[]>(api, "audit_log", { select: "id,actor_label,action,entity,entity_id,created_at", order: "id.desc", limit: "60" }, token)
    : [];
  return (
    <>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <h1 className="adm-h1">Settings</h1>

      <section className="adm-card">
        <h2>Connections</h2>
        <dl className="adm-dl">
          <dt>Chat requests (database)</dt><dd><State ok={conciergeServer() !== null} label={conciergeServer() ? "Connected" : "Not available in this environment"} /></dd>
          <dt>Email notifications</dt>
          <dd>
            <State ok={!!email} label={email ? "Connected" : "Needs connection"} />
            {email ? <span className="adm-muted adm-small"> · to {email.to} via {email.host}</span> : <span className="adm-muted adm-small"> · set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, NOTIFY_EMAIL_TO in Vercel (Production)</span>}
          </dd>
          <dt>WhatsApp notifications</dt>
          <dd>
            <State ok={!!wa} label={wa ? "Connected" : "Needs connection"} />
            {!wa && <span className="adm-muted adm-small"> · requires the WhatsApp Business Platform (Meta Cloud API) and an approved template; see docs/CONCIERGE.md</span>}
          </dd>
          <dt>Order checks in the chat</dt><dd><State ok={!!email} label={email ? "On (codes by email)" : "Off until email is connected: customers are offered a call back instead"} /></dd>
          <dt>AI assistance</dt>
          <dd>
            <State ok={!!ai} label={ai ? `On (${ai.model})` : "Off"} />
            <span className="adm-muted adm-small"> · {ai ? `limits: ${ai.perConversation} per conversation, ${ai.perDay} per day` : "the chat works fully without it"}</span>
          </dd>
        </dl>
        {isOwner && email && (
          <form action={testEmail}>
            <button type="submit" className="adm-btn">Send a test email to {email.to}</button>
          </form>
        )}
      </section>

      {isOwner && (
        <section className="adm-card">
          <h2>Export (owner)</h2>
          <p className="adm-muted adm-small">CSV files with personal data. Every export is recorded in the activity log. Store them safely and delete them when no longer needed.</p>
          <div className="adm-actions">
            {["requests", "customers", "orders"].map((k) => (
              <form key={k} action="/admin/export" method="post" className="adm-inline">
                <input type="hidden" name="kind" value={k} />
                <button type="submit" className="adm-btn">Export {k}</button>
              </form>
            ))}
          </div>
        </section>
      )}

      <section className="adm-card adm-narrow">
        <h2>Change your password</h2>
        <form action={changePassword} className="adm-form">
          <label>New password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} /></label>
          <label>Repeat<input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={200} /></label>
          <button type="submit" className="adm-btn adm-btn--dark">Change password</button>
        </form>
      </section>

      {isOwner && (
        <section className="adm-card">
          <h2>Activity log</h2>
          <ul className="adm-notes adm-small">
            {audit.map((a) => <li key={a.id}>{when(a.created_at)} · {a.actor_label} · {a.action} · {a.entity}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}
