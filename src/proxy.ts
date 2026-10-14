import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_MAX_AGE, cookieOptions, refreshSession, tokenExpiresAt } from "@/lib/admin/gotrue";
import { RETIRED_LOCALE_COOKIE, defaultLocale, retiredLocales } from "@/i18n/config";
import { brandAllowedIn, findBrand } from "@/data/brands";
import { isCategoryId } from "@/data/taxonomy";

/**
 * Two jobs:
 * 1. Website addresses. The site is English only: pages live at the unprefixed addresses (/,
 *    /collection, /chat), served internally from /en/…. The retired Arabic, Russian and French
 *    addresses (/ar/…, /ru/…, /fr/…) and /en/… redirect permanently to the unprefixed English page,
 *    so every page has one URL. A language choice remembered by the former selector is ignored and
 *    its cookie cleared, so nothing switches a visitor away from English.
 * 2. Private panel (/admin): keeps the sign-in session fresh and sends signed-out visitors to the
 *    sign-in page. This is a convenience layer; every page and action still checks the person's
 *    role on the server, and the database enforces it again.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/admin" || path.startsWith("/admin/")) return admin(request);
  return pages(request);
}

/**
 * Addresses from before the shop pages (Oct 2026) move permanently to their new place:
 *   /collection?item=REF            → /product/REF
 *   /collection?category=bags       → /bags   (with ?designer=Hermès → /bags/hermes)
 *   /collection?category=accessories → /jewellery (Jewellery replaced Accessories)
 * The search text is kept.
 */
function legacyShopAddress(path: string, params: URLSearchParams): string | null {
  if (path !== "/collection") return null;
  const item = params.get("item");
  if (item && /^[A-Za-z0-9-]{2,40}$/.test(item)) return `/product/${encodeURIComponent(item)}`;
  const category = params.get("category");
  if (!category) return null;
  const target = category === "accessories" ? "jewellery" : isCategoryId(category) ? category : null;
  const keep = new URLSearchParams();
  for (const k of ["q", "sort"]) {
    const v = params.get(k);
    if (v) keep.set(k, v);
  }
  const qs = keep.toString() ? `?${keep}` : "";
  if (!target) return `/collection${qs}`;
  const brand = findBrand(params.get("designer") ?? params.get("brand"));
  const brandPart = brand && brandAllowedIn(target, brand.name) ? `/${brand.id}` : "";
  return `/${target}${brandPart}${qs}`;
}

/** "/ar/collection" → "/collection", "/fr" → "/", "/en/chat" → "/chat". */
const LANGUAGE_PREFIX = new RegExp(`^/(?:${[defaultLocale, ...retiredLocales].join("|")})(?=/|$)`);

function pages(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  const prefix = pathname.match(LANGUAGE_PREFIX)?.[0];
  const path = prefix ? pathname.slice(prefix.length) || "/" : pathname;

  const moved = legacyShopAddress(path, searchParams);
  const response = moved
    ? NextResponse.redirect(new URL(moved, request.url), 308)
    : prefix
      ? NextResponse.redirect(new URL(`${path}${search}`, request.url), 308)
      : NextResponse.rewrite(new URL(`/${defaultLocale}${path === "/" ? "" : path}${search}`, request.url));

  if (request.cookies.has(RETIRED_LOCALE_COOKIE)) {
    response.cookies.set(RETIRED_LOCALE_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax", secure: request.nextUrl.protocol === "https:" });
  }
  return response;
}

const OPEN_PATHS = new Set(["/admin/login", "/admin/setup", "/admin/reset"]);

async function admin(request: NextRequest) {
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
  // Every page except API routes, Next.js internals and files with an extension (images, icons,
  // robots.txt, sitemap.xml, …).
  matcher: ["/((?!api/|_next/|_vercel/|.*\\.[A-Za-z0-9]+$).*)"],
};
