"""Kit modulaire d'arbres pour l'exploitation (Opus 5.5).

Sapins au style de la forêt actuelle (fût à 6 pans, étages de feuillage coniques),
découpés pour le cycle de vie d'un bosquet exploité :
- 3 sapins adultes : fût et feuillage séparés, origine au centre de la base, au sol,
  qui sert aussi de pivot d'abattage. Le fût a ses deux faces de coupe en bois clair :
  on peut le raccourcir tronçon par tronçon et le coucher sans trou visible.
- 2 stades de pousse : petit plant et arbuste.
- 2 souches à racines, face de coupe claire légèrement inclinée.
- 1 tronçon de bûche (tas, chargements) et 1 branche au sol (ébranchage).

Couleurs de sommet, aucune texture. Budget : adulte ≤ 150 triangles, souche ≤ 40,
pousse ≤ 30.

Deux propositions de style, choisies par la variable ARBRES_STYLE :
- a (par défaut) : étages en jupe étoilée, pointes retombantes ;
- b : étages arrondis « jouet », dans l'esprit des figurines, et un feuillu.

À lancer sans interface, depuis la racine du dépôt :
  blender --background --factory-startup --python blender-elements/arbres/sources/kit_arbres.py
  ARBRES_STYLE=b blender --background --factory-startup --python blender-elements/arbres/sources/kit_arbres.py
Écrit arbres(-b).blend, les aperçus de previews/ et kit-arbres(-b).json.
"""
import json, math, os, random, sys
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(KIT, "..", ".."))
ns = {"__name__": "villageois"}
with open(os.path.join(ROOT, "blender-elements", "villageois", "sources", "build_villageois.py"), encoding="utf-8") as f:
    exec(compile(f.read(), "build_villageois.py", "exec"), ns)
Part, hexc, mul = ns["Part"], ns["hexc"], ns["mul"]

# Teintes des matériaux actuels (BabylonVillageScene.ts) et bois de coupe.
BARK, BARK_LIGHT = hexc("523620"), hexc("6b4a2e")
LEAF_DARK, LEAF, LEAF_LIGHT = hexc("294e2d"), hexc("3f6c35"), hexc("668442")
CUT, CUT_RING = hexc("d2ae78"), hexc("a98352")
GRASS = hexc("4c7234")
STYLE = os.environ.get("ARBRES_STYLE", "a")
SUFFIX = "" if STYLE == "a" else f"-{STYLE}"
# Feuillu (style b) : vert plus jaune que les résineux.
BROAD_DARK, BROAD, BROAD_LIGHT = hexc("3d6630"), hexc("6a8f3c"), hexc("8fae52")


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def tri(p, pts, cols, out):
    """Triangle (ou polygone convexe) orienté vers `out` ; couleurs par sommet."""
    pts = [Vector(q) for q in pts]
    cols = cols if isinstance(cols, list) else [cols] * len(pts)
    n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
    if n.dot(Vector(out)) < 0:
        pts, cols = pts[::-1], cols[::-1]
    p.face(pts, cols)


def fan(p, centre, rim, c_centre, c_rim, out):
    for i in range(len(rim)):
        tri(p, [centre, rim[i], rim[(i + 1) % len(rim)]], [c_centre, c_rim, c_rim], out)


def ring(z, r, n, phase=0.0, cx=0.0, cy=0.0, tilt=(0.0, 0.0)):
    """Anneau horizontal ; `tilt` incline le plan (pente en x, pente en y)."""
    pts = []
    for i in range(n):
        a = phase + i * math.tau / n
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        pts.append(Vector((x, y, z + tilt[0] * (x - cx) + tilt[1] * (y - cy))))
    return pts


