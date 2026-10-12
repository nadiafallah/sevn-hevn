"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The hero's stage. The entrance (the piece settling onto the plinth) is CSS only. On desktop
 * pointers, this adds a slight depth: the layers shift by a few pixels against each other as the
 * pointer moves over the hero. The piece itself is only moved, never rotated in 3D or scaled, so
 * its shape and proportions stay exactly as photographed.
 *
 * Pointer handling follows the Tilt component of motion-primitives (MIT, © 2024 ibelick, listed on
 * 21st.dev): the pointer position is normalised to -0.5…0.5 and smoothed by a spring. Here it is a
 * small dependency-free loop that writes two CSS variables and stops once the stage is at rest,
 * off screen or the page is hidden.
 */
export function HeroStage({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const stage = ref.current;
    const area = stage?.closest<HTMLElement>(".hero");
    if (!stage || !area) return;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const target = { x: 0, y: 0 };
    const pos = { x: 0, y: 0 };
    const vel = { x: 0, y: 0 };
    let frame = 0;
    let visible = true;

    const write = () => {
      stage.style.setProperty("--px", pos.x.toFixed(4));
      stage.style.setProperty("--py", pos.y.toFixed(4));
    };

    // A soft, slightly under-damped spring: the layers ease after the pointer rather than track it.
    const step = () => {
      frame = 0;
      let moving = false;
      for (const k of ["x", "y"] as const) {
        vel[k] = (vel[k] + (target[k] - pos[k]) * 0.06) * 0.8;
        pos[k] += vel[k];
        if (Math.abs(vel[k]) > 0.0002 || Math.abs(target[k] - pos[k]) > 0.0005) moving = true;
        else pos[k] = target[k];
      }
      write();
      if (moving && visible) frame = requestAnimationFrame(step);
    };
    const kick = () => {
      if (!frame && visible) frame = requestAnimationFrame(step);
    };

    const active = () => finePointer.matches && !reduceMotion.matches;
    const onMove = (e: PointerEvent) => {
      if (!active() || e.pointerType !== "mouse") return;
      const r = area.getBoundingClientRect();
      target.x = Math.min(0.5, Math.max(-0.5, (e.clientX - r.left) / r.width - 0.5));
      target.y = Math.min(0.5, Math.max(-0.5, (e.clientY - r.top) / r.height - 0.5));
      kick();
    };
    const onLeave = () => {
      target.x = 0;
      target.y = 0;
      kick();
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (visible) kick();
    });
    io.observe(stage);

    area.addEventListener("pointermove", onMove, { passive: true });
    area.addEventListener("pointerleave", onLeave);
    return () => {
      io.disconnect();
      area.removeEventListener("pointermove", onMove);
      area.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <figure ref={ref} className={className}>
      {children}
    </figure>
  );
}
