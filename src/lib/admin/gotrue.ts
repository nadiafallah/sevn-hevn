/**
 * Supabase Auth (GoTrue) over its REST API, server-side only (used by the proxy and server actions).
 * The publishable key identifies the project; passwords and tokens never reach browser JavaScript:
 * the session lives in httpOnly, Secure, SameSite=Lax cookies.
 */

export const ACCESS_COOKIE = "__Host-sh_at";
export const REFRESH_COOKIE = "__Host-sh_rt";
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function api() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

export function authAvailable() {
  return api() !== null;
}

async function call(path: string, init: { method: string; body?: unknown; token?: string }) {
  const a = api();
  if (!a) return { ok: false as const, status: 503, data: null };
  try {
    const res = await fetch(`${a.url}/auth/v1/${path}`, {
      method: init.method,
      headers: { apikey: a.key, "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false as const, status: 503, data: null };
  }
}

const asSession = (d: Record<string, unknown> | null): AuthSession | null =>
  d && typeof d.access_token === "string" && typeof d.refresh_token === "string"
    ? { access_token: d.access_token, refresh_token: d.refresh_token, expires_in: Number(d.expires_in) || 3600 }
    : null;

export async function signInWithPassword(email: string, password: string) {
  const r = await call("token?grant_type=password", { method: "POST", body: { email, password } });
  return { session: r.ok ? asSession(r.data) : null, status: r.status, code: typeof r.data?.error_code === "string" ? r.data.error_code : undefined };
}

export async function refreshSession(refreshToken: string) {
  const r = await call("token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refreshToken } });
  return r.ok ? asSession(r.data) : null;
}

export async function signOut(accessToken: string) {
  await call("logout?scope=local", { method: "POST", token: accessToken });
}

/** Creates the account for an invited team member; Supabase e-mails a confirmation link. */
export async function signUp(email: string, password: string, redirectTo: string) {
  const r = await call(`signup?redirect_to=${encodeURIComponent(redirectTo)}`, { method: "POST", body: { email, password } });
  return { ok: r.ok, status: r.status, code: typeof r.data?.error_code === "string" ? r.data.error_code : undefined };
}

export async function sendRecovery(email: string, redirectTo: string) {
  const r = await call(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: "POST", body: { email } });
  return r.ok;
}

export async function updatePassword(accessToken: string, password: string) {
  const r = await call("user", { method: "PUT", token: accessToken, body: { password } });
  return { ok: r.ok, code: typeof r.data?.error_code === "string" ? r.data.error_code : undefined };
}

/** Reads the expiry from a JWT without trusting it (only to decide when to refresh; the database verifies tokens). */
export function tokenExpiresAt(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")) as { exp?: number };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});
