"""
Whale of Dreams — procedural humpback whale build for Blender (bpy 4.x / 5.x).

Builds a complete, closed, textured humpback whale (body, rostrum tubercles,
eye, long scalloped pectoral fins, dorsal hump, serrated flukes), dresses it
with real 3D flowers and foliage, rigs it with a spine/fin armature, bakes a
seamless 12 s swim loop and exports a single GLB for Three.js.

Run headless:
    python3 blender/build_whale.py            (with `pip install bpy`)
    blender -b -P blender/build_whale.py      (with a Blender install)

Blender axes: +X = forward (snout), +Y = whale's left, +Z = up.
"""
import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_GLB = os.path.join(HERE, "whale_raw.glb")  # optimised to assets/whale.glb by build.sh
TEX_DIR = os.path.join(HERE, "textures")
os.makedirs(TEX_DIR, exist_ok=True)
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)

random.seed(11)
RNG = np.random.default_rng(11)
TAU = math.pi * 2

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = scene.collection


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def profile(pts, sigma=0.03):
    """Smooth 1D profile through control points (s, value)."""
    xs = np.linspace(0, 1, 2001)
    ys = np.interp(xs, [p[0] for p in pts], [p[1] for p in pts])
    sd = sigma * 2000
    k = int(sd * 3)
    g = np.exp(-0.5 * (np.arange(-k, k + 1) / sd) ** 2)
    g /= g.sum()
    sm = np.convolve(np.pad(ys, (k, k), mode="edge"), g, mode="valid")
    return lambda s: np.interp(s, xs, sm)


# --- 3D value noise (vectorised) -------------------------------------------
_PERM = RNG.permutation(1024)


def _hash(ix, iy, iz):
    h = _PERM[(ix & 1023)]
    h = _PERM[(h + iy) & 1023]
    h = _PERM[(h + iz) & 1023]
    return h / 1023.0


def vnoise(p):
    p = np.asarray(p, dtype=np.float64)
    fl = np.floor(p)
    f = p - fl
    i = fl.astype(np.int64)
    u = f * f * (3 - 2 * f)
    res = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[..., 0] if dx else 1 - u[..., 0]) * (u[..., 1] if dy else 1 - u[..., 1]) * (
                    u[..., 2] if dz else 1 - u[..., 2])
                res = res + w * _hash(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz)
    return res


def fbm(p, octaves=4, lac=2.03, gain=0.5):
    amp, tot, norm = 1.0, 0.0, 0.0
    p = np.asarray(p, dtype=np.float64)
    for o in range(octaves):
        tot = tot + amp * vnoise(p + o * 17.31)
        norm += amp
        p = p * lac
        amp *= gain
    return tot / norm


# ----------------------------------------------------------------------------
# body definition
# ----------------------------------------------------------------------------
X0 = 5.5     # snout x
BL = 11.0    # snout -> peduncle end
W = profile([(0, .30), (.04, .55), (.10, .80), (.18, 1.02), (.30, 1.28), (.42, 1.32), (.54, 1.16),
             (.66, .86), (.78, .52), (.88, .30), (.95, .19), (1.0, .12)])
HT = profile([(0, .14), (.05, .28), (.12, .46), (.20, .70), (.30, 1.0), (.42, 1.13), (.54, 1.05),
              (.66, .88), (.78, .66), (.88, .46), (.95, .30), (1.0, .14)])
HB = profile([(0, .16), (.05, .36), (.12, .62), (.20, .98), (.30, 1.36), (.42, 1.40), (.54, 1.15),
              (.66, .80), (.78, .52), (.88, .36), (.95, .26), (1.0, .12)])
CZ = profile([(0, .10), (.12, .02), (.4, 0.0), (.7, .08), (1.0, .10)])
EXP = profile([(0, 2.6), (.2, 2.3), (.5, 2.1), (.85, 2.0), (1.0, 2.3)])


def nose(s):
    t = np.clip(s / 0.045, 0, 1)
    return np.sqrt(1 - (1 - t) ** 2)


def body_xyz(s, th):
    s = np.asarray(s, dtype=np.float64)
    th = np.asarray(th, dtype=np.float64)
    n = EXP(s)
    nf = nose(s)
    c, sn = np.cos(th), np.sin(th)
    e = 2.0 / n
    y = W(s) * nf * np.sign(c) * np.abs(c) ** e
    h = np.where(sn >= 0, HT(s), HB(s)) * nf
    z = CZ(s) + h * np.sign(sn) * np.abs(sn) ** e
    # humpback head: slightly flattened rostrum with a raised midline splash-guard
    ridge = 0.05 * np.exp(-((th - math.pi / 2) / 0.18) ** 2) * smoothstep(0.02, 0.08, s) * (1 - smoothstep(0.16, 0.24, s))
    z = z + ridge
    x = X0 - s * BL
    return np.stack([x, y, z], -1)


def body_frame(s, th, eps=1e-3):
    p = body_xyz(s, th)
    ds = body_xyz(min(s + eps, 1.0), th) - body_xyz(max(s - eps, 0.0), th)
    dt = body_xyz(s, th + eps) - body_xyz(s, th - eps)
    nrm = np.cross(dt, ds)
    nrm /= np.linalg.norm(nrm) + 1e-12
    # make sure normal points outward
    centre = np.array([X0 - s * BL, 0, CZ(s)])
    if np.dot(nrm, p - centre) < 0:
        nrm = -nrm
    return p, nrm, ds / (np.linalg.norm(ds) + 1e-12)


# ----------------------------------------------------------------------------
# mesh builder
# ----------------------------------------------------------------------------
class MB:
    def __init__(self):
        self.v, self.f, self.uv, self.col, self.wt = [], [], [], [], []

    def add(self, verts, faces, uvs=None, cols=None, weights=None):
        base = len(self.v)
        self.v.extend([tuple(map(float, p)) for p in verts])
        n = len(verts)
        self.uv.extend(uvs if uvs is not None else [(0.0, 0.0)] * n)
        self.col.extend(cols if cols is not None else [(1, 1, 1)] * n)
        if isinstance(weights, dict) or weights is None:
            self.wt.extend([weights or {}] * n)
        else:
            self.wt.extend(weights)
        self.f.extend([tuple(base + i for i in fc) for fc in faces])
        return base

    def build(self, name, recalc=False):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.update()
        if recalc:
            import bmesh
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(me)
            bm.free()
        # loop uvs from per-vertex uvs (seams handled by caller via 'wrap' fix)
        uvl = me.uv_layers.new(name="UVMap")
        loop_vi = np.zeros(len(me.loops), dtype=np.int64)
        me.loops.foreach_get("vertex_index", loop_vi)
        uv = np.array(self.uv, dtype=np.float32)[loop_vi]
        uvl.data.foreach_set("uv", uv.ravel())
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        return ob


def fix_wrap_uv(ob, period_axis=1):
    """Fix UV seam on wrapped tubes: faces straddling v 1->0 get v+1."""
    me = ob.data
    uvl = me.uv_layers[0]
    for poly in me.polygons:
        vs = [uvl.data[li].uv[period_axis] for li in poly.loop_indices]
        if max(vs) - min(vs) > 0.5:
            for li in poly.loop_indices:
                uv = uvl.data[li].uv
                if uv[period_axis] < 0.5:
                    uv[period_axis] += 1.0


