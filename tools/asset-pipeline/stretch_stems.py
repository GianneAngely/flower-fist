"""Lengthen the bare stems of a bouquet without touching the flowers.

Image generators tend to make bouquets compact: blooms sit right on top of a
short stem bundle, so in the hand the flowers touch the fist. Stems are close to
vertical lines, so stretching only the rows below the blooms (from `start` down)
reads as longer stems and keeps the petals untouched.

Usage:  python stretch_stems.py IN.png OUT.png start factor
        start  = y (0-1) where bare stems begin
        factor = how much longer the stem section becomes (e.g. 1.6)
Remember: size in flowers.js scales with the new height (size x new_h / old_h).
"""
import sys

import numpy as np
from PIL import Image


def stretch(img, start, factor):
    w, h = img.size
    end = np.where((np.asarray(img)[..., 3] > 128).sum(1) > 1)[0].max() + 1
    y0 = int(start * h)
    top, stems = img.crop((0, 0, w, y0)), img.crop((0, y0, w, end))
    stems = stems.resize((w, round((end - y0) * factor)), Image.LANCZOS)
    out = Image.new("RGBA", (w, y0 + stems.height))
    out.paste(top, (0, 0))
    out.paste(stems, (0, y0))
    return out


if __name__ == "__main__":
    src, dst, start, factor = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
    img = Image.open(src)
    out = stretch(img, start, factor)
    out.save(dst, optimize=True)
    print(f"{img.size[1]} px -> {out.size[1]} px tall (scale size by {out.size[1] / img.size[1]:.3f})")
