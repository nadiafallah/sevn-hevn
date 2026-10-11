"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { SpinFrame } from "@/data/types";

export interface StageHandle {
  turn: (steps: number) => void;
  zoom: (delta: number) => void;
  reset: () => void;
}

export interface SpinState {
  frame: number;
  total: number;
  zoom: number;
}

const MAX_ZOOM = 3;

/**
 * A spin made of real photographs taken in one horizontal turn. Dragging sideways turns the piece;
 * vertical swipes are left to the page (touch-action: pan-y), so scrolling on a phone still works.
 * When zoomed in, dragging moves around the larger photograph of the same angle instead.
 */
export const SpinStage = forwardRef<
  StageHandle,
  {
    frames: SpinFrame[];
    start: number;
    reverse?: boolean;
    alt: string;
    onState: (s: SpinState) => void;
    onProgress: (loaded: number, total: number) => void;
    onError: () => void;
  }
>(function SpinStage({ frames, start, reverse = false, alt, onState, onProgress, onError }, ref) {
  const total = frames.length;
  const [frame, setFrame] = useState(start % total);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; frame: number; pan: { x: number; y: number } } | null>(null);
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);

  const go = useCallback((f: number) => setFrame(((Math.round(f) % total) + total) % total), [total]);

  // Load the first angle, then the rest outward from it, so turning works as soon as possible.
  useEffect(() => {
    let cancelled = false;
    let loaded = 0;
    let failed = 0;
    const order = Array.from({ length: total }, (_, i) => (start + (i % 2 ? Math.ceil(i / 2) : -Math.ceil(i / 2)) + total) % total);
    const seen = new Set<number>();
    const queue = order.filter((i) => (seen.has(i) ? false : (seen.add(i), true)));
    const next = () => {
      const i = queue.shift();
      if (i === undefined || cancelled) return;
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (cancelled) return;
        loaded++;
        if (i === start % total) setReady(true);
        onProgress(loaded, total);
        next();
      };
      img.onerror = () => {
        if (cancelled) return;
        failed++;
        // The first angle or a quarter of the set missing: the spin would jump, so don't offer it.
        if (i === start % total || failed > total / 4) onError();
        else next();
      };
      img.src = frames[i].src;
    };
    // A few at a time keeps the first angles quick on slow connections.
    for (let k = 0; k < 4; k++) next();
    return () => {
      cancelled = true;
    };
  }, [frames, start, total, onProgress, onError]);

  useEffect(() => onState({ frame, total, zoom }), [frame, total, zoom, onState]);

  const clampPan = useCallback(
    (p: { x: number; y: number }, z: number) => {
      const el = stageRef.current;
      if (!el || z <= 1) return { x: 0, y: 0 };
      const maxX = (el.clientWidth * (z - 1)) / 2;
      const maxY = (el.clientHeight * (z - 1)) / 2;
      return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) };
    },
    [],
  );

  const setZoomTo = useCallback(
    (z: number) => {
      const next = Math.max(1, Math.min(MAX_ZOOM, z));
      setZoom(next);
      setPan((p) => clampPan(p, next));
    },
    [clampPan],
  );

  useImperativeHandle(
    ref,
    () => ({
      turn: (steps) => go(frame + (reverse ? -steps : steps)),
      zoom: (delta) => setZoomTo(zoom + delta),
      reset: () => {
        go(start);
        setZoom(1);
        setPan({ x: 0, y: 0 });
      },
    }),
    [frame, go, reverse, setZoomTo, start, zoom],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current.size === 2) {
      const [a, b] = [...pinch.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      drag.current = null;
      return;
    }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, frame, pan };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pinch.current.has(e.pointerId)) pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pinch.current.values()];
      setZoomTo((pinchStart.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinchStart.current.dist);
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (zoom > 1) {
      setPan(clampPan({ x: d.pan.x + dx, y: d.pan.y + (e.clientY - d.y) }, zoom));
      return;
    }
    // One drag across the stage turns the piece once.
    const width = stageRef.current?.clientWidth || 600;
    const steps = (dx / width) * total;
    go(d.frame - (reverse ? -steps : steps));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pinch.current.delete(e.pointerId);
    if (pinch.current.size < 2) pinchStart.current = null;
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const current = frames[frame];
  return (
    <div
      ref={stageRef}
      className={`pv-spin${zoom > 1 ? " is-zoomed" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={(e) => {
        // Trackpad pinch (and ctrl/⌘ + wheel) zooms; a normal wheel keeps scrolling the page.
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        setZoomTo(zoom - e.deltaY * 0.01);
      }}
      style={{ aspectRatio: `${current.width} / ${current.height}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- frames are pre-sized in Storage; next/image would spend a transformation per frame */}
      <img
        src={zoom > 1 ? current.zoom : current.src}
        alt={alt}
        width={current.width}
        height={current.height}
        draggable={false}
        className="pv-spin__img"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, opacity: ready ? 1 : 0 }}
      />
    </div>
  );
});
