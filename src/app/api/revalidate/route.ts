import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { CATALOG_TAG } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/**
 * Called by Supabase (see supabase/migrations/*_catalogue_revalidation.sql) whenever products or
 * product images change. Expires the cached catalogue so the next visit shows the new data.
 */
export async function POST(request: Request) {
  const expected = process.env.CATALOG_REVALIDATE_SECRET?.trim();
  if (!expected) return NextResponse.json({ error: "Revalidation is not configured." }, { status: 503 });

  const given = Buffer.from(request.headers.get("x-revalidate-secret") ?? "");
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  revalidateTag(CATALOG_TAG, { expire: 0 });
  return NextResponse.json({ revalidated: true, tag: CATALOG_TAG, at: new Date().toISOString() });
}
