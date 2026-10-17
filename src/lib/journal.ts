import "server-only";
import { cache } from "react";
import { supabaseReadConfig } from "@/lib/supabase";

/**
 * Journal articles for the public pages. Only published articles, and only the columns a page
 * shows, are readable with the public key (row-level security and column grants, see
 * supabase/migrations/*_journal.sql). Cached for JOURNAL_REFRESH_SECONDS; publishing from the panel
 * expires the cache at once. Until the journal tables exist, the journal is simply empty.
 */
export const JOURNAL_TAG = "journal";
const JOURNAL_REFRESH_SECONDS = 300;

/** A photo (the shop's own, of a published piece) or a house video, as saved with an article. */
export type JournalMedia =
  | { type: "photo"; id: string; piece: string; alt: string; href: string; src: string; width: number; height: number }
  | { type: "video"; id: string; title: string; channel: string; house: string };

const isMedia = (m: unknown): m is JournalMedia => {
  const x = m as Record<string, unknown>;
  if (!x || typeof x.id !== "string") return false;
  if (x.type === "video") return /^[\w-]{11}$/.test(x.id) && typeof x.title === "string" && typeof x.house === "string";
  return x.type === "photo" && typeof x.src === "string" && /^https?:\/\//.test(x.src) && typeof x.href === "string" && x.href.startsWith("/") && Number(x.width) > 0 && Number(x.height) > 0;
};

export interface JournalPost {
  slug: string;
  title: string;
  bodyMd: string;
  metaTitle: string | null;
  metaDescription: string | null;
  summary: string | null;
  keywords: string[];
  faq: { q: string; a: string }[];
  media: JournalMedia[];
  publishedAt: string;
  updatedAt: string;
}

export type JournalCard = Pick<JournalPost, "slug" | "title" | "summary" | "publishedAt">;

type Row = {
  slug: string;
  title: string;
  body_md?: string;
  meta_title?: string | null;
  meta_description?: string | null;
  summary: string | null;
  keywords?: string[] | null;
  faq?: { q: string; a: string }[] | null;
  media?: unknown[] | null;
  published_at: string;
  updated_at?: string;
};

async function read(params: Record<string, string>): Promise<Row[]> {
  const cfg = supabaseReadConfig();
  if (!cfg) return [];
  try {
    const res = await fetch(`${cfg.url}/rest/v1/journal_posts?${new URLSearchParams(params)}`, {
      headers: { apikey: cfg.key, accept: "application/json" },
      next: { revalidate: JOURNAL_REFRESH_SECONDS, tags: [JOURNAL_TAG] },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    return (await res.json()) as Row[];
  } catch {
    return [];
  }
}

/** Published articles, newest first. */
export const getJournalCards = cache(async (): Promise<JournalCard[]> => {
  const rows = await read({ select: "slug,title,summary,published_at", order: "published_at.desc", limit: "200" });
  return rows.map((r) => ({ slug: r.slug, title: r.title, summary: r.summary, publishedAt: r.published_at }));
});

export const getJournalPost = cache(async (slug: string): Promise<JournalPost | undefined> => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 70) return undefined;
  const rows = await read({
    select: "slug,title,body_md,meta_title,meta_description,summary,keywords,faq,media,published_at,updated_at",
    slug: `eq.${slug}`,
    limit: "1",
  });
  const r = rows[0];
  if (!r) return undefined;
  return {
    slug: r.slug,
    title: r.title,
    bodyMd: r.body_md ?? "",
    metaTitle: r.meta_title ?? null,
    metaDescription: r.meta_description ?? null,
    summary: r.summary,
    keywords: r.keywords ?? [],
    faq: Array.isArray(r.faq) ? r.faq.filter((f) => typeof f?.q === "string" && typeof f?.a === "string") : [],
    media: Array.isArray(r.media) ? r.media.filter(isMedia) : [],
    publishedAt: r.published_at,
    updatedAt: r.updated_at ?? r.published_at,
  };
});

/** The article's cover: its first photo. */
export function coverPhoto(post: Pick<JournalPost, "media">) {
  return post.media.find((m): m is Extract<JournalMedia, { type: "photo" }> => m.type === "photo");
}
