"""Tuiles d'herbe et découpes de chemin de terre (Opus 5.5).

Principe : le sol du jeu devient de la terre battue ; un tapis de gazon de 3,5 cm
d'épaisseur est posé par-dessus, une tuile par case de 2,5 m, en thin instances.
Un chemin de terre est une absence de gazon : il n'est pas dessiné.

- 4 variantes de gazon (ras, dru, fleuri, trèfle et cailloux), à tourner par quarts
  de tour : leurs bords sont identiques sur les quatre côtés et se raccordent.
- 6 formes de découpe (point, bout, droit, angle, T, croix), d'après roadTileRects :
  chemin de 0,94 m (ROAD_HALF_WIDTH = 0,47), bord irrégulier à l'intérieur de la case,
  exactement ±0,47 m sur le bord de la case pour se raccorder à la voisine.

À lancer sans interface, depuis la racine du dépôt :
  blender --background --factory-startup --python blender-elements/sol-herbe/sources/tuiles_herbe.py
Écrit sol-herbe.blend, les aperçus et apps/world-web/bench/assets/tuiles-herbe.json.
"""
import json, math, os, random, sys
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(KIT, "..", ".."))
ns = {"__name__": "villageois"}
with open(os.path.join(ROOT, "blender-elements", "villageois", "sources", "build_villageois.py"), encoding="utf-8") as f:
    exec(compile(f.read(), "build_villageois.py", "exec"), ns)
Part, hexc, mul = ns["Part"], ns["hexc"], ns["mul"]

CELL, HALF = 2.5, 1.25
TURF = 0.035  # épaisseur du gazon au-dessus de la terre battue
PATH = 0.47  # demi-largeur d'un chemin de terre (road-profile.ts)
XS = [-HALF, -0.86, -PATH, 0.0, PATH, 0.86, HALF]
GREENS = [hexc(c) for c in ("4c7234", "537a39", "476c30", "587d3c", "4f7636")]
SOIL_SIDE = hexc("6a5536")
EARTH = hexc("8a7350")  # terre battue
BLADE_BASE = [hexc(c) for c in ("4a7a2e", "3f6d27", "557f33")]
BLADE_TIP = [hexc(c) for c in ("9cc25a", "a9c766", "8fb850")]


def blade(p, x, z, ang, length, width, height, base_col, tip_col):
    """Feuille en losange, comme blade() du carré potager : 2 triangles, face tournée vers le haut."""
    d = (math.cos(ang), math.sin(ang))
    nrm = (-d[1], d[0])
    base = (x, TURF - 0.004, z)
    mid = (x + d[0] * length * 0.45, TURF + height * 0.6, z + d[1] * length * 0.45)
    tip = (x + d[0] * length, TURF + height, z + d[1] * length)
    left = (mid[0] - nrm[0] * width, mid[1], mid[2] - nrm[1] * width)
    right = (mid[0] + nrm[0] * width, mid[1], mid[2] + nrm[1] * width)
    face_dir(p, [base, left, tip, right], [base_col, base_col, tip_col, base_col], (0, 0, 1))

# Masque de chemin, comme roadTileRects : 1 = +x, 2 = −x, 4 = +z, 8 = −z (axes du jeu).
SHAPES = {"point": 0, "bout": 1, "droit": 1 | 2, "angle": 1 | 4, "t": 1 | 2 | 4, "croix": 15}
VARIANTS = ("ras", "dru", "fleuri", "trefle")


def g2b(x, y, z):
    """Jeu (x, y haut, z) → Blender (x, −z, y)."""
    return (x, -z, y)


def face_dir(p, pts, col, want):
    """Face orientée : sa normale (Blender) pointe dans la direction `want`."""
    v = [Vector(g2b(*q)) for q in pts]
    n = (v[1] - v[0]).cross(v[2] - v[0])
    if n.dot(Vector(want)) < 0:
        v.reverse()
        if isinstance(col, list):
            col = list(reversed(col))
    p.face(v, col)


def in_path(mask, x, z, margin=0.0):
    w = PATH + margin
    if abs(x) < w and abs(z) < w:
        return True
    return ((mask & 1) and x > 0 and abs(z) < w) or ((mask & 2) and x < 0 and abs(z) < w) or \
           ((mask & 4) and z > 0 and abs(x) < w) or ((mask & 8) and z < 0 and abs(x) < w)


