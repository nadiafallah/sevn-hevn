import { RESULTS_PER_QUERY } from "../config";
import type { SearchResult } from "../contracts/research";
import type { Video } from "../contracts/run";
import { officialVideos } from "./videos";

/** Runs web searches. The model only writes the queries; this code executes them. */
export interface Search {
  run(queries: string[]): Promise<SearchResult[]>;
  /** Videos from the houses' official YouTube channels, verified by code. */
  videos(queries: string[]): Promise<Video[]>;
}

/** Sources too weak to cite as fact (user posts, pins, social feeds). */
const EXCLUDED = ["pinterest.com", "quora.com", "tiktok.com", "facebook.com", "instagram.com", "x.com", "twitter.com"];
const MAX_CONTENT = 1500;

/**
 * Tavily Search API (free "Researcher" plan: 1,000 credits a month; a basic search costs 1).
 * https://docs.tavily.com/documentation/api-reference/endpoint/search
 */
export class TavilySearch implements Search {
  constructor(private readonly apiKey: string) {}

  async run(queries: string[]): Promise<SearchResult[]> {
    const out: SearchResult[] = [];
    const seen = new Set<string>();
    for (const query of queries) {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ query, search_depth: "basic", max_results: RESULTS_PER_QUERY, include_answer: false, include_raw_content: false, exclude_domains: EXCLUDED }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`search failed with HTTP ${res.status}`);
      const data = (await res.json()) as { results?: { url?: string; title?: string; content?: string }[] };
      for (const r of data.results ?? []) {
        if (!r.url || !/^https:\/\//.test(r.url) || seen.has(r.url)) continue;
        seen.add(r.url);
        out.push({ url: r.url, title: (r.title ?? "").slice(0, 200), content: (r.content ?? "").slice(0, MAX_CONTENT), query });
      }
    }
    return out;
  }

  async videos(queries: string[]): Promise<Video[]> {
    const urls: string[] = [];
    for (const query of queries) {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ query, search_depth: "basic", max_results: 8, include_answer: false, include_domains: ["youtube.com"] }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`video search failed with HTTP ${res.status}`);
      const data = (await res.json()) as { results?: { url?: string }[] };
      for (const r of data.results ?? []) if (r.url) urls.push(r.url);
    }
    return officialVideos(urls);
  }
}
