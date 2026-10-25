"""Banc d'essai des routes à l'échelle du jeu, avec l'attelage pour gabarit (Opus 5.5).

À exécuter après build_villageois.py, tenues.py, poses.py et attelage.py (même espace de noms).
Une tuile = 2,5 m ; les revêtements sont rastérisés sur la grille du moteur de routes (1/16 de tuile).
Circulation à droite. Repère Blender : Z haut.
"""
import bpy, math
from mathutils import Vector

TILE = 2.5
PX = TILE / 16                 # pixel du moteur de routes (0,15625 m)
ROAD_Z, CURB_H = 0.015, 0.06   # dessus de chaussée et hauteur de trottoir, comme le jeu
EARTH, STONE_TOP, STONE_SIDE = hexc("795b3d"), hexc("c5c6b8"), hexc("9fa094")
GRASS_LINE = hexc("5f7340")
OK_COL, BAD_COL, HORSE_COL = hexc("3fae4a"), hexc("d43d33"), hexc("e8c547")

VARIANTS = {
    "1 tuile": dict(W=TILE, sw=3 * PX),       # trottoirs 0,47 m, chaussée 1,56 m
    "2 tuiles": dict(W=2 * TILE, sw=4 * PX),  # trottoirs 0,625 m, chaussée 3,75 m
}


# ---------- masques ----------
def straight_masks(W, sw):
    """Route rectiligne le long de X, centrée sur y = 0."""
    H, h = W / 2, W / 2 - sw
    return (lambda x, y: abs(y) <= H), (lambda x, y: abs(y) <= h)


def corner_masks(W, sw, kind, size):
    """Virage : bras ouest (le long de -X) et bras sud (le long de -Y), coin intérieur au sud-ouest.
    `kind` : vif, pan (pan coupé de côté `size`) ou arc (congé de rayon `size`)."""
    H, h = W / 2, W / 2 - sw

    def foot(x, y):
        return (x <= H and abs(y) <= H) or (y <= H and abs(x) <= H)

    def road(x, y):
        if (x <= h and abs(y) <= h) or (y <= h and abs(x) <= h):
            return True
        if x < -h and y < -h:
            if kind == "pan":
                return x + y >= -2 * h - size
            if kind == "arc":
                cx = cy = -h - size
                return x >= cx and y >= cy and math.hypot(x - cx, y - cy) >= size
        return False
    return foot, road


def raster(sc, name, origin, extent, foot, road):
    """Chaussée en terre (plats fusionnés par rangée) et trottoirs en pierre (pavés de 6 cm)."""
    (x0, x1), (y0, y1) = extent
    nx, ny = int(round((x1 - x0) / PX)), int(round((y1 - y0) / PX))
    flat, curb = Part(), Part()
    ox, oy = origin
    for j in range(ny):
        yc = y0 + (j + 0.5) * PX
        run, start = None, 0
        for i in range(nx + 1):
            xc = x0 + (i + 0.5) * PX
            cls = None
            if i < nx and foot(xc, yc):
                cls = "road" if road(xc, yc) else "curb"
            if cls != run:
                if run:
                    xa, xb = x0 + start * PX + ox, x0 + i * PX + ox
                    ya, yb = y0 + j * PX + oy, y0 + (j + 1) * PX + oy
                    if run == "road":
                        flat.face([(xa, ya, ROAD_Z), (xb, ya, ROAD_Z), (xb, yb, ROAD_Z), (xa, yb, ROAD_Z)], EARTH)
                    else:
                        box(curb, (xa + xb) / 2, (ya + yb) / 2, CURB_H / 2, xb - xa, yb - ya, CURB_H, STONE_SIDE)
                        curb.c[-6] = [STONE_TOP] * 4  # la première face de box() est le dessus
                run, start = cls, i
    for part, suffix in ((flat, "chaussee"), (curb, "trottoirs")):
        if part.f:
            o = bpy.data.objects.new(f"{name}_{suffix}", part.build(f"{name}_{suffix}"))
            sc.collection.objects.link(o)


