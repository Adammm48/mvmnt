"""Derive every app icon from the club's one official mark.

Source of truth: assets/brand/mvmnt-logo.png — the wordmark the owner
supplied, black on transparency. Everything the stores and launchers need is
cut from it here, so a sharper export (E1 asks for SVG or a square 1024) means
re-running this script and nothing else. No icon is hand-made; hand-made icons
drift from the mark they imitate.

The icon is the brand verbatim: black wordmark on the brand's white
(theme.ts: base #FFFFFF). Android's adaptive icon gets the wordmark inside
the 66% safe circle — launchers crop the rest into circles, squircles and
squares, and a mark that touches the edge loses its letters to the crop.

    python3 scripts/generate-app-icons.py
"""

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "brand" / "mvmnt-logo.png"
OUT = ROOT / "apps" / "mobile" / "assets"

WHITE = (255, 255, 255, 255)


def wordmark() -> Image.Image:
    """MVMNT alone, without the tagline underneath.

    The official export carries "LIVE IN THE MOVEMENT" under the wordmark. On
    a poster that is the mark; at home-screen size the tagline is a grey
    smudge pretending to be a scratch. The two blocks are separated by clear
    space, so the split is found rather than hard-coded — a re-exported logo
    with different proportions keeps working.
    """
    logo = Image.open(SOURCE).convert("RGBA")
    ink = logo.crop(logo.getbbox())

    alpha = ink.split()[3]
    rows_with_ink = [
        y for y in range(ink.height)
        if any(alpha.getpixel((x, y)) > 16 for x in range(0, ink.width, 4))
    ]
    # The largest vertical gap divides wordmark from tagline.
    gaps = [
        (rows_with_ink[i + 1] - rows_with_ink[i], rows_with_ink[i])
        for i in range(len(rows_with_ink) - 1)
    ]
    biggest_gap, gap_starts_after = max(gaps)
    if biggest_gap < ink.height * 0.05:
        return ink  # single-block export: nothing to strip
    top_block = ink.crop((0, 0, ink.width, gap_starts_after + 1))
    return top_block.crop(top_block.getbbox())


def on_canvas(size: int, mark_fraction: float, background) -> Image.Image:
    """The wordmark centred on a square canvas at a fraction of its width."""
    mark = wordmark()
    canvas = Image.new("RGBA", (size, size), background)
    target_w = int(size * mark_fraction)
    scale = target_w / mark.width
    resized = mark.resize((target_w, max(1, int(mark.height * scale))), Image.LANCZOS)
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2), resized)
    return canvas


def save(image: Image.Image, name: str, mode: str = "RGBA") -> None:
    path = OUT / name
    image.convert(mode).save(path)
    print(f"{name}  {image.size[0]}x{image.size[1]}")


if __name__ == "__main__":
    # iOS / general app icon. No transparency — the store rejects it.
    save(on_canvas(1024, 0.72, WHITE), "icon.png", mode="RGB")

    # Android adaptive icon. Foreground on transparency, sized for the 66%
    # safe zone; background a plain white tile; monochrome is the alpha the
    # themed-icon mask reads.
    save(on_canvas(512, 0.58, (0, 0, 0, 0)), "android-icon-foreground.png")
    save(Image.new("RGBA", (512, 512), WHITE), "android-icon-background.png")
    save(on_canvas(432, 0.58, (0, 0, 0, 0)), "android-icon-monochrome.png")

    # The web favicon. The full wordmark at 48px is a smudge; the first
    # letter survives.
    mark = wordmark()
    m_width = int(mark.width * 0.26)  # the M of MVMNT
    letter = mark.crop((0, 0, m_width, mark.height))
    canvas = Image.new("RGBA", (192, 192), WHITE)
    target = int(192 * 0.62)
    scale = target / letter.height
    resized = letter.resize((max(1, int(letter.width * scale)), target), Image.LANCZOS)
    canvas.paste(resized, ((192 - resized.width) // 2, (192 - resized.height) // 2), resized)
    save(canvas.resize((48, 48), Image.LANCZOS), "favicon.png")

    # Splash: the wordmark small and centred on white, which is how the app
    # already feels when it opens.
    save(on_canvas(1024, 0.5, WHITE), "splash-icon.png", mode="RGB")
