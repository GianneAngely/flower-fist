"""Blue-screen chroma key for the bouquet photos.

Each bouquet is first cleaned up in Google Flow and placed on a flat #0000FF
background. This script turns that into a transparent PNG:

  alpha   = how much bluer a pixel is than its red/green channels (b - max(r, g)),
            mapped through a soft ramp so thin stems and petal edges keep partial alpha
  despill = blue is clamped to max(r, g) + 8, which removes the blue fringe
            the screen leaves on white and pale petals
  crop    = tight bounding box of the visible bouquet, then downscaled to 1400 px

Usage:  python chroma_key.py IN_DIR OUT_DIR name [name ...]
        (reads IN_DIR/name.jpg, writes OUT_DIR/name.png)
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

KEY_SOLID, KEY_CLEAR = 35, 140  # b - max(r, g) below SOLID = opaque, above CLEAR = transparent


def key(path):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    rg = np.maximum(r, g)
    alpha = np.clip((KEY_CLEAR - (b - rg)) / (KEY_CLEAR - KEY_SOLID), 0, 1)
    despilled = np.stack([r, g, np.minimum(b, rg + 8)], -1)

    # erode by one pixel, then feather: no blue halo, no jagged edge
    a = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    out = Image.fromarray(despilled.clip(0, 255).astype(np.uint8))
    out.putalpha(a)

    visible = np.asarray(a) > 40
    ys, xs = np.where(visible.sum(1) > 3)[0], np.where(visible.sum(0) > 3)[0]
    out = out.crop((xs[0], ys[0], xs[-1] + 1, ys[-1] + 1))
    out.thumbnail((1400, 1400), Image.LANCZOS)
    return out


def residual_blue(img):
    """Pixels that are still clearly blue inside the opaque area (should be 0)."""
    a = np.asarray(img).astype(int)
    return int((((a[..., 2] - np.maximum(a[..., 0], a[..., 1])) > 40) & (a[..., 3] > 200)).sum())


if __name__ == "__main__":
    src, dst, *names = sys.argv[1:]
    for name in names:
        img = key(f"{src}/{name}.jpg")
        img.save(f"{dst}/{name}.png", optimize=True)
        print(f"{name}: {img.size[0]}x{img.size[1]}, residual blue px = {residual_blue(img)}")