def prism(p, z0, z1, r0, r1, n, col0, col1, phase=0.0, caps=(None, None), cap_tilt=(0.0, 0.0)):
    """Fût à n pans, de z0 à z1 ; caps = (couleur bas, couleur haut) en bois de coupe."""
    lo, hi = ring(z0, r0, n, phase), ring(z1, r1, n, phase, tilt=cap_tilt)
    for i in range(n):
        j = (i + 1) % n
        mid = (lo[i] + lo[j] + hi[i] + hi[j]) / 4
        out = Vector((mid.x, mid.y, 0))
        tri(p, [lo[i], lo[j], hi[j]], [col0, col0, col1], out)
        tri(p, [lo[i], hi[j], hi[i]], [col0, col1, col1], out)
    if caps[0]:
        fan(p, Vector((0, 0, z0)), lo, caps[0][0], caps[0][1], (0, 0, -1))
    if caps[1]:
        centre = sum(hi, Vector()) / n
        fan(p, centre, hi, caps[1][0], caps[1][1], (0, 0, 1))
    return lo, hi


def tier(p, z0, z1, radius, points, droop, cols, rng, underside=True, lean=(0.0, 0.0)):
    """Étage de feuillage : jupe étoilée (pointes tombantes) et sommet ; dessous plus sombre."""
    tip, mid, inner = cols
    apex = Vector((lean[0], lean[1], z1))
    rim = []
    phase = rng.uniform(0, math.tau)
    for i in range(points * 2):
        a = phase + i * math.pi / points
        outer = i % 2 == 0
        r = radius * (rng.uniform(0.92, 1.06) if outer else 0.7)
        z = z0 - (droop * rng.uniform(0.8, 1.15) if outer else -0.06)
        rim.append(Vector((r * math.cos(a), r * math.sin(a), z)))
    for i in range(len(rim)):
        a, b = rim[i], rim[(i + 1) % len(rim)]
        ca = tip if i % 2 == 0 else inner
        cb = tip if (i + 1) % 2 == 0 else inner
        out = (a + b) / 2 - apex
        out.z = abs(out.z) + 0.2
        tri(p, [a, b, apex], [ca, cb, mid], out)
    if underside:
        centre = Vector((lean[0] * 0.3, lean[1] * 0.3, z0 + (z1 - z0) * 0.22))
        under = mul(inner, (0.75, 0.75, 0.75))
        for i in range(len(rim)):
            a, b = rim[i], rim[(i + 1) % len(rim)]
            tri(p, [a, b, centre], [under, under, under], (0, 0, -1))


def tier_round(p, z0, z1, radius, n, cols, rng, lip=True, underside=True, shoulder=True, lean=(0.0, 0.0)):
    """Étage arrondi (style b) : bourrelet sombre, rebord, épaule claire, pointe ; facettes décalées."""
    tip, mid, inner = cols
    h = z1 - z0
    phase = rng.uniform(0, math.tau)
    rings, cols_r = [ring(z0 + 0.07, radius, n, phase)], [mid]
    if shoulder:
        rings.append(ring(z0 + 0.5 * h, radius * 0.58, n, phase + math.pi / n, lean[0] * 0.5, lean[1] * 0.5))
        cols_r.append(tip)
    apex = Vector((lean[0], lean[1], z1))
    if lip:
        rings.insert(0, ring(z0 - 0.04, radius * 0.86, n, phase + math.pi / n))
        cols_r.insert(0, inner)
    for k in range(len(rings) - 1):
        a, b, ca, cb = rings[k], rings[k + 1], cols_r[k], cols_r[k + 1]
        for i in range(n):
            j = (i + 1) % n
            out = (a[i] + a[j] + b[i] + b[j]) / 4 - Vector((lean[0], lean[1], z0))
            out.z = max(out.z, 0.05) if (k or not lip) else -0.2
            tri(p, [a[i], a[j], b[i]], [ca, ca, cb], out)
            tri(p, [a[j], b[j], b[i]], [ca, cb, cb], out)
    top = rings[-1]
    for i in range(n):
        out = (top[i] + top[(i + 1) % n]) / 2 - apex
        out.z = abs(out.z) + 0.2
        tri(p, [top[i], top[(i + 1) % n], apex], [cols_r[-1], cols_r[-1], lerp(tip, LEAF_LIGHT, 0.4)], out)
    if underside:
        centre = Vector((lean[0] * 0.3, lean[1] * 0.3, z0 + h * 0.2))
        under = mul(inner, (0.75, 0.75, 0.75))
        fan(p, centre, rings[0], under, under, (0, 0, -1))