def tile_grid(sc, name, origin, extent):
    """Repères de tuiles : fines lignes sombres sur l'herbe."""
    p = Part()
    (x0, x1), (y0, y1) = extent
    ox, oy = origin
    k = math.floor(x0 / TILE)
    while k * TILE <= x1:
        x = k * TILE + ox
        p.face([(x - 0.01, y0 + oy, 0.001), (x + 0.01, y0 + oy, 0.001), (x + 0.01, y1 + oy, 0.001), (x - 0.01, y1 + oy, 0.001)], GRASS_LINE)
        k += 1
    k = math.floor(y0 / TILE)
    while k * TILE <= y1:
        y = k * TILE + oy
        p.face([(x0 + ox, y - 0.01, 0.001), (x1 + ox, y - 0.01, 0.001), (x1 + ox, y + 0.01, 0.001), (x0 + ox, y + 0.01, 0.001)], GRASS_LINE)
        k += 1
    o = bpy.data.objects.new(f"{name}_tuiles", p.build(f"{name}_tuiles"))
    sc.collection.objects.link(o)


# ---------- attelages ----------
def team(sc, name, axle, heading, coat="bai", load="sacs", driver=True):
    fwd = Vector((math.sin(heading), -math.cos(heading), 0))
    cart = cart_rig(sc, f"{name}_carriole", load)
    cart["root"].location = (axle[0], axle[1], 0)
    cart["root"].rotation_euler = (0, 0, heading)
    hc = Vector((axle[0], axle[1], 0)) + fwd * (HITCH - COLLAR)
    horse_rig(sc, f"{name}_cheval", (hc.x, hc.y), heading, coat=coat, harnessed=True)
    if driver:
        side = Vector((math.cos(heading), math.sin(heading), 0))  # à droite du cheval (côté trottoir)
        d = hc - side * 0.3
        rig(sc, f"{name}_charretier", (d.x, d.y), heading, dict(skin=1, clothes=2, hair=0), hat="bonnet")


def strip(p, a, b, w, col, z=0.075):
    d = (b - a)
    if d.length < 1e-6:
        return
    n = Vector((-d.y, d.x, 0)).normalized() * (w / 2)
    p.face([a - n + Vector((0, 0, z)), b - n + Vector((0, 0, z)), b + n + Vector((0, 0, z)), a + n + Vector((0, 0, z))], col)


def corner_test(sc, name, origin, W, sw, kind, size, radius):
    """Virage à droite (vers l'est puis vers le sud) dans la voie de droite ; trace des roues."""
    h = W / 2 - sw
    foot, road = corner_masks(W, sw, kind, size)
    ext = ((-2.2 * TILE, W / 2 + 0.3), (-2.2 * TILE, W / 2 + 0.3))
    raster(sc, name, origin, ext, foot, road)
    tile_grid(sc, name, origin, ext)
    lane = h / 2
    cx = cy = -lane - radius
    path = [(-2.2 * TILE, -lane), (cx, -lane)]
    for k in range(1, 13):
        a = math.pi / 2 - k * (math.pi / 2) / 12
        path.append((cx + radius * math.cos(a), cy + radius * math.sin(a)))
    path.append((-lane, -2.2 * TILE))
    samples = trailer(path)
    ox, oy = origin
    p = Part()
    worst = dict(chaussee=0.0, emprise=0.0)
    prev = None
    for hp, hh, ax, ch, d in samples:
        side = Vector((math.cos(ch), math.sin(ch), 0)) * (TRACK / 2 + 0.03)
        wheels = (ax - side, ax + side)
        if prev:
            strip(p, prev[0] + Vector((ox, oy, 0)), hp + Vector((ox, oy, 0)), 0.03, HORSE_COL)
            for k in range(2):
                a, b = prev[1][k], wheels[k]
                on_road = road(b.x, b.y)
                strip(p, a + Vector((ox, oy, 0)), b + Vector((ox, oy, 0)), 0.035, OK_COL if on_road else BAD_COL)
                if not on_road:
                    # distance au bord de chaussée le plus proche, approchée par recherche radiale
                    worst["chaussee"] = max(worst["chaussee"], _outside(road, b))
                if not foot(b.x, b.y):
                    worst["emprise"] = max(worst["emprise"], _outside(foot, b))
        prev = (hp, wheels)
    o = bpy.data.objects.new(f"{name}_traces", p.build(f"{name}_traces"))
    sc.collection.objects.link(o)
    # trois positions fantômes de l'attelage le long du virage
    n = len(samples)
    for i, f in enumerate((0.42, 0.55, 0.7)):
        hp, hh, ax, ch, d = samples[int(n * f)]
        team(sc, f"{name}_att{i}", (ax.x + ox, ax.y + oy), ch, coat=("bai", "gris", "alezan")[i], driver=False)
    return {k: round(v, 2) for k, v in worst.items()}


