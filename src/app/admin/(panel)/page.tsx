import Link from "next/link";
import { rpc, select } from "@/lib/concierge/db";
import { requireStaff } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { requestStatusLabels, requestTypeLabels, reviewLabels, when } from "@/lib/admin/labels";

export const metadata = { title: "Requests" };

interface Row {
  id: string;
  reference: string;
  type: string;
  status: string;
  summary: string;
  needs_review: string | null;
  locale: string;
  destination_label: string | null;
  contact_name: string | null;
  contact_phone: string;
  assigned_to: string | null;
  follow_up_at: string | null;
  created_at: string;
  is_test: boolean;
}

const PAGE = 50;

export default async function Requests({ searchParams }: { searchParams: SP }) {
  const { api, token } = await requireStaff();
  const sp = await searchParams;
  const q = one(sp.q)?.slice(0, 80) ?? "";
  const status = one(sp.status) && requestStatusLabels[one(sp.status)!] ? one(sp.status)! : null;
  const type = one(sp.type) && requestTypeLabels[one(sp.type)!] ? one(sp.type)! : null;
  const locale = one(sp.lang) === "ar" || one(sp.lang) === "en" ? one(sp.lang)! : null;
  const assignee = /^[0-9a-f-]{36}$/.test(one(sp.assignee) ?? "") ? one(sp.assignee)! : null;
  const destination = /^[A-Z]{2}$/.test(one(sp.dest) ?? "") ? one(sp.dest)! : null;
  const review = one(sp.review) === "1";
  const includeTest = one(sp.test) === "1";
  const page = Math.max(0, Number(one(sp.page) ?? 0) || 0);

  const [stats, list, team] = await Promise.all([
    rpc<Record<string, number>>(api, "admin_dashboard", {}, token),
    rpc<{ total: number; rows: Row[] }>(api, "admin_list_requests", {
      p_q: q || null, p_status: status, p_type: type, p_assignee: assignee, p_locale: locale, p_destination: destination,
      p_review: review, p_include_test: includeTest, p_limit: PAGE, p_offset: page * PAGE,
    }, token),
    select<{ id: string; display_name: string | null; active: boolean }[]>(api, "staff_members", { select: "id,display_name,active", order: "display_name.asc" }, token),
  ]);
  const names = Object.fromEntries(team.map((s) => [s.id, s.display_name ?? "Team member"]));
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "ok" && k !== "error") p.set(k, v);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `?${p}`;
  };

  return (
    <>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <section aria-label="Overview" className="adm-stats">
        {[
          ["New", stats.new, "?status=new"],
          ["Waiting for approval", stats.awaiting_approval, "?status=awaiting_approval"],
          ["Need your confirmation", stats.needs_review, "?review=1"],
          ["Follow-ups due", stats.follow_ups_due, "?status=in_progress"],
          ["Open orders", stats.open_orders, "/admin/orders"],
          ["Requests, last 7 days", stats.last_7_days, "?"],
        ].map(([label, n, href]) => (
          <Link key={label as string} href={href as string} className="adm-stat">
            <span className="adm-stat__n">{n as number}</span>
            <span className="adm-stat__l">{label as string}</span>
          </Link>
        ))}
      </section>
      {stats.notifications_failed > 0 && (
        <p className="adm-flash adm-flash--error">{stats.notifications_failed} notification(s) failed. Open the request to see the error and retry.</p>
      )}

      <h1 className="adm-h1">Requests</h1>
      <form className="adm-filters" role="search">
        <label>
          Search
          <input name="q" defaultValue={q} placeholder="Reference, name, phone, brand…" maxLength={80} />
        </label>
        <label>
          Status
          <select name="status" defaultValue={status ?? ""}>
            <option value="">Any</option>
            {Object.entries(requestStatusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          Type
          <select name="type" defaultValue={type ?? ""}>
            <option value="">Any</option>
            {Object.entries(requestTypeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          Assigned to
          <select name="assignee" defaultValue={assignee ?? ""}>
            <option value="">Anyone</option>
            {team.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.display_name ?? "Team member"}</option>)}
          </select>
        </label>
        <label>
          Language
          <select name="lang" defaultValue={locale ?? ""}>
            <option value="">Any</option>
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </select>
        </label>
        <label>
          Destination (country code)
          <input name="dest" defaultValue={destination ?? ""} placeholder="AE" maxLength={2} pattern="[A-Za-z]{2}" />
        </label>
        <label className="adm-check">
          <input type="checkbox" name="review" value="1" defaultChecked={review} /> Needs confirmation
        </label>
        <label className="adm-check">
          <input type="checkbox" name="test" value="1" defaultChecked={includeTest} /> Include test records
        </label>
        <button type="submit" className="adm-btn adm-btn--dark">Filter</button>
        <Link href="/admin" className="adm-link">Clear</Link>
      </form>

      <p className="adm-muted adm-small">{list.total} request{list.total === 1 ? "" : "s"}</p>
      {list.rows.length === 0 ? (
        <p className="adm-empty">No requests match. New chat requests appear here as soon as they are saved.</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Received</th>
                <th scope="col">Reference</th>
                <th scope="col">Customer</th>
                <th scope="col">Request</th>
                <th scope="col">Status</th>
                <th scope="col">Assigned</th>
                <th scope="col">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.created_at)}</td>
                  <td>
                    <Link href={`/admin/requests/${r.id}`} className="adm-ref">{r.reference}</Link>
                    {r.is_test && <span className="adm-badge adm-badge--test">Test</span>}
                  </td>
                  <td>
                    {r.contact_name || "—"}
                    <br />
                    <span className="adm-muted adm-ltr">{r.contact_phone}</span>
                  </td>
                  <td>
                    <span className="adm-muted">{requestTypeLabels[r.type]} · {r.locale === "ar" ? "Arabic" : "English"}{r.destination_label ? ` · ${r.destination_label}` : ""}</span>
                    <br />
                    <span dir="auto">{r.summary}</span>
                    {r.needs_review && <span className="adm-badge adm-badge--review">Confirm: {reviewLabels[r.needs_review]}</span>}
                  </td>
                  <td><span className={`adm-status adm-status--${r.status}`}>{requestStatusLabels[r.status]}</span></td>
                  <td>{r.assigned_to ? names[r.assigned_to] : "—"}</td>
                  <td>{when(r.follow_up_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="adm-pager" aria-label="Pages">
        {page > 0 && <Link href={qs({ page: String(page - 1) })}>← Newer</Link>}
        {(page + 1) * PAGE < list.total && <Link href={qs({ page: String(page + 1) })}>Older →</Link>}
      </nav>
    </>
  );
}