def blob(p, cx, cy, cz, r, rng, cols):
    """Touffe de feuillu : pointe basse, deux anneaux de 6 décalés, pointe haute (24 triangles)."""
    tip, mid, inner = cols
    phase = rng.uniform(0, math.tau)
    sq = rng.uniform(0.85, 1.0)
    bottom = Vector((cx, cy, cz - r * 0.75 * sq))
    lo = ring(cz - r * 0.3 * sq, r * 0.95, 6, phase, cx, cy)
    hi = ring(cz + r * 0.32 * sq, r * 0.88, 6, phase + math.pi / 6, cx, cy)
    top = Vector((cx + rng.uniform(-0.04, 0.04), cy + rng.uniform(-0.04, 0.04), cz + r * 0.85 * sq))
    c = Vector((cx, cy, cz))
    fan(p, bottom, lo, mul(inner, (0.8,) * 3), inner, (0, 0, -1))
    for i in range(6):
        j = (i + 1) % 6
        tri(p, [lo[i], lo[j], hi[i]], [inner, inner, mid], (lo[i] + lo[j] + hi[i]) / 3 - c)
        tri(p, [lo[j], hi[j], hi[i]], [inner, mid, mid], (lo[j] + hi[j] + hi[i]) / 3 - c)
        tri(p, [hi[i], hi[j], top], [mid, mid, tip], (hi[i] + hi[j] + top) / 3 - c)


def leaf_cols(level, light):
    """Pointes, sommet et creux d'un étage ; les étages hauts sont plus clairs."""
    t = level * 0.35 + light
    return (lerp(LEAF, LEAF_LIGHT, min(1, 0.45 + t)), lerp(LEAF, LEAF_LIGHT, min(1, 0.15 + t)), lerp(LEAF_DARK, LEAF, 0.35 + t * 0.5))


# ---------- sapins adultes ----------
# Échelle de l'arbre actuel : fût de 0,38 à la base, feuillage dès ~0,7 m, sommet à 2,85 m.
ADULTS_A = {
    # étages : (bas, sommet, rayon, pointes, retombée)
    "sapin-a": dict(fut=1.35, tiers=[(0.72, 2.0, 0.8, 7, 0.12), (1.35, 2.5, 0.6, 7, 0.1), (1.95, 2.85, 0.36, 6, 0.07)], seed=11),
    "sapin-b": dict(fut=1.15, tiers=[(0.62, 1.75, 0.92, 8, 0.14), (1.2, 2.3, 0.68, 7, 0.11), (1.8, 2.75, 0.4, 6, 0.08)], seed=23),
    "sapin-c": dict(fut=1.55, tiers=[(0.9, 1.95, 0.62, 7, 0.1), (1.35, 2.35, 0.52, 6, 0.09), (1.8, 2.7, 0.4, 6, 0.08), (2.25, 3.0, 0.24, 5, 0.05)], seed=37),
}
ADULTS_B = {
    # étages arrondis : (bas, sommet, rayon, côtés) ; le dernier n'a ni bourrelet ni dessous
    "sapin-a": dict(fut=1.35, tiers=[(0.72, 1.95, 0.8, 7), (1.32, 2.42, 0.6, 7), (1.9, 2.85, 0.4, 7)], seed=11),
    "sapin-b": dict(fut=1.15, tiers=[(0.6, 1.72, 0.92, 7), (1.15, 2.25, 0.7, 7), (1.75, 2.75, 0.44, 7)], seed=23),
    "sapin-c": dict(fut=1.55, tiers=[(0.92, 2.0, 0.6, 7), (1.45, 2.5, 0.47, 7), (2.0, 3.0, 0.32, 6)], seed=37),
    # feuillu : touffes (x, y, z, rayon)
    "feuillu-a": dict(fut=1.45, blobs=[(0.0, 0.0, 1.85, 0.78), (0.42, 0.18, 1.45, 0.5), (-0.36, -0.28, 1.5, 0.52)], seed=41),
}
ADULTS = ADULTS_A if STYLE == "a" else ADULTS_B


def fut(spec):
    p = Part()
    prism(p, 0.0, spec["fut"], 0.19, 0.1, 6, BARK, BARK_LIGHT, phase=0.3,
          caps=((CUT, CUT_RING), (CUT, CUT_RING)))
    return p


