import { rpc } from "@/lib/concierge/db";
import { requireOwner } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { when } from "@/lib/admin/labels";
import { addStaff, updateStaff } from "../../actions";

export const metadata = { title: "Team" };

export default async function Team({ searchParams }: { searchParams: SP }) {
  const { api, token, staff: me } = await requireOwner();
  const sp = await searchParams;
  const team = await rpc<{ id: string; email: string; display_name: string | null; role: string; active: boolean; linked: boolean; created_at: string }[]>(api, "admin_list_staff", {}, token);
  return (
    <>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <h1 className="adm-h1">Team</h1>
      <p className="adm-muted">
        <strong>Owner</strong>: everything. <strong>Staff</strong>: see all customers, requests and orders; add notes and call results; update follow-up and delivery details.
        Staff cannot approve prices or payments, create or delete records, export data, manage the team or change settings. The database enforces these limits.
      </p>
      <section className="adm-card adm-narrow">
        <h2>Add a person</h2>
        <form action={addStaff} className="adm-form">
          <label>Email<input name="email" type="email" required maxLength={254} /></label>
          <label>Name<input name="display_name" maxLength={80} /></label>
          <label>Role<select name="role" defaultValue="staff"><option value="staff">Staff</option><option value="owner">Owner</option></select></label>
          <button type="submit" className="adm-btn adm-btn--dark">Add</button>
          <p className="adm-muted adm-small">They then open /admin/setup, choose a password and confirm their email. No one can sign up without being added here.</p>
        </form>
      </section>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Access</th><th scope="col">Added</th><th scope="col">Change</th></tr></thead>
          <tbody>
            {team.map((s) => (
              <tr key={s.id}>
                <td>{s.display_name ?? "—"}{s.id === me.staff_id && <span className="adm-badge">You</span>}</td>
                <td>{s.email}</td>
                <td>{s.role === "owner" ? "Owner" : "Staff"}</td>
                <td>{!s.active ? "Deactivated" : s.linked ? "Active" : "Invited (not set up yet)"}</td>
                <td>{when(s.created_at)}</td>
                <td>
                  <form action={updateStaff} className="adm-inline">
                    <input type="hidden" name="id" value={s.id} />
                    <select name="role" defaultValue={s.role} aria-label={`Role for ${s.email}`}><option value="staff">Staff</option><option value="owner">Owner</option></select>
                    <select name="active" defaultValue={String(s.active)} aria-label={`Access for ${s.email}`}><option value="true">Active</option><option value="false">Deactivated</option></select>
                    <button type="submit" className="adm-btn">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
