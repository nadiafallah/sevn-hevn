import { site } from "@/config/site";
import { MAX_SENTENCE_WORDS, WORD_TOLERANCE } from "../config";
import type { Brief } from "../contracts/brief";
import type { ResearchPack } from "../contracts/research";
import { plain, type DraftChecks } from "../contracts/review";
import type { SiteLink } from "../contracts/run";

/**
 * Computable checks on a draft. No judgement here: counting, matching and set membership only.
 * The editor sees the result; the gate and the publisher use draftProblems() on it.
 */

/** Links, not images: `[text](href)` but not `![alt](photo:P1)`. */
const LINK = /(?<!!)\[([^\]\n]+)\]\(([^)\s]+)\)/g;
/** A photo or video on its own line: `![caption](photo:P1)` or `![title](video:ID)`. */
const MEDIA = /^!\[[^\]\n]*\]\(((?:photo|video):[\w-]+)\)\s*$/gm;
const ANY_IMAGE = /!\[[^\]\n]*\]\(([^)\s]*)\)/g;

/** The article's text without photo and video lines. */
function prose(md: string) {
  return md.replace(ANY_IMAGE, "");
}

/** Words a reader sees: link targets and Markdown markers removed. */
export function wordCount(md: string) {
  const text = prose(md).replace(LINK, "$1").replace(/[#>*_`|]/g, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** "## Heading" lines, as plain text. */
export function sectionHeadings(md: string) {
  return md
    .split("\n")
    .filter((l) => /^##\s+\S/.test(l) && !/^###/.test(l))
    .map((l) => plain(l.replace(/^##\s+/, "")));
}

/** A site address in the form the link list uses: "/bags/hermes" (absolute site URLs accepted). */
export function sitePath(href: string): string | null {
  let h = href.trim();
  for (const base of [site.url, "https://www.sevnhevn.ae", "https://sevnhevn.ae"]) {
    if (h.toLowerCase().startsWith(base.toLowerCase())) h = h.slice(base.length) || "/";
  }
  if (!h.startsWith("/") || h.startsWith("//")) return null;
  h = h.split(/[?#]/)[0];
  return h.length > 1 ? h.replace(/\/+$/, "") : h;
}

export function extractLinks(md: string) {
  return [...prose(md).matchAll(LINK)].map((m) => ({ text: m[1], href: m[2] }));
}

/** Every image reference, wherever it is (`photo:P1`, `video:ID`, or anything else). */
export function mediaRefs(md: string) {
  const standalone = new Set([...md.matchAll(MEDIA)].map((m) => m[1]));
  return [...md.matchAll(ANY_IMAGE)].map((m) => ({ ref: m[1], ownLine: standalone.has(m[1]) }));
}

/** Sentences of the prose (headings, list items and paragraphs), as plain words. */
export function sentences(md: string) {
  const text = prose(md)
    .replace(LINK, "$1")
    .split("\n")
    .map((l) => l.replace(/^(#{1,6}|>|[-*]|\d+[.)])\s+/, "").replace(/[*_`]/g, ""))
    .filter((l) => l.trim())
    .join("\n");
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

export function readability(md: string) {
  const counts = sentences(md).map((s) => ({ s, n: s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length }));
  const words = counts.reduce((a, c) => a + c.n, 0);
  return {
    avgSentenceWords: counts.length ? Math.round((words / counts.length) * 10) / 10 : 0,
    longSentences: counts.filter((c) => c.n > MAX_SENTENCE_WORDS).map((c) => c.s.split(/\s+/).slice(0, 8).join(" ")).slice(0, 5),
  };
}

/** Figures in the text: "1837", "25%", "12,500". Small counts below 10 ("three tips") are ignored. */
export function numbersIn(text: string) {
  const out: string[] = [];
  for (const m of text.replace(LINK, "$1").matchAll(/\d[\d,.]*\d%?|\d%?/g)) {
    const n = m[0].replace(/,/g, "").replace(/\.$/, "");
    if (!n.endsWith("%") && Number(n) < 10) continue;
    out.push(n);
  }
  return out;
}

export function checkDraft(
  md: string,
  brief: Brief,
  research: ResearchPack,
  links: SiteLink[],
  allowedNumbers: string[] = [],
  videoIds: string[] = [],
): DraftChecks {
  const words = wordCount(md);
  const wordRange = {
    min: Math.floor(brief.targetWords.min * (1 - WORD_TOLERANCE)),
    max: Math.ceil(brief.targetWords.max * (1 + WORD_TOLERANCE)),
  };
  // A section counts when a "## " heading is the brief's heading, or begins with it (a keyword added
  // after it, e.g. "Structure, size and colour: a winter bag guide", still marks the same section).
  const headings = sectionHeadings(md);
  const missingSections = brief.outline.map((s) => s.h2).filter((h) => {
    const want = plain(h);
    return !headings.some((got) => got === want || got.startsWith(`${want}:`) || got.startsWith(`${want} -`) || got.startsWith(`${want} —`));
  });

  const byPath = new Map(links.map((l) => [l.href, l]));
  const sources = new Set([...research.facts.map((f) => f.sourceUrl), ...research.examples.flatMap((e) => (e.sourceUrl ? [e.sourceUrl] : []))]);
  const found = extractLinks(md).map((l) => {
    const path = sitePath(l.href);
    const kind: DraftChecks["links"][number]["kind"] = path !== null && byPath.has(path) ? "site" : sources.has(l.href) ? "source" : "unknown";
    return { text: l.text, href: path !== null && kind === "site" ? path : l.href, kind };
  });
  const ctaFound = found.some((l) => l.kind === "site" && l.href === brief.cta.href);
  const productLinkFound = found.some((l) => l.kind === "site" && ["product", "category", "house"].includes(byPath.get(l.href)!.kind));

  const known = new Set(
    numbersIn(
      [
        ...research.facts.map((f) => f.claim),
        ...research.examples.map((e) => e.text),
        ...research.readerQuestions.map((q) => `${q.q} ${q.basis}`),
        JSON.stringify(brief),
      ].join("\n"),
    ).concat(allowedNumbers),
  );
  const unsourcedNumbers = [...new Set(numbersIn(prose(md)).filter((n) => !known.has(n)))];

  const refs = mediaRefs(md);
  const allowed = new Set([...brief.photos.map((id) => `photo:${id}`), ...videoIds.map((id) => `video:${id}`)]);
  const unknownMedia = [...new Set(refs.filter((r) => !allowed.has(r.ref) || !r.ownLine).map((r) => r.ref || "(empty image)"))];
  const photosUsed = [...new Set(refs.filter((r) => r.ref.startsWith("photo:") && allowed.has(r.ref)).map((r) => r.ref.slice(6)))];
  const videosUsed = [...new Set(refs.filter((r) => r.ref.startsWith("video:") && allowed.has(r.ref)).map((r) => r.ref.slice(6)))];
  const missingPhotos = brief.photos.filter((id) => !photosUsed.includes(id));

  return { words, wordRange, missingSections, links: found, ctaFound, productLinkFound, unsourcedNumbers, ...readability(md), photosUsed, videosUsed, unknownMedia, missingPhotos };
}

/** Writer output tidy-up: no H1 (the page prints the title), no stray fences, trimmed. */
export function tidyDraft(md: string) {
  return md
    .replace(/^\s*```(?:markdown|md)?\s*\n/, "")
    .replace(/\n```\s*$/, "")
    .replace(/^\s*#\s+[^\n]*\n+/, "")
    .trim();
}
