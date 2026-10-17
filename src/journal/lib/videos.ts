import { MAX_VIDEOS, OFFICIAL_CHANNELS } from "../config";
import type { Video } from "../contracts/run";

/**
 * Finds videos for an article: the researcher writes the searches; code runs them on youtube.com
 * and keeps a video only if YouTube's oEmbed says it comes from one of the houses' official
 * channels and may be embedded (OFFICIAL_CHANNELS). Videos stay on YouTube; the site embeds them.
 */
export function videoId(url: string) {
  const m = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})(?![\w-])/);
  return m?.[1] ?? null;
}

export async function verifyVideo(id: string): Promise<Video | null> {
  const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null; // 401: embedding is switched off; 404: no such video
  const o = (await res.json()) as { title?: string; author_name?: string; author_url?: string };
  const house = OFFICIAL_CHANNELS[(o.author_url ?? "").replace(/\/+$/, "").toLowerCase()];
  if (!house || !o.title) return null;
  return { id, title: o.title.slice(0, 200), channel: (o.author_name ?? house).slice(0, 80), house };
}

/** Candidate video ids from search result urls → verified official videos (a few, best first). */
export async function officialVideos(urls: string[], limit = MAX_VIDEOS + 2): Promise<Video[]> {
  const ids = [...new Set(urls.map(videoId).filter((x): x is string => !!x))];
  const out: Video[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const v = await verifyVideo(id).catch(() => null);
    if (v) out.push(v);
  }
  return out;
}
