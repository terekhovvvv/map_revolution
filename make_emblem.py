# -*- coding: utf-8 -*-
"""Заглушка герба кафедры: тёмно-зелёный щит с золотой звездой и надписью.
Пользователь заменит emblem.png настоящим гербом."""
import math
from PIL import Image, ImageDraw, ImageFont

S = 4                      # суперсэмплинг для гладкости
W, H = 240, 280
GOLD = (212, 175, 55, 255)
GREEN = (38, 58, 32, 255)
GREEN2 = (74, 104, 56, 255)

# ── маска щита ──
shield = [(30, 14), (210, 14), (210, 118), (186, 204), (120, 262), (54, 204), (30, 118)]
shield_s = [(x * S, y * S) for x, y in shield]
mask = Image.new("L", (W * S, H * S), 0)
ImageDraw.Draw(mask).polygon(shield_s, fill=255)

# ── содержимое щита ──
body = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
d = ImageDraw.Draw(body)
d.polygon(shield_s, fill=GREEN)

# топографические горизонтали (дужки)
for k, rr in enumerate((150, 115, 82, 52)):
    cx, cy, ry = 120, 218, 0.5
    bbox = [(cx - rr) * S, (cy - rr * ry) * S, (cx + rr) * S, (cy + rr * ry) * S]
    d.arc(bbox, 195, 345, fill=GOLD if k % 2 else GREEN2, width=2 * S)

# звезда
def star(cx, cy, r_out, r_in, n=5):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = math.radians(-90 + i * 180 / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

d.polygon(star(120 * S, 92 * S, 44 * S, 18 * S), fill=GOLD)

# надпись
import matplotlib
font_path = matplotlib.get_data_path() + "/fonts/ttf/DejaVuSans-Bold.ttf"
f = ImageFont.truetype(font_path, 30 * S)
text = "УТС"
tw = d.textlength(text, font=f)
d.text(((W * S - tw) / 2, 148 * S), text, font=f, fill=GOLD)

# обрезать всё по форме щита
body.putalpha(mask)

# ── сборка: щит + рамка ──
img = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
img.alpha_composite(body)
d2 = ImageDraw.Draw(img)
d2.line(shield_s + [shield_s[0]], fill=GOLD, width=5 * S, joint="curve")
inner = [(40, 24), (200, 24), (200, 116), (178, 196), (120, 249), (62, 196), (40, 116)]
inner_s = [(x * S, y * S) for x, y in inner]
d2.line(inner_s + [inner_s[0]], fill=GOLD, width=2 * S, joint="curve")

img = img.resize((W, H), Image.LANCZOS)
img.save("emblem.png")
print("emblem.png сохранён:", img.size)
