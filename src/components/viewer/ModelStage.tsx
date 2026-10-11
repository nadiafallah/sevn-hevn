"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { StageHandle } from "./SpinStage";

/** The parts of <model-viewer> used here (https://modelviewer.dev, Apache-2.0). */
interface ModelViewerElement extends HTMLElement {
  cameraOrbit: string;
  fieldOfView: string;
  variantName: string | null;
  animationName: string | undefined;
  currentTime: number;
  loaded: boolean;
  getCameraOrbit(): { theta: number; phi: number; radius: number };
  jumpCameraToGoal(): void;
  zoom(keyPresses: number): void;
  play(options?: { repetitions?: number; pingpong?: boolean }): void;
  pause(): void;
}

let loader: Promise<unknown> | null = null;
/** Loads the 3D viewer (and three.js) only when a customer actually opens a model. */
function loadModelViewer() {
  loader ??= import("@google/model-viewer");
  return loader;
}

export interface ModelStageHandle extends StageHandle {
  open: (on: boolean) => void;
}

/**
 * A 3D model of the piece: it can be turned to any angle and zoomed. Vertical swipes stay with the
 * page on touch screens (touch-action: pan-y). Only colourways and animations that the file itself
 * contains are offered.
 */
export const ModelStage = forwardRef<
  ModelStageHandle,
  {
    src: string;
    poster: string;
    alt: string;
    orbit?: string;
    variant?: string;
    openAnimation?: string;
    onProgress: (fraction: number) => void;
    onLoad: () => void;
    onError: () => void;
  }
>(function ModelStage({ src, poster, alt, orbit = "35deg 70deg auto", variant, openAnimation, onProgress, onLoad, onError }, ref) {
  const el = useRef<ModelViewerElement | null>(null);
  const [defined, setDefined] = useState(false);

  useEffect(() => {
    let alive = true;
    loadModelViewer().then(
      () => alive && setDefined(true),
      () => alive && onError(),
    );
    return () => {
      alive = false;
    };
  }, [onError]);

  useEffect(() => {
    const mv = el.current;
    if (!mv || !defined) return;
    const progress = (e: Event) => onProgress((e as CustomEvent<{ totalProgress: number }>).detail.totalProgress);
    const load = () => onLoad();
    const fail = () => onError();
    mv.addEventListener("progress", progress);
    mv.addEventListener("load", load);
    mv.addEventListener("error", fail);
    if (mv.loaded) onLoad();
    return () => {
      mv.removeEventListener("progress", progress);
      mv.removeEventListener("load", load);
      mv.removeEventListener("error", fail);
    };
  }, [defined, onProgress, onLoad, onError]);

  // Colourway from the product's colour choice (a variant stored in the model file).
  useEffect(() => {
    if (el.current && defined) el.current.variantName = variant ?? null;
  }, [variant, defined]);

  useImperativeHandle(
    ref,
    () => ({
      turn: (steps) => {
        const mv = el.current;
        if (!mv) return;
        const o = mv.getCameraOrbit();
        mv.cameraOrbit = `${o.theta - (steps * Math.PI) / 6}rad ${o.phi}rad ${o.radius}m`;
      },
      zoom: (delta) => el.current?.zoom(delta * 3),
      reset: () => {
        const mv = el.current;
        if (!mv) return;
        mv.cameraOrbit = orbit;
        mv.fieldOfView = "auto";
        mv.jumpCameraToGoal();
      },
      open: (on) => {
        const mv = el.current;
        if (!mv || !openAnimation) return;
        mv.animationName = openAnimation;
        if (on) mv.play({ repetitions: 1 });
        else {
          mv.pause();
          mv.currentTime = 0;
        }
      },
    }),
    [orbit, openAnimation],
  );

  if (!defined) return <div className="pv-model pv-model--waiting" style={{ backgroundImage: `url("${poster}")` }} />;
  return (
    <model-viewer
      ref={(node: HTMLElement | null) => {
        el.current = node as ModelViewerElement | null;
      }}
      class="pv-model"
      src={src}
      poster={poster}
      alt={alt}
      camera-controls=""
      touch-action="pan-y"
      interaction-prompt="none"
      camera-orbit={orbit}
      min-camera-orbit="auto auto auto"
      max-field-of-view="40deg"
      min-field-of-view="8deg"
      shadow-intensity="0.85"
      shadow-softness="0.8"
      exposure="1.05"
      environment-image="neutral"
      tone-mapping="aces"
      loading="eager"
      reveal="auto"
    />
  );
});
