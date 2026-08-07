"""
Cut a product out of its photo and re-stage it on a different backdrop.

Deliberately NOT generative. The product pixels are the source pixels, resized and
moved — nothing is redrawn. That removes the two failure modes the generative path
in api/worker-variants.js has to defend against with a verify call:
  * it cannot hand back a different product (the ~1-in-4 reject rate)
  * it cannot warp, melt or hallucinate detail
So there is no check step here, and no per-image cost.

Kept free of gradio so it can be imported and tested on its own.
"""

from __future__ import annotations

import io
import os
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

BACKDROP_DIR = Path(__file__).parent / "backdrops"

# Names are stable — the pipeline stores which slot a listing used, so renaming
# these would orphan existing listings. Add to the end instead.
BACKDROPS = ["seamless_grey", "wall_wood", "brick", "concrete_beige"]

# How much of the frame the product fills. 0.72 keeps a margin on every side so the
# product is never clipped — the FRAMING failure the verify prompts keep catching.
FILL = 0.72
# Vertical centre of the product, as a fraction of frame height. Slightly below
# middle so a floor-standing item sits on the floor line rather than floating.
BASELINE = 0.60


def _procedural(size, kind, seed=0):
    """Fallback backdrop when no photo is supplied.

    These are flat and hash poorly against each other (measured: 5-6 apart for the
    smooth ones). Real photographs belong in backdrops/ — see load_backdrop.
    """
    w, h = size
    rnd = random.Random(seed)
    im = Image.new("RGB", size)
    d = ImageDraw.Draw(im)

    if kind == "seamless_grey":
        for y in range(h):
            v = 228 - y * 18 // h
            d.line([(0, y), (w, y)], fill=(v, v, v))
    elif kind == "wall_wood":
        d.rectangle([0, 0, w, int(h * 0.62)], fill=(242, 240, 236))
        for i in range(0, w, 90):
            d.rectangle([i, int(h * 0.62), i + 86, h],
                        fill=(196 + rnd.randint(-12, 12), 160, 112))
    elif kind == "brick":
        d.rectangle([0, 0, w, h], fill=(150, 74, 58))
        for r, y in enumerate(range(0, h, 34)):
            off = 0 if r % 2 else 46
            for x in range(-46, w, 92):
                d.rectangle([x + off, y, x + off + 88, y + 30],
                            fill=(168 + rnd.randint(-14, 14), 86, 66))
    else:  # concrete_beige
        d.rectangle([0, 0, w, int(h * 0.6)], fill=(226, 216, 200))
        d.rectangle([0, int(h * 0.6), w, h], fill=(178, 176, 172))
        for _ in range(2500):
            x, y = rnd.randrange(w), rnd.randrange(h)
            v = rnd.randint(-14, 14)
            p = im.getpixel((x, y))
            im.putpixel((x, y), tuple(max(0, min(255, c + v)) for c in p))
        im = im.filter(ImageFilter.GaussianBlur(0.6))
    return im


def load_backdrop(kind, size):
    """A real photo from backdrops/ if present, else the procedural fallback.

    Photographs are strongly preferred and are the whole reason this is pluggable.
    Measured on 8x8 dHash: procedural smooth backdrops sit 5-6 apart, which is well
    inside duplicate range. Backdrops carrying visible STRUCTURE — a pendant lamp, a
    window frame, floorboards running to a corner — are what actually separate, which
    is the same conclusion api/worker-variants.js reached about generated scenes.
    Drop 4-6 CC0 room photos in backdrops/ named <kind>.jpg and they win automatically.
    """
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        p = BACKDROP_DIR / f"{kind}{ext}"
        if p.exists():
            im = Image.open(p).convert("RGB")
            # Cover-fit: fill the frame, crop the overflow, never letterbox.
            sc = max(size[0] / im.width, size[1] / im.height)
            im = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))),
                           Image.LANCZOS)
            left = (im.width - size[0]) // 2
            top = (im.height - size[1]) // 2
            return im.crop((left, top, left + size[0], top + size[1]))
    return _procedural(size, kind, seed=BACKDROPS.index(kind) if kind in BACKDROPS else 0)


def cutout(img, session=None):
    """RGB product photo -> RGBA with the background removed."""
    from rembg import remove
    return remove(img.convert("RGB"), session=session)


def compose(cut, kind, size=(1000, 1000), fill=FILL, baseline=BASELINE):
    """Place an RGBA cut-out on a backdrop, centred and whole."""
    bg = load_backdrop(kind, size)
    bbox = cut.getbbox()
    if bbox:
        cut = cut.crop(bbox)          # trim transparent margin before scaling
    bw, bh = size
    sc = min(bw * fill / cut.width, bh * fill / cut.height)
    cut = cut.resize((max(1, int(cut.width * sc)), max(1, int(cut.height * sc))),
                     Image.LANCZOS)
    out = bg.copy()
    out.paste(cut, ((bw - cut.width) // 2, int(bh * baseline) - cut.height // 2), cut)
    return out


def stage(img, kinds=None, size=(1000, 1000), session=None):
    """Product photo -> {backdrop_name: staged RGB image}. One cut-out, N composites."""
    cut = cutout(img, session=session)
    return {k: compose(cut, k, size=size) for k in (kinds or BACKDROPS)}


def dhash(im, s=8):
    """8x8 difference hash — the cheap stand-in for whatever a marketplace dedups on."""
    g = im.convert("L").resize((s + 1, s), Image.LANCZOS)
    px = list(g.getdata())
    return [px[r * (s + 1) + c] < px[r * (s + 1) + c + 1]
            for r in range(s) for c in range(s)]


def hamming(a, b):
    return sum(x != y for x, y in zip(a, b))


def to_png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()
