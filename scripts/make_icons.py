#!/usr/bin/env python3
"""Generate the app icons (radar sweep + meeting dots).

    python3 scripts/make_icons.py
"""
import math
import pathlib

from PIL import Image, ImageDraw, ImageFilter

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "icons"

BG_TOP = (6, 12, 22)
BG_BOTTOM = (3, 6, 12)
RING = (52, 96, 130)
SWEEP = (46, 230, 196)
DOTS = [(46, 240, 200), (255, 193, 77), (91, 107, 134), (255, 193, 77)]


def radial_background(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), BG_BOTTOM)
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(size - 1, 1)
        col = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (size, y)], fill=col)
    return img


def draw_icon(size: int) -> Image.Image:
    scale = 4
    s = size * scale
    img = radial_background(s).convert("RGBA")

    rings = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rings)
    cx = cy = s / 2
    for r in (0.34, 0.22, 0.11):
        radius = s * r
        rd.ellipse(
            [cx - radius, cy - radius, cx + radius, cy + radius],
            outline=(*RING, 190),
            width=max(2, int(s * 0.006)),
        )
    # crosshair
    tick = s * 0.045
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        rd.line(
            [
                (cx + dx * s * 0.40, cy + dy * s * 0.40),
                (cx + dx * (s * 0.40 - tick), cy + dy * (s * 0.40 - tick)),
            ],
            fill=(*RING, 220),
            width=max(2, int(s * 0.006)),
        )

    sweep = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sweep)
    radius = s * 0.40
    start = -60
    steps = 40
    for i in range(steps):
        a0 = start + 60 * i / steps
        a1 = start + 60 * (i + 1) / steps
        alpha = int(70 * (i / steps) ** 2)
        sd.pieslice(
            [cx - radius, cy - radius, cx + radius, cy + radius],
            a0,
            a1,
            fill=(*SWEEP, alpha),
        )
    sd.pieslice(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        start,
        start + 2,
        fill=(*SWEEP, 190),
    )
    sweep = sweep.filter(ImageFilter.GaussianBlur(s * 0.004))

    img = Image.alpha_composite(img, rings)
    img = Image.alpha_composite(img, sweep)

    dots = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dots)
    pts = [(0.62, 0.40), (0.36, 0.63), (0.55, 0.72), (0.30, 0.34)]
    for (px, py), colour in zip(pts, DOTS):
        x, y = s * px, s * py
        r = s * 0.030
        dd.ellipse([x - r * 2.2, y - r * 2.2, x + r * 2.2, y + r * 2.2], fill=(*colour, 60))
        dd.ellipse([x - r, y - r, x + r, y + r], fill=(*colour, 255))
    img = Image.alpha_composite(img, dots)

    # rounded mask
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.22, fill=255)
    img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512, 1024):
        draw_icon(size).save(OUT / f"icon-{size}.png")
    draw_icon(180).save(OUT / "apple-touch-icon.png")
    # maskable: same art, extra padding baked into a square canvas
    base = draw_icon(512)
    canvas = Image.new("RGBA", (512, 512), (4, 7, 13, 255))
    inner = base.resize((410, 410), Image.LANCZOS)
    canvas.paste(inner, (51, 51), inner)
    canvas.save(OUT / "maskable-512.png")
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
