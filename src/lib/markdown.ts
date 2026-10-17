/**
 * The small Markdown subset journal articles are written in (see src/journal/prompts/writer.md):
 * paragraphs, ## and ### headings, - and 1. lists, > quotes, **bold**, *italic*, links, and the
 * shop's photos or a house video on their own line (`![…](photo:P1)`, `![…](video:ID)`).
 * Parsed into plain data and rendered as React elements, never as HTML, so nothing in an article
 * can inject markup or scripts. Anything else is shown as text.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "h2" | "h3" | "p" | "quote"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "media"; ref: string };

const MEDIA_LINE = /^!\[[^\]\n]*\]\(((?:photo|video):[\w-]+)\)$/;
/** Any other image syntax is dropped: articles show only the media code gave them. */
const OTHER_IMAGE = /!\[[^\]\n]*\]\([^)\n]*\)/g;

const INLINE: { t: "link" | "strong" | "em"; re: RegExp }[] = [
  { t: "link", re: /\[([^\]\n]+)\]\(([^)\s]+)\)/ },
  { t: "strong", re: /\*\*([^*\n]+)\*\*/ },
  { t: "em", re: /\*([^*\n]+)\*|(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/u },
];

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let rest = s.replace(OTHER_IMAGE, "");
  while (rest) {
    let best: { t: (typeof INLINE)[number]["t"]; m: RegExpExecArray } | null = null;
    for (const p of INLINE) {
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { t: p.t, m };
    }
    if (!best) {
      out.push({ t: "text", v: rest });
      break;
    }
    if (best.m.index > 0) out.push({ t: "text", v: rest.slice(0, best.m.index) });
    if (best.t === "link") out.push({ t: "link", href: best.m[2], c: parseInline(best.m[1]) });
    else out.push({ t: best.t, c: parseInline(best.m[1] ?? best.m[2]) });
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    let m: RegExpMatchArray | null;
    if (!line) flush();
    else if ((m = line.match(MEDIA_LINE))) {
      flush();
      blocks.push({ t: "media", ref: m[1] });
    } else if ((m = line.match(/^(#{1,6})\s+(.+)$/))) {
      flush();
      blocks.push({ t: m[1].length <= 2 ? "h2" : "h3", c: parseInline(m[2].replace(/\s+#+$/, "")) });
    } else if (/^([-*]|\d+[.)])\s+/.test(line)) {
      flush();
      const ordered = /^\d/.test(line);
      const items: Inline[][] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
        items.push(parseInline(lines[i].trim().replace(/^([-*]|\d+[.)])\s+/, "")));
        i++;
      }
      i--;
      blocks.push({ t: ordered ? "ol" : "ul", items });
    } else if (line.startsWith(">")) {
      flush();
      const q: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) q.push(lines[i++].trim().replace(/^>\s?/, ""));
      i--;
      blocks.push({ t: "quote", c: parseInline(q.join(" ")) });
    } else para.push(line);
  }
  flush();
  return blocks;
}

/** Where a link may go: a page on this site, or an https page elsewhere. Anything else is not a link. */
export function linkTarget(href: string, siteUrl: string): { internal: string } | { external: string } | null {
  const h = href.trim();
  for (const base of [siteUrl, "https://www.sevnhevn.ae", "https://sevnhevn.ae"]) {
    if (h.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return { internal: h.slice(base.length) };
  }
  if (h.startsWith("/") && !h.startsWith("//")) return { internal: h };
  if (/^https:\/\/[^\s/]+\.[^\s]+$/i.test(h)) return { external: h };
  return null;
}

export function plainText(c: Inline[]): string {
  return c.map((x) => (x.t === "text" ? x.v : plainText(x.c))).join("");
}

/** A stable anchor for a heading ("Choosing the colour" → "choosing-the-colour"). */
export function headingId(c: Inline[]) {
  return plainText(c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
