import Link from "next/link";
import { requireStaff } from "@/lib/admin/session";
import { logout } from "../actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { staff, isOwner } = await requireStaff();
  return (
    <div className="adm-shell">
      <header className="adm-top">
        <Link href="/admin" className="adm-top__brand">
          SEVN HEVN <span>Private panel</span>
        </Link>
        <nav aria-label="Panel" className="adm-nav">
          <Link href="/admin">Requests</Link>
          <Link href="/admin/customers">Customers</Link>
          <Link href="/admin/orders">Orders</Link>
          {isOwner && <Link href="/admin/knowledge">Store knowledge</Link>}
          {isOwner && <Link href="/admin/team">Team</Link>}
          <Link href="/admin/settings">Settings</Link>
        </nav>
        <div className="adm-top__me">
          <span>
            {staff.display_name || staff.email} <span className={`adm-badge adm-badge--${staff.role}`}>{staff.role === "owner" ? "Owner" : "Staff"}</span>
          </span>
          <form action={logout}>
            <button type="submit" className="adm-link">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="adm-main">{children}</main>
    </div>
  );
}