def tube_faces(nsec, nring, close=True):
    faces = []
    for i in range(nsec - 1):
        for j in range(nring):
            j2 = (j + 1) % nring
            a, b, c, d = i * nring + j, i * nring + j2, (i + 1) * nring + j2, (i + 1) * nring + j
            faces.append((a, b, c, d))
    return faces


# ----------------------------------------------------------------------------
# bones / weights
# ----------------------------------------------------------------------------
SPINE = [  # name, s_from, s_to, centre(for weights)
    ("head", 0.20, 0.0, 0.08),
    ("neck", 0.34, 0.20, 0.25),
    ("chest", 0.34, 0.50, 0.41),
    ("back", 0.50, 0.64, 0.57),
    ("lumbar", 0.64, 0.78, 0.71),
    ("tail1", 0.78, 0.90, 0.84),
    ("tail2", 0.90, 1.00, 0.95),
]
SPINE_C = np.array([b[3] for b in SPINE])


def spine_weights(s, fluke_mix=0.0):
    sig = 0.065
    w = np.exp(-((s - SPINE_C) / sig) ** 2)
    w[0] = max(w[0], 1.0 if s < 0.1 else 0)
    w /= w.sum()
    d = {SPINE[i][0]: float(w[i]) for i in range(len(SPINE)) if w[i] > 0.01}
    if fluke_mix > 0:
        d = {k: v * (1 - fluke_mix) for k, v in d.items()}
        d["fluke"] = d.get("fluke", 0) + fluke_mix
    tot = sum(d.values())
    return {k: v / tot for k, v in d.items()}


def fin_weights(side, r):
    s = "L" if side > 0 else "R"
    if r < 0.12:
        k = r / 0.12
        return {"chest": 1 - k, f"fin{s}1": k}
    k = smoothstep(0.38, 0.62, r)
    return {f"fin{s}1": float(1 - k), f"fin{s}2": float(k)}


# ----------------------------------------------------------------------------
# BODY
# ----------------------------------------------------------------------------
print("building body…")
NS, NR = 190, 80
ss = np.linspace(0, 1, NS) ** 1.08
ss[0] = 0.0015
ths = np.linspace(0, TAU, NR, endpoint=False)
S, TH = np.meshgrid(ss, ths, indexing="ij")
P = body_xyz(S, TH).reshape(-1, 3)
uvs = [(float(s), float(t / TAU)) for s, t in zip(S.ravel(), TH.ravel())]
faces = tube_faces(NS, NR)
wts = []
for s in S.ravel():
    wts.append(spine_weights(s, fluke_mix=float(smoothstep(0.97, 1.0, s)) * 0.5))
body = MB()
body.add(P, faces, uvs, None, wts)
# caps
tip = body_xyz(0.0, 0.0) + np.array([0.05, 0, 0])
tip[1] = 0
ti = len(body.v)
body.add([tip], [], [(0.0, 0.75)], None, spine_weights(0.0))
body.f.extend([(ti, j, (j + 1) % NR) for j in range(NR)])
end = np.array([X0 - BL - 0.06, 0, CZ(1.0)])
ei = len(body.v)
body.add([end], [], [(1.0, 0.5)], None, spine_weights(1.0, 0.5))
last = (NS - 1) * NR
body.f.extend([(ei, last + (j + 1) % NR, last + j) for j in range(NR)])

# dorsal fin: small hooked fin on a low hump
DS = np.linspace(0.60, 0.715, 18)
DR = 16
d_pts, d_uv, d_w = [], [], []
for s in DS:
    k = (s - 0.60) / 0.115
    H = 0.48 * (np.sin(np.clip(k, 0, 1) ** 0.8 * math.pi) ** 0.9) + 0.02
    ztop = body_xyz(s, math.pi / 2)[2]
    hook = -0.10 * smoothstep(0.55, 1.0, k)  # trailing hook leans back
    for j in range(DR):
        a = TAU * j / DR
        y = 0.075 * (1 - 0.6 * k) * np.cos(a) * (0.4 + 0.6 * (0.5 - 0.5 * np.sin(a)))
        z = ztop - 0.18 + (H + 0.18) * (0.5 + 0.5 * np.sin(a))
        xoff = hook * (0.5 + 0.5 * np.sin(a))
        d_pts.append((X0 - s * BL + xoff, y, z))
        d_uv.append((float(s), 0.25 + 0.02 * np.cos(a)))
        d_w.append(spine_weights(s))
body.add(d_pts, tube_faces(len(DS), DR), d_uv, None, d_w)
body_ob = body.build("WhaleBody", recalc=True)
fix_wrap_uv(body_ob)

# ----------------------------------------------------------------------------
# PECTORAL FINS + FLUKES  (shared "fin" texture: pectorals u∈[0,.5], flukes u∈[.5,1])
# ----------------------------------------------------------------------------
print("building fins…")
fins = MB()
FIN_LEN = 4.1
FIN_S = 0.305
FIN_INFO = {}


def pect_frame(side):
    th = -0.62 if side > 0 else math.pi + 0.62
    p, n, _ = body_frame(FIN_S, th)
    root = p - n * 0.32
    a = Vector((-0.50, 0.40 * side, -0.77)).normalized()
    X = Vector((1, 0, 0))
    c = (X - a * X.dot(a)).normalized()
    t = a.cross(c).normalized()
    if t.dot(Vector((0, side, 0))) < 0:
        t = -t
    return Vector(root), a, c, t


def pect_point(side, r, ph):
    root, a, c, t = FIN_INFO[side]
    chord = 0.24 + 0.92 * (1 - r ** 1.7)
    chord *= 0.82 + 0.18 * smoothstep(0.0, 0.25, r)  # slightly narrow at the root (wrist)
    thick = 0.25 * (1 - r) ** 0.9 + 0.05
    bump = 0.075 * max(0.0, math.sin(r * math.pi * 11 - 0.6)) ** 1.6 * smoothstep(0.18, 0.3, r)
    centre = root + a * (r * FIN_LEN) + c * (-0.55 * r ** 2) + t * (0.35 * r ** 2.2)
    cx, sy = math.cos(ph), math.sin(ph)
    X = 0.5 * chord * cx
    if cx > 0:
        X += bump * cx ** 3
    T = 0.5 * thick * sy * (0.72 + 0.28 * cx)
    return centre + c * X + t * T


for side in (1, -1):
    FIN_INFO[side] = pect_frame(side)
    NSP, NPH = 70, 28
    rs = np.linspace(0, 1, NSP)
    pts, uv, ww = [], [], []
    for r in rs:
        for j in range(NPH):
            ph = TAU * j / NPH
            pts.append(tuple(pect_point(side, r, ph)))
            uv.append((float(0.02 + 0.46 * r), j / NPH))
            ww.append(fin_weights(side, r))
    base = fins.add(pts, tube_faces(NSP, NPH), uv, None, ww)
    root, a, c, t = FIN_INFO[side]
    tipv = pect_point(side, 1.0, 0) * 0 + (root + a * (FIN_LEN + 0.1) + c * (-0.6) + t * 0.36)
    ti = fins.add([tuple(tipv)], [], [(0.49, 0.5)], None, fin_weights(side, 1.0))
    lst = base + (NSP - 1) * NPH
    fins.f.extend([(lst + j, lst + (j + 1) % NPH, ti) for j in range(NPH)])

XP = X0 - BL
ZP = float(CZ(1.0))
FL_SPAN = 2.7


