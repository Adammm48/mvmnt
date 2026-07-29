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
import subprocess

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


def build_clip(still: pathlib.Path, name: str, seconds: int = 5, fps: int = 25) -> pathlib.Path | None:
    """
    A slow push-in on a still, encoded as real h264/mp4.

    Needs `imageio-ffmpeg` (a real, complete ffmpeg binary it downloads on first
    use). The ffmpeg bundled with Playwright is NOT a substitute — it is a
    stripped build with no image decoders and cannot do this, which is why this
    is a separate optional step rather than part of `build()` above.

    This exists because RunHero's video path went uncaught for a while with no
    clip anywhere in the seed data to exercise it against. A real clip here is
    what makes `npm run db:reset` demonstrate the video path out of the box.
    """
    try:
        import imageio_ffmpeg
    except ImportError:
        return None

    import numpy as np

    src = Image.open(still).convert("RGB")
    out_w, out_h = 960, 640
    n = fps * seconds
    path = OUT / f"{name}.mp4"

    proc = subprocess.Popen(
        [
            imageio_ffmpeg.get_ffmpeg_exe(), "-y",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{out_w}x{out_h}", "-r", str(fps),
            "-i", "pipe:0",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-movflags", "+faststart",
            str(path),
        ],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    for i in range(n):
        zoom = 1.0 + 0.15 * (i / (n - 1))
        crop_w, crop_h = int(src.width / zoom), int(src.height / zoom)
        left = (src.width - crop_w) // 2
        top_px = int((src.height - crop_h) * 0.4)
        frame = src.crop((left, top_px, left + crop_w, top_px + crop_h)).resize(
            (out_w, out_h), Image.LANCZOS
        )
        proc.stdin.write(np.asarray(frame).tobytes())
    proc.stdin.close()
    stderr = proc.stderr.read()
    if proc.wait() != 0:
        print(f"  (clip generation failed for {name}: {stderr.decode()[-300:]})")
        return None
    return path


# Gallery placeholders: same abstract style, one per Drive folder plus spares,
# each seeded differently so the grid reads as a set of photos rather than one
# image repeated. Still deliberately not photographs of people.
GALLERY = [
    ("gallery-pre-run-1", (255, 158, 110), (255, 90, 54), (255, 201, 60)),
    ("gallery-pre-run-2", (255, 138, 76), (214, 88, 92), (255, 201, 60)),
    ("gallery-run-1", (38, 74, 106), (255, 90, 54), (61, 220, 132)),
    ("gallery-run-2", (255, 90, 54), (27, 31, 42), (255, 201, 60)),
    ("gallery-run-3", (214, 88, 92), (38, 74, 106), (255, 201, 60)),
    ("gallery-after-1", (255, 201, 60), (255, 138, 76), (255, 90, 54)),
    ("gallery-after-2", (58, 65, 82), (27, 31, 42), (61, 220, 132)),
    ("gallery-camera-1", (27, 31, 42), (38, 74, 106), (255, 90, 54)),
]


# Merch placeholders: a flat tile per product in the brand palette, with the
# item drawn as a simple mark. Abstract like everything else here — the real
# product photos are the club's to take.
MERCH = [
    ("product-tee", (255, 90, 54)),
    ("product-cap", (27, 31, 42)),
    ("product-bottle", (61, 220, 132)),
    ("product-jacket", (38, 74, 106)),
]


def build_product(name: str, colour: tuple[int, int, int]) -> pathlib.Path:
    size = 800
    image = Image.new("RGB", (size, size), colour)
    draw = ImageDraw.Draw(image)

    # A soft diagonal sheen so the tile reads as fabric-ish rather than flat.
    sheen = Image.new("L", (size, size), 0)
    sd = ImageDraw.Draw(sheen)
    for i in range(-size, size, 14):
        sd.line([(i, size), (i + size, 0)], fill=22, width=6)
    white = Image.new("RGB", (size, size), (255, 255, 255))
    image = Image.composite(white, image, sheen.filter(ImageFilter.GaussianBlur(2)))
    draw = ImageDraw.Draw(image)

    # The wordmark, big and centred — merch is the brand.
    text = "MVMNT"
    # Default bitmap font scaled up: crude on purpose, it reads as a print.
    from PIL import ImageFont

    font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    scale = int(size * 0.7 / tw)
    mark = Image.new("RGBA", (tw + 2, th + 2), (0, 0, 0, 0))
    ImageDraw.Draw(mark).text((1, 1), text, font=font, fill=(247, 245, 242, 235))
    mark = mark.resize((mark.width * scale, mark.height * scale), Image.NEAREST)
    image.paste(mark, ((size - mark.width) // 2, (size - mark.height) // 2), mark)

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.jpg"
    image.save(path, "JPEG", quality=85, optimize=True)
    return path


if __name__ == "__main__":
    for scene in SCENES:
        path = build(*scene)
        print(f"{path.name}  {path.stat().st_size // 1024}KB")

    for scene in GALLERY:
        path = build(*scene)
        print(f"{path.name}  {path.stat().st_size // 1024}KB")

    for name, colour in MERCH:
        path = build_product(name, colour)
        print(f"{path.name}  {path.stat().st_size // 1024}KB")

    # One clip is enough to prove the path works — the rest stay stills.
    clip = build_clip(OUT / "saturday-6k.jpg", "saturday-6k")
    if clip:
        print(f"{clip.name}  {clip.stat().st_size // 1024}KB")
    else:
        print("  (skipped cover clip: pip install imageio-ffmpeg to enable it)")
