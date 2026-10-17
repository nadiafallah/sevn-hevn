"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * A house's own film from its official YouTube channel. Until the visitor presses play, only a
 * still (served from this site) is shown and nothing loads from YouTube; then the video plays in
 * YouTube's privacy-enhanced player (youtube-nocookie.com).
 */
export function JournalVideo({ id, title, house, playLabel, caption }: { id: string; title: string; house: string; playLabel: string; caption: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <figure className="journal-video">
      <div className="journal-video__frame">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button type="button" className="journal-video__play" onClick={() => setPlaying(true)} aria-label={`${playLabel}: ${title}`}>
            <Image src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" fill sizes="(max-width: 899px) 100vw, 760px" />
            <span className="journal-video__icon" aria-hidden="true" />
          </button>
        )}
      </div>
      <figcaption>
        {caption.replace("{house}", house)} · {title}
      </figcaption>
    </figure>
  );
}
