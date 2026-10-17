"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { PauseIcon, PlayIcon } from "./icons";

/** Same breakpoint as the hero layout in globals.css. */
const WIDE = "(min-width: 900px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

const noop = () => () => {};

function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** True once the page (and so the hero still, its largest image) has finished loading. */
function usePageLoaded() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("load", onChange);
      return () => window.removeEventListener("load", onChange);
    },
    () => document.readyState === "complete",
    () => false,
  );
}

function saveData() {
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

/**
 * The home hero's photograph with its cinemagraph: a short, silent loop made from the same image.
 * The still (`children`, rendered on the server with priority) shows first and stays whenever the
 * film doesn't play. The film is fetched only after the page has loaded, never by itself for
 * visitors who prefer reduced motion or save data (the button still plays it), pauses while the
 * hero is off screen, and fades in over the still once it is actually playing. Phones get a smaller
 * file cut to their framing; the wide file is the full frame.
 */
export function HeroFilm({
  children,
  wideSrc,
  narrowSrc,
  pauseLabel,
  playLabel,
}: {
  children: ReactNode;
  wideSrc: string;
  narrowSrc: string;
  pauseLabel: string;
  playLabel: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const client = useSyncExternalStore(noop, () => true, () => false);
  const reduced = useMedia(REDUCED);
  const wide = useMedia(WIDE);
  const loaded = usePageLoaded();
  const autoMotion = client && !reduced && !saveData();
  // The visitor's own choice from the button (null until they press it) wins over the default.
  const [choice, setChoice] = useState<boolean | null>(null);
  const [onScreen, setOnScreen] = useState(true);
  // The file that has started playing; the film fades in over the still only then.
  const [playingSrc, setPlayingSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const wanted = choice ?? autoMotion;
  const src = loaded && !failed && (autoMotion || choice !== null) ? (wide ? wideSrc : narrowSrc) : null;

  // Pause while the hero is scrolled out of view.
  useEffect(() => {
    const el = box.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v || !src) return;
    if (wanted && onScreen) {
      // Set as a property too: iOS only plays inline video that is muted when play() is called.
      v.muted = true;
      v.play().catch((err: unknown) => {
        // Autoplay refused (e.g. Low Power Mode): keep the still and offer the play button.
        if (err instanceof DOMException && err.name === "NotAllowedError") setChoice(false);
      });
    } else {
      v.pause();
    }
  }, [wanted, onScreen, src]);

  return (
    <div ref={box} className="hero__media">
      <div className="hero__frame">
        {children}
        {src && (
          <video
            ref={video}
            className={`hero__film${playingSrc === src ? " is-on" : ""}`}
            src={src}
            muted
            autoPlay={wanted}
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            disableRemotePlayback
            aria-hidden="true"
            tabIndex={-1}
            onPlaying={() => setPlayingSrc(src)}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      {client && !failed && (
        <button type="button" className="hero__film-toggle" onClick={() => setChoice(!wanted)} aria-label={wanted ? pauseLabel : playLabel}>
          {wanted ? <PauseIcon /> : <PlayIcon />}
        </button>
      )}
    </div>
  );
}
