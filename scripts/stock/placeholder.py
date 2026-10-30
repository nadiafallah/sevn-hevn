"""Branded "photographs coming soon" card for a piece SEVN HEVN holds but hasn't photographed yet.

It shows no product — only the house and model in type — so it can never be mistaken for the piece.
usage: python placeholder.py FONTS_DIR OUT.jpg "House" "Model name"
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1800, 2400
BG = (243, 239, 233)
ESPRESSO = (42, 28, 22)
MUTED = (107, 94, 85)
CHAMPAGNE = (214, 200, 174)

fonts, out, house, model = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]


def font(name, size, weight):
    f = ImageFont.truetype(str(fonts / name), size)
    f.set_variation_by_axes([weight])
    return f


def tracked(draw, y, text, f, fill, tracking):
    widths = [draw.textlength(ch, font=f) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = (W - total) / 2
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=f, fill=fill)
        x += w + tracking


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
inset = round(W * 0.12)
d.rectangle([inset, inset, W - inset, H - inset], outline=CHAMPAGNE, width=3)

mark = Image.open(fonts / "wordmark.png").convert("RGBA")
tint = Image.new("RGBA", mark.size, ESPRESSO + (255,))
tint.putalpha(mark.getchannel("A").point(lambda v: v * 0.85))
img.paste(tint, ((W - mark.width) // 2, round(H * 0.20)), tint)

tracked(d, round(H * 0.40), house.upper(), font("Jost.ttf", 46, 500), MUTED, 12)

serif = font("Cormorant.ttf", 132, 400)
words, lines, line = model.split(), [], ""
for w in words:
    test = f"{line} {w}".strip()
    if d.textlength(test, font=serif) > W - inset * 2 - 160 and line:
        lines.append(line)
        line = w
    else:
        line = test
lines.append(line)
y = round(H * 0.45)
for ln in lines:
    d.text(((W - d.textlength(ln, font=serif)) / 2, y), ln, font=serif, fill=ESPRESSO)
    y += 150

d.line([(W / 2 - 60, y + 70), (W / 2 + 60, y + 70)], fill=CHAMPAGNE, width=3)
tracked(d, y + 130, "PHOTOGRAPHS COMING SOON", font("Jost.ttf", 38, 400), MUTED, 9)

Path(out).parent.mkdir(parents=True, exist_ok=True)
img.save(out, quality=90, optimize=True, progressive=True)
print(out)
