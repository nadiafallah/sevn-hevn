/**
 * `sizes` for a photo shown with `object-fit: cover` in a frame of `frameRatio` (width / height).
 * A photo wider than its frame is enlarged to fill the frame's height, so the browser needs a
 * proportionally wider file to keep it sharp. Only the size at the end of each entry is scaled,
 * never the media condition.
 */
export function coverSizes(sizes: string, image: { width: number; height: number }, frameRatio: number) {
  const k = image.width / image.height / frameRatio;
  if (k <= 1.05) return sizes;
  return sizes
    .split(",")
    .map((entry) => entry.replace(/(\d+(?:\.\d+)?)(vw|px)\s*$/, (_, n: string, unit: string) => `${Math.round(Number(n) * k)}${unit}`))
    .join(",");
}

/**
 * Ref for a photo that may still be downloading when the page becomes interactive: it fades in
 * once decoded instead of popping in. Photos that are already shown are left alone, and nothing
 * is hidden for reduced motion.
 */
export function fadeInOnLoad(img: HTMLImageElement | null) {
  if (!img || img.complete || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  img.dataset.fade = "wait";
  const done = () => {
    img.dataset.fade = "in";
  };
  img.addEventListener("load", done, { once: true });
  img.addEventListener("error", done, { once: true });
}
