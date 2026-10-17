import type { Brief } from "./brief";
import type { Issue } from "./review";
import type { Media } from "./run";
import type { Seo } from "./seo";

/** The publisher's decision (code only). */
export interface PublishDecision {
  decision: "published" | "draft";
  /** Why it is a draft (empty when published). */
  reasons: string[];
}

/** What is saved for the article (journal_posts), published or not. */
export interface PostRecord {
  status: "published" | "draft";
  title: string;
  slug: string;
  bodyMd: string;
  metaTitle: string | null;
  metaDescription: string | null;
  summary: string | null;
  keywords: string[];
  faq: Seo["faq"];
  primaryKeyword: string;
  score: number;
  subscores: Record<string, number>;
  /** The last review's open issues, for whoever reviews the draft. */
  issues: Issue[];
  reasons: string[];
  cta: Brief["cta"];
  /** Research sources the article cites. */
  sources: { url: string; title: string }[];
  /** The shop's photos and official videos shown in the article (`photo:P1`, `video:ID` in the text). */
  media: Media[];
}