def fluke_point(r, ph):
    u = abs(r)
    cx = XP - 0.22 - 1.15 * u ** 1.6
    cy = r * FL_SPAN
    cz = ZP + 0.42 * u ** 2.0
    chord = 0.10 + 1.30 * (1 - u ** 1.25) ** 0.85
    notch = 0.38 * math.exp(-(r / 0.07) ** 2)
    thick = 0.30 * (1 - u) ** 1.3 + 0.025
    c, sy = math.cos(ph), math.sin(ph)
    if c > 0:
        X = 0.36 * chord * c
    else:
        serr = 0.05 * abs(math.sin(u * math.pi * 9)) * u
        X = (0.64 * chord - notch - serr) * c
    T = 0.5 * thick * sy * (0.75 + 0.25 * c)
    return Vector((cx + X, cy, cz + T))


NSP, NPH = 121, 26
rs = np.linspace(-1, 1, NSP)
pts, uv, ww = [], [], []
for r in rs:
    for j in range(NPH):
        ph = TAU * j / NPH
        pts.append(tuple(fluke_point(r, ph)))
        uv.append((float(0.52 + 0.46 * (r + 1) / 2), j / NPH))
        mix = 1.0 - 0.35 * math.exp(-(r / 0.12) ** 2)
        ww.append({"fluke": mix, "tail2": 1 - mix} if mix < 1 else {"fluke": 1.0})
base = fins.add(pts, tube_faces(NSP, NPH), uv, None, ww)
for endr, ring0, sgn in ((-1.0, base, -1), (1.0, base + (NSP - 1) * NPH, 1)):
    tp = fluke_point(endr, 0) * 0 + Vector((XP - 0.22 - 1.15 - 0.02, endr * (FL_SPAN + 0.04), ZP + 0.42))
    ti = fins.add([tuple(tp)], [], [(0.5 + 0.25 * (endr + 1), 0.5)], None, {"fluke": 1.0})
    fins.f.extend([(ring0 + j, ring0 + (j + 1) % NPH, ti) for j in range(NPH)])
fins_ob = fins.build("WhaleFins", recalc=True)
fix_wrap_uv(fins_ob)

# ----------------------------------------------------------------------------
# DECOR: tubercles, eyes, flowers, foliage (vertex coloured, uv0 = (sway, phase))
# ----------------------------------------------------------------------------
print("building decor…")
decor = MB()


def frame_from_normal(n, hint=None):
    n = Vector(n).normalized()
    h = Vector(hint) if hint is not None else Vector((1, 0, 0))
    if abs(n.dot(h)) > 0.95:
        h = Vector((0, 0, 1))
    x = (h - n * h.dot(n)).normalized()
    y = n.cross(x)
    return Matrix((x, y, n)).transposed()  # columns = x,y,n


def add_local(verts, faces, cols, sway, pos, rot3, scale, weights, phase):
    verts = np.asarray(verts, dtype=np.float64) * scale
    R = np.array(rot3)
    wv = verts @ R.T + np.asarray(pos)
    uvs = [(float(sw), float(phase)) for sw in sway]
    decor.add(wv, faces, uvs, [tuple(c) for c in cols], weights)


def uv_sphere(nu=10, nv=7, rx=1, ry=1, rz=1):
    verts, faces = [], []
    verts.append((0, 0, -rz))
    for i in range(1, nv):
        v = math.pi * i / nv - math.pi / 2
        for j in range(nu):
            u = TAU * j / nu
            verts.append((rx * math.cos(v) * math.cos(u), ry * math.cos(v) * math.sin(u), rz * math.sin(v)))
    verts.append((0, 0, rz))
    top = len(verts) - 1
    for j in range(nu):
        faces.append((0, 1 + (j + 1) % nu, 1 + j))
    for i in range(nv - 2):
        for j in range(nu):
            a = 1 + i * nu + j
            b = 1 + i * nu + (j + 1) % nu
            faces.append((a, b, b + nu, a + nu))
    for j in range(nu):
        a = 1 + (nv - 2) * nu
        faces.append((a + j, a + (j + 1) % nu, top))
    return np.array(verts), faces


# --- tubercles on rostrum & lower jaw ---------------------------------------
TV, TF = uv_sphere(12, 7, 1, 1, 0.55)
tub_col = srgb_to_lin([0.48, 0.47, 0.47])
cands = []
for i in range(4000):
    s = random.uniform(0.012, 0.22)
    th = random.uniform(0, TAU)
    top = math.sin(th)
    # top of rostrum (rows near the midline) and the lower-jaw lip line
    on_top = top > 0.55 and abs(math.cos(th)) < 0.55 and s < 0.19
    lip_th = -0.20 - 0.45 * float(smoothstep(0.09, 0.22, s))
    on_lip = (abs(((th + math.pi) % TAU - math.pi) - lip_th) < 0.18 or
              abs(((math.pi - th + math.pi) % TAU - math.pi) - lip_th) < 0.18) and s < 0.2
    on_chin = top < -0.6 and s < 0.08
    if on_top or on_lip or on_chin:
        cands.append((s, th))
placed = []
for s, th in cands:
    p, n, _ = body_frame(s, th)
    if all(np.linalg.norm(p - q) > 0.17 for q in placed):
        placed.append(p)
        sc = random.uniform(0.026, 0.048)
        add_local(TV, TF, [tub_col * random.uniform(0.85, 1.12)] * len(TV), [0] * len(TV),
                  p - n * sc * 0.25, frame_from_normal(n), sc, spine_weights(s), 0)
    if len(placed) > 170:
        break
print("  tubercles:", len(placed))

# --- eyes --------------------------------------------------------------------
EV, EF = uv_sphere(14, 10, 1, 1, 0.8)
LV, LF = uv_sphere(16, 8, 1.6, 1.25, 0.55)
for side in (1, -1):
    s = 0.232
    th = 0.02 if side > 0 else math.pi - 0.02
    p, n, _ = body_frame(s, th)
    lid_col = srgb_to_lin([0.16, 0.16, 0.17])
    add_local(LV, LF, [lid_col] * len(LV), [0] * len(LV), p - n * 0.025, frame_from_normal(n, (1, 0, 0.2)), 0.085,
              spine_weights(s), 0)
    eye_col = srgb_to_lin([0.03, 0.025, 0.03])
    add_local(EV, EF, [eye_col] * len(EV), [0] * len(EV), p + n * 0.035, frame_from_normal(n), 0.07,
              spine_weights(s), 0)


# --- flower templates ---------------------------------------------------------
def petal_patch(width, length, cup, curl, nu=3, nv=3, ruffle=0.0):
    verts, b_of = [], []
    for iv in range(nv + 1):
        b = iv / nv
        hw = width * 0.5 * (math.sin(math.pi * (0.12 + 0.80 * b)) ** 0.75)
        for iu in range(nu + 1):
            a = iu / nu * 2 - 1
            x = a * hw
            y = -cup * (1 - a * a) * hw * (0.6 + 0.4 * b)
            z = b * length
            # outward curl at the tip
            ang = curl * b * b
            y2 = y * math.cos(ang) + z * math.sin(ang) * 0.6
            z2 = -y * math.sin(ang) * 0.3 + z * math.cos(ang * 0.5)
            y2 += ruffle * math.sin(a * 5 + b * 3) * b
            verts.append((x, y2, z2))
            b_of.append(b)
    faces = []
    for iv in range(nv):
        for iu in range(nu):
            a = iv * (nu + 1) + iu
            faces.append((a, a + 1, a + nu + 2, a + nu + 1))
    return np.array(verts), faces, np.array(b_of)


