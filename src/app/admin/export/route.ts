import { cookies } from "next/headers";
import { supabaseApi } from "@/lib/concierge/config";
import { DbError, rpc } from "@/lib/concierge/db";
import { ACCESS_COOKIE } from "@/lib/admin/gotrue";

export const dynamic = "force-dynamic";

const KINDS = new Set(["requests", "customers", "orders"]);

function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    // Neutralise spreadsheet formulas in exported text.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}

/** Owner-only CSV export (the database refuses anyone else and records every export). */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) return new Response("Forbidden", { status: 403 });
  const api = supabaseApi();
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!api || !token) return new Response("Sign in first", { status: 401 });
  const kind = String((await request.formData()).get("kind") ?? "");
  if (!KINDS.has(kind)) return new Response("Unknown export", { status: 400 });
  try {
    const rows = await rpc<Record<string, unknown>[]>(api, "admin_export", { p_kind: kind, p_include_test: false }, token);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(`﻿${csv(rows)}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="sevn-hevn-${kind}-${date}.csv"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    const status = e instanceof DbError && (e.code === "owner_only" || e.code === "not_authorized") ? 403 : 500;
    return new Response(status === 403 ? "Only the owner can export data." : "Export failed.", { status });
  }
}
