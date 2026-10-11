import type { Item, ItemImage, ItemView } from "@/data/types";

/** 360° spin frames, interior photos and 3D models (migration 20261012120000). Public read by URL. */
export const PRODUCT_MEDIA_BUCKET = "product-media";

/** Public URL of a file in the product-media bucket. */
export function mediaUrl(url: string, storagePath: string) {
  return `${url}/storage/v1/object/public/${PRODUCT_MEDIA_BUCKET}/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
}

export type ViewRow = { product_ref: string; kind: "spin" | "model"; start_frame: number; reverse: boolean; model_path: string | null; model_bytes: number | null; open_animation: string | null };
export type MediaRow = { product_ref: string; kind: "frame" | "interior"; storage_path: string; zoom_path: string | null; width: number; height: number; alt: string | null };

/** A spin needs 12–72 frames of one shape (enforced by the database too). */
export const SPIN_MIN_FRAMES = 12;
export const SPIN_MAX_FRAMES = 72;

/** Attaches a piece's 360° view and interior photos, if they are complete. */
export function attachView(item: Item, url: string, view: ViewRow | undefined, media: MediaRow[]): Item {
  const mine = media.filter((m) => m.product_ref === item.ref);
  const interior: ItemImage[] = mine
    .filter((m) => m.kind === "interior")
    .map((m, i) => ({ src: mediaUrl(url, m.storage_path), width: m.width, height: m.height, alt: m.alt ?? `${item.name} — ${i + 1}` }));
  let built: ItemView | undefined;
  if (view?.kind === "spin") {
    const frames = mine.filter((m) => m.kind === "frame");
    if (frames.length >= SPIN_MIN_FRAMES && frames.length <= SPIN_MAX_FRAMES) {
      built = {
        kind: "spin",
        start: Math.min(view.start_frame, frames.length - 1),
        reverse: view.reverse || undefined,
        frames: frames.map((f) => ({
          src: mediaUrl(url, f.storage_path),
          zoom: mediaUrl(url, f.zoom_path ?? f.storage_path),
          width: f.width,
          height: f.height,
        })),
      };
    }
  } else if (view?.kind === "model" && view.model_path && item.images[0]) {
    built = {
      kind: "model",
      src: mediaUrl(url, view.model_path),
      poster: item.images[0].src,
      bytes: view.model_bytes ?? undefined,
      openAnimation: view.open_animation ?? undefined,
    };
  }
  // Interior photos are offered only together with a 360° view.
  return built ? { ...item, view: built, interior: interior.length ? interior : undefined } : item;
}

