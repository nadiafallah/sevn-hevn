import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { supabaseReadConfig } from "@/lib/supabase";

type Props = PageProps<"/[locale]/terms/[kind]">;

/** Owner-approved policy texts (panel → Settings → Policies). Only the approved version is public. */
const KINDS: Record<string, string> = { "terms-of-sale": "terms_of_sale", returns: "returns", shipping: "shipping", privacy: "privacy" };

async function approved(kind: string) {
  const cfg = supabaseReadConfig();
  const db = KINDS[kind];
  if (!cfg || !db) return null;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/policy_versions?select=title,version,body,approved_at&status=eq.approved&kind=eq.${db}&limit=1`, {
      headers: { apikey: cfg.key, accept: "application/json" },
      next: { revalidate: 60, tags: ["policies"] },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { title: string; version: string; body: string; approved_at: string }[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind } = await params;
  const p = await approved(kind);
  return p ? { title: p.title, alternates: { canonical: `/terms/${kind}` } } : {};
}

export default async function TermsPage({ params }: Props) {
  const { locale, kind } = await params;
  if (!isLocale(locale)) notFound();
  const p = await approved(kind);
  if (!p) notFound();
  return (
    <article className="container terms">
      <h1 className="display display--sm">{p.title}</h1>
      <p className="muted small">Version {p.version} · approved {new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Asia/Dubai" }).format(new Date(p.approved_at))}</p>
      {p.body.split(/\n\s*\n/).map((para, i) => <p key={i}>{para.trim()}</p>)}
    </article>
  );
}