def ringed_flower(rings, c_in, c_out, bud=None, jitter=0.08):
    V, F, C = [], [], []

    def push(v, f, c):
        base = len(V)
        V.extend(v)
        F.extend([tuple(base + i for i in fc) for fc in f])
        C.extend(c)

    nr = len(rings)
    for ri, (n, R, tilt, ln, wd, cup, curl) in enumerate(rings):
        off = random.random() * TAU
        for k in range(n):
            phi = off + TAU * k / n + random.uniform(-jitter, jitter)
            pv, pf, pb = petal_patch(wd * random.uniform(0.9, 1.1), ln * random.uniform(0.92, 1.08), cup, curl,
                                     ruffle=0.015 * ri)
            tl = tilt + random.uniform(-0.08, 0.08)
            # tilt outward around x then translate out along +y, rotate around z
            ct, st = math.cos(tl), math.sin(tl)
            rx = np.array([[1, 0, 0], [0, ct, st], [0, -st, ct]])
            pv = pv @ rx.T
            pv[:, 1] += R
            cz, sz = math.cos(phi), math.sin(phi)
            rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
            pv = pv @ rz.T
            ring_t = ri / max(1, nr - 1)
            cols = []
            for b in pb:
                t = min(1, 0.25 * ring_t + 0.75 * (0.35 * ring_t + 0.65 * b) * (0.4 + 0.6 * ring_t))
                cols.append(c_in * (1 - t) + c_out * t)
            push(pv, pf, cols)
    if bud is not None:
        bv, bf = uv_sphere(8, 6, bud, bud, bud * 1.25)
        bv[:, 2] += bud * 0.6
        push(bv, bf, [c_in * 0.85] * len(bv))
    V = np.array(V)
    sway = np.clip(V[:, 2] / max(1e-3, V[:, 2].max()), 0, 1)
    return V, F, np.array(C), sway


def make_rose(c_in, c_out):
    rings = [(3, 0.03, 0.10, 0.30, 0.30, 0.9, 0.0),
             (4, 0.07, 0.32, 0.36, 0.36, 0.8, 0.2),
             (5, 0.11, 0.62, 0.40, 0.42, 0.7, 0.5),
             (6, 0.16, 0.95, 0.42, 0.46, 0.55, 0.9),
             (7, 0.20, 1.25, 0.40, 0.48, 0.45, 1.1)]
    return ringed_flower(rings, c_in, c_out, bud=0.07)


def make_ranunculus(c_in, c_out):
    rings = []
    for i in range(5):
        t = i / 4
        rings.append((6 + i, 0.02 + 0.17 * t, 0.15 + 1.25 * t ** 1.2, 0.20 + 0.10 * t, 0.26 + 0.10 * t,
                      1.0 - 0.4 * t, 0.2 * t))
    return ringed_flower(rings, c_in, c_out, bud=0.06, jitter=0.12)


def make_peony(c_in, c_out):
    rings = []
    for i in range(5):
        t = i / 4
        rings.append((5 + 2 * i, 0.03 + 0.24 * t, 0.25 + 1.2 * t, 0.30 + 0.14 * t, 0.40 + 0.12 * t,
                      0.7 - 0.3 * t, 0.4 + 0.6 * t))
    return ringed_flower(rings, c_in, c_out, bud=0.08, jitter=0.25)


def make_daisy(c_pet, c_mid):
    V, F, C = [], [], []
    n = 12
    for k in range(n):
        pv, pf, pb = petal_patch(0.13, 0.42, 0.25, 0.1, nu=2, nv=3)
        ct, st = math.cos(1.35), math.sin(1.35)
        pv = pv @ np.array([[1, 0, 0], [0, ct, st], [0, -st, ct]]).T
        pv[:, 1] += 0.07
        phi = TAU * k / n
        pv = pv @ np.array([[math.cos(phi), -math.sin(phi), 0], [math.sin(phi), math.cos(phi), 0], [0, 0, 1]]).T
        base = len(V)
        V.extend(pv)
        F.extend([tuple(base + i for i in f) for f in pf])
        C.extend([c_pet * (0.85 + 0.15 * b) for b in pb])
    bv, bf = uv_sphere(8, 5, 0.11, 0.11, 0.06)
    bv[:, 2] += 0.05
    base = len(V)
    V.extend(bv)
    F.extend([tuple(base + i for i in f) for f in bf])
    C.extend([c_mid] * len(bv))
    V = np.array(V)
    return V, F, np.array(C), np.clip(V[:, 2] / 0.2, 0, 1)


def make_bud(c, green):
    bv, bf = uv_sphere(9, 7, 0.12, 0.12, 0.17)
    bv[:, 2] += 0.15
    V, F, C = list(bv), list(bf), [c] * len(bv)
    for k in range(4):
        pv, pf, pb = petal_patch(0.10, 0.22, 0.4, 0.6, nu=2, nv=2)
        tl = 0.5
        pv = pv @ np.array([[1, 0, 0], [0, math.cos(tl), math.sin(tl)], [0, -math.sin(tl), math.cos(tl)]]).T
        pv[:, 1] += 0.06
        phi = TAU * k / 4
        pv = pv @ np.array([[math.cos(phi), -math.sin(phi), 0], [math.sin(phi), math.cos(phi), 0], [0, 0, 1]]).T
        base = len(V)
        V.extend(pv)
        F.extend([tuple(base + i for i in f) for f in pf])
        C.extend([green] * len(pv))
    V = np.array(V)
    return V, F, np.array(C), np.clip(V[:, 2] / 0.3, 0, 1)


def make_spike(c_top, c_base, green, h=1.25):
    V, F, C = [], [], []
    # stem
    for i in range(7):
        z = h * i / 6
        for j in range(4):
            a = TAU * j / 4
            V.append((0.018 * math.cos(a), 0.018 * math.sin(a), z))
            C.append(green)
    for i in range(6):
        for j in range(4):
            a, b = i * 4 + j, i * 4 + (j + 1) % 4
            F.append((a, b, b + 4, a + 4))
    sv, sf = uv_sphere(6, 4, 1, 1, 1)
    n = 18
    for k in range(n):
        t = k / (n - 1)
        z = 0.25 * h + 0.75 * h * t
        rad = 0.10 * (1 - 0.7 * t) + 0.02
        phi = k * 2.4
        pos = np.array([math.cos(phi) * rad * 0.8, math.sin(phi) * rad * 0.8, z])
        sc = 0.07 * (1 - 0.6 * t) + 0.02
        base = len(V)
        V.extend(sv * sc * np.array([1, 1, 0.75]) + pos)
        F.extend([tuple(base + i for i in f) for f in sf])
        C.extend([c_base * (1 - t) + c_top * t] * len(sv))
    V = np.array(V)
    return V, F, np.array(C), np.clip(V[:, 2] / h, 0, 1) ** 1.2


