import Link from "next/link";
import { select } from "@/lib/concierge/db";
import { requireStaff } from "@/lib/admin/session";
import { one, type SP } from "@/components/admin/Flash";
import { fulfilmentLabels, money, orderStatusLabels, paymentLabels, when } from "@/lib/admin/labels";

export const metadata = { title: "Orders" };

export default async function Orders({ searchParams }: { searchParams: SP }) {
  const { api, token } = await requireStaff();
  const sp = await searchParams;
  const status = one(sp.status) && orderStatusLabels[one(sp.status)!] ? one(sp.status)! : null;
  const includeTest = one(sp.test) === "1";
  const query: Record<string, string> = { select: "id,reference,status,currency,total_amount,payment_status,fulfilment_status,tracking_number,is_test,created_at,customers(name,phone_e164)", order: "created_at.desc", limit: "200" };
  if (status) query.status = `eq.${status}`;
  if (!includeTest) query.is_test = "is.false";
  const rows = await select<{ id: string; reference: string; status: string; currency: string; total_amount: string; payment_status: string; fulfilment_status: string; tracking_number: string | null; is_test: boolean; created_at: string; customers: { name: string | null; phone_e164: string | null } }[]>(api, "orders", query, token);
  return (
    <>
      <h1 className="adm-h1">Orders</h1>
      <p className="adm-muted adm-small">Orders are entered by the owner from a request or a customer record. Payment and delivery are tracked separately.</p>
      <form className="adm-filters">
        <label>Status<select name="status" defaultValue={status ?? ""}><option value="">Any</option>{Object.entries(orderStatusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="adm-check"><input type="checkbox" name="test" value="1" defaultChecked={includeTest} /> Include test records</label>
        <button type="submit" className="adm-btn adm-btn--dark">Filter</button>
      </form>
      {rows.length === 0 ? <p className="adm-empty">No orders yet.</p> : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th scope="col">Created</th><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Total</th><th scope="col">Payment</th><th scope="col">Delivery</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>{when(o.created_at)}</td>
                  <td><Link href={`/admin/orders/${o.id}`} className="adm-ref">{o.reference}</Link>{o.is_test && <span className="adm-badge adm-badge--test">Test</span>}</td>
                  <td>{o.customers?.name || "—"}</td>
                  <td>{money(o.total_amount, o.currency)}</td>
                  <td>{paymentLabels[o.payment_status]}</td>
                  <td>{fulfilmentLabels[o.fulfilment_status]}{o.tracking_number ? ` · ${o.tracking_number}` : ""}</td>
                  <td>{orderStatusLabels[o.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
