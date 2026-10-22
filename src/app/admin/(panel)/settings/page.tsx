import { select } from "@/lib/concierge/db";
import { aiConfig, conciergeServer, emailConfig, whatsappConfig } from "@/lib/concierge/config";
import { requireStaff } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { dutiesLabels, when } from "@/lib/admin/labels";
import { getPaymentProvider } from "@/lib/payments";
import { changePassword, testEmail } from "../../actions";
import { savePolicy, saveShippingZone, saveShopSettings, setPolicyStatus } from "../../order-actions";

type ShopSettings = {
  reservation_minutes: number; quote_valid_hours: number; vat_trn: string | null; vat_rate_percent: string | null; prices_include_vat: boolean | null;
  change_of_mind_days: number | null; dispatch_alert_days: number; supplier_alert_days: number; customer_emails_enabled: boolean; updated_at: string;
};
type Zone = {
  id: number; name: string; fee_aed: string | null; transit_days_min: number | null; transit_days_max: number | null; vat_treatment: string; duties_treatment: string;
  duties_note: string | null; carrier_note: string | null; active: boolean; shipping_zone_countries: { country: string }[];
};
type Policy = { id: number; kind: string; version: string; title: string; body: string; status: string; approved_at: string | null; created_at: string };
const policyKinds: Record<string, string> = { terms_of_sale: "Terms of sale", returns: "Returns and refunds", shipping: "Shipping and delivery", privacy: "Privacy" };

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
  const [shop, zones, policies] = await Promise.all([
    select<ShopSettings[]>(api, "shop_settings", { select: "*" }, token).catch(() => [] as ShopSettings[]),
    select<Zone[]>(api, "shipping_zones", { select: "*,shipping_zone_countries(country)", order: "position.asc,id.asc" }, token).catch(() => [] as Zone[]),
    select<Policy[]>(api, "policy_versions", { select: "*", order: "kind.asc,created_at.desc" }, token).catch(() => [] as Policy[]),
  ]);
  const st = shop[0];
  const approved = (kind: string) => policies.some((p) => p.kind === kind && p.status === "approved");
  const onlineReady = !!getPaymentProvider() && !!st?.vat_rate_percent && st.prices_include_vat !== null && approved("terms_of_sale") && approved("returns") && zones.some((z) => z.active && z.fee_aed !== null && z.vat_treatment !== "unknown" && z.duties_treatment !== "unknown");
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

      {st && (
        <section className="adm-card" id="shop">
          <h2>Shop rules{isOwner ? "" : " (set by the owner)"}</h2>
          <dl className="adm-dl">
            <dt>Online payment</dt>
            <dd>
              <State ok={onlineReady} label={onlineReady ? "On" : "Off"} />
              <span className="adm-muted adm-small">
                {" "}· needs a payment provider with a merchant account{getPaymentProvider() ? " ✓" : " (not connected)"}, the VAT rate and price basis{st.vat_rate_percent && st.prices_include_vat !== null ? " ✓" : ""},
                {" "}a shipping zone with a fee, VAT and duties{zones.some((z) => z.active && z.fee_aed !== null && z.vat_treatment !== "unknown" && z.duties_treatment !== "unknown") ? " ✓" : ""},
                {" "}and approved terms of sale{approved("terms_of_sale") ? " ✓" : ""} and returns policy{approved("returns") ? " ✓" : ""}. Until then checkout sends purchase requests.
              </span>
            </dd>
          </dl>
          {isOwner && (
            <form action={saveShopSettings} className="adm-form">
              <fieldset className="adm-fieldset">
                <legend>VAT (confirm with your accountant)</legend>
                <div className="adm-row">
                  <label>TRN (15 digits)<input name="vat_trn" defaultValue={st.vat_trn ?? ""} pattern="[0-9]{15}" maxLength={15} /></label>
                  <label>Standard rate %<input name="vat_rate_percent" inputMode="decimal" defaultValue={st.vat_rate_percent ?? ""} pattern="[0-9]{1,2}(\.[0-9]{1,2})?" /></label>
                  <label>
                    Listed prices
                    <select name="prices_include_vat" defaultValue={st.prices_include_vat === null ? "" : String(st.prices_include_vat)}>
                      <option value="">Not decided</option>
                      <option value="true">Include VAT</option>
                      <option value="false">Exclude VAT (added at checkout)</option>
                    </select>
                  </label>
                </div>
              </fieldset>
              <fieldset className="adm-fieldset">
                <legend>Returns, quotes and holds</legend>
                <div className="adm-row">
                  <label>Change-of-mind returns of in-stock pieces: days after delivery (empty: not offered)<input name="change_of_mind_days" type="number" min={1} max={365} defaultValue={st.change_of_mind_days ?? ""} /></label>
                  <label>Quote valid for (hours)<input name="quote_valid_hours" type="number" min={1} max={720} defaultValue={st.quote_valid_hours} /></label>
                  <label>Checkout holds the piece for (minutes)<input name="reservation_minutes" type="number" min={15} max={1440} defaultValue={st.reservation_minutes} /></label>
                </div>
                <p className="adm-muted adm-small">Faulty, damaged, wrong, misdescribed or inauthentic pieces can always be reported; you review every return request.</p>
              </fieldset>
              <fieldset className="adm-fieldset">
                <legend>Team alerts</legend>
                <div className="adm-row">
                  <label>Dispatch overdue after (days)<input name="dispatch_alert_days" type="number" min={1} max={60} defaultValue={st.dispatch_alert_days} /></label>
                  <label>Supplier must confirm within (days)<input name="supplier_alert_days" type="number" min={1} max={60} defaultValue={st.supplier_alert_days} /></label>
                </div>
              </fieldset>
              <label className="adm-check">
                <input type="checkbox" name="customer_emails_enabled" defaultChecked={st.customer_emails_enabled} /> Send customers order e-mails (confirmed, shipped, delivered, cancelled, refunds, returns). Approve the wording in docs/ORDERS.md first.
              </label>
              <button type="submit" className="adm-btn adm-btn--dark">Save the rules</button>
            </form>
          )}

          <h3>Shipping zones</h3>
          {zones.length === 0 && <p className="adm-muted adm-small">None yet: online payment needs at least one.</p>}
          {zones.map((z) => (
            <details key={z.id}>
              <summary>{z.name}{z.active ? "" : " (off)"} · {z.shipping_zone_countries.map((c) => c.country).join(", ") || "no countries"} · {z.fee_aed === null ? "quoted per order" : `AED ${z.fee_aed}`} · VAT {z.vat_treatment} · duties {dutiesLabels[z.duties_treatment]}</summary>
              {isOwner && <ZoneForm z={z} />}
            </details>
          ))}
          {isOwner && (
            <details>
              <summary>Add a shipping zone</summary>
              <ZoneForm />
            </details>
          )}

          <h3>Policies</h3>
          <p className="adm-muted adm-small">The customer accepts the approved terms of sale and returns policy before paying, and the order records the versions. Have the texts reviewed for the UAE (and the countries you ship to) before approving them. An approved text can’t be edited: write a new version.</p>
          {Object.entries(policyKinds).map(([kind, title]) => (
            <div key={kind}>
              <h4>{title}</h4>
              <ul className="adm-notes adm-small">
                {policies.filter((p) => p.kind === kind).map((p) => (
                  <li key={p.id}>
                    {p.version} · {p.title} · <span className={`adm-badge adm-badge--k-${p.status}`}>{p.status}</span>{p.approved_at ? ` · approved ${when(p.approved_at)}` : ""}
                    {isOwner && p.status !== "retired" && (
                      <form action={setPolicyStatus} className="adm-inline">
                        <input type="hidden" name="policy_id" value={p.id} />
                        <button type="submit" name="status" value={p.status === "draft" ? "approved" : "retired"} className="adm-link">{p.status === "draft" ? "Approve" : "Retire"}</button>
                      </form>
                    )}
                    {isOwner && p.status === "draft" && (
                      <details>
                        <summary>Edit</summary>
                        <PolicyForm kind={kind} p={p} />
                      </details>
                    )}
                  </li>
                ))}
              </ul>
              {isOwner && (
                <details>
                  <summary>New version</summary>
                  <PolicyForm kind={kind} />
                </details>
              )}
            </div>
          ))}
        </section>
      )}

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

