"""Revêtements de route proposés, en trois états d'usure (Opus 5.5).

À exécuter après gabarit_routes.py (même espace de noms). Tronçons de 2 tuiles de large :
trottoirs de 0,625 m (4 pixels du moteur), chaussée de 3,75 m, circulation à droite.
Usure : 0 neuf, 1 usé, 2 dégradé. Les ornières suivent la trace des roues (entraxe TRACK).
"""
import bpy, math, random
from mathutils import Vector

ROAD_W, SIDE_W = 2 * TILE, 4 * PX
HALF = ROAD_W / 2 - SIDE_W           # demi-chaussée : 1,875 m
LANE = HALF / 2                      # axe de chaque voie
GRANITE, GRANITE_TOP = hexc("8e9190"), hexc("a7aaa8")
SLAB, SLAB_JOINT = hexc("c9c7b8"), hexc("9e9c8f")
EARTH_LIGHT, EARTH_DARK, RUT, MUD = hexc("86663f"), hexc("6e5232"), hexc("553d26"), hexc("4a3a2a")
GRAVEL, GRAVEL_DARK, PEBBLE = hexc("b4ab97"), hexc("968d79"), hexc("cfc7b3")
SETT, SETT_DARK, SETT_LIGHT = hexc("9b9a92"), hexc("7d7c75"), hexc("b1afa6")
PUDDLE, GRASS_TUFT = hexc("6f8090"), hexc("6c8a3e")


def _quad(p, x0, y0, x1, y1, z, col):
    p.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], col)


def wheel_tracks():
    """Positions transversales des quatre traces de roues (deux voies)."""
    return [s * LANE + k * TRACK / 2 for s in (-1, 1) for k in (-1, 1)]


def sidewalks(p, L):
    """Trottoirs : bordure de granit (0,12 m) côté chaussée, puis dalles à joints."""
    for s in (-1, 1):
        y_in, y_out = s * HALF, s * (HALF + SIDE_W)
        yb = y_in + s * 0.12
        box(p, L / 2, (y_in + yb) / 2, CURB_H / 2, L, 0.12, CURB_H, GRANITE)
        p.c[-6] = [GRANITE_TOP] * 4
        n = int(L / 0.625)
        for k in range(n):
            x0, x1 = k * 0.625 + 0.01, (k + 1) * 0.625 - 0.01
            ya, yc = sorted((yb, y_out))
            box(p, (x0 + x1) / 2, (ya + yc) / 2, CURB_H / 2 - 0.002, x1 - x0, yc - ya - 0.02, CURB_H - 0.004, SLAB_JOINT)
            p.c[-6] = [SLAB if k % 3 else mul(SLAB, (0.95,) * 3)] * 4


def earth(p, L, wear, rng):
    """Terre battue : sol légèrement varié ; ornières qui se creusent et s'assombrissent ; flaques et herbe."""
    # fond : grille de sommets partagés à teinte aléatoire douce (pas de damier), bords neutres
    nx, ny = int(L / 0.25), int(2 * HALF / 0.25)
    tone = {(i, j): mul(EARTH_LIGHT, (1 + rng.uniform(-0.07, 0.05),) * 3) for i in range(nx + 1) for j in range(ny + 1)}
    for i in range(nx):
        for j in range(ny):
            ks = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            p.face([(a * 0.25, -HALF + b * 0.25, ROAD_Z) for a, b in ks], [tone[k] for k in ks])
    if wear >= 1:
        w = 0.07 + 0.04 * wear
        for y in wheel_tracks():
            _quad(p, 0, y - w / 2, L, y + w / 2, ROAD_Z + 0.001, mul(RUT, (1.0 - 0.12 * wear,) * 3))
    if wear >= 2:
        for k in range(4):
            x, y = rng.uniform(0.3, L - 0.3), rng.choice(wheel_tracks())
            rx, ry = rng.uniform(0.25, 0.45), rng.uniform(0.08, 0.14)
            ring_pts = [(x + rx * math.cos(a), y + ry * math.sin(a), ROAD_Z + 0.002) for a in (k2 * math.tau / 10 for k2 in range(10))]
            cap_top(p, [Vector(q) for q in ring_pts], Vector((x, y, ROAD_Z + 0.002)), PUDDLE)
        for k in range(14):
            x, y = rng.uniform(0, L), rng.choice((-1, 1)) * rng.uniform(0.0, 0.18)
            two_sided(p, [(x - 0.03, y, ROAD_Z), (x + 0.03, y, ROAD_Z), (x, y + 0.01, ROAD_Z + 0.07)], GRASS_TUFT)


