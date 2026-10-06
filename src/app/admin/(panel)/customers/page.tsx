import Link from "next/link";
import { select } from "@/lib/concierge/db";
import { formatPhone } from "@/lib/concierge/phone";
import { requireStaff } from "@/lib/admin/session";
import { one, type SP } from "@/components/admin/Flash";
import { methodLabels, when } from "@/lib/admin/labels";

export const metadata = { title: "Customers" };

export default async function Customers({ searchParams }: { searchParams: SP }) {
  const { api, token } = await requireStaff();
  const sp = await searchParams;
  const q = (one(sp.q) ?? "").replace(/[^\p{L}\p{N} @.+-]/gu, "").slice(0, 60).trim();
  const includeTest = one(sp.test) === "1";
  const digits = q.replace(/\D/g, "");
  const query: Record<string, string> = {
    select: "id,name,phone_e164,email,preferred_language,preferred_contact,country_code,is_test,created_at,requests(count),orders(count)",
    order: "created_at.desc",
    limit: "200",
  };
  if (!includeTest) query.is_test = "is.false";
  if (q) {
    const like = `*${q.replace(/[*,()]/g, "")}*`;
    query.or = `(name.ilike.${like},email.ilike.${like}${digits.length >= 4 ? `,phone_e164.like.*${digits}*` : ""})`;
  }
  const rows = await select<{ id: string; name: string | null; phone_e164: string | null; email: string | null; preferred_language: string; preferred_contact: string | null; country_code: string | null; is_test: boolean; created_at: string; requests: { count: number }[]; orders: { count: number }[] }[]>(api, "customers", query, token);

  return (
    <>
      <h1 className="adm-h1">Customers</h1>
      <form className="adm-filters" role="search">
        <label>Search<input name="q" defaultValue={q} placeholder="Name, email or phone" maxLength={60} /></label>
        <label className="adm-check"><input type="checkbox" name="test" value="1" defaultChecked={includeTest} /> Include test records</label>
        <button type="submit" className="adm-btn adm-btn--dark">Search</button>
      </form>
      {rows.length === 0 ? <p className="adm-empty">No customers yet. They are created when a chat request is sent.</p> : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col">Language</th><th scope="col">Prefers</th><th scope="col">Requests</th><th scope="col">Orders</th><th scope="col">Since</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/admin/customers/${c.id}`}>{c.name || "Unnamed"}</Link>{c.is_test && <span className="adm-badge adm-badge--test">Test</span>}</td>
                  <td className="adm-ltr">{c.phone_e164 ? formatPhone(c.phone_e164) : "—"}</td>
                  <td>{c.email ?? "—"}</td>
                  <td>{c.preferred_language === "ar" ? "Arabic" : "English"}</td>
                  <td>{c.preferred_contact ? methodLabels[c.preferred_contact] : "—"}</td>
                  <td>{c.requests[0]?.count ?? 0}</td>
                  <td>{c.orders[0]?.count ?? 0}</td>
                  <td>{when(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
