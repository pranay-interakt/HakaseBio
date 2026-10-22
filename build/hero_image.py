"""Make the home-page hero image from the protein render in assets/.

    python3 hero_image.py [blend] [brightness] [out-dir]

The render is toned down so it reads as atmosphere behind the headline: blended toward the
site's navy band (#0E1A33), dimmed, and faded into flat navy on the left and at the bottom
so the copy and the cards sit on solid colour. Writes hero-protein.webp (full size) and
hero-protein-960.webp (phones) into ../src/assets/img by default.
"""
from __future__ import annotations
import pathlib, sys
from PIL import Image, ImageEnhance

HERE = pathlib.Path(__file__).parent
NAVY = (14, 26, 51)

def make(blend=0.42, brightness=0.82, out=HERE.parent / "src/assets/img"):
    im = Image.open(HERE / "assets/hero-protein-source.webp").convert("RGB")
    W, H = im.size
    im = ImageEnhance.Brightness(im).enhance(brightness)
    im = Image.blend(im, Image.new("RGB", im.size, NAVY), blend)
    # alpha: 0 at the left edge rising to 1 by a third of the width; 1 down to the lower third, then easing to .1 at the bottom
    cols = [min(1.0, x / (W * 0.34)) ** 1.6 for x in range(W)]
    rows = [1.0 if y < H * 0.66 else 1.0 - 0.9 * ((y - H * 0.66) / (H * 0.34)) ** 1.4 for y in range(H)]
    mask = Image.new("L", im.size)
    mask.putdata([round(255 * cols[x] * rows[y]) for y in range(H) for x in range(W)])
    out_im = Image.composite(im, Image.new("RGB", im.size, NAVY), mask)
    out = pathlib.Path(out); out.mkdir(parents=True, exist_ok=True)
    out_im.save(out / "hero-protein.webp", quality=84, method=6)
    out_im.resize((960, round(H * 960 / W)), Image.LANCZOS).save(out / "hero-protein-960.webp", quality=82, method=6)
    return out_im

if __name__ == "__main__":
    a = sys.argv[1:]
    make(float(a[0]) if a else 0.42, float(a[1]) if len(a) > 1 else 0.82, a[2] if len(a) > 2 else HERE.parent / "src/assets/img")
    print("hero image written")