def gravel(p, L, wear, rng):
    """Empierrement : fond clair, cailloux épars ; traces tassées puis nids-de-poule."""
    _quad(p, 0, -HALF, L, HALF, ROAD_Z, GRAVEL)
    for k in range(int(L * 2 * HALF * 9)):
        x, y = rng.uniform(0, L), rng.uniform(-HALF, HALF)
        s = rng.uniform(0.025, 0.05)
        box(p, x, y, ROAD_Z + s / 4, s, s * 0.8, s / 2, PEBBLE if k % 3 else GRAVEL_DARK)
    if wear >= 1:
        for y in wheel_tracks():
            _quad(p, 0, y - 0.06, L, y + 0.06, ROAD_Z + 0.001, mul(GRAVEL_DARK, (1.0 - 0.06 * wear,) * 3))
    if wear >= 2:
        for k in range(6):
            x, y = rng.uniform(0.3, L - 0.3), rng.choice(wheel_tracks()) + rng.uniform(-0.1, 0.1)
            r = rng.uniform(0.12, 0.22)
            pts = [Vector((x + r * math.cos(a), y + r * 0.8 * math.sin(a), ROAD_Z + 0.002)) for a in (i * math.tau / 8 for i in range(8))]
            cap_top(p, pts, Vector((x, y, ROAD_Z + 0.002)), MUD)


def setts(p, L, wear, rng):
    """Pavés de 0,31 × 0,156 m (2 × 1 pixels) en quinconce, chaussée bombée, caniveaux le long des bordures."""
    sx, sy, joint = 2 * PX, PX, 0.012
    rows = int(round(2 * HALF / sy))
    crown = 0.025
    for j in range(rows):
        y0 = -HALF + j * sy
        yc = y0 + sy / 2
        gutter = j == 0 or j == rows - 1
        lift = crown * (1 - (yc / HALF) ** 2)
        off = (sx / 2) if j % 2 else 0.0
        x = -off
        while x < L:
            x0, x1 = max(0.0, x), min(L, x + sx)
            x += sx
            if x1 - x0 < 0.03:
                continue
            missing = wear >= 2 and not gutter and rng.random() < 0.03
            sunk = wear >= 1 and rng.random() < (0.04 if wear == 1 else 0.1) and any(abs(yc - t) < 0.12 for t in wheel_tracks())
            if missing:
                _quad(p, x0, y0, x1, y0 + sy, ROAD_Z, MUD)
                continue
            z = ROAD_Z + lift - (0.012 if sunk else 0.0) - (0.01 if gutter else 0.0)
            col = SETT_DARK if gutter else (SETT_LIGHT if (j + int(x / sx)) % 4 == 0 else SETT)
            if wear >= 1 and not gutter:
                col = mul(col, (1 - 0.04 * wear,) * 3)
            box(p, (x0 + x1) / 2, yc, z / 2 + 0.004, x1 - x0 - joint, sy - joint, z + 0.008, mul(col, (0.75,) * 3))
            p.c[-6] = [col] * 4
    _quad(p, 0, -HALF, L, HALF, ROAD_Z - 0.004, SLAB_JOINT)


SURFACES = {"terre": earth, "empierrement": gravel, "paves": setts}


def section(sc, name, origin, kind, wear, L=1.5 * TILE, seed=1):
    rng = random.Random(seed)
    p = Part()
    SURFACES[kind](p, L, wear, rng)
    sidewalks(p, L)
    ox, oy = origin
    o = bpy.data.objects.new(name, p.build(name))
    o.location = (ox, oy, 0)
    sc.collection.objects.link(o)
    return o


def build_surfaces(G):
    sc = stage("VIL revetements", G)
    for o in [o for o in sc.objects if o.name.endswith("parcelle")]:
        bpy.data.objects.remove(o, do_unlink=True)
    L = 1.5 * TILE
    for r, kind in enumerate(("terre", "empierrement", "paves")):
        for c, wear in enumerate((0, 1, 2)):
            section(sc, f"rev_{kind}_{wear}", (c * (L + 0.8), -r * (ROAD_W + 1.0)), kind, wear, L, seed=r * 10 + c)
    # échelle : un attelage et des passants sur la colonne « neuf »
    for r, (load, coat) in enumerate((("sacs", "bai"), ("bois", "alezan"), ("pierre", "gris"))):
        team(sc, f"rev_att{r}", (1.0, -r * (ROAD_W + 1.0) - LANE), math.pi / 2, coat=coat, load=load)
        rig(sc, f"rev_pieton{r}", (2.9, -r * (ROAD_W + 1.0) + HALF + SIDE_W / 2), -math.pi / 2,
            dict(skin=r % 3, clothes=(r + 1) % 5, hair=(r + 2) % 3))
    return sc
