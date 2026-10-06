import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_MAX_AGE, cookieOptions, refreshSession, tokenExpiresAt } from "@/lib/admin/gotrue";

/**
 * Private panel only (/admin): keeps the sign-in session fresh and sends signed-out visitors to the
 * sign-in page. This is a convenience layer; every page and action still checks the person's role
 * on the server, and the database enforces it again.
 */
const OPEN_PATHS = new Set(["/admin/login", "/admin/setup", "/admin/reset"]);

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const open = OPEN_PATHS.has(path);
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;

  let response = NextResponse.next();
  const needsRefresh = refresh && (!access || tokenExpiresAt(access) - Date.now() < 90_000);

  if (needsRefresh) {
    const session = await refreshSession(refresh);
    if (session) {
      request.cookies.set(ACCESS_COOKIE, session.access_token);
      request.cookies.set(REFRESH_COOKIE, session.refresh_token);
      response = NextResponse.next({ request });
      response.cookies.set(ACCESS_COOKIE, session.access_token, cookieOptions(session.expires_in));
      response.cookies.set(REFRESH_COOKIE, session.refresh_token, cookieOptions(REFRESH_MAX_AGE));
    } else {
      request.cookies.delete(ACCESS_COOKIE);
      request.cookies.delete(REFRESH_COOKIE);
      response = open ? NextResponse.next({ request }) : NextResponse.redirect(new URL("/admin/login", request.url));
      // __Host- cookies can only be cleared with the same Secure/Path attributes they were set with.
      response.cookies.set(ACCESS_COOKIE, "", cookieOptions(0));
      response.cookies.set(REFRESH_COOKIE, "", cookieOptions(0));
    }
  } else if (!access && !open) {
    const login = new URL("/admin/login", request.url);
    if (path !== "/admin") login.searchParams.set("next", path);
    response = NextResponse.redirect(login);
  }

  response.headers.set("cache-control", "private, no-store");
  response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
