#!/usr/bin/env python3
"""
Generate placeholder run cover images.

These are abstract, generated locally, and deliberately not photographs of
people — MVMNT's real run photos belong here instead, uploaded through the
admin console. They exist so the app can be developed and demoed against
something that looks alive rather than a grey box.

Palette follows App Spec §2: coral for energy, deep charcoal-navy as the base,
signal green and sunshine yellow as accents.

    python3 scripts/generate-placeholder-media.py
"""

from __future__ import annotations

import math
import pathlib
import random

from PIL import Image, ImageDraw, ImageFilter

OUT = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "seed-media"
WIDTH, HEIGHT = 1200, 800

# (name, sky top, sky bottom, accent) — each evokes a different time of day,
# because a 6am track session and a sunset long run should not look identical.
SCENES = [
    ("saturday-6k", (255, 138, 76), (255, 90, 54), (255, 201, 60)),      # sunrise
    ("track-session", (27, 31, 42), (58, 65, 82), (61, 220, 132)),        # floodlit night
    ("long-run", (255, 158, 110), (214, 88, 92), (255, 201, 60)),         # golden hour
    ("waterway", (38, 74, 106), (27, 31, 42), (61, 220, 132)),            # early blue hour
]


def vertical_gradient(top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    """Base sky wash."""
    image = Image.new("RGB", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(image)
    for y in range(HEIGHT):
        t = y / HEIGHT
        draw.line(
            [(0, y), (WIDTH, y)],
            fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
        )
    return image


def add_sun(image: Image.Image, accent: tuple[int, int, int]) -> None:
    """A soft light source, blurred so it reads as glow rather than a circle."""
    glow = Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0))
    draw = ImageDraw.Draw(glow)
    cx, cy, r = WIDTH * 0.72, HEIGHT * 0.34, 150
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=accent)
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    image.paste(Image.blend(image, Image.blend(image, glow, 0.55), 0.8), (0, 0))


def add_motion_streaks(image: Image.Image, rng: random.Random) -> None:
    """
    Diagonal streaks reading as speed. Blurred and low-opacity so they suggest
    movement without competing with the title text laid over the top.
    """
    layer = Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for _ in range(26):
        y = rng.uniform(0, HEIGHT)
        length = rng.uniform(WIDTH * 0.2, WIDTH * 0.7)
        x = rng.uniform(-200, WIDTH)
        thickness = rng.randint(2, 9)
        shade = rng.randint(120, 255)
        draw.line([(x, y), (x + length, y - length * 0.16)], fill=(shade,) * 3, width=thickness)
    layer = layer.filter(ImageFilter.GaussianBlur(7))
    image.paste(Image.blend(image, layer, 0.12), (0, 0))


def add_horizon(image: Image.Image) -> None:
    """A dark silhouetted skyline, so the frame reads as a place, not a texture."""
    draw = ImageDraw.Draw(image)
    base = HEIGHT * 0.78
    points = [(0, HEIGHT), (0, base)]
    x = 0
    rng = random.Random(7)
    while x < WIDTH:
        w = rng.randint(60, 150)
        h = rng.uniform(0, 70)
        points += [(x, base - h), (x + w, base - h)]
        x += w
    points += [(WIDTH, base), (WIDTH, HEIGHT)]
    draw.polygon(points, fill=(18, 21, 30))


def add_vignette(image: Image.Image) -> Image.Image:
    """
    Darken the lower half so overlaid white text stays legible whatever the
    scene — a contrast requirement (Principles §5), not a mood choice.
    """
    overlay = Image.new("L", (WIDTH, HEIGHT), 0)
    draw = ImageDraw.Draw(overlay)
    for y in range(HEIGHT):
        t = max(0.0, (y / HEIGHT - 0.35) / 0.65)
        draw.line([(0, y), (WIDTH, y)], fill=int(170 * math.pow(t, 1.6)))
    dark = Image.new("RGB", (WIDTH, HEIGHT), (10, 12, 18))
    return Image.composite(dark, image, overlay)


def build(name: str, top, bottom, accent) -> pathlib.Path:
    rng = random.Random(name)
    image = vertical_gradient(top, bottom)
    add_sun(image, accent)
    add_motion_streaks(image, rng)
    add_horizon(image)
    image = add_vignette(image)
    image = image.filter(ImageFilter.SMOOTH)

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.jpg"
    image.save(path, "JPEG", quality=82, optimize=True)
    return path


if __name__ == "__main__":
    for scene in SCENES:
        path = build(*scene)
        print(f"{path.name}  {path.stat().st_size // 1024}KB")
