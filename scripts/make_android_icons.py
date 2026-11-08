#!/usr/bin/env python3
"""Render the Android launcher icons from the web app icon.

    python3 scripts/make_android_icons.py

Capacitor scaffolds a placeholder icon; this replaces the square and round
mipmaps and the adaptive-icon foreground with the radar icon in `public/icons`.
"""
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "icons" / "icon-1024.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

# Legacy launcher icon sizes (48dp baseline) and the adaptive foreground
# size (108dp, of which the inner 72dp is the safe zone).
LAUNCHER = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def main() -> None:
    icon = Image.open(SRC).convert("RGBA")

    for density, size in LAUNCHER.items():
        out = RES / f"mipmap-{density}"
        out.mkdir(parents=True, exist_ok=True)
        square = icon.resize((size, size), Image.LANCZOS)
        square.save(out / "ic_launcher.png")
        round_icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        round_icon.paste(square, (0, 0), circle_mask(size))
        round_icon.save(out / "ic_launcher_round.png")

    for density, size in FOREGROUND.items():
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        inner = round(size * 0.74)
        art = icon.resize((inner, inner), Image.LANCZOS)
        mask = circle_mask(inner)
        offset = (size - inner) // 2
        canvas.paste(art, (offset, offset), mask)
        canvas.save(RES / f"mipmap-{density}" / "ic_launcher_foreground.png")

    print(f"wrote launcher icons from {SRC.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