def tile(seed, mask=None, kind="ras"):
    """Une tuile de gazon : dalle facettée 6 × 6, jupes de bord, touffes et détails."""
    rng = random.Random(seed)
    p = Part()
    n = len(XS)
    # sommets : bord de case fixe, intérieur jitté (bord de chemin irrégulier)
    P = {}
    for i in range(n):
        for j in range(n):
            x, z = XS[i], XS[j]
            border = i in (0, n - 1) or j in (0, n - 1)
            if not border:
                x += rng.uniform(-0.06, 0.06)
                z += rng.uniform(-0.06, 0.06)
            y = TURF if border else TURF + rng.uniform(-0.003, 0.006)
            P[i, j] = (x, y, z)
    kept = {}
    for i in range(n - 1):
        for j in range(n - 1):
            cx, cz = (XS[i] + XS[i + 1]) / 2, (XS[j] + XS[j + 1]) / 2
            kept[i, j] = mask is None or not in_path(mask, cx, cz)
    tone = {"ras": 1.0, "dru": 0.9, "fleuri": 1.04, "trefle": 0.97}[kind]
    for (i, j), k in kept.items():
        if not k:
            continue
        a, b, c, d = P[i, j], P[i + 1, j], P[i + 1, j + 1], P[i, j + 1]
        for tri in ((a, b, c), (a, c, d)):
            col = mul(rng.choice(GREENS), (tone * rng.uniform(0.97, 1.03),) * 3)
            if kind == "trefle" and rng.random() < 0.22:
                col = mul(hexc("466f35"), (rng.uniform(0.97, 1.03),) * 3)
            face_dir(p, tri, col, (0, 0, 1))
    # jupes : vers la terre battue (y = 0), sur le chemin et en bord de case
    def skirt(q0, q1, outward):
        face_dir(p, [q0, q1, (q1[0], 0.0, q1[2]), (q0[0], 0.0, q0[2])], SOIL_SIDE, g2b(*outward))
    for (i, j), k in kept.items():
        if not k:
            continue
        for di, dj, e0, e1, out in ((1, 0, (i + 1, j), (i + 1, j + 1), (1, 0, 0)), (-1, 0, (i, j), (i, j + 1), (-1, 0, 0)),
                                    (0, 1, (i, j + 1), (i + 1, j + 1), (0, 0, 1)), (0, -1, (i, j), (i + 1, j), (0, 0, -1))):
            nb = (i + di, j + dj)
            if nb in kept and kept[nb]:
                continue
            skirt(P[e0], P[e1], out)
    # touffes à la manière des fanes du carré potager : feuilles en losange qui rayonnent,
    # pied sombre, pointe claire ; plus fines, plus droites et plus jaunes que des fanes.
    counts = {"ras": 16, "dru": 30, "fleuri": 16, "trefle": 12}[kind]
    def free_spot(margin):
        for _ in range(50):
            x, z = rng.uniform(-1.18, 1.18), rng.uniform(-1.18, 1.18)
            if mask is None or not in_path(mask, x, z, margin):
                return x, z
        return None
    for _ in range(counts):
        spot = free_spot(0.1)
        if not spot:
            continue
        x, z = spot
        size = rng.uniform(0.75, 1.15) * (1.2 if kind == "dru" else 1.0)
        base_col = mul(rng.choice(BLADE_BASE), (rng.uniform(0.92, 1.05),) * 3)
        tip_col = mul(rng.choice(BLADE_TIP), (rng.uniform(0.92, 1.05),) * 3)
        n_blades = rng.choice((5, 6, 7))
        turn0 = rng.uniform(0, math.tau)
        for k in range(n_blades):
            a = turn0 + k * math.tau / n_blades + rng.uniform(-0.3, 0.3)
            blade(p, x, z, a, rng.uniform(0.11, 0.17) * size, 0.022 * size, rng.uniform(0.13, 0.21) * size, base_col, tip_col)
    if kind == "fleuri":
        for _ in range(6):
            spot = free_spot(0.1)
            if not spot:
                continue
            x, z = spot
            col = hexc(rng.choice(("f2efe2", "e9d35a", "f2efe2", "c9a0d8")))
            top = TURF + rng.uniform(0.11, 0.16)
            pts = [(x + 0.028 * math.cos(a), top - 0.012, z + 0.028 * math.sin(a)) for a in (0, 2.1, 4.2)]
            for k in range(3):
                q0, q1 = pts[k], pts[(k + 1) % 3]
                face_dir(p, [q0, q1, (x, top, z)], col, (0, 0, 1))
            face_dir(p, [(x - 0.006, TURF, z), (x + 0.006, TURF, z), (x, top - 0.012, z)], hexc("4f7737"), (0, -1, 0))
    if kind == "trefle":
        for _ in range(2):
            spot = free_spot(0.15)
            if not spot:
                continue
            x, z = spot
            r = rng.uniform(0.06, 0.1)
            col = hexc(rng.choice(("8d8f8c", "9a958a")))
            ring = [(x + r * math.cos(a), TURF - 0.01, z + r * 0.8 * math.sin(a)) for a in [k * math.tau / 5 for k in range(5)]]
            top = (x, TURF + r * 0.6, z)
            for k in range(5):
                q0, q1 = ring[k], ring[(k + 1) % 5]
                face_dir(p, [q0, q1, top], mul(col, (0.9 + 0.1 * (k % 2),) * 3), g2b((q0[0] + q1[0]) / 2 - x, 0.3, (q0[2] + q1[2]) / 2 - z))
    return p


