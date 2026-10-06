import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseApi } from "@/lib/concierge/config";
import { DbError, rpc } from "@/lib/concierge/db";
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_MAX_AGE, cookieOptions, type AuthSession } from "./gotrue";

export interface Staff {
  staff_id: string;
  role: "owner" | "staff";
  display_name: string | null;
  email: string;
}

export interface PanelContext {
  staff: Staff;
  token: string;
  api: NonNullable<ReturnType<typeof supabaseApi>>;
  isOwner: boolean;
}

/**
 * The signed-in team member for this request, verified by the database (admin_session checks the
 * token's signature and the person's active team membership). Null when signed out or not on the team.
 */
export const currentStaff = cache(async (): Promise<PanelContext | null> => {
  const api = supabaseApi();
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!api || !token) return null;
  try {
    const staff = await rpc<Staff | null>(api, "admin_session", {}, token);
    return staff ? { staff, token, api, isOwner: staff.role === "owner" } : null;
  } catch (e) {
    // 404: the panel's database functions are not installed yet (one-time setup pending).
    if (e instanceof DbError && (e.status === 401 || e.status === 403 || e.status === 404)) return null;
    throw e;
  }
});

export async function requireStaff(): Promise<PanelContext> {
  const ctx = await currentStaff();
  if (!ctx) redirect("/admin/login");
  return ctx;
}

/** Owner-only pages and actions. The database checks this again for every change. */
export async function requireOwner(): Promise<PanelContext> {
  const ctx = await requireStaff();
  if (!ctx.isOwner) redirect("/admin?error=owner_only");
  return ctx;
}

export async function setSessionCookies(session: AuthSession) {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, session.access_token, cookieOptions(session.expires_in));
  jar.set(REFRESH_COOKIE, session.refresh_token, cookieOptions(REFRESH_MAX_AGE));
}

export async function clearSessionCookies() {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, "", cookieOptions(0));
  jar.set(REFRESH_COOKIE, "", cookieOptions(0));
}