def make_leaf(c, length=0.75, width=0.28):
    verts, cols = [], []
    nu, nv = 2, 4
    for iv in range(nv + 1):
        b = iv / nv
        hw = width * 0.5 * math.sin(math.pi * min(1, b * 0.95 + 0.04)) ** 0.8
        for iu in range(nu + 1):
            a = iu / nu * 2 - 1
            x = a * hw
            z = abs(a) * hw * 0.45 - 0.08 * b * b  # midrib fold + droop
            verts.append((x, b * length, z))
            cols.append(c * (0.75 + 0.35 * abs(a)) * (0.9 + 0.2 * b))
    faces = []
    for iv in range(nv):
        for iu in range(nu):
            a = iv * (nu + 1) + iu
            faces.append((a, a + 1, a + nu + 2, a + nu + 1))
    V = np.array(verts)
    return V, faces, np.array(cols), np.clip(V[:, 1] / length, 0, 1)


def make_eucalyptus(c):
    V, F, C = [], [], []
    for k in range(5):
        y = 0.12 + 0.15 * k
        for sgn in (1, -1):
            lv, lf, lc, _ = make_leaf(c, 0.17, 0.17)
            lv = lv @ np.array([[0, -sgn, 0], [sgn, 0, 0], [0, 0, 1]]).T
            lv[:, 1] += y
            lv[:, 2] += 0.02 * k
            base = len(V)
            V.extend(lv)
            F.extend([tuple(base + i for i in f) for f in lf])
            C.extend(lc)
    V = np.array(V)
    return V, F, np.array(C), np.clip(V[:, 1] / 0.8, 0, 1)


def make_filler(c):
    V, F, C = [], [], []
    sv, sf = uv_sphere(5, 3, 1, 1, 1)
    for k in range(9):
        pos = np.array([random.uniform(-0.15, 0.15), random.uniform(-0.15, 0.15), random.uniform(0.05, 0.22)])
        base = len(V)
        V.extend(sv * random.uniform(0.025, 0.04) + pos)
        F.extend([tuple(base + i for i in f) for f in sf])
        C.extend([c * random.uniform(0.9, 1.05)] * len(sv))
    V = np.array(V)
    return V, F, np.array(C), np.clip(V[:, 2] / 0.25, 0, 1)


L = srgb_to_lin
PALETTE = [  # (inner, outer)
    (L([0.86, 0.36, 0.52]), L([0.98, 0.70, 0.78])),   # classic pink rose
    (L([0.80, 0.22, 0.45]), L([0.95, 0.52, 0.68])),   # hot pink
    (L([0.62, 0.10, 0.34]), L([0.86, 0.30, 0.52])),   # magenta / cerise
    (L([0.93, 0.62, 0.66]), L([1.00, 0.88, 0.88])),   # blush
    (L([0.95, 0.74, 0.62]), L([1.00, 0.92, 0.86])),   # peach cream
    (L([0.94, 0.86, 0.84]), L([1.00, 0.98, 0.96])),   # white
    (L([0.93, 0.50, 0.48]), L([0.99, 0.76, 0.70])),   # coral
    (L([0.80, 0.48, 0.70]), L([0.95, 0.78, 0.90])),   # mauve
]
PAL_W = np.array([0.24, 0.18, 0.10, 0.16, 0.08, 0.09, 0.07, 0.08])
GREENS = [L([0.30, 0.46, 0.27]), L([0.42, 0.56, 0.38]), L([0.50, 0.62, 0.52]), L([0.22, 0.36, 0.22])]

print("  making templates…")
TPL = {"rose": [], "ranunculus": [], "peony": [], "bud": [], "daisy": [], "spike": [], "leaf": [], "euc": [],
       "filler": []}
for i in range(len(PALETTE)):
    ci, co = PALETTE[i]
    TPL["rose"].append(make_rose(ci, co))
    TPL["ranunculus"].append(make_ranunculus(ci, co))
    TPL["peony"].append(make_peony(ci, co))
    TPL["bud"].append(make_bud(ci, GREENS[1]))
TPL["daisy"] = [make_daisy(L([0.98, 0.96, 0.94]), L([0.92, 0.72, 0.30])),
                make_daisy(L([0.98, 0.80, 0.86]), L([0.85, 0.55, 0.30]))]
TPL["spike"] = [make_spike(L([0.72, 0.72, 0.94]), L([0.52, 0.54, 0.86]), GREENS[0]),
                make_spike(L([0.88, 0.78, 0.95]), L([0.70, 0.56, 0.86]), GREENS[0])]
TPL["leaf"] = [make_leaf(g) for g in GREENS]
TPL["euc"] = [make_eucalyptus(GREENS[2]), make_eucalyptus(L([0.55, 0.66, 0.60]))]
TPL["filler"] = [make_filler(L([0.98, 0.95, 0.95])), make_filler(L([0.97, 0.80, 0.86]))]


def pick_flower():
    kind = random.choices(["rose", "ranunculus", "peony", "bud", "daisy", "filler"],
                          [0.36, 0.22, 0.12, 0.14, 0.06, 0.10])[0]
    if kind in ("rose", "ranunculus", "peony", "bud"):
        i = int(RNG.choice(len(PALETTE), p=PAL_W / PAL_W.sum()))
        return kind, TPL[kind][i]
    return kind, random.choice(TPL[kind])


KIND_SCALE = {"rose": 1.0, "ranunculus": 0.95, "peony": 1.15, "bud": 0.9, "daisy": 0.8, "filler": 1.0}
n_flowers = [0]


def place_flower(pos, nrm, size, weights, up_bias=0.35, tangent=None):
    kind, (V, F, C, SW) = pick_flower()
    n = Vector(nrm)
    n = (n + Vector((0, 0, up_bias))).normalized()
    n = (n + Vector((random.uniform(-.2, .2), random.uniform(-.2, .2), random.uniform(-.2, .2)))).normalized()
    R = frame_from_normal(n, (random.uniform(-1, 1), random.uniform(-1, 1), 0.3))
    sc = size * KIND_SCALE[kind] * 1.1
    add_local(V, F, C, SW * (0.6 + 0.4 * random.random()), np.asarray(pos) - np.asarray(nrm) * sc * 0.08, R, sc,
              weights, random.random())
    n_flowers[0] += 1


def place_leaf(pos, nrm, size, weights, kind="leaf"):
    V, F, C, SW = random.choice(TPL[kind])
    n = Vector(nrm).normalized()
    # leaf lies close to the surface, pointing in a random tangent direction, lifted ~25°
    t = n.cross(Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1)))).normalized()
    b = n.cross(t)
    lift = random.uniform(0.25, 0.6)
    yv = (t * math.cos(lift) + n * math.sin(lift)).normalized()
    zv = b.cross(yv).normalized() * -1
    if zv.dot(n) < 0:
        zv = -zv
    xv = yv.cross(zv)
    R = Matrix((xv, yv, zv)).transposed()
    add_local(V, F, C, SW, np.asarray(pos) - np.asarray(nrm) * 0.02, R, size, weights, random.random())


def place_spike(pos, nrm, size, weights):
    V, F, C, SW = random.choice(TPL["spike"])
    n = (Vector(nrm) * 0.6 + Vector((0, 0, 1)) * 0.4 + Vector((-0.3, 0, 0))).normalized()
    R = frame_from_normal(n)
    add_local(V, F, C, SW, np.asarray(pos) - np.asarray(nrm) * 0.05, R, size, weights, random.random())


def poisson_on_body(count, sampler, min_d_fn, tries=40000):
    pts = []
    for _ in range(tries):
        cand = sampler()
        if cand is None:
            continue
        p, n, s, size = cand
        if all(np.linalg.norm(p - q) > min_d_fn(size, qs) for q, qs in [(x[0], x[3]) for x in pts]):
            pts.append((p, n, s, size))
            if len(pts) >= count:
                break
    return pts


