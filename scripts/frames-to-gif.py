#!/usr/bin/env python3
"""
Assemble the captured frames into the README animation.

    node scripts/capture-checkin-gif.mjs
    python3 scripts/frames-to-gif.py

Pillow rather than ffmpeg: the only ffmpeg on this machine is Playwright's
stripped build, which has no image decoders. Pillow is already a dependency of
the placeholder-media script.
"""

from __future__ import annotations

import pathlib
import sys

from PIL import Image

FRAMES = pathlib.Path("docs/screenshots/.frames")
OUT = pathlib.Path("docs/screenshots/check-in.gif")

# Half width keeps the file small enough to sit in a README without the page
# stalling on it; a phone screenshot is legible at this size.
WIDTH = 300
FRAME_MS = 90
END_HOLD_MS = 1600


def main() -> int:
    paths = sorted(FRAMES.glob("*.png"))
    if not paths:
        print(f"No frames in {FRAMES}. Run capture-checkin-gif.mjs first.", file=sys.stderr)
        return 1

    frames = []
    for path in paths:
        image = Image.open(path).convert("RGB")
        height = round(image.height * WIDTH / image.width)
        frames.append(image.resize((WIDTH, height), Image.LANCZOS))

    # Adaptive palette per the whole animation, so the coral and the confetti
    # survive quantisation instead of banding into mud.
    quantised = [f.quantize(colors=200, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)
                 for f in frames]

    durations = [FRAME_MS] * len(quantised)
    durations[-1] = END_HOLD_MS

    OUT.parent.mkdir(parents=True, exist_ok=True)
    quantised[0].save(
        OUT,
        save_all=True,
        append_images=quantised[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )

    print(f"{OUT}  {OUT.stat().st_size // 1024}KB  ({len(frames)} frames)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