def export_piece(part):
    """Comme export_jeu.py : triangles en éventail, axes Blender → jeu (x, z, −y)."""
    positions, colors = [], []
    for idx, cols in zip(part.f, part.c):
        pts = [part.v[i] for i in idx]
        for k in range(1, len(pts) - 1):
            for q, col in ((pts[0], cols[0]), (pts[k], cols[k]), (pts[k + 1], cols[k + 1])):
                positions += [round(q.x * 1e4), round(q.z * 1e4), round(-q.y * 1e4)]
                colors += [round(v * 200) for v in col[:3]]
    return {"positions": positions, "colors": colors}


pieces = {}
for v, kind in enumerate(VARIANTS):
    pieces[f"herbe-{kind}"] = tile(100 + v, None, kind)
for s, (name, mask) in enumerate(SHAPES.items()):
    pieces[f"chemin-{name}"] = tile(200 + s, mask, "ras")

tris = {k: v.tris() for k, v in pieces.items()}
print("tuiles", json.dumps(tris), file=sys.stderr)

# ---------- scène de démonstration ----------
def rotate_part(part, quarter):
    """Quart de tour autour de l'axe vertical (Blender Z), comme une rotation d'instance."""
    a = quarter * math.pi / 2
    c, s = math.cos(a), math.sin(a)
    out = Part()
    for idx, cols in zip(part.f, part.c):
        out.face([Vector((part.v[i].x * c - part.v[i].y * s, part.v[i].x * s + part.v[i].y * c, part.v[i].z)) for i in idx], cols)
    return out


def shape_for(mask):
    """Forme et quart de tour (sens direct vu de dessus, axes Blender) d'un masque de chemin."""
    def rot(m, q):
        # bits jeu : 1 = +x, 4 = +z, 2 = −x, 8 = −z ; en Blender +z jeu = −y. Un quart de tour
        # direct en Blender envoie +x → +y Blender = −z jeu : 1 → 8 → 2 → 4 → 1.
        order = {1: 8, 8: 2, 2: 4, 4: 1}
        for _ in range(q):
            m = sum(order[b] for b in (1, 2, 4, 8) if m & b)
        return m
    for name, base in SHAPES.items():
        for q in range(4):
            if rot(base, q) == mask:
                return name, q
    raise ValueError(mask)