def crest_band(s):
    """angular half-width of the flower crest along the back (0 = none)."""
    a = smoothstep(0.17, 0.24, s) * (1 - smoothstep(0.95, 0.99, s))
    wide = 0.42 + 0.38 * np.exp(-((s - 0.36) / 0.10) ** 2) + 0.12 * np.sin(s * 23)
    return float(a * wide)


def crest_sampler():
    s = random.uniform(0.17, 0.97)
    band = crest_band(s)
    if band <= 0.02:
        return None
    th = math.pi / 2 + random.gauss(0, band * 0.55)
    if abs(th - math.pi / 2) > band:
        return None
    # thin out the tail; leave little gaps so the back reads as clusters
    gap = 0.5 + 0.5 * math.sin(s * 37 + 1.3)
    if s > 0.62 and random.random() > 0.45 + 0.4 * gap:
        return None
    p, n, _ = body_frame(s, th)
    size = (0.58 - 0.30 * float(smoothstep(0.45, 0.95, s))) * random.uniform(0.75, 1.15)
    # mound: flowers in the centre of the crest sit higher (two-layer bouquet look)
    k = 1 - abs(th - math.pi / 2) / band
    p = p + n * (0.26 * k ** 0.7 * (1 - 0.6 * float(smoothstep(0.55, 0.9, s))))
    return p, n, s, size


def shoulder_sampler():
    """a cascade from the crest down the flank toward each pectoral fin root."""
    side = random.choice((1, -1))
    s = random.uniform(0.25, 0.37)
    t = random.random()
    th_l = math.pi / 2 - t * (math.pi / 2 + 0.55)
    th = th_l if side > 0 else math.pi - th_l
    if random.random() > 0.55 + 0.45 * (1 - t):
        return None
    s += 0.03 * t
    p, n, _ = body_frame(s, th)
    size = random.uniform(0.32, 0.46)
    return p, n, s, size


print("  placing crest flowers…")
crest = poisson_on_body(260, crest_sampler, lambda a, b: 0.36 * (a + b))
shoulder = poisson_on_body(70, shoulder_sampler, lambda a, b: 0.38 * (a + b))
for p, n, s, size in crest + shoulder:
    place_flower(p, n, size, spine_weights(s), up_bias=0.25)
# foliage bed under the crest — keeps every flower visibly attached
for i in range(380):
    c = crest_sampler() if i % 4 else shoulder_sampler()
    if c is None:
        continue
    p, n, s, size = c
    kind = "euc" if random.random() < 0.3 else "leaf"
    place_leaf(p - n * 0.06, n, size * random.uniform(1.0, 1.5), spine_weights(s), kind)
# delphinium spikes rising from the front of the crest (as in the reference)
for i in range(5):
    s = random.uniform(0.27, 0.38)
    th = math.pi / 2 + random.uniform(-0.25, 0.25)
    p, n, _ = body_frame(s, th)
    place_spike(p + n * 0.12, n, random.uniform(0.45, 0.62), spine_weights(s))

# pectoral fin flowers — along the outer face and leading edge
print("  placing fin flowers…")


def pect_frame_at(side, r, ph, eps=1e-3):
    p = pect_point(side, r, ph)
    dr = pect_point(side, min(1, r + eps), ph) - pect_point(side, max(0, r - eps), ph)
    dp = pect_point(side, r, ph + eps) - pect_point(side, r, ph - eps)
    n = dr.cross(dp).normalized()
    root, a, c, t = FIN_INFO[side]
    centre = root + a * (r * FIN_LEN) + c * (-0.55 * r ** 2) + t * (0.35 * r ** 2.2)
    if n.dot(p - centre) < 0:
        n = -n
    return np.array(p), np.array(n)


for side in (1, -1):
    pts = []
    for _ in range(4000):
        r = random.uniform(0.06, 0.88)
        ph = random.gauss(math.pi * 0.42, 0.45)
        p, n = pect_frame_at(side, r, ph)
        size = (0.36 - 0.15 * r) * random.uniform(0.8, 1.1)
        if all(np.linalg.norm(p - q[0]) > 0.4 * (size + q[2]) for q in pts):
            pts.append((p, n, size, r))
        if len(pts) > 30:
            break
    for p, n, size, r in pts:
        place_flower(p, n, size, fin_weights(side, r), up_bias=0.1)
    for _ in range(36):
        r = random.uniform(0.06, 0.85)
        p, n = pect_frame_at(side, r, random.gauss(math.pi * 0.42, 0.45))
        place_leaf(p, n, random.uniform(0.18, 0.3), fin_weights(side, r))


# fluke flowers — clusters on the upper surface
def fluke_frame_at(r, ph, eps=1e-3):
    p = fluke_point(r, ph)
    dr = fluke_point(r + eps, ph) - fluke_point(r - eps, ph)
    dp = fluke_point(r, ph + eps) - fluke_point(r, ph - eps)
    n = dr.cross(dp).normalized()
    if n.z < 0:
        n = -n
    return np.array(p), np.array(n)


pts = []
for _ in range(5000):
    r = random.choice((-1, 1)) * random.uniform(0.08, 0.86)
    ph = math.pi / 2 + random.gauss(0, 0.5)
    p, n = fluke_frame_at(r, ph)
    size = (0.36 - 0.16 * abs(r)) * random.uniform(0.8, 1.1)
    if all(np.linalg.norm(p - q[0]) > 0.4 * (size + q[2]) for q in pts):
        pts.append((p, n, size, r))
    if len(pts) > 46:
        break
for p, n, size, r in pts:
    place_flower(p, n, size, {"fluke": 1.0}, up_bias=0.2)
for _ in range(50):
    r = random.choice((-1, 1)) * random.uniform(0.06, 0.85)
    p, n = fluke_frame_at(r, math.pi / 2 + random.gauss(0, 0.5))
    place_leaf(p, n, random.uniform(0.18, 0.3), {"fluke": 1.0})

print("  flowers:", n_flowers[0], "decor verts:", len(decor.v), "faces:", len(decor.f))
decor_ob = decor.build("WhaleDecor")
me = decor_ob.data
ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
cols = np.ones((len(decor.col), 4), dtype=np.float32)
cols[:, :3] = np.array(decor.col, dtype=np.float32)
ca.data.foreach_set("color", cols.ravel())
me.color_attributes.active_color = ca

# ----------------------------------------------------------------------------
# TEXTURES
# ----------------------------------------------------------------------------
print("painting textures…")