function ZoneForm({ z }: { z?: Zone }) {
  return (
    <form action={saveShippingZone} className="adm-form">
      <input type="hidden" name="zone_id" value={z?.id ?? ""} />
      <div className="adm-row">
        <label>Name<input name="name" required defaultValue={z?.name ?? ""} maxLength={80} /></label>
        <label>Countries (2-letter codes)<input name="countries" defaultValue={z?.shipping_zone_countries.map((c) => c.country).join(", ") ?? ""} placeholder="AE or GB, FR, DE" /></label>
      </div>
      <div className="adm-row">
        <label>Fee per parcel, AED (empty: quoted per order)<input name="fee_aed" inputMode="decimal" defaultValue={z?.fee_aed ?? ""} pattern="[0-9,]+(\.[0-9]{1,2})?" /></label>
        <label>Transit days from<input name="transit_days_min" type="number" min={0} max={90} defaultValue={z?.transit_days_min ?? ""} /></label>
        <label>to<input name="transit_days_max" type="number" min={0} max={90} defaultValue={z?.transit_days_max ?? ""} /></label>
      </div>
      <div className="adm-row">
        <label>VAT<select name="vat_treatment" defaultValue={z?.vat_treatment ?? "unknown"}><option value="unknown">Not decided</option><option value="standard">Standard VAT</option><option value="zero_rated">Zero-rated (export)</option></select></label>
        <label>Import duties<select name="duties_treatment" defaultValue={z?.duties_treatment ?? "unknown"}>{Object.entries(dutiesLabels).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
      </div>
      <label>Duties note for the customer<input name="duties_note" defaultValue={z?.duties_note ?? ""} maxLength={400} /></label>
      <label>What the carrier confirmed about cover (internal)<input name="carrier_note" defaultValue={z?.carrier_note ?? ""} maxLength={600} /></label>
      <label className="adm-check"><input type="checkbox" name="active" defaultChecked={z?.active ?? true} /> Active</label>
      <button type="submit" className="adm-btn adm-btn--dark">{z ? "Save the zone" : "Add the zone"}</button>
    </form>
  );
}

function PolicyForm({ kind, p }: { kind: string; p?: Policy }) {
  return (
    <form action={savePolicy} className="adm-form">
      <input type="hidden" name="policy_id" value={p?.id ?? ""} />
      <input type="hidden" name="kind" value={kind} />
      <div className="adm-row">
        <label>Version<input name="version" required defaultValue={p?.version ?? ""} pattern="[A-Za-z0-9._-]{1,40}" placeholder="2026-11" /></label>
        <label>Title<input name="title" required defaultValue={p?.title ?? policyKinds[kind]} maxLength={160} /></label>
      </div>
      <label>Text (plain text; blank lines start a new paragraph)<textarea name="body" rows={12} required defaultValue={p?.body ?? ""} maxLength={40000} /></label>
      <button type="submit" className="adm-btn adm-btn--dark">Save as draft</button>
    </form>
  );
}
