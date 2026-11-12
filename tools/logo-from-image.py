"""Turns a flat logo picture (transparent background) into the pieces the 3D logo scene needs.
Run:  python3 tools/logo-from-image.py assets/logos/tawassl/original.webp assets/logos/tawassl
Needs: pip install opencv-python-headless potracer pillow numpy
Writes into the output folder:
  layers.svg  - outlines of the logo, split into: dark, gold, name-dark, name-gold
  color.png   - the logo's own colours, spread slightly past the edges so 3D sides pick up clean colour
"""
import sys
import numpy as np, cv2, potrace
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
UP = 3  # trace at 3x size for smoother curves
rgba = np.array(Image.open(src).convert('RGBA'))
H, W = rgba.shape[:2]
rgb, alpha = rgba[..., :3], rgba[..., 3]
hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)

big = lambda m: cv2.resize(m.astype(np.float32), (W * UP, H * UP), interpolation=cv2.INTER_CUBIC)
solid = big(alpha / 255.0) > 0.5
is_gold = (big(hsv[..., 1]) > 110) & (big(hsv[..., 2]) > 110)
gold, dark = solid & is_gold, solid & ~is_gold
# tidy: remove specks and hairline slivers where the two colours meet
k = np.ones((3, 3), np.uint8)
clean = lambda m: cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, k, iterations=2).astype(bool)
gold, dark = clean(gold), clean(dark)
# drop tiny dark slivers (thin outline lines where the gold ring crosses other parts)
count, labels, stats, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8))
for i in range(1, count):
    if stats[i, cv2.CC_STAT_AREA] < 500 * UP * UP:
        dark[labels == i] = False

# The channel name is the bottom line of small lettering: find the empty gap above it.
rows = solid.sum(axis=1)
filled = np.where(rows > 0)[0]
top, bottom = filled[0], filled[-1]
gaps = [y for y in range(int(top + (bottom - top) * 0.7), bottom) if rows[y] == 0]
name_y = gaps[len(gaps) // 2] if gaps else bottom + 1
print('logo rows', top / UP, bottom / UP, 'name starts below y =', name_y / UP)

def path(mask):
    parts = []
    for curve in potrace.Bitmap(~mask).trace(turdsize=30, alphamax=1.0, opttolerance=0.3):
        p = curve.start_point
        parts.append(f'M{p.x / UP:.2f},{p.y / UP:.2f}')
        for s in curve.segments:
            if s.is_corner:
                parts.append(f'L{s.c.x / UP:.2f},{s.c.y / UP:.2f}L{s.end_point.x / UP:.2f},{s.end_point.y / UP:.2f}')
            else:
                parts.append(f'C{s.c1.x / UP:.2f},{s.c1.y / UP:.2f} {s.c2.x / UP:.2f},{s.c2.y / UP:.2f} '
                             f'{s.end_point.x / UP:.2f},{s.end_point.y / UP:.2f}')
        parts.append('Z')
    return ''.join(parts)

def split(mask):
    upper, lower = mask.copy(), mask.copy()
    upper[name_y:] = False
    lower[:name_y] = False
    return upper, lower

layers = {}
layers['dark'], layers['name-dark'] = split(dark)
layers['gold'], layers['name-gold'] = split(gold)
fills = {'dark': '#2a2c31', 'gold': '#fdc008', 'name-dark': '#2a2c31', 'name-gold': '#fdc008'}
with open(f'{out}/layers.svg', 'w') as f:
    f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n')
    for name, mask in layers.items():
        f.write(f'<path id="{name}" fill="{fills[name]}" fill-rule="evenodd" d="{path(mask)}"/>\n')
    f.write('</svg>\n')

# Colour picture: every see-through pixel takes the colour of its nearest solid pixel.
inside = (alpha > 220).astype(np.uint8)
inside = cv2.erode(inside, k, iterations=1)
_, labels = cv2.distanceTransformWithLabels(1 - inside, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
ys, xs = np.where(inside == 1)
lookup = np.zeros((labels.max() + 1, 3), np.uint8)
lookup[labels[ys, xs]] = rgb[ys, xs]
Image.fromarray(lookup[labels]).save(f'{out}/color.png')

gold_px, dark_px = rgb[(alpha > 250) & (hsv[..., 1] > 110)], rgb[(alpha > 250) & (hsv[..., 1] <= 110)]
print('gold colour  #%02x%02x%02x' % tuple(np.median(gold_px, axis=0).astype(int)))
print('dark colour  #%02x%02x%02x' % tuple(np.median(dark_px, axis=0).astype(int)))