def save_image(name, arr, non_color=False):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(TEX_DIR, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


TW, TH_ = 2048, 1024
u = (np.arange(TW) + 0.5) / TW
v = (np.arange(TH_) + 0.5) / TH_
UU, VV = np.meshgrid(u, v)          # rows = v (bottom->top in Blender)
TT = VV * TAU
sn, cs = np.sin(TT), np.cos(TT)
P3 = np.stack([UU * 11.0, cs * 1.3, sn * 1.3], -1)

n_big = fbm(P3 * 0.9, 4)
n_mid = fbm(P3 * 3.2 + 5, 4)
n_fine = fbm(P3 * 14 + 9, 3)
n_spk = vnoise(P3 * 38 + 3)

dark = np.array([0.155, 0.165, 0.185])
mid = np.array([0.32, 0.33, 0.35])
pale = np.array([0.86, 0.86, 0.87])

albedo = dark * (0.82 + 0.40 * n_big[..., None]) * (0.9 + 0.2 * n_fine[..., None])
height = (n_fine - 0.5) * 0.35

# belly / ventral pleats (chin to navel)
bellyS = smoothstep(0.0, 0.03, UU) * (1 - smoothstep(0.46, 0.60, UU))
bellyMask = smoothstep(-0.25, -0.62, sn + (n_mid - 0.5) * 0.45) * bellyS
wob = (n_mid - 0.5) * 1.2 + UU * 2.0
groove = smoothstep(0.80, 0.98, np.cos(TT * 58 + wob)) * bellyMask
belly_col = pale * (0.85 + 0.2 * n_fine[..., None])
blot = smoothstep(0.62, 0.74, n_mid) * bellyMask * 0.75
belly_col = belly_col * (1 - blot[..., None]) + dark[None, None, :] * blot[..., None]
albedo = albedo * (1 - bellyMask[..., None]) + belly_col * bellyMask[..., None]
albedo *= (1 - 0.45 * groove)[..., None]
height -= groove * 1.0
# pale grey speckled underside for the rear body
rearUnder = smoothstep(-0.35, -0.75, sn) * smoothstep(0.45, 0.62, UU)
rc = mid * (0.8 + 0.5 * n_mid[..., None])
albedo = albedo * (1 - 0.6 * rearUnder[..., None]) + rc * 0.6 * rearUnder[..., None]

# mouth line + whitish lower jaw
def lip_theta(uu):
    return -0.18 - 0.48 * smoothstep(0.10, 0.235, uu)

ang_l = np.arctan2(sn, cs)                         # left side angle (0 at +y)
ang_r = np.arctan2(sn, -cs)                        # mirrored for right side
mouthS = (1 - smoothstep(0.215, 0.245, UU)) * smoothstep(0.0, 0.01, UU)
lt = lip_theta(UU)
dl = np.minimum(np.abs(ang_l - lt), np.abs(ang_r - lt))
mouth = np.exp(-(dl / 0.018) ** 2) * mouthS
below = smoothstep(0.0, -0.10, np.where(np.abs(ang_l - lt) < np.abs(ang_r - lt), ang_l - lt, ang_r - lt)) * mouthS
jaw = below * smoothstep(-0.2, 0.4, n_mid) * (1 - bellyMask)
albedo = albedo * (1 - 0.65 * jaw[..., None]) + (pale * 0.78) * 0.65 * jaw[..., None]
albedo *= (1 - 0.85 * mouth)[..., None]
height -= mouth * 1.6

# eye patch (soft darker ring) + eyelid bump
for ang in (ang_l, ang_r):
    d = np.sqrt(((UU - 0.232) * 11.0) ** 2 + ((ang - 0.02) * 1.3) ** 2)
    ring = np.exp(-(d / 0.22) ** 2)
    albedo *= (1 - 0.35 * ring)[..., None]
    height += np.exp(-((d - 0.12) / 0.05) ** 2) * 0.8

# pale speckles, scars and barnacle-ish knobs on the head
spk = smoothstep(0.86, 0.93, n_spk) * (0.15 + 0.85 * (1 - smoothstep(0.08, 0.35, UU)))
albedo = albedo * (1 - spk[..., None] * 0.7) + pale * spk[..., None] * 0.7
height += spk * 0.6
for _ in range(22):
    u0, t0 = random.random() * 0.9, random.uniform(0.2, math.pi - 0.2)
    ln, ang = random.uniform(0.006, 0.03), random.uniform(-0.6, 0.6)
    du = (UU - u0)
    dt = (TT - t0)
    along = du * math.cos(ang) + dt * 0.12 * math.sin(ang)
    across = -du * math.sin(ang) + dt * 0.12 * math.cos(ang)
    m = (np.abs(across) < 0.0009) & (np.abs(along) < ln)
    albedo[m] = albedo[m] * 0.8 + pale * 0.16
# flowers grow from the back: slightly lighter "moss" tint under the crest
crestT = np.exp(-((TT - math.pi / 2) / 0.55) ** 2) * smoothstep(0.18, 0.25, UU)
albedo = albedo * (1 - 0.25 * crestT[..., None]) + np.array([0.32, 0.22, 0.27]) * 0.25 * crestT[..., None]

albedo_img = save_image("whale_albedo", albedo ** (1 / 1.0))

# normal map from height (sizes in world units per texel)
du_w = 11.0 / TW
dv_w = (TAU * 1.0) / TH_
hx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / (2 * du_w)
hy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) / (2 * dv_w)
strength = 0.012
nx, ny = -hx * strength, -hy * strength
nz = np.ones_like(nx)
ln_ = np.sqrt(nx * nx + ny * ny + nz * nz)
nmap = np.stack([nx / ln_ * 0.5 + 0.5, ny / ln_ * 0.5 + 0.5, nz / ln_ * 0.5 + 0.5], -1)
normal_img = save_image("whale_normal", nmap, non_color=True)

# fin texture
FW, FH = 1024, 512
fu = (np.arange(FW) + 0.5) / FW
fv = (np.arange(FH) + 0.5) / FH
FU, FV = np.meshgrid(fu, fv)
FT = FV * TAU
fs, fc = np.sin(FT), np.cos(FT)
FP = np.stack([FU * 9, fc * 0.6, fs * 0.6], -1)
fb = fbm(FP * 1.6, 4)
ff = fbm(FP * 7 + 2, 3)
fspk = vnoise(FP * 30 + 1)
pect = FU < 0.5
r_ = np.where(pect, (FU - 0.02) / 0.46, np.abs((FU - 0.52) / 0.46 * 2 - 1))
# pectoral: outer face (sin>0) mottled grey, inner face whitish, knobs pale, dark rim
outer = smoothstep(-0.2, 0.35, fs)
p_col = pale * (0.78 + 0.2 * ff[..., None])
p_mott = smoothstep(0.45, 0.62, fb + 0.25 * outer - 0.1)
p_col = p_col * (1 - p_mott[..., None] * 0.85) + dark * p_mott[..., None] * 0.85
rim = smoothstep(0.82, 0.98, np.abs(fc)) * smoothstep(0.1, 0.5, r_)
p_col = p_col * (1 - 0.55 * rim[..., None]) + dark * 0.55 * rim[..., None]
lead = smoothstep(0.9, 1.0, fc)
p_col = p_col * (1 - lead[..., None] * 0.5) + pale * 0.5 * lead[..., None]
# flukes: dark top, pale patterned underside, dark serrated trailing edge
top = smoothstep(-0.3, 0.2, fs)
f_col = dark * (0.85 + 0.35 * fb[..., None])
under_pat = smoothstep(0.42, 0.55, fb + 0.3 * (1 - r_))
f_under = pale * (0.8 + 0.2 * ff[..., None]) * (1 - under_pat[..., None]) + dark * under_pat[..., None]
f_col = f_col * top[..., None] + f_under * (1 - top[..., None])
trail = smoothstep(-0.8, -0.98, fc)
f_col = f_col * (1 - trail[..., None]) + dark * 0.8 * trail[..., None]
fin_alb = np.where(pect[..., None], p_col, f_col)
spk = smoothstep(0.82, 0.9, fspk)
fin_alb = fin_alb * (1 - spk[..., None] * 0.5) + pale * 0.5 * spk[..., None]
fin_img = save_image("whale_fin_albedo", fin_alb)

