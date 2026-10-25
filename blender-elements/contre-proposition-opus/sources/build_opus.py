"""Contre-proposition jardins « planche-jauge » (Opus 5.5).

Exécuter dans Blender : crée les scènes OPUS * sans toucher aux scènes existantes.
Coordonnées Blender : XY au sol, +Z en haut ; cellule de 2,5 m, origine au coin bas gauche.
"""
import bpy, math, random
from mathutils import Vector, Matrix

CELL = 2.5
ROWS = (0.43, 1.25, 2.07)          # mêmes axes de rangs que le V8, pour comparer
SLOTS = (0.45, 0.98, 1.52, 2.05)   # 4 touffes par rang, 12 par parcelle
RIDGE_H = 0.09
# Croissance uniforme retenue par Tristan : stade 1..7 -> (pièce, échelle) pour les 12 emplacements
GROWTH = (("semis", 1.0), ("semis", 1.45), ("jeune", 0.8), ("jeune", 1.05),
          ("mure", 0.78), ("mure", 0.9), ("mure", 1.0))
LIGHT = Vector((-0.35, -0.45, 1.0)).normalized()


def hexc(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


SOIL, SOIL_DARK = hexc("5b3a24"), hexc("4a2e1c")
RIDGE_TOP, RIDGE_SIDE = hexc("74492b"), hexc("5f3b23")
WOOD, WOOD_TOP, POST, POST_TOP = hexc("9c7148"), hexc("c49a66"), hexc("7d5a39"), hexc("a8845a")
LEAF_A, LEAF_B, LEAF_TIP = hexc("4f8d2f"), hexc("3f7526"), hexc("8cc04e")
SPROUT, SPROUT_TIP = hexc("6f9f3c"), hexc("a5cf62")
ORANGE, ORANGE_DARK = hexc("ee8a2c"), hexc("c8641a")
CRATE, CRATE_TOP = hexc("b98a55"), hexc("d8ad74")


def material():
    m = bpy.data.materials.get("OPUS_vc")
    if m:
        return m
    m = bpy.data.materials.new("OPUS_vc")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    a = nt.nodes.new("ShaderNodeVertexColor")
    a.layer_name = "Col"
    e = nt.nodes.new("ShaderNodeEmission")
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(a.outputs[0], e.inputs[0])
    nt.links.new(e.outputs[0], o.inputs[0])
    m.use_backface_culling = True
    return m


class MB:
    """Accumule des faces ; une couleur par coin."""

    def __init__(self):
        self.v, self.f, self.c = [], [], []

    def face(self, pts, col):
        i = len(self.v)
        self.v += [Vector(p) for p in pts]
        self.f.append(tuple(range(i, i + len(pts))))
        self.c.append(col if isinstance(col, list) else [col] * len(pts))

    def add(self, other, mat=Matrix.Identity(4)):
        for idx, cols in zip(other.f, other.c):
            self.face([mat @ other.v[i] for i in idx], cols)

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def build(self, name, shade=True, mat=None):
        """`shade` inscrit un éclairage fixe (aperçus unlit) ; l'export pour le jeu le désactive."""
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.v], [], self.f)
        me.update()
        ca = me.color_attributes.new("Col", 'BYTE_COLOR', 'CORNER')
        for poly, cols in zip(me.polygons, self.c):
            sh = 0.6 + 0.4 * max(0.0, poly.normal.dot(LIGHT)) if shade else 1.0
            for li, col in zip(poly.loop_indices, cols):
                ca.data[li].color_srgb = (min(1, col[0] * sh), min(1, col[1] * sh), min(1, col[2] * sh), 1)
        me.materials.append(mat or material())
        return me


def jit(col, r, k=0.08):
    s = 1 + r.uniform(-k, k)
    return tuple(min(1, x * s) for x in col)


