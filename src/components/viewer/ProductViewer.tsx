"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Item } from "@/data/types";
import { useI18n } from "@/i18n/I18nProvider";
import { SpinStage, type SpinState, type StageHandle } from "./SpinStage";
import { ModelStage, type ModelStageHandle } from "./ModelStage";
import "./viewer.css";

type ViewItem = Pick<Item, "name" | "brand" | "view" | "interior" | "showcase">;

/**
 * The shared 360° viewer, used in product cards (in a panel) and in the product gallery.
 * It shows only what the files really contain: a spin turns horizontally, a model turns freely,
 * and "inside" appears only when interior photos or an opening animation exist.
 * Nothing moves on its own; every control is a labelled button, and the keyboard works too.
 */
export function ProductViewer({ item, variant, onExit }: { item: ViewItem; variant?: string; onExit?: () => void }) {
  const { t, fmt } = useI18n();
  const v = t.viewer;
  const view = item.view;
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<StageHandle | ModelStageHandle | null>(null);
  const hintId = useId();
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [spin, setSpin] = useState<SpinState | null>(null);
  const [full, setFull] = useState(false);
  const [inside, setInside] = useState<number | null>(null);
  const [opened, setOpened] = useState(false);
  const title = item.brand ? `${item.brand} ${item.name}` : item.name;

  const onSpinProgress = useCallback((n: number, total: number) => {
    setProgress(n / total);
    if (n === total) setLoaded(true);
  }, []);
  const onModelProgress = useCallback((f: number) => setProgress(f), []);
  const onLoad = useCallback(() => {
    setProgress(1);
    setLoaded(true);
  }, []);
  const onError = useCallback(() => setFailed(true), []);
  const onSpinState = useCallback((s: SpinState) => setSpin(s), []);

  // Full screen: the Fullscreen API where it exists, otherwise (iPhone) a fixed full-window layer.
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFull = () => {
    const el = root.current;
    if (!el) return;
    if (full) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else setFull(false);
    } else if (el.requestFullscreen && document.fullscreenEnabled) {
      el.requestFullscreen().catch(() => setFull(true));
    } else setFull(true);
  };

  if (!view) return null;
  const isModel = view.kind === "model";
  const interior = item.interior ?? [];
  const canOpen = isModel && !!view.openAnimation;
  const zoomed = (spin?.zoom ?? 1) > 1;
  const pct = Math.round(progress * 100);

  const onKey = (e: React.KeyboardEvent) => {
    if (inside !== null || isModel) return; // model-viewer has its own keyboard controls
    const k = e.key;
    if (k === "ArrowLeft" || k === "ArrowRight") stage.current?.turn(k === "ArrowRight" ? 1 : -1);
    else if (k === "+" || k === "=") stage.current?.zoom(0.5);
    else if (k === "-" || k === "_") stage.current?.zoom(-0.5);
    else if (k === "0" || k === "Home") stage.current?.reset();
    else return;
    e.preventDefault();
  };

  const credit =
    item.showcase &&
    fmt(t.showcase.credit, { type: t.showcase.types[item.showcase.type] ?? "", source: item.showcase.source, author: item.showcase.author, licence: item.showcase.licence });

  return (
    <div ref={root} className={`pv${full ? " is-full" : ""}`} role="group" aria-roledescription={v.title} aria-label={`${v.title}: ${title}`}>
      <p className="pv__kind">
        {isModel ? v.kindModel : v.kindSpin}
        {item.showcase && <span className="pv__demo">{t.showcase.badge}</span>}
      </p>

      <div className="pv__stage" tabIndex={isModel ? -1 : 0} aria-describedby={hintId} onKeyDown={onKey}>
        {inside !== null ? (
          <div className="pv-inside">
            <Image src={interior[inside].src} alt={interior[inside].alt} width={interior[inside].width} height={interior[inside].height} sizes="(min-width: 900px) 60vw, 100vw" className="pv-inside__img" />
          </div>
        ) : failed ? (
          <div className="pv__error" role="alert">
            <p>{v.error}</p>
            <div className="pv__error-actions">
              <button
                type="button"
                className="btn btn--line"
                onClick={() => {
                  setFailed(false);
                  setLoaded(false);
                  setProgress(0);
                  setAttempt((n) => n + 1);
                }}
              >
                {v.retry}
              </button>
              {onExit && (
                <button type="button" className="btn btn--dark" onClick={onExit}>
                  {v.backToPhotos}
                </button>
              )}
            </div>
          </div>
        ) : view.kind === "spin" ? (
          <SpinStage
            key={attempt}
            ref={(h) => {
              stage.current = h;
            }}
            frames={view.frames}
            start={view.start}
            reverse={view.reverse}
            alt={title}
            onState={onSpinState}
            onProgress={onSpinProgress}
            onError={onError}
          />
        ) : (
          <ModelStage
            key={attempt}
            ref={(h) => {
              stage.current = h;
            }}
            src={view.src}
            poster={view.poster}
            alt={title}
            orbit={view.orbit}
            variant={variant}
            openAnimation={view.openAnimation}
            onProgress={onModelProgress}
            onLoad={onLoad}
            onError={onError}
          />
        )}
        {!loaded && !failed && inside === null && (
          <div className="pv__loading" role="status">
            <span className="pv__bar" style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
            <span>{fmt(v.loading, { pct })}</span>
          </div>
        )}
      </div>

      <p id={hintId} className="pv__hint">
        {inside !== null ? fmt(v.insideOf, { n: inside + 1, total: interior.length }) : zoomed ? v.hintZoomed : isModel ? v.hintModel : v.hintSpin}
        <span className="visually-hidden"> {v.keyboard}</span>
      </p>

      {view.kind === "spin" && spin && inside === null && !failed && (
        <label className="pv__angle">
          <span className="visually-hidden">{v.angle}</span>
          <input
            type="range"
            min={0}
            max={spin.total - 1}
            value={spin.frame}
            aria-valuetext={fmt(v.angleOf, { n: spin.frame + 1, total: spin.total })}
            onChange={(e) => stage.current?.turn(Number(e.currentTarget.value) - spin.frame)}
          />
        </label>
      )}

      <div className="pv__tools" role="toolbar" aria-label={v.title}>
        {inside === null ? (
          <>
            <ToolButton label={v.turnLeft} onClick={() => stage.current?.turn(-1)} disabled={failed} icon="left" />
            <ToolButton label={v.turnRight} onClick={() => stage.current?.turn(1)} disabled={failed} icon="right" />
            <ToolButton label={v.zoomOut} onClick={() => stage.current?.zoom(-0.5)} disabled={failed} icon="minus" />
            <ToolButton label={v.zoomIn} onClick={() => stage.current?.zoom(0.5)} disabled={failed} icon="plus" />
            <ToolButton label={v.reset} onClick={() => stage.current?.reset()} disabled={failed} icon="reset" />
            {canOpen && (
              <button
                type="button"
                className="pv__text-btn"
                aria-pressed={opened}
                onClick={() => {
                  (stage.current as ModelStageHandle | null)?.open(!opened);
                  setOpened(!opened);
                }}
              >
                {opened ? v.closePiece : v.open}
              </button>
            )}
            {interior.length > 0 && (
              <button type="button" className="pv__text-btn" onClick={() => setInside(0)}>
                {v.inside}
              </button>
            )}
          </>
        ) : (
          <>
            {interior.length > 1 && (
              <>
                <ToolButton label={v.turnLeft} onClick={() => setInside((i) => ((i ?? 0) - 1 + interior.length) % interior.length)} icon="left" />
                <ToolButton label={v.turnRight} onClick={() => setInside((i) => ((i ?? 0) + 1) % interior.length)} icon="right" />
              </>
            )}
            <button type="button" className="pv__text-btn" onClick={() => setInside(null)}>
              {v.outside}
            </button>
          </>
        )}
        <span className="pv__spacer" />
        <ToolButton label={full ? v.exitFullscreen : v.fullscreen} onClick={toggleFull} icon={full ? "shrink" : "expand"} />
        {onExit && (
          <button type="button" className="pv__text-btn" onClick={onExit}>
            {v.backToPhotos}
          </button>
        )}
      </div>

      {credit && <p className="pv__credit">{credit}</p>}
    </div>
  );
}

const paths: Record<string, string> = {
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
  minus: "M6 12h12",
  plus: "M6 12h12M12 6v12",
  reset: "M5 12a7 7 0 1 0 2-5M5 4v4h4",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  shrink: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
};

function ToolButton({ label, onClick, icon, disabled }: { label: string; onClick: () => void; icon: string; disabled?: boolean }) {
  return (
    <button type="button" className="pv__tool" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d={paths[icon]} stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
