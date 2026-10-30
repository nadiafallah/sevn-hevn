"""Studio treatment for SEVN HEVN product photos.

Cut the real piece out of its photo, neutralise the colour cast and exposure against the white
surface it was shot on, and place it on one warm studio background with a soft shadow, framed the
same way for every photo (3:4, like the site's cards and gallery). The piece itself is never
redrawn: its pixels are the original pixels, only white-balanced and exposed.

usage: python studio.py OUT_DIR MANIFEST.json
manifest: [{"src": "...jpg", "out": "ref/01.jpg", "mode": "stand|flat|detail", "holes": false, "gains_from": "ref/01.jpg"}]
  stand  — piece standing on the table, photographed from the side or at an angle
  flat   — top-down shot
  detail — close-up: no cut-out, only colour and exposure (from gains_from) and a 3:4 crop
  holes  — also clear the table showing through closed loops (chains, handles)
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps
from rembg import new_session, remove
from scipy import ndimage

BG = np.array([243, 239, 233], dtype=np.float32)  # warm studio white, a shade under the site's --paper
W, H = 1800, 2400  # 3:4
WORK = 2400  # long side used for segmentation and processing
TABLE = 236.0  # brightness the table is brought to

session = new_session("isnet-general-use", providers=["CPUExecutionProvider"])


def load(path):
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    s = WORK / max(im.size)
    if s < 1:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im


def matte(im):
    a = np.asarray(remove(im, session=session, only_mask=True, post_process_mask=False), dtype=np.float32) / 255
    solid = a > 0.5
    lab, n = ndimage.label(solid)
    if n > 1:
        sizes = ndimage.sum(solid, lab, range(1, n + 1))
        keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= sizes.max() * 0.02])
        a = np.where(ndimage.binary_dilation(keep, iterations=6), a, 0)
    return a


def gains_for(px, a, mode):
    """Per-channel gains that make the surface around the piece neutral grey at TABLE brightness."""
    h = px.shape[0]
    away = ~ndimage.binary_dilation(a > 0.05, iterations=25)
    region = np.zeros_like(away)
    region[int(h * (0.0 if mode == "flat" else 0.55)) :, :] = True  # the table, not the cushion behind
    sel = px[away & region]
    if len(sel) < 5000:
        sel = px[away]
    lum = sel.mean(axis=1)
    sel = sel[lum > np.percentile(lum, 40)]  # the lit surface, not its shadows
    ref = np.median(sel, axis=0)
    return ref.mean() / np.maximum(ref, 1) * np.clip(TABLE / ref.mean(), 0.9, 1.35)


def clear_holes(px, a):
    """Table seen through a chain loop or under a handle: bright, colourless, enclosed by the piece."""
    spread = px.max(axis=2) - px.min(axis=2)
    lum = px.mean(axis=2)
    tableish = (a > 0.3) & (spread < 26) & (lum > TABLE - 75)
    lab, n = ndimage.label(ndimage.binary_opening(tableish, iterations=2))
    if not n:
        return a
    sizes = ndimage.sum(tableish, lab, range(1, n + 1))
    holes = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= (a > 0.5).sum() * 0.002])
    holes = ndimage.binary_dilation(holes, iterations=2)
    soft = ndimage.gaussian_filter(holes.astype(np.float32), 1.5)
    return a * (1 - np.clip(soft * 1.4, 0, 1))


def shadow(alpha, nw, nh, left, top, mode):
    base = np.asarray(alpha, dtype=np.float32) / 255
    if mode == "flat":
        layer = np.zeros((H, W), dtype=np.float32)
        dx, dy = round(nw * 0.008), round(nh * 0.018)
        layer[top + dy : top + dy + nh, left + dx : left + dx + nw] = base[: H - top - dy, : W - left - dx]
        return np.clip(ndimage.gaussian_filter(layer, nw * 0.03) * 0.28, 0, 0.35)
    # Contact shadow along the piece's lower outline, column by column, and a wider soft one.
    foot = np.zeros((H, W), dtype=np.float32)
    solid = base > 0.5
    cols = np.where(solid.any(axis=0))[0]
    bottom = nh - 1 - np.argmax(solid[::-1, cols], axis=0)
    ry = max(round(nh * 0.012), 3)
    for x, y in zip(cols, bottom):
        yy = top + y
        foot[max(yy - ry, 0) : min(yy + ry, H), left + x] = 1
    contact = ndimage.gaussian_filter(foot, (nw * 0.006, nw * 0.01))
    wide = ndimage.gaussian_filter(foot, (nw * 0.025, nw * 0.05))
    contact /= max(contact.max(), 1e-6)
    wide /= max(wide.max(), 1e-6)
    return np.clip(contact * 0.42 + wide * 0.22, 0, 0.55)


def frame(px, a, mode):
    ys, xs = np.where(a > 0.3)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    px, a = px[y0:y1, x0:x1], a[y0:y1, x0:x1]
    max_w, max_h = (0.82, 0.74) if mode == "flat" else (0.80, 0.66)
    s = min(W * max_w / px.shape[1], H * max_h / px.shape[0])
    nw, nh = round(px.shape[1] * s), round(px.shape[0] * s)
    piece = Image.fromarray(px.astype(np.uint8)).resize((nw, nh), Image.LANCZOS)
    alpha = Image.fromarray((a * 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS)
    left = (W - nw) // 2
    top = round(H * (0.5 if mode == "flat" else 0.54) - nh / 2)

    canvas = np.ones((H, W, 3), dtype=np.float32) * BG
    canvas *= (1 - shadow(alpha, nw, nh, left, top, mode))[..., None]
    region = canvas[top : top + nh, left : left + nw]
    aa = (np.asarray(alpha, dtype=np.float32) / 255)[..., None]
    region[:] = np.asarray(piece, dtype=np.float32) * aa + region * (1 - aa)
    return Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))


def highlight_gains(px):
    """No table in view (close-ups, pieces in their box): neutralise against the brightest colourless areas."""
    flat = px.reshape(-1, 3)
    spread = flat.max(axis=1) - flat.min(axis=1)
    lum = flat.mean(axis=1)
    sel = flat[(spread < 30) & (lum > np.percentile(lum, 85))]
    if len(sel) < 2000:
        return np.ones(3)
    ref = np.median(sel, axis=0)
    return ref.mean() / np.maximum(ref, 1) * np.clip(TABLE / ref.mean(), 0.9, 1.25)


def detail(px):
    h, w = px.shape[:2]
    if w / h > W / H:
        cw = round(h * W / H)
        px = px[:, (w - cw) // 2 : (w - cw) // 2 + cw]
    else:
        ch = round(w * H / W)
        px = px[(h - ch) // 2 : (h - ch) // 2 + ch]
    return Image.fromarray(px.astype(np.uint8)).resize((W, H), Image.LANCZOS)


def main(out, manifest):
    gains = {}
    for job in manifest:
        im = load(job["src"])
        raw = np.asarray(im, dtype=np.float32)
        mode = job.get("mode", "stand")
        if mode == "detail":
            g = gains[job["gains_from"]] if job.get("gains_from") else highlight_gains(raw)
            img = detail(np.clip(raw * g, 0, 255))
        else:
            a = matte(im)
            g = gains_for(raw, a, mode)
            px = np.clip(raw * g, 0, 255)
            if job.get("holes"):
                a = clear_holes(px, a)
            img = frame(px, a, mode)
        gains[job["out"]] = g
        dest = out / job["out"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        img.save(dest, quality=90, optimize=True, progressive=True)
        print(job["out"], mode, "gains", np.round(g, 3), flush=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text()))
