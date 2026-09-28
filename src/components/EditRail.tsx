"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowIcon } from "./icons";

/**
 * Horizontal rail of cards. It scrolls natively (swipe, trackpad, keyboard); the arrow
 * buttons only move it by one card. Nothing hijacks vertical scrolling.
 */
export function EditRail({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  function step(dir: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>(":scope > *");
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * ((card?.offsetWidth ?? el.clientWidth * 0.8) + gap), behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <div className="rail">
      <div className="rail__controls">
        <button type="button" className="rail__btn rail__btn--prev" onClick={() => step(-1)} disabled={edges.start} aria-label="Previous pieces">
          <ArrowIcon size={16} />
        </button>
        <button type="button" className="rail__btn" onClick={() => step(1)} disabled={edges.end} aria-label="More pieces">
          <ArrowIcon size={16} />
        </button>
      </div>
      <div ref={ref} className="rail__track" role="region" aria-label={label} tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