# ---------- pièces ----------
def soil():
    """Grille 4x4 (32 triangles) : variation de teinte, bords neutres pour des joints invisibles."""
    mb, n, r = MB(), 4, random.Random(7)
    step = CELL / n
    col = {}
    for i in range(n + 1):
        for j in range(n + 1):
            edge = i in (0, n) or j in (0, n)
            col[i, j] = SOIL if edge else jit(SOIL if (i + j) % 2 else SOIL_DARK, r, 0.1)
    for i in range(n):
        for j in range(n):
            ks = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            mb.face([(a * step, b * step, 0) for a, b in ks], [col[k] for k in ks])
    return mb


def ridge(yc):
    """Butte trapézoïdale à bouts biseautés : 5 quads, 10 triangles."""
    x0, x1, wb, wt, h, e = 0.14, CELL - 0.14, 0.26, 0.12, RIDGE_H, 0.12
    b = [(x0, yc - wb, 0), (x1, yc - wb, 0), (x1, yc + wb, 0), (x0, yc + wb, 0)]
    t = [(x0 + e, yc - wt, h), (x1 - e, yc - wt, h), (x1 - e, yc + wt, h), (x0 + e, yc + wt, h)]
    mb = MB()
    mb.face(t, RIDGE_TOP)
    mb.face([b[0], b[1], t[1], t[0]], RIDGE_SIDE)
    mb.face([b[2], b[3], t[3], t[2]], RIDGE_SIDE)
    mb.face([b[1], b[2], t[2], t[1]], RIDGE_SIDE)
    mb.face([b[3], b[0], t[0], t[3]], RIDGE_SIDE)
    return mb


def box(mb, x0, y0, x1, y1, h, side, top, z0=0.0):
    """Pavé sans dessous : 5 quads, 10 triangles."""
    p = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    mb.face([(x, y, z0 + h) for x, y in p], top)
    for a, c in ((0, 1), (1, 2), (2, 3), (3, 0)):
        mb.face([(*p[a], z0), (*p[c], z0), (*p[c], z0 + h), (*p[a], z0 + h)], side)


def border():
    """Bordure d'un côté exposé, le long de X, posée à l'intérieur de la cellule : 10 triangles."""
    mb = MB()
    box(mb, 0.0, 0.0, CELL, 0.07, 0.13, WOOD, WOOD_TOP)
    return mb


def post():
    """Poteau d'angle centré sur le coin canonique (dédupliqué) : 10 triangles."""
    mb = MB()
    box(mb, -0.06, -0.06, 0.06, 0.06, 0.19, POST, POST_TOP)
    return mb


def blade(mb, ang, length, width, height, base_col, tip_col, z0=0.0):
    """Feuille en losange inclinée vers l'extérieur, face visible du dessus : 2 triangles."""
    d = Vector((math.cos(ang), math.sin(ang), 0))
    n = Vector((-d.y, d.x, 0))
    base = Vector((0, 0, z0))
    mid = d * (length * 0.45) + Vector((0, 0, z0 + height * 0.6))
    tip = d * length + Vector((0, 0, z0 + height))
    mb.face([base, mid - n * width, tip, mid + n * width], [base_col, base_col, tip_col, base_col])


def tuft_mature(seed=1):
    """Touffe mûre : 6 feuilles + 3 collets orange = 21 triangles, ~0,45 m de large."""
    mb, r = MB(), random.Random(seed)
    for k in range(6):
        a = k * math.tau / 6 + r.uniform(-0.25, 0.25)
        blade(mb, a, r.uniform(0.21, 0.27), 0.045, r.uniform(0.22, 0.3), LEAF_A if k % 2 else LEAF_B, LEAF_TIP)
    for k in range(3):
        a = k * math.tau / 3 + 0.5
        c = Vector((math.cos(a) * 0.055, math.sin(a) * 0.055, 0))
        q = [c + Vector((math.cos(a + i * math.tau / 3) * 0.035, math.sin(a + i * math.tau / 3) * 0.035, 0))
             for i in range(3)]
        top = c + Vector((0, 0, 0.035))
        for i in range(3):
            mb.face([q[i], q[(i + 1) % 3], top], ORANGE if i else ORANGE_DARK)
    return mb


