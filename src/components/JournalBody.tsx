import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { site } from "@/config/site";
import type { JournalMedia } from "@/lib/journal";
import { headingId, linkTarget, parseMarkdown, type Inline } from "@/lib/markdown";
import { JournalVideo } from "./JournalVideo";

const LABELS = { view: "View the piece", play: "Play the film", video: "Film by {house}, on YouTube" };

/** A journal article's body, from its Markdown, as React elements (never raw HTML). */
export function JournalBody({ md, href, media = [], hide }: { md: string; href: (path: string) => string; media?: JournalMedia[]; hide?: string }) {
  const byRef = new Map(media.map((m) => [`${m.type}:${m.id}`, m]));
  const inline = (c: Inline[], key = ""): ReactNode[] =>
    c.map((x, i) => {
      const k = `${key}${i}`;
      if (x.t === "text") return x.v;
      if (x.t === "strong") return <strong key={k}>{inline(x.c, k)}</strong>;
      if (x.t === "em") return <em key={k}>{inline(x.c, k)}</em>;
      const target = linkTarget(x.href, site.url);
      if (!target) return <span key={k}>{inline(x.c, k)}</span>;
      if ("internal" in target) return <Link key={k} href={href(target.internal)}>{inline(x.c, k)}</Link>;
      return (
        <a key={k} href={target.external} target="_blank" rel="noopener noreferrer nofollow">
          {inline(x.c, k)}
        </a>
      );
    });

  return (
    <div className="journal-body">
      {parseMarkdown(md).map((b, i) => {
        switch (b.t) {
          case "media": {
            // Only media saved with the article is shown; the caption comes from the catalogue, not a model.
            const m = byRef.get(b.ref);
            // `hide`: the photo already shown as the article's cover.
            if (!m || b.ref === hide) return null;
            if (m.type === "video") return <JournalVideo key={i} id={m.id} title={m.title} house={m.house} playLabel={LABELS.play} caption={LABELS.video} />;
            return (
              <figure key={i} className="journal-figure">
                <Link href={href(m.href)} className="journal-figure__link">
                  <Image src={m.src} alt={`${m.piece}, ${m.alt}`} width={m.width} height={m.height} sizes="(max-width: 899px) 100vw, 760px" quality={85} />
                </Link>
                <figcaption>
                  {m.piece} · <Link href={href(m.href)}>{LABELS.view}</Link>
                </figcaption>
              </figure>
            );
          }
          case "h2":
            return <h2 key={i} id={headingId(b.c)}>{inline(b.c)}</h2>;
          case "h3":
            return <h3 key={i}>{inline(b.c)}</h3>;
          case "quote":
            return <blockquote key={i}><p>{inline(b.c)}</p></blockquote>;
          case "ul":
            return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
          case "ol":
            return <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
          default:
            return <p key={i}>{inline(b.c)}</p>;
        }
      })}
    </div>
  );
}