def feuillage(spec, light=0.0):
    p = Part()
    rng = random.Random(spec["seed"])
    if "blobs" in spec:
        for k, (x, y, z, r) in enumerate(spec["blobs"]):
            t = 0.25 if k == 0 else 0.0
            blob(p, x, y, z, r, rng, (lerp(BROAD, BROAD_LIGHT, 0.6 + t), lerp(BROAD, BROAD_LIGHT, 0.1 + t), lerp(BROAD_DARK, BROAD, 0.3)))
        return p
    if STYLE == "b":
        last = len(spec["tiers"]) - 1
        for k, (z0, z1, r, n) in enumerate(spec["tiers"]):
            lean = (rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04))
            tier_round(p, z0, z1, r, n, leaf_cols(k / len(spec["tiers"]), light), rng, lip=k < last, underside=k < last, lean=lean)
        return p
    for k, (z0, z1, r, n, d) in enumerate(spec["tiers"]):
        lean = (rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04))
        tier(p, z0, z1, r, n, d, leaf_cols(k / len(spec["tiers"]), light), rng, lean=lean)
    return p


# ---------- pousses ----------
def pousse(stage):
    p = Part()
    rng = random.Random(50 + stage)
    if STYLE == "b":
        if stage == 1:  # petit plant : 0,36 m, un étage arrondi
            prism(p, 0.0, 0.12, 0.025, 0.02, 3, BARK, BARK_LIGHT)
            tier_round(p, 0.08, 0.36, 0.14, 5, leaf_cols(0.5, 0.15), rng, lip=False, underside=False)
        else:  # arbuste : 0,96 m
            prism(p, 0.0, 0.3, 0.05, 0.035, 3, BARK, BARK_LIGHT)
            tier_round(p, 0.2, 0.7, 0.36, 5, leaf_cols(0.2, 0.08), rng, lip=False, underside=False)
            tier_round(p, 0.55, 0.96, 0.22, 5, leaf_cols(0.8, 0.08), rng, lip=False, underside=False, shoulder=False)
        return p
    if stage == 1:  # petit plant : 0,35 m, deux étages sans dessous
        prism(p, 0.0, 0.12, 0.025, 0.02, 3, BARK, BARK_LIGHT)
        tier(p, 0.08, 0.27, 0.13, 4, 0.03, leaf_cols(0.3, 0.15), rng, underside=False)
        tier(p, 0.19, 0.36, 0.08, 3, 0.02, leaf_cols(0.8, 0.15), rng, underside=False)
    else:  # arbuste : 0,95 m
        prism(p, 0.0, 0.3, 0.05, 0.035, 3, BARK, BARK_LIGHT)
        tier(p, 0.2, 0.68, 0.36, 5, 0.06, leaf_cols(0.2, 0.08), rng, underside=False)
        tier(p, 0.52, 0.96, 0.22, 4, 0.04, leaf_cols(0.8, 0.08), rng, underside=False)
    return p


# ---------- souches ----------
def souche(variant):
    p = Part()
    rng = random.Random(70 + variant)
    h, slope, r = (0.24, (0.12, 0.05), 0.19) if variant == 1 else (0.17, (-0.06, 0.14), 0.17)
    lo, hi = prism(p, 0.0, h, r * 1.08, r, 7 if STYLE == "b" else 6, BARK, BARK_LIGHT, phase=0.2 + variant,
                   caps=(None, (CUT, CUT_RING)), cap_tilt=slope)
    roots = (3 if STYLE == "b" else 4) if variant == 1 else 3
    for k in range(roots):
        a = (k + rng.uniform(-0.15, 0.15)) * math.tau / roots + 0.4 * variant
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        base = d * r * 0.95
        top = base + Vector((0, 0, h * rng.uniform(0.45, 0.6)))
        knee = d * (r + 0.09) + Vector((0, 0, 0.06))
        tip = d * (r + rng.uniform(0.19, 0.24)) + side * rng.uniform(-0.04, 0.04)
        # Racine en dos d'âne : arête du collet au genou puis à la pointe, flancs jusqu'au sol.
        w = 0.1
        l, rr = base + side * w + d * 0.03, base - side * w + d * 0.03
        tri(p, [top, l, knee], [BARK_LIGHT, BARK, BARK_LIGHT], side + Vector((0, 0, 1)))
        tri(p, [top, knee, rr], [BARK_LIGHT, BARK_LIGHT, BARK], -side + Vector((0, 0, 1)))
        tri(p, [l, tip, knee], [BARK, BARK, BARK_LIGHT], side + Vector((0, 0, 1)))
        tri(p, [knee, tip, rr], [BARK_LIGHT, BARK, BARK], -side + Vector((0, 0, 1)))
    return p


