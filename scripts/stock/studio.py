"""Studio treatment for SEVN HEVN product photos.

Cut the real piece out of its photo (out of its box or tissue too), balance its colour and exposure
against the white surface it was shot on, and place it on one stone set with a soft shadow, framed
the same way for every photo: 3:4, 3000 × 4000, from the full-resolution original.
The piece itself is never redrawn: its pixels are the original pixels, only white-balanced and
exposed, with highlights rolled off gently so white leather keeps its grain.

usage: python studio.py OUT_DIR MANIFEST.json SCENE_PREFIX
  SCENE_PREFIX-stand.png: the set for side views (a slab in front of a wall)
  SCENE_PREFIX-flat.png:  the same stone from above, for top-down shots
manifest: [{"src": "...jpg", "out": "ref/01.jpg", "mode": "stand|flat", "drop": ["white", "brown", "orange"], "holes": false}]
  stand  — piece standing on the table, photographed from the side or at an angle
  flat   — top-down shot
  drop   — also remove what the cut-out kept of the packaging: white tissue, brown suede or felt,
           the orange Hermès box
  holes  — also clear the table showing through closed loops (chains, handles)
  focus  — [x0, y0, x1, y1] as shares of the photo: crop to the piece first, so a small piece on its
           box or cushion is what the cut-out sees
  erase  — [{"poly": [[x, y], …] in percent of the photo, "only": "light" | "colour"}]: remove packaging
           the cut-out kept, by hand; "only" limits it to light pixels (tissue next to black leather)
           or to coloured ones (suede next to silver)
  neutral — silver: take out the colour the box or cushion reflects in it
  both   — combine two cut-out models, for white pieces on the white table
  add    — [[[x, y], …], …] in percent of the photo: outlines of parts the cut-out missed
  fill   — restore white areas the sole's rim encloses, which the cut-out loses on a white table
  area   — [[x, y], …] in percent of the photo: use this outline instead of the automatic cut-out
  gains  — [r, g, b] colour balance to use instead of measuring it (for focus crops)

Needs: pip install "rembg[cpu]" pillow numpy scipy. The BiRefNet model runs on the CPU provider:
the CoreML provider stalls on the owner's Mac.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps
from rembg import new_session, remove
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
W, H = 3000, 4000  # 3:4, like the site's cards and gallery
TABLE = 236.0  # brightness the white table is brought to
MAX_EXPOSURE = 1.22
SHOULDER = 0.86  # highlights above this share of white roll off instead of clipping

session = new_session("birefnet-general-lite", providers=["CPUExecutionProvider"])


def load(path):
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def matte(im, both=False):
    small = im.copy()
    small.thumbnail((2048, 2048), Image.LANCZOS)
    m = np.asarray(remove(small, session=session, only_mask=True, post_process_mask=False))
    if both:  # white on white: BiRefNet can lose a white insole on the table, IS-Net keeps it
        isnet = new_session("isnet-general-use", providers=["CPUExecutionProvider"])
        m = np.maximum(m, np.asarray(remove(small, session=isnet, only_mask=True, post_process_mask=False)))
    m = Image.fromarray(m).resize(im.size, Image.BICUBIC)
    return np.asarray(m, dtype=np.float32) / 255


def fill_enclosed(a, reach=10):
    """White insole on a white table: restore what the brown rim of the sole encloses."""
    q = 4
    small = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((a.shape[1] // q, a.shape[0] // q), Image.BILINEAR)) > 100
    closed = ndimage.binary_closing(small, iterations=reach)
    filled = ndimage.binary_fill_holes(closed)
    m = Image.fromarray((filled * 255).astype(np.uint8)).resize((a.shape[1], a.shape[0]), Image.BICUBIC)
    return np.maximum(a, np.asarray(m, dtype=np.float32) / 255)


def keep_main(a, share=0.02):
    """Largest solid region and anything near it as large; drops specks of tissue, dust or wrap."""
    solid = a > 0.5
    lab, n = ndimage.label(solid)
    if n <= 1:
        return a
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= sizes.max() * share])
    return np.where(ndimage.binary_dilation(keep, iterations=8), a, 0)


def gains_for(px, a, mode):
    """Per-channel gains that make the surface around the piece neutral and evenly lit."""
    step = max(1, px.shape[1] // 1200)
    px, a = px[::step, ::step], a[::step, ::step]
    h = px.shape[0]
    away = ~ndimage.binary_dilation(a > 0.05, iterations=12)
    region = np.zeros_like(away)
    region[int(h * (0.0 if mode == "flat" else 0.55)) :, :] = True  # the table, not the cushion behind
    sel = px[away & region]
    if len(sel) < 3000:
        sel = px[away]
    lum = sel.mean(axis=1)
    sel = sel[lum > np.percentile(lum, 40)]
    ref = np.median(sel, axis=0)
    return ref.mean() / np.maximum(ref, 1) * np.clip(TABLE / ref.mean(), 0.95, MAX_EXPOSURE)


def tone(px):
    """Linear up to SHOULDER, then a smooth roll-off to white: no clipped highlights."""
    x = px / 255
    k = SHOULDER
    over = x > k
    x[over] = k + (1 - k) * np.tanh((x[over] - k) / (1 - k))
    return x * 255


def drop_packaging(px, a, kinds):
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    spread = px.max(axis=2) - px.min(axis=2)
    lum = px.mean(axis=2)
    out = np.zeros(a.shape, dtype=bool)
    if "white" in kinds:  # tissue paper
        out |= (lum > 200) & (spread < 24)
    if "brown" in kinds:  # suede cushions, felt boards and pegs
        out |= (r > g) & (g > b) & (spread > 28) & (lum < 150)
    if "orange" in kinds:  # the Hermès box
        out |= (r - b > 95) & (r > 120)
    if "colour" in kinds:  # anything clearly coloured or dark-and-warm around silver
        out |= (spread / np.maximum(px.max(axis=2), 1) > 0.42)
    out = ndimage.binary_opening(out, iterations=2)
    a = np.where(out, 0, a)
    return keep_main(a, share=0.01)


def erase(px, a, areas):
    h, w = a.shape
    spread = px.max(axis=2) - px.min(axis=2)
    lum = px.mean(axis=2)
    for area in areas:
        poly = Image.new("L", (w, h), 0)
        ImageDraw.Draw(poly).polygon([(x * w / 100, y * h / 100) for x, y in area["poly"]], fill=255)
        inside = np.asarray(poly) > 0
        if area.get("only") == "light":
            inside &= lum > 70
        elif area.get("only") == "colour":
            inside &= (spread > 20) | (lum < 90)
        a = np.where(inside, 0, a)
    return keep_main(a, share=0.01)


def neutral(px, a, keep=0.3):
    lum = px.mean(axis=2, keepdims=True)
    grey = lum + (px - lum) * keep
    m = (a > 0.05)[..., None]
    return np.where(m, grey, px)


def clear_holes(px, a):
    spread = px.max(axis=2) - px.min(axis=2)
    lum = px.mean(axis=2)
    tableish = (a > 0.3) & (spread < 26) & (lum > TABLE - 75)
    lab, n = ndimage.label(ndimage.binary_opening(tableish, iterations=2))
    if not n:
        return a
    sizes = ndimage.sum(tableish, lab, range(1, n + 1))
    holes = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= (a > 0.5).sum() * 0.002])
    soft = ndimage.gaussian_filter(ndimage.binary_dilation(holes, iterations=3).astype(np.float32), 2)
    return a * (1 - np.clip(soft * 1.4, 0, 1))


def choke(a):
    """Pull the edge in slightly, so no light halo from the table shows against the stone."""
    return np.clip((a - 0.45) / 0.55, 0, 1)


def shadow(base, nw, nh, left, top, mode):
    """Worked out at a quarter of the size (it is all soft), then scaled up."""
    q = 4
    small = np.asarray(Image.fromarray((base * 255).astype(np.uint8)).resize((max(nw // q, 1), max(nh // q, 1)), Image.BILINEAR), dtype=np.float32) / 255
    layer = np.zeros((H // q, W // q), dtype=np.float32)
    sw, sh, sl, st = small.shape[1], small.shape[0], left // q, top // q
    if mode == "flat":
        dx, dy = round(sw * 0.012), round(sh * 0.016)  # the sets are lit from the left
        layer[st + dy : st + dy + sh, sl + dx : sl + dx + sw] = small[: H // q - st - dy, : W // q - sl - dx]
        shade = np.clip(ndimage.gaussian_filter(layer, sw * 0.008) * 0.3 + ndimage.gaussian_filter(layer, sw * 0.035) * 0.3, 0, 0.55)
    else:
        solid = small > 0.5
        cols = np.where(solid.any(axis=0))[0]
        bottom = sh - 1 - np.argmax(solid[::-1, cols], axis=0)
        ry = max(round(sh * 0.012), 1)
        for x, y in zip(cols, bottom):
            yy = st + y
            layer[max(yy - ry, 0) : min(yy + ry, H // q), sl + x] = 1
        contact = ndimage.gaussian_filter(layer, (sw * 0.006, sw * 0.01))
        wide = ndimage.gaussian_filter(layer, (sw * 0.025, sw * 0.05))
        contact /= max(contact.max(), 1e-6)
        wide /= max(wide.max(), 1e-6)
        shade = np.clip(contact * 0.6 + wide * 0.32, 0, 0.7)
    return np.asarray(Image.fromarray((shade * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=np.float32) / 255


def compose(px, a, mode, scene):
    ys, xs = np.where(a > 0.3)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    px, a = px[y0:y1, x0:x1], a[y0:y1, x0:x1]
    max_w, max_h = (0.80, 0.74) if mode == "flat" else (0.76, 0.56)
    s = min(W * max_w / px.shape[1], H * max_h / px.shape[0])
    nw, nh = round(px.shape[1] * s), round(px.shape[0] * s)
    piece = np.asarray(Image.fromarray(np.clip(px, 0, 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS), dtype=np.float32)
    alpha = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS), dtype=np.float32) / 255
    left = (W - nw) // 2
    # Flat lays sit in the middle; side views stand on the slab, whatever their height.
    top = round(H * 0.5 - nh / 2) if mode == "flat" else round(H * 0.81 - nh)
    canvas = scene[mode].copy()
    canvas *= (1 - shadow(alpha, nw, nh, left, top, mode))[..., None]
    region = canvas[top : top + nh, left : left + nw]
    region[:] = piece * alpha[..., None] + region * (1 - alpha[..., None])
    return Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))


def main(out, manifest, prefix):
    scene = {m: np.asarray(Image.open(f"{prefix}-{m}.png").convert("RGB").resize((W, H), Image.LANCZOS), dtype=np.float32) for m in ("stand", "flat")}
    for job in manifest:
        dest = out / job["out"]
        if dest.exists() and not job.get("redo"):
            continue
        im = load(job["src"])
        if job.get("focus"):
            x0, y0, x1, y1 = job["focus"]
            im = im.crop((round(x0 * im.width), round(y0 * im.height), round(x1 * im.width), round(y1 * im.height)))
        mode = job.get("mode", "stand")
        if job.get("area"):  # a piece that has to stay on its display board: take the board by hand
            poly = Image.new("L", im.size, 0)
            ImageDraw.Draw(poly).polygon([(x * im.width / 100, y * im.height / 100) for x, y in job["area"]], fill=255)
            a = np.asarray(poly, dtype=np.float32) / 255
        else:
            a = keep_main(matte(im, job.get("both", False)))
        for add in job.get("add", []):  # part of the piece the cut-out missed, outlined by hand
            poly = Image.new("L", im.size, 0)
            ImageDraw.Draw(poly).polygon([(x * im.width / 100, y * im.height / 100) for x, y in add], fill=255)
            a = np.maximum(a, np.asarray(poly, dtype=np.float32) / 255)
        if job.get("fill"):
            a = fill_enclosed(a, job["fill"] if job["fill"] is not True else 10)
        raw = np.asarray(im, dtype=np.float32)
        # A cropped photo may show only the box or cushion: take the balance from the whole photo instead.
        g = np.array(job["gains"], dtype=np.float32) if job.get("gains") else gains_for(raw, a, mode)
        px = tone(raw * g)
        del raw
        if job.get("drop"):
            a = drop_packaging(px, a, job["drop"])
        if job.get("erase"):
            a = erase(px, a, job["erase"])
        if job.get("holes"):
            a = clear_holes(px, a)
        if job.get("neutral"):
            px = neutral(px, a)
        img = compose(px, choke(a), mode, scene)
        dest.parent.mkdir(parents=True, exist_ok=True)
        img.save(dest, quality=92, subsampling=0, optimize=True, progressive=True)
        print(job["out"], mode, "gains", np.round(g, 3), flush=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text()), sys.argv[3])