def tuft_sprout(seed=2):
    """Semis : trois pousses de deux feuilles = 12 triangles, lisible comme une ligne pointillée."""
    mb, r = MB(), random.Random(seed)
    for dx in (-0.16, 0.0, 0.16):
        sub = MB()
        for k in range(2):
            blade(sub, k * math.pi + r.uniform(-0.4, 0.4) + 0.8, 0.075, 0.022, 0.07, SPROUT, SPROUT_TIP)
        mb.add(sub, Matrix.Translation((dx, r.uniform(-0.03, 0.03), 0)))
    return mb


def tuft_young(seed=3):
    """Touffe jeune : 4 feuilles plus claires, pas encore de collet = 8 triangles."""
    mb, r = MB(), random.Random(seed)
    for k in range(4):
        a = k * math.tau / 4 + r.uniform(-0.3, 0.3)
        blade(mb, a, r.uniform(0.15, 0.19), 0.035, r.uniform(0.15, 0.2), LEAF_A, SPROUT_TIP)
    return mb


def crate():
    """Cagette pleine posée dans l'allée : caisse + tas orange + fanes = 22 triangles."""
    mb = MB()
    box(mb, -0.2, -0.13, 0.2, 0.13, 0.17, CRATE, CRATE_TOP)
    q = [(-0.17, -0.1, 0.17), (0.17, -0.1, 0.17), (0.17, 0.1, 0.17), (-0.17, 0.1, 0.17)]
    apex = (0.0, 0.0, 0.25)
    for i in range(4):
        mb.face([q[i], q[(i + 1) % 4], apex], ORANGE if i % 2 else ORANGE_DARK)
    for k in range(4):
        blade(mb, k * math.tau / 4 + 0.4, 0.16, 0.035, 0.16, LEAF_A, LEAF_TIP, z0=0.22)
    return mb


# ---------- assemblage ----------
def tuft_matrix(x, y, seed, scale=1.0):
    """Variation déterministe par emplacement, conservée d'un stade à l'autre."""
    r = random.Random(seed)
    return (Matrix.Translation((x + r.uniform(-0.04, 0.04), y + r.uniform(-0.03, 0.03), RIDGE_H))
            @ Matrix.Rotation(r.uniform(0, math.tau), 4, 'Z') @ Matrix.Scale(scale * r.uniform(0.9, 1.1), 4))


def parcel(cell, stage, tufts, cr, with_crate=True):
    """Contenu d'une cellule (sans bordure) dans le repère monde ; les 12 touffes poussent ensemble."""
    T = Matrix.Translation((cell[0] * CELL, cell[1] * CELL, 0))
    mb = MB()
    mb.add(soil(), T)
    for y in ROWS:
        mb.add(ridge(y), T)
    piece, scale = GROWTH[stage - 1]
    for k, (x, y) in enumerate((x, y) for y in ROWS for x in SLOTS):
        seed = cell[0] * 1000 + cell[1] * 100 + k
        mb.add(tufts[piece], T @ tuft_matrix(x, y, seed, scale))
    if stage == 7 and with_crate:
        mb.add(cr, T @ Matrix.Translation((2.12, 0.84, 0)) @ Matrix.Rotation(0.12, 4, 'Z'))
    return mb


def garden(cells, stages, borders=True, crates=True):
    """Jardin fusionné : bordures sur les seuls côtés exposés, poteaux dédupliqués."""
    tufts = {"semis": tuft_sprout(), "jeune": tuft_young(), "mure": tuft_mature()}
    cr, bd, ps = crate(), border(), post()
    mb = MB()
    for c in cells:
        mb.add(parcel(c, stages[c], tufts, cr, crates))
    if not borders:
        return mb
    S = set(cells)
    posts = set()
    for (cx, cy) in cells:
        ox, oy = cx * CELL, cy * CELL
        # (voisin, rotation, origine) : la bordure locale longe X à y=0, intérieur vers +Y
        sides = (((0, -1), 0, (ox, oy)), ((1, 0), math.pi / 2, (ox + CELL, oy)),
                 ((0, 1), math.pi, (ox + CELL, oy + CELL)), ((-1, 0), -math.pi / 2, (ox, oy + CELL)))
        for (dx, dy), rot, (px, py) in sides:
            if (cx + dx, cy + dy) in S:
                continue
            M = Matrix.Translation((px, py, 0)) @ Matrix.Rotation(rot, 4, 'Z')
            mb.add(bd, M)
            a = M @ Vector((0, 0, 0))
            b = M @ Vector((CELL, 0, 0))
            posts.add((round(a.x, 3), round(a.y, 3)))
            posts.add((round(b.x, 3), round(b.y, 3)))
    for (x, y) in sorted(posts):
        mb.add(ps, Matrix.Translation((x, y, 0)))
    return mb