# ---------- bûche et branche ----------
def buche():
    """Tronçon couché selon x, posé au sol : 0,45 m, diamètre 0,2 m."""
    p = Part()
    q = Part()
    prism(q, -0.225, 0.225, 0.1, 0.095, 7 if STYLE == "b" else 6, BARK, BARK_LIGHT, phase=0.1, caps=((CUT, CUT_RING), (CUT, CUT_RING)))
    m = Matrix.Translation((0, 0, 0.095)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
    for idx, cols in zip(q.f, q.c):
        p.face([m @ q.v[i] for i in idx], cols)
    return p


def branche():
    """Branche au sol, selon x : tige triangulaire et deux rameaux d'aiguilles à plat."""
    p = Part()
    a, b = Vector((-0.4, 0, 0.03)), Vector((0.4, 0.04, 0.02))
    for k in range(3):
        o0 = Vector((0, 0.025 * math.cos(k * math.tau / 3), 0.025 * math.sin(k * math.tau / 3)))
        o1 = Vector((0, 0.025 * math.cos((k + 1) * math.tau / 3), 0.025 * math.sin((k + 1) * math.tau / 3)))
        tri(p, [a + o0, b + o0 * 0.5, b + o1 * 0.5], BARK, o0 + o1)
        tri(p, [a + o0, b + o1 * 0.5, a + o1], BARK, o0 + o1)
    rng = random.Random(90)
    for cx, s in ((-0.05, 0.22), (0.25, 0.16)):
        c = Vector((cx, 0.02, 0.06))
        pts = []
        for i in range(10):
            ang = i * math.pi / 5
            r = s * (1.0 if i % 2 == 0 else 0.45) * rng.uniform(0.85, 1.1)
            pts.append(c + Vector((r * math.cos(ang) * 1.3, r * math.sin(ang), -0.04 if i % 2 == 0 else 0.0)))
        fan(p, c, pts, LEAF_LIGHT, lerp(LEAF_DARK, LEAF, 0.6), (0, 0, 1))
    return p


pieces = {}
for name, spec in ADULTS.items():
    pieces[f"{name}-fut"] = fut(spec)
    pieces[f"{name}-feuillage"] = feuillage(spec)
pieces["pousse-plant"] = pousse(1)
pieces["pousse-arbuste"] = pousse(2)
pieces["souche-a"] = souche(1)
pieces["souche-b"] = souche(2)
pieces["buche"] = buche()
pieces["branche"] = branche()

tris = {k: v.tris() for k, v in pieces.items()}
adult = {n: tris[f"{n}-fut"] + tris[f"{n}-feuillage"] for n in ADULTS}
print("pieces", json.dumps(tris), "adultes", json.dumps(adult), file=sys.stderr)
assert all(v <= 150 for v in adult.values()), adult
assert tris["souche-a"] <= 40 and tris["souche-b"] <= 40, tris
assert tris["pousse-plant"] <= 30 and tris["pousse-arbuste"] <= 30, tris


# ---------- arbre actuel, pour comparaison ----------
def cone(p, z0, h, r0, r1, n, col):
    prism(p, z0, z0 + h, r0, r1, n, col, col)
    fan(p, Vector((0, 0, z0)), ring(z0, r0, n), col, col, (0, 0, -1))


def actuel():
    p = Part()
    cone(p, 0.5 - 0.55, 1.1, 0.19, 0.11, 6, BARK)
    cone(p, 1.48 - 0.775, 1.55, 0.775, 0.08, 7, LEAF)
    cone(p, 2.22 - 0.625, 1.25, 0.575, 0.02, 7, LEAF_LIGHT)
    return p


# ---------- scènes ----------
def stage(name):
    old = bpy.data.scenes.get(name)
    if old:
        bpy.data.scenes.remove(old)
    sc = bpy.data.scenes.new(name)
    engines = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items}
    sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
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
    g = Part()
    g.face([(-40, -40, 0), (40, -40, 0), (40, 40, 0), (-40, 40, 0)], GRASS)
    add(sc, f"{name} sol", g)
    return sc