# ----------------------------------------------------------------------------
# MATERIALS
# ----------------------------------------------------------------------------
def principled_mat(name, img=None, nimg=None, rough=0.5, vcol=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = rough
    if img is not None:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = img
        nt.links.new(tn.outputs["Color"], bsdf.inputs["Base Color"])
    if nimg is not None:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = nimg
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if vcol:
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    return m


body_ob.data.materials.append(principled_mat("WhaleSkin", albedo_img, normal_img, 0.45))
fins_ob.data.materials.append(principled_mat("WhaleFin", fin_img, None, 0.5))
decor_ob.data.materials.append(principled_mat("Flora", None, None, 0.7, vcol=True))

# ----------------------------------------------------------------------------
# ARMATURE
# ----------------------------------------------------------------------------
print("rigging…")
arm_data = bpy.data.armatures.new("WhaleRig")
arm = bpy.data.objects.new("Whale", arm_data)
coll.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones


def spine_pt(s):
    return Vector((X0 - s * BL, 0, float(CZ(min(s, 1.0)))))


root = eb.new("root")
root.head = spine_pt(0.34)
root.tail = spine_pt(0.34) + Vector((0, 0, 1.0))
bones = {}
for name, a, b, _ in SPINE:
    bn = eb.new(name)
    bn.head = spine_pt(a)
    bn.tail = spine_pt(b)
    bones[name] = bn
bones["neck"].parent = root
bones["head"].parent = bones["neck"]
bones["head"].use_connect = True
bones["chest"].parent = root
prev = bones["chest"]
for name in ("back", "lumbar", "tail1", "tail2"):
    bones[name].parent = prev
    bones[name].use_connect = True
    prev = bones[name]
fl = eb.new("fluke")
fl.head = spine_pt(1.0)
fl.tail = spine_pt(1.0) + Vector((-1.2, 0, 0))
fl.parent = bones["tail2"]
fl.use_connect = True
for side in (1, -1):
    s = "L" if side > 0 else "R"
    rt, a, c, t = FIN_INFO[side]
    b1 = eb.new(f"fin{s}1")
    b1.head = rt
    b1.tail = rt + a * (FIN_LEN * 0.5) + c * (-0.14)
    b1.parent = bones["chest"]
    b2 = eb.new(f"fin{s}2")
    b2.head = b1.tail
    b2.tail = rt + a * FIN_LEN + c * (-0.55) + t * 0.35
    b2.parent = b1
    b2.use_connect = True
for bn in eb:
    bn.roll = 0
bpy.ops.object.mode_set(mode="OBJECT")


def skin(ob, builder):
    groups = {}
    for vi, wd in enumerate(builder.wt):
        for bname, w in wd.items():
            if w <= 1e-4:
                continue
            if bname not in groups:
                groups[bname] = ob.vertex_groups.new(name=bname)
            groups[bname].add([vi], float(w), "REPLACE")
    ob.parent = arm
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm


skin(body_ob, body)
skin(fins_ob, fins)
skin(decor_ob, decor)

# ----------------------------------------------------------------------------
# ANIMATION — seamless 12 s loop (360 frames @ 30 fps)
# ----------------------------------------------------------------------------
print("animating…")
FPS, NF = 30, 360
scene.render.fps = FPS
scene.frame_start = 0
scene.frame_end = NF
pb = arm.pose.bones
for p in pb:
    p.rotation_mode = "QUATERNION"

Y = Vector((0, 1, 0))
Xw = Vector((1, 0, 0))
Zw = Vector((0, 0, 1))


def local_axis(bname, world_axis):
    m = arm_data.bones[bname].matrix_local.to_3x3()
    return (m.inverted() @ world_axis).normalized()


AX = {b.name: local_axis(b.name, Y) for b in arm_data.bones}
AXX = {b.name: local_axis(b.name, Xw) for b in arm_data.bones}
AXZ = {b.name: local_axis(b.name, Zw) for b in arm_data.bones}

# (bone, amplitude rad, phase lag) — wave travels head -> fluke, amplitude grows toward the tail
WAVE = [("chest", 0.022, 0.0), ("back", 0.040, 0.55), ("lumbar", 0.060, 1.10), ("tail1", 0.085, 1.65),
        ("tail2", 0.110, 2.20), ("fluke", 0.200, 2.85)]
root_rest_loc = Vector((0, 0, 0))

for f in range(NF + 1):
    p = TAU * f / NF          # one cycle over the clip (rise & fall)
    w = 2 * p                 # two tail strokes over the clip (6 s period)
    # root: delicate rise & fall + pitch that follows it
    bob = 0.22 * math.sin(p) + 0.05 * math.sin(w + 1.2)
    pb["root"].location = Vector((0, 0, 0))
    # root bone points up (+Z); its local Y = world Z
    pb["root"].location = Vector((0, bob, 0))
    q = Quaternion(AX["root"], 0.035 * math.cos(p) + 0.012 * math.sin(w + 0.4))
    q = q @ Quaternion(AXX["root"], 0.018 * math.sin(p + 0.7))
    pb["root"].rotation_quaternion = q
    pb["root"].keyframe_insert("location", frame=f)
    pb["root"].keyframe_insert("rotation_quaternion", frame=f)
    for name, amp, lag in WAVE:
        pb[name].rotation_quaternion = Quaternion(AX[name], amp * math.sin(w - lag))
        pb[name].keyframe_insert("rotation_quaternion", frame=f)
    pb["neck"].rotation_quaternion = Quaternion(AX["neck"], 0.016 * math.sin(w + 0.6))
    pb["head"].rotation_quaternion = Quaternion(AX["head"], 0.020 * math.sin(w + 1.0))
    pb["neck"].keyframe_insert("rotation_quaternion", frame=f)
    pb["head"].keyframe_insert("rotation_quaternion", frame=f)
    for side, s in ((1, "L"), (-1, "R")):
        flap = 0.12 * math.sin(w - 0.9) + 0.05 * math.sin(p + 0.3)
        sweep = 0.06 * math.sin(w - 1.6)
        q1 = Quaternion(AXX[f"fin{s}1"], side * flap) @ Quaternion(AXZ[f"fin{s}1"], side * sweep)
        q2 = Quaternion(AXX[f"fin{s}2"], side * 0.07 * math.sin(w - 1.6))
        pb[f"fin{s}1"].rotation_quaternion = q1
        pb[f"fin{s}2"].rotation_quaternion = q2
        pb[f"fin{s}1"].keyframe_insert("rotation_quaternion", frame=f)
        pb[f"fin{s}2"].keyframe_insert("rotation_quaternion", frame=f)

# name the action so the clip is easy to find in three.js
if arm.animation_data and arm.animation_data.action:
    arm.animation_data.action.name = "Swim"

# ----------------------------------------------------------------------------
# EXPORT
# ----------------------------------------------------------------------------
print("exporting…", OUT_GLB)
for o in scene.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_image_format="JPEG",
    export_jpeg_quality=88,
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_materials="EXPORT",
    export_vertex_color="ACTIVE",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_optimize_animation_size=False,
    export_frame_range=True,
    export_anim_slide_to_zero=True,
    export_skins=True,
    export_def_bones=False,
    export_yup=True,
    export_apply=False,
    export_cameras=False,
    export_lights=False,
)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "whale.blend"))
print("done:", os.path.getsize(OUT_GLB) / 1e6, "MB")