def new_scene(name, world_from="V8 L_LOD0"):
    old = bpy.data.scenes.get(name)
    if old:
        for o in list(old.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.scenes.remove(old)
    sc = bpy.data.scenes.new(name)
    ref = bpy.data.scenes[world_from]
    sc.world = ref.world
    sc.render.engine = ref.render.engine
    sc.view_settings.view_transform = ref.view_settings.view_transform
    sc.render.resolution_x, sc.render.resolution_y = ref.render.resolution_x, ref.render.resolution_y
    return sc


def put(sc, name, mb):
    ob = bpy.data.objects.new(name, mb.build(name))
    sc.collection.objects.link(ob)
    return ob


def ortho_cam(sc, name, loc, rot, scale):
    cd = bpy.data.cameras.new(name)
    cd.type = 'ORTHO'
    cd.ortho_scale = scale
    co = bpy.data.objects.new(name, cd)
    co.location = loc
    co.rotation_euler = rot
    sc.collection.objects.link(co)
    sc.camera = co
    return co


def build():
    report = {}
    L = [(0, 0), (1, 0), (0, 1)]
    ref_cam = bpy.data.scenes["V8 L_LOD0"].camera

    for name, stages in (("plein", {c: 7 for c in L}), ("croissance", {(0, 0): 7, (1, 0): 4, (0, 1): 2})):
        sc = new_scene(f"OPUS L {name}")
        g = garden(L, stages)
        put(sc, f"OPUS_L_{name}", g)
        ortho_cam(sc, f"Cam OPUS L {name}", ref_cam.location.copy(), ref_cam.rotation_euler.copy(),
                  ref_cam.data.ortho_scale)
        report[f"L_{name}"] = g.tris()

    report["parcelle_pleine"] = garden([(0, 0)], {(0, 0): 7}).tris()
    report["parcelle_vide"] = garden([(0, 0)], {(0, 0): 1}).tris()
    report["pieces"] = {"sol": soil().tris(), "butte": ridge(1).tris(), "bordure": border().tris(),
                        "poteau": post().tris(), "touffe_mure": tuft_mature().tris(),
                        "touffe_jeune": tuft_young().tris(), "semis": tuft_sprout().tris(),
                        "cagette": crate().tris()}

    # sept stades vus du dessus, sans bordure comme les bakes V8
    sc = new_scene("OPUS sept stades")
    for s in range(1, 8):
        ob = put(sc, f"OPUS_stade_{s}", garden([(0, 0)], {(0, 0): s}, borders=False))
        ob.location.x = (s - 1) * CELL
    ortho_cam(sc, "Cam OPUS stades", Vector((3.5 * CELL, 1.25, 10)), (0, 0, 0), 7 * CELL)
    sc.render.resolution_x, sc.render.resolution_y = 7 * 256, 256

    sc = new_scene("OPUS kit")
    pieces = (("sol", soil()), ("butte", ridge(0.3)), ("bordure", border()), ("poteau", post()),
              ("touffe_mure", tuft_mature()), ("touffe_jeune", tuft_young()), ("semis", tuft_sprout()),
              ("cagette", crate()))
    for i, (n, mb) in enumerate(pieces):
        ob = put(sc, f"OPUS_{n}", mb)
        ob.location.x = i * 3.0
    return report


if __name__ in ("__main__", "opus_build"):
    print(build())
