"""Measure where a bouquet is held and how big it is drawn, relative to a reference.

In the app a bouquet is drawn with its `grip` point on the fist and a height of
`size` x knuckle span (index knuckle to pinky knuckle, landmarks 5 and 17).
To make every bouquet feel equally big in the hand, its flower head is matched
to the reference bouquet (White tulips) in two ways, and the smaller wins:

  area   sqrt(opaque pixels above the grip)    -> same visual mass
  width  3rd-97th percentile column span       -> never wider than 1.05x the reference

The grip is placed `gap` knuckle spans below the lowest bloom, so a strip of bare
stem shows between the flowers and the fingers (approved bouquets use 1-1.5).

Usage:  python measure_bouquet.py FLOWERS_DIR name bloom_bottom [gap]
        bloom_bottom = y (0-1) of the lowest petal, read off the image
Prints a flowers.js-ready `grip` and `size`.
"""
import sys

import numpy as np
from PIL import Image

REFERENCE = ("tulip-putih", 0.673, 3.92)  # id, grip y, size: the bouquet everything is matched to


def alpha(path):
    return np.asarray(Image.open(path))[..., 3] > 128


def head(mask, grip_y):
    above = mask[: int(grip_y * mask.shape[0])]
    cols = np.where(above.sum(0) > 2)[0]
    return np.sqrt(above.sum()), np.percentile(cols, 97) - np.percentile(cols, 3)


def measure(folder, name, bloom_bottom, gap=1.15):
    ref_id, ref_grip, ref_size = REFERENCE
    ref = alpha(f"{folder}/{ref_id}.png")
    ref_unit = ref.shape[0] / ref_size
    ref_area, ref_width = (v / ref_unit for v in head(ref, ref_grip))

    mask = alpha(f"{folder}/{name}.png")
    h = mask.shape[0]
    size, grip_y = 3.0, bloom_bottom + 0.2
    for _ in range(4):  # size and grip depend on each other; this settles in a few rounds
        area, width = head(mask, grip_y)
        size = min(h * ref_area / area, h * ref_width * 1.05 / width)
        grip_y = min(bloom_bottom + gap / size, 0.95)
    row = np.where(mask[int(grip_y * h)])[0]
    stem_below = (1 - grip_y) * size
    return dict(x=round(row.mean() / mask.shape[1], 3), y=round(grip_y, 3), size=round(size, 2), stem_below=round(stem_below, 2))


if __name__ == "__main__":
    folder, name, bloom = sys.argv[1], sys.argv[2], float(sys.argv[3])
    gap = float(sys.argv[4]) if len(sys.argv) > 4 else 1.15
    m = measure(folder, name, bloom, gap)
    print(f'grip: {{ x: {m["x"]}, y: {m["y"]} }}, size: {m["size"]},   // stem below fist: {m["stem_below"]} knuckle spans')
    if m["stem_below"] < 0.8:
        print("stem below the fist is short; lengthen it with stretch_stems.py first")