def stage(name):
    old = bpy.data.scenes.get(name)
    if old:
        bpy.data.scenes.remove(old)
    sc = bpy.data.scenes.new(name)
    sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE_NEXT'
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new(f"{name} monde")
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs[0].default_value = (*[c ** 2.2 for c in hexc("9fb3bf")], 1)
    bg.inputs[1].default_value = 0.9
    sc.world = w
    sun = bpy.data.lights.new(f"{name} soleil", 'SUN')
    sun.energy = 3.2
    sun.angle = math.radians(3)
    so = bpy.data.objects.new(f"{name} soleil", sun)
    so.rotation_euler = (math.radians(42), 0, math.radians(-35))
    sc.collection.objects.link(so)
    cd = bpy.data.cameras.new(f"{name} camera")
    cd.type = 'ORTHO'
    cam = bpy.data.objects.new(f"{name} camera", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc


def add(sc, name, part, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, part.build(name))
    o.location = loc
    sc.collection.objects.link(o)
    return o


# Plan de démo : 8 × 6 cases, un chemin en L avec un T, un bout et un croisement.
W, Hn = 8, 6
path_cells = {(x, 2) for x in range(0, 8)} | {(3, z) for z in range(2, 6)} | {(6, z) for z in range(0, 3)} | {(1, 3)}
def mask_at(x, z):
    m = 0
    for bit, (dx, dz) in ((1, (1, 0)), (2, (-1, 0)), (4, (0, 1)), (8, (0, -1))):
        if (x + dx, z + dz) in path_cells:
            m |= bit
    return m


def demo(sc, style):
    g = Part()
    g.face([(-30, -30, -0.002), (30, -30, -0.002), (30, 30, -0.002), (-30, 30, -0.002)], EARTH)
    add(sc, f"{sc.name} terre", g)
    rng = random.Random(7)
    for x in range(W):
        for z in range(Hn):
            gx, gz = (x - W / 2 + 0.5) * CELL, (z - Hn / 2 + 0.5) * CELL
            loc = (gx, -gz, 0)
            if style == "actuel":
                # sol plat actuel : dalle verte, chemin creusé de 6 cm en terre
                q = Part()
                path = (x, z) in path_cells
                col = rng.choice(GREENS)
                if not path:
                    face_dir(q, [(-HALF, 0.0, -HALF), (HALF, 0.0, -HALF), (HALF, 0.0, HALF), (-HALF, 0.0, HALF)], col, (0, 0, 1))
                else:
                    m = mask_at(x, z)
                    b = [-HALF, -PATH, PATH, HALF]
                    for i in range(3):
                        for j in range(3):
                            dug = (i == 1 and j == 1) or (j == 1 and m & (1 if i == 2 else 2) and i != 1) or (i == 1 and m & (4 if j == 2 else 8) and j != 1)
                            y = -0.06 if dug else 0.0
                            face_dir(q, [(b[i], y, b[j]), (b[i + 1], y, b[j]), (b[i + 1], y, b[j + 1]), (b[i], y, b[j + 1])],
                                     mul(SOIL_SIDE, (1.1,) * 3) if dug else col, (0, 0, 1))
                add(sc, f"{sc.name} case {x} {z}", q, loc)
                continue
            if (x, z) in path_cells:
                name, quarter = shape_for(mask_at(x, z))
                part = rotate_part(pieces[f"chemin-{name}"], quarter)
            else:
                part = rotate_part(pieces[f"herbe-{VARIANTS[rng.randrange(4)]}"], rng.randrange(4))
            add(sc, f"{sc.name} case {x} {z}", part, loc)
    # deux figurines pour l'échelle : sur le chemin et dans l'herbe
    look = dict(skin=0, clothes=1, hair=1)
    ns["build_figurine"](sc, f"{sc.name} passant", ((3 - W / 2 + 0.5) * CELL, -((2 - Hn / 2 + 0.5) * CELL) + 0.3, 0), -0.4, "marche", look, None, "court")
    ns["build_figurine"](sc, f"{sc.name} jardiniere", ((5 - W / 2 + 0.5) * CELL, -((4 - Hn / 2 + 0.5) * CELL), 0), 0.8, "repos",
                         dict(skin=1, clothes=4, hair=0), "paille", "chignon")


def render(sc, target, scale, res, path):
    cam = sc.camera
    cam.rotation_euler = (0.877, 0, 0.588)
    d = cam.rotation_euler.to_matrix() @ Vector((0, 0, -1))
    cam.location = Vector(target) - d * 40
    cam.data.ortho_scale = scale
    cam.data.clip_end = 120
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=sc.name)


out = os.path.join(KIT, "previews")
for style in ("actuel", "herbe"):
    sc = stage(f"SOL {style}")
    demo(sc, style)
    render(sc, (0, 0, 0), 24.6, (640, 400), os.path.join(out, f"{style}-zoom-moyen.png"))
    render(sc, ((1 - W / 2 + 0.5) * CELL + 2.6, -((3 - Hn / 2 + 0.5) * CELL) + 0.6, 0), 6.0, (800, 500), os.path.join(out, f"{style}-zoom-proche.png"))

# planche des pièces : 4 variantes et 6 découpes
sc = stage("SOL planche")
g = Part()
g.face([(-30, -30, -0.002), (30, -30, -0.002), (30, 30, -0.002), (-30, 30, -0.002)], EARTH)
add(sc, "planche terre", g)
for k, (name, part) in enumerate(pieces.items()):
    add(sc, f"planche {name}", part, ((k % 5 - 2) * 2.9, -(k // 5 - 0.5) * 2.9, 0))
render(sc, (0, 0, 0), 16, (900, 500), os.path.join(out, "planche-pieces.png"))

for name in [s.name for s in bpy.data.scenes if not s.name.startswith("SOL")]:
    if len(bpy.data.scenes) > 1:
        bpy.data.scenes.remove(bpy.data.scenes[name])
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(KIT, "sol-herbe.blend"), copy=True, compress=True)

bench = os.path.join(ROOT, "apps", "world-web", "bench", "assets")
os.makedirs(bench, exist_ok=True)
with open(os.path.join(bench, "tuiles-herbe.json"), "w", encoding="utf-8") as f:
    json.dump({"source": "blender-elements/sol-herbe/sources/tuiles_herbe.py", "cell": CELL, "turf": TURF, "pathHalfWidth": PATH,
               "units": {"position": 1e-4, "color": 1 / 200}, "colorsPerVertex": True, "shapes": SHAPES,
               "pieces": {k: export_piece(v) for k, v in pieces.items()}}, f, separators=(",", ":"))
print("ok", file=sys.stderr)
