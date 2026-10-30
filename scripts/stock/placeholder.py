"""Branded "photographs coming soon" card for a piece SEVN HEVN holds but hasn't photographed yet.

It shows no product — only the house and model in type — so it can never be mistaken for the piece.
usage: python placeholder.py FONTS_DIR STONE.png OUT.jpg "House" "Model name"
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 3000, 4000
PANEL = (247, 243, 236)
ESPRESSO = (42, 28, 22)
MUTED = (107, 94, 85)
CHAMPAGNE = (214, 200, 174)

fonts, stone, out, house, model = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]


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


img = Image.open(stone).convert("RGB").resize((W, H), Image.LANCZOS)
d = ImageDraw.Draw(img)
inset = round(W * 0.12)
d.rectangle([inset, inset, W - inset, H - inset], fill=PANEL, outline=CHAMPAGNE, width=5)

mark = Image.open(fonts / "wordmark.png").convert("RGBA")
mark = mark.resize((1060, round(mark.height * 1060 / mark.width)), Image.LANCZOS)
tint = Image.new("RGBA", mark.size, ESPRESSO + (255,))
tint.putalpha(mark.getchannel("A").point(lambda v: v * 0.85))
img.paste(tint, ((W - mark.width) // 2, round(H * 0.20)), tint)

tracked(d, round(H * 0.40), house.upper(), font("Jost.ttf", 77, 500), MUTED, 20)

serif = font("Cormorant.ttf", 220, 400)
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
    y += 250

d.line([(W / 2 - 100, y + 115), (W / 2 + 100, y + 115)], fill=CHAMPAGNE, width=5)
tracked(d, y + 215, "PHOTOGRAPHS COMING SOON", font("Jost.ttf", 63, 400), MUTED, 15)

Path(out).parent.mkdir(parents=True, exist_ok=True)
img.save(out, quality=90, optimize=True, progressive=True)
print(out)