def add(sc, name, part, loc=(0, 0, 0), rot=0.0, scale=(1, 1, 1), tilt=None):
    o = bpy.data.objects.new(name, part.build(name))
    o.location = loc
    o.rotation_euler = tilt if tilt else (0, 0, rot)
    o.scale = scale
    sc.collection.objects.link(o)
    return o


def tree(sc, name, variant, loc, rot, s=1.0, hs=None, tilt=None, foliage=True, fut_scale=1.0):
    hs = s if hs is None else hs
    root = bpy.data.objects.new(name, None)
    root.location = loc
    root.rotation_euler = tilt if tilt else (0, 0, rot)
    root.scale = (s, s, hs)
    sc.collection.objects.link(root)
    for part, sz in ((f"{variant}-fut", fut_scale),) + (((f"{variant}-feuillage", 1.0),) if foliage else ()):
        o = add(sc, f"{name} {part}", pieces[part])
        o.parent = root
        o.scale = (1, 1, sz)
    return root


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


def forest(sc, style):
    """Bosquets de 2,5 m comme en jeu ; un chantier de coupe au centre, avec ses étapes."""
    rng = random.Random(5)
    for gx in range(-5, 5):
        for gy in range(-3, 4):
            cx, cy = (gx + 0.5) * 2.5, (gy + 0.5) * 2.5
            if abs(cx) < 4.5 and abs(cy) < 3.2:
                continue  # clairière du chantier
            if rng.random() < 0.25:
                continue
            for i in range(2 + rng.randrange(3)):
                a = (i + rng.random()) / 3 * math.tau
                r = rng.uniform(0.42, 0.9)
                s = rng.uniform(0.76, 1.02)
                at = (cx + math.cos(a) * r, cy + math.sin(a) * r, 0)
                if style == "actuel":
                    o = add(sc, f"actuel {gx} {gy} {i}", actuel(), at, rng.uniform(0, math.pi), (s, s, s))
                else:
                    tree(sc, f"sapin {gx} {gy} {i}", rng.choice(KINDS), at, rng.uniform(0, math.tau), s)
    look = [dict(skin=0, clothes=1, hair=1), dict(skin=1, clothes=3, hair=0), dict(skin=2, clothes=0, hair=2)]
    if style == "actuel":
        for k, at in enumerate(((-1.2, 0.4, 0), (0.6, -0.6, 0), (1.8, 0.8, 0))):
            ns["build_figurine"](sc, f"{style} bucheron {k}", at, 0.4 * k, "repos", look[k], "bonnet", "court")
        return
    # chantier : arbre en cours d'abattage (incliné sur son pivot), arbre couché ébranché,
    # arbre couché dont le fût est raccourci, souches, pousses, tas de bûches, branches
    tree(sc, "sapin abattu", "sapin-a", (-2.6, 1.6, 0), 0, tilt=(math.radians(-35), 0, 0.5))
    tree(sc, "sapin couche", "sapin-b", (-0.5, 1.6, 0.19), 0, tilt=(0, math.radians(90), 0.25), foliage=False)
    tree(sc, "sapin debite", "sapin-c", (1.0, -1.7, 0.19), 0, tilt=(0, math.radians(90), -0.3), foliage=False, fut_scale=0.55)
    for k, (at, v) in enumerate((((-3.2, -0.6, 0), "a"), ((-1.6, -1.9, 0), "b"), ((2.9, 1.9, 0), "a"), ((3.5, -0.4, 0), "b"))):
        add(sc, f"souche {k}", pieces[f"souche-{v}"], at, k * 1.3)
    for k, (at, st) in enumerate((((-3.6, 0.6, 0), "plant"), ((-2.9, -1.6, 0), "plant"), ((2.2, 2.6, 0), "arbuste"),
                                  ((3.8, 0.9, 0), "plant"), ((-0.2, -2.6, 0), "arbuste"))):
        add(sc, f"pousse {k}", pieces[f"pousse-{st}"], at, k * 0.9)
    for k in range(6):
        row, col = (0, k) if k < 3 else (1, k - 3)
        add(sc, f"buche {k}", pieces["buche"], (2.0 + col * 0.0, 0.4 + col * 0.22 + row * 0.11, row * 0.17), 1.57 + 0.05 * k)
    for k, at in enumerate(((0.6, 2.4, 0), (-1.4, 0.2, 0), (1.6, 1.4, 0))):
        add(sc, f"branche {k}", pieces["branche"], at, 0.7 + k * 1.9)
    ns["build_figurine"](sc, "bucheron hache", (-2.2, 0.6, 0), 2.6, "repos", look[0], "bonnet", "court")
    ns["build_figurine"](sc, "scieur 1", (1.0, -1.25, 0), 3.14, "repos", look[1], "bonnet", "court")
    ns["build_figurine"](sc, "porteur", (2.6, 0.2, 0), 1.2, "repos", look[2], "bonnet", "court")