def _outside(mask, pnt, step=0.02):
    """Distance approximative d'un point hors masque jusqu'au masque."""
    for k in range(1, 60):
        r = k * step
        for a in range(16):
            ang = a * math.tau / 16
            if mask(pnt.x + r * math.cos(ang), pnt.y + r * math.sin(ang)):
                return r
    return 60 * step


def straight_test(sc, name, origin, W, sw):
    foot, road = straight_masks(W, sw)
    h = W / 2 - sw
    ext = ((-1.5 * TILE, 1.5 * TILE), (-W / 2 - 0.3, W / 2 + 0.3))
    raster(sc, name, origin, ext, foot, road)
    tile_grid(sc, name, origin, ext)
    ox, oy = origin
    lane = h / 2
    # croisement : vers l'est voie sud (droite), vers l'ouest voie nord
    team(sc, f"{name}_est", (ox - 0.9, oy - lane), math.pi / 2, coat="bai", load="bois")
    team(sc, f"{name}_ouest", (ox + 0.9, oy + lane), -math.pi / 2, coat="gris", load="pierre")
    for i, (x, s) in enumerate(((-2.4, -1), (1.6, 1), (2.6, -1))):
        y = s * (W / 2 - sw / 2)
        rig(sc, f"{name}_pieton{i}", (ox + x, oy + y), math.pi / 2 if s < 0 else -math.pi / 2,
            dict(skin=i % 3, clothes=(i + 2) % 5, hair=i % 3))
    gap_center = 2 * lane - (TRACK + 0.06 + 0.05)
    gap_curb = h - lane - (TRACK / 2 + 0.06)
    return dict(chaussee=round(2 * h, 3), entre_carrioles=round(gap_center, 3), au_trottoir=round(gap_curb, 3))


def build_gabarit(G):
    sc = stage("VIL gabarit routes", G)
    for o in [o for o in sc.objects if o.name.endswith("parcelle")]:
        bpy.data.objects.remove(o, do_unlink=True)
    report = {}
    report["droite 1 tuile"] = straight_test(sc, "droite1", (0, 0), **VARIANTS["1 tuile"])
    report["droite 2 tuiles"] = straight_test(sc, "droite2", (0, -5.5), **VARIANTS["2 tuiles"])
    for i, (kind, size) in enumerate((("vif", 0), ("pan", VARIANTS["1 tuile"]["sw"]), ("arc", VARIANTS["1 tuile"]["sw"]))):
        report[f"virage 1 tuile {kind}"] = corner_test(sc, f"virage1_{kind}", (11 + i * 7.5, 0), radius=0.7, kind=kind, size=size,
                                                      **VARIANTS["1 tuile"])
    report["virage 2 tuiles vif"] = corner_test(sc, "virage2_vif", (11 + 7.5, -9), radius=0.7, kind="vif", size=0,
                                                 **VARIANTS["2 tuiles"])
    return sc, report