# Tirage des variantes dans la forêt : un feuillu pour quatre résineux en style b.
KINDS = list(ADULTS) + (["sapin-a", "sapin-b", "sapin-c"] * 2 if STYLE == "b" else [])
out = os.path.join(KIT, "previews")
os.makedirs(out, exist_ok=True)
for style in (("actuel", "kit") if STYLE == "a" else (f"kit{SUFFIX}",)):
    sc = stage(f"ARBRES {style}")
    forest(sc, style)
    render(sc, (0, 0, 0), 24.6, (640, 400), os.path.join(out, f"{style}-zoom-moyen.png"))
    render(sc, (0.0, 0.2, 0), 9.0, (900, 560), os.path.join(out, f"{style}-zoom-proche.png"))

# planche des pièces
sc = stage("ARBRES planche")
row = [("arbre", v) for v in ADULTS] + [("pousse-arbuste", None), ("pousse-plant", None),
       ("souche-a", None), ("souche-b", None), ("buche", None), ("branche", None)]
right = Vector((math.cos(0.588), math.sin(0.588), 0))
for k, (name, v) in enumerate(row):
    at = tuple(right * ((k - (len(row) - 1) / 2) * 1.3))
    if v:
        tree(sc, f"planche {v}", v, at, 0.3)
    else:
        add(sc, f"planche {name}", pieces[name], at, 0.5)
render(sc, (0, 0, 0.9), 1.3 * len(row) + 1.5, (1200, 520), os.path.join(out, f"planche-pieces{SUFFIX}.png"))

for name in [s.name for s in bpy.data.scenes if not s.name.startswith("ARBRES")]:
    if len(bpy.data.scenes) > 1:
        bpy.data.scenes.remove(bpy.data.scenes[name])
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(KIT, f"arbres{SUFFIX}.blend"), copy=True, compress=True)


def export_piece(part):
    """Comme export_jeu.py : triangles en éventail, axes Blender → jeu (x, z, −y), couleurs par sommet."""
    positions, colors = [], []
    for idx, cols in zip(part.f, part.c):
        pts = [part.v[i] for i in idx]
        for k in range(1, len(pts) - 1):
            for q, col in ((pts[0], cols[0]), (pts[k], cols[k]), (pts[k + 1], cols[k + 1])):
                positions += [round(q.x * 1e4), round(q.z * 1e4), round(-q.y * 1e4)]
                colors += [round(v * 200) for v in col[:3]]
    return {"positions": positions, "colors": colors}


with open(os.path.join(KIT, f"kit-arbres{SUFFIX}.json"), "w", encoding="utf-8") as f:
    json.dump({"source": "blender-elements/arbres/sources/kit_arbres.py", "units": {"position": 1e-4, "color": 1 / 200},
               "colorsPerVertex": True, "pivot": "centre de la base, au sol (pivot d'abattage)",
               "trunkTop": {n: s["fut"] for n, s in ADULTS.items()}, "triangles": tris,
               "pieces": {k: export_piece(v) for k, v in pieces.items()}}, f, separators=(",", ":"))
print("ok", file=sys.stderr)
