"""Scierie au langage de la factory des bâtiments : maquette d'étude (Opus 5.5).

La scierie actuelle (sawmill-factory.ts) est un assemblage procédural de boîtes et de
cylindres aux couleurs unies. Cette maquette la redessine avec les pièces et matériaux de
la factory (timber-thatch.ts, building-plan.ts, stonemason-factory.ts) :
- fermes à poinçon de section 0,123 × 0,153, chanfrein de 10 %, pannes, planches de toit ;
- maçonnerie calcaire en modules 0,28 × 0,14 × 0,14, joints décalés, arêtes adoucies ;
- chêne clair veiné, rondins à écorce et bouts coupés clairs.

Une case de 2,5 m, comme aujourd'hui ; trois niveaux qui s'enrichissent sans déborder.
Axes Blender : x à droite, y vers le fond (z du jeu inversé), z en haut. L'atelier est
ouvert vers −y, la cour devant.

À lancer sans interface, depuis la racine du dépôt :
  blender --background --factory-startup --python blender-elements/scierie/sources/scierie.py
Écrit scierie.blend et les aperçus de previews/.
"""
import math, os, random
import bpy
from mathutils import Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(KIT, "..", ".."))
ns = {"__name__": "villageois"}
with open(os.path.join(ROOT, "blender-elements", "villageois", "sources", "build_villageois.py"), encoding="utf-8") as f:
    exec(compile(f.read(), "build_villageois.py", "exec"), ns)
hexc = ns["hexc"]

CELL = 2.5


# ---------- matériaux ----------
def lin(c):
    return tuple(x ** 2.2 for x in c)


def mat_grain(name, light, dark, stretch=(2.0, 40.0, 40.0), scale=3.0, rough=0.85):
    """Fibres allongées selon l'axe x local de chaque pièce (pièces construites selon x)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = stretch
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 4
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (*lin(dark), 1)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = (*lin(light), 1)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def mat_flat(name, colour, rough=0.9, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*lin(colour), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


OAK = mat_grain("chene", hexc("c39d6c"), hexc("9a7651"))
BOARDS = mat_grain("planches toit", hexc("c8a97f"), hexc("a0825d"))
DARK_OAK = mat_grain("chene sombre", hexc("8a6644"), hexc("6b4d32"))
STONE = mat_grain("calcaire", hexc("efece4"), hexc("d6d2c6"), stretch=(6, 6, 6), scale=4)
MORTAR = mat_flat("mortier", hexc("a7a091"))
BARK = mat_grain("ecorce", hexc("6b4a2e"), hexc("4a3220"), stretch=(3, 25, 25), scale=4)
CUT = mat_flat("bois coupe", hexc("d9b783"))
STEEL = mat_flat("acier", hexc("9aa0a6"), rough=0.45, metal=0.6)
ROPE = mat_flat("corde", hexc("b9a273"))
EARTH = mat_flat("terre battue", hexc("8a7350"))
SAWDUST = mat_flat("sciure", hexc("d6bd8c"))
GRASS = mat_flat("herbe", hexc("4c7234"))
# Couleurs de la scierie actuelle (BabylonVillageScene.ts)
LEGACY = {k: mat_flat(f"actuel {k}", hexc(v)) for k, v in dict(
    timber="794521", light="a8672f", dark="402718", roof="5d3226", stone="686a5f",
    earth="4f5839", sawdust="806b3d", trunk="523620").items()}


# ---------- géométrie ----------
class Scene:
    def __init__(self, sc, origin=(0, 0)):
        self.sc, self.origin = sc, Vector((origin[0], origin[1], 0))

    def obj(self, name, verts, faces, mats, idx=None, loc=(0, 0, 0), quat=None, bevel=0.0, segments=1):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in verts], [], faces)
        for m in mats:
            me.materials.append(m)
        if idx:
            for poly, i in zip(me.polygons, idx):
                poly.material_index = i
        me.update()
        o = bpy.data.objects.new(name, me)
        o.location = Vector(loc) + self.origin
        if quat:
            o.rotation_mode = 'QUATERNION'
            o.rotation_quaternion = quat
        if bevel > 0:
            b = o.modifiers.new("chanfrein", 'BEVEL')
            b.width = bevel
            b.segments = segments
            b.limit_method = 'ANGLE'
        self.sc.collection.objects.link(o)
        return o


def box_mesh(L, w, h, cx=0.0, cy=0.0, cz=0.0):
    x0, x1, y0, y1, z0, z1 = cx - L / 2, cx + L / 2, cy - w / 2, cy + w / 2, cz - h / 2, cz + h / 2
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return v, f


def orient(d, roll=0.0):
    d = d.normalized()
    q = d.to_track_quat('X', 'Y' if abs(d.z) > 0.99 else 'Z')
    return q @ Quaternion((1, 0, 0), roll)


def beam(S, name, a, b, w, h, mat=OAK, roll=0.0, chamfer=0.1):
    """Pièce équarrie de a à b ; w horizontal, h vertical (avant roulis), chanfrein de la factory."""
    a, b = Vector(a), Vector(b)
    v, f = box_mesh((b - a).length, w, h)
    return S.obj(name, v, f, [mat], loc=(a + b) / 2, quat=orient(b - a, roll), bevel=min(w, h) * chamfer)


def block(S, name, centre, size, mat=OAK, chamfer=0.1, quat=None):
    v, f = box_mesh(*size)
    return S.obj(name, v, f, [mat], loc=centre, quat=quat, bevel=min(size) * chamfer)


def log(S, name, a, b, r, n=10, bark=BARK, cut=CUT, seed=0):
    """Rondin à 10 facettes : écorce sur les côtés, bois clair aux bouts."""
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    rng = random.Random(seed)
    verts, faces, idx = [], [], []
    for end in (-L / 2, L / 2):
        for i in range(n):
            ang = i * math.tau / n
            rr = r * rng.uniform(0.94, 1.04)
            verts.append((end, rr * math.cos(ang), rr * math.sin(ang)))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
        idx.append(0)
    faces.append(tuple(range(n - 1, -1, -1)))
    idx.append(1)
    faces.append(tuple(range(n, 2 * n)))
    idx.append(1)
    return S.obj(name, verts, faces, [bark, cut], idx, loc=(a + b) / 2, quat=orient(b - a, rng.uniform(0, 1)))


def disc(S, name, centre, r, h, mat, n=14, axis='z'):
    verts, faces = [], []
    for z in (-h / 2, h / 2):
        for i in range(n):
            a = i * math.tau / n
            verts.append((r * math.cos(a), r * math.sin(a), z))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    faces += [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    quat = None if axis == 'z' else orient(Vector((1, 0, 0)) if axis == 'x' else Vector((0, 1, 0))) @ Quaternion((0, 1, 0), math.pi / 2)
    return S.obj(name, verts, faces, [mat], loc=centre, quat=quat)


def patch(S, name, centre, rx, ry, mat, z=0.004, n=12, seed=0, rot=0.0):
    rng = random.Random(seed)
    pts = []
    for i in range(n):
        a = i * math.tau / n
        k = rng.uniform(0.85, 1.12)
        x, y = rx * k * math.cos(a), ry * k * math.sin(a)
        pts.append((x * math.cos(rot) - y * math.sin(rot), x * math.sin(rot) + y * math.cos(rot), z))
    return S.obj(name, pts, [tuple(range(n))], [mat], loc=centre)


def masonry(S, name, a, b, z0, courses, thick=0.14, module=(0.28, 0.14), joint=0.008, seed=0):
    """Mur de blocs calcaires en assises décalées, de a à b (au sol), joints creux sur mortier."""
    a, b = Vector((*a, 0)), Vector((*b, 0))
    L = (b - a).length
    rng = random.Random(seed)
    verts, faces = [], []
    for row in range(courses):
        x = -L / 2
        first = module[0] / 2 if row % 2 else module[0]
        while x < L / 2 - 0.001:
            ln = min(first if x == -L / 2 else module[0], L / 2 - x)
            jitter = rng.uniform(-0.004, 0.004)
            v, f = box_mesh(ln - joint, thick + jitter, module[1] - joint, x + ln / 2, 0, z0 + (row + 0.5) * module[1])
            base = len(verts)
            verts += v
            faces += [tuple(base + i for i in face) for face in f]
            x += ln
    d = b - a
    q = orient(d)
    wall = S.obj(name, verts, faces, [STONE], loc=(a + b) / 2, quat=q, bevel=module[1] * 0.12, segments=2)
    mv, mf = box_mesh(L - 0.01, thick - 0.03, courses * module[1] - 0.01, 0, 0, z0 + courses * module[1] / 2)
    S.obj(f"{name} mortier", mv, mf, [MORTAR], loc=(a + b) / 2, quat=q)
    return wall


# ---------- scierie au langage de la factory ----------
HALF, Y0, Y1 = 0.86, -0.2, 1.02          # demi-portée, pignon ouvert, fond
EAVE, SLOPE = 1.22, math.radians(25)      # sablière et pente du tailleur de pierres
TIE_W, TIE_H, PURLIN, PLANK = 0.123, 0.153, 0.07, 0.038


RIDGE = EAVE + HALF * math.tan(SLOPE)
SPAN = HALF / math.cos(SLOPE)


def on_slope(side, dist, offset, y):
    return Vector((side * (dist * math.cos(SLOPE) + offset * math.sin(SLOPE)),
                   y, RIDGE - dist * math.sin(SLOPE) + offset * math.cos(SLOPE)))


def truss(S, tag, k, y):
    """Ferme à poinçon dans le plan y : entrait, arbalétriers, contrefiches, poinçon."""
    fh = TIE_H / 2
    parts = [beam(S, f"{tag} entrait {k}", (-HALF - 0.08, y, EAVE), (HALF + 0.08, y, EAVE), TIE_W, TIE_H)]
    for side in (-1, 1):
        parts.append(beam(S, f"{tag} arbaletrier {k} {side}", (side * (HALF + 0.06), y, EAVE - 0.02), (0, y, RIDGE + 0.02), TIE_W, TIE_H))
        # contrefiche du poinçon vers le milieu de l'arbalétrier
        mid = on_slope(side, SPAN * 0.5, -fh, y)
        parts.append(beam(S, f"{tag} contrefiche {k} {side}", (0, y, EAVE + 0.14), mid, TIE_W * 0.8, TIE_H * 0.7))
    parts.append(beam(S, f"{tag} poincon {k}", (0, y, EAVE), (0, y, RIDGE + 0.04), TIE_W, TIE_H))
    return parts


def roof(S, tag, trusses, overhang_y=(0.2, 0.18), overhang_x=0.22, lantern=False, raised=None, purlins=True,
         cover=(1.0, 1.0)):
    """Charpente et couverture ; `raised`, `purlins` et `cover` (part des planches par versant) servent au chantier."""
    ridge, fh, span = RIDGE, TIE_H / 2, SPAN
    for k, y in enumerate(trusses):
        if raised is None or k in raised:
            truss(S, tag, k, y)
    if not purlins:
        return ridge
    ya, yb = trusses[0] - overhang_y[0], trusses[-1] + overhang_y[1]
    # faîtière et pannes, posées sur les arbalétriers
    for dist in (0.0, span * 0.5, span * 0.95):
        for side in ((1,) if dist == 0 else (-1, 1)):
            p = on_slope(side, dist, fh + PURLIN / 2, 0)
            beam(S, f"{tag} panne {dist:.2f} {side}", (p.x, ya, p.z), (p.x, yb, p.z), PURLIN, PURLIN,
                 roll=-side * SLOPE if dist else 0)
    # planches de couverture, dans le sens de la pente, longueurs décalées au bord
    edge = (HALF + overhang_x) / math.cos(SLOPE)
    n = round((yb - ya) / 0.14)
    w = (yb - ya) / n
    rng = random.Random(len(tag))
    for side in (-1, 1):
        for i in range(n):
            if i >= n * cover[0 if side < 0 else 1]:
                continue
            y = ya + (i + 0.5) * w
            a = on_slope(side, 0.0 if side < 0 else -0.02, fh + PURLIN + PLANK / 2, y)
            b = on_slope(side, edge - rng.uniform(0, 0.03), fh + PURLIN + PLANK / 2, y)
            if lantern and abs(y - (ya + yb) / 2) < 0.31:
                a = on_slope(side, 0.34, fh + PURLIN + PLANK / 2, y)
            beam(S, f"{tag} planche {side} {i}", a, b, w - 0.006, PLANK, BOARDS, roll=side * SLOPE)
    # couvre-faîte
    top = on_slope(1, 0, fh + PURLIN + PLANK + 0.01, 0)
    if min(cover) < 1:
        return ridge
    if not lantern:
        for side in (-1, 1):
            beam(S, f"{tag} faitage {side}", (side * 0.05, ya, top.z - 0.01), (side * 0.05, yb, top.z - 0.01), 0.12, 0.03, BOARDS,
                 roll=side * SLOPE)
    else:
        # lanterne d'aération : petit toit surélevé au milieu du faîtage
        yc, lh = (ya + yb) / 2, 0.26
        for sx in (-0.3, 0.3):
            for sy in (-0.3, 0.3):
                base = on_slope(1 if sx > 0 else -1, 0.34, fh, yc + sy)
                beam(S, f"{tag} lanterne montant {sx} {sy}", (sx, yc + sy, base.z), (sx, yc + sy, ridge + lh), 0.06, 0.06)
        lr = ridge + lh
        ys = (yc - 0.42, yc + 0.42)
        for side in (-1, 1):
            for i in range(6):
                y = ys[0] + (i + 0.5) * (ys[1] - ys[0]) / 6
                a = Vector((-side * 0.02, y, lr + 0.03 + 0.5 * math.tan(SLOPE)))
                b = Vector((side * 0.5, y, lr + 0.03))
                beam(S, f"{tag} lanterne planche {side} {i}", a, b, (ys[1] - ys[0]) / 6 - 0.006, PLANK, BOARDS, roll=side * SLOPE)
            beam(S, f"{tag} lanterne sabliere {side}", (side * 0.3, ys[0] + 0.06, lr), (side * 0.3, ys[1] - 0.06, lr), 0.06, 0.06)
            # persiennes : lames inclinées entre le toit et la lanterne, l'air passe, la pluie non
            base = on_slope(side, 0.34, fh + PURLIN + PLANK, 0).z
            for k in range(3):
                z = base + 0.05 + k * (lr - base - 0.04) / 3
                beam(S, f"{tag} persienne {side} {k}", (side * 0.31, yc - 0.3, z), (side * 0.31, yc + 0.3, z), 0.075, 0.016, BOARDS,
                     roll=side * 0.6)
        for y in (yc - 0.3, yc + 0.3):
            beam(S, f"{tag} lanterne entrait {y}", (-0.33, y, lr), (0.33, y, lr), 0.06, 0.07)
    return ridge


def frame(S, tag, trusses, braces=True, posts=True, plates=True):
    for k, y in enumerate(trusses):
        for side in (-1, 1):
            x = side * HALF
            block(S, f"{tag} de pierre {k} {side}", (x, y, 0.05), (0.2, 0.2, 0.1), STONE, chamfer=0.15)
            if not posts:
                continue
            beam(S, f"{tag} poteau {k} {side}", (x, y, 0.1), (x, y, EAVE - TIE_H / 2), 0.14, 0.14)
            if braces:
                beam(S, f"{tag} aisselier {k} {side}", (x, y, EAVE - 0.38), (x - side * 0.3, y, EAVE - TIE_H / 2), 0.08, 0.08)
    if not plates:
        return
    for side in (-1, 1):  # sablières longitudinales
        beam(S, f"{tag} sabliere {side}", (side * HALF, trusses[0] - 0.1, EAVE + 0.01), (side * HALF, trusses[-1] + 0.1, EAVE + 0.01), 0.12, 0.12)


def trestle(S, tag, x, y, top=0.46, length=0.5, along='y'):
    d = Vector((0, 1, 0)) if along == 'y' else Vector((1, 0, 0))
    side = Vector((1, 0, 0)) if along == 'y' else Vector((0, 1, 0))
    c = Vector((x, y, top))
    beam(S, f"{tag} chevalet", c - d * length / 2, c + d * length / 2, 0.08, 0.08)
    for s in (-1, 1):
        for e in (-0.35, 0.35):
            foot = c + d * e * length + side * s * 0.2
            beam(S, f"{tag} pied {s} {e}", (foot.x, foot.y, 0), c + d * e * length * 0.8 + Vector((0, 0, -0.02)), 0.05, 0.05)


def log_pile(S, tag, x, y, rows, length=1.0, r=0.1, along='x', seed=0):
    d = Vector((1, 0, 0)) if along == 'x' else Vector((0, 1, 0))
    side = Vector((0, 1, 0)) if along == 'x' else Vector((1, 0, 0))
    c = Vector((x, y, 0))
    for s in (-0.32, 0.32):  # deux traverses au sol
        a = c + d * s * length - side * (rows[0] * r + 0.06)
        b = c + d * s * length + side * (rows[0] * r + 0.06)
        beam(S, f"{tag} traverse {s}", (a.x, a.y, 0.035), (b.x, b.y, 0.035), 0.07, 0.07, DARK_OAK)
    k = 0
    for row, count in enumerate(rows):
        for i in range(count):
            off = (i - (count - 1) / 2) * 2 * r
            z = 0.07 + r + row * r * 1.72
            p = c + side * off + Vector((0, 0, z))
            jitter = d * random.Random(seed + k).uniform(-0.06, 0.06)
            log(S, f"{tag} rondin {k}", p - d * length / 2 + jitter, p + d * length / 2 + jitter, r, seed=seed + k)
            k += 1


def plank_stack(S, tag, x, y, layers, length=0.9, per_layer=5, cover=True, seed=0):
    """Pile de séchage : planches espacées, lattes croisées à chaque lit, planches de couverture."""
    pw, pt = 0.12, 0.028
    width = per_layer * (pw + 0.025)
    for s in (-0.38, 0.0, 0.38):
        beam(S, f"{tag} cale {s}", (x + s * length, y - width / 2, 0.04), (x + s * length, y + width / 2, 0.04), 0.08, 0.08, DARK_OAK)
    z = 0.08
    rng = random.Random(seed)
    for layer in range(layers):
        for i in range(per_layer):
            yy = y - width / 2 + (i + 0.5) * (pw + 0.025)
            j = rng.uniform(-0.04, 0.04)
            beam(S, f"{tag} planche {layer} {i}", (x - length / 2 + j, yy, z + pt / 2), (x + length / 2 + j, yy, z + pt / 2), pw, pt, OAK)
        z += pt
        if layer < layers - 1 or cover:
            for s in (-0.38, 0.0, 0.38):
                beam(S, f"{tag} latte {layer} {s}", (x + s * length, y - width / 2, z + 0.01), (x + s * length, y + width / 2, z + 0.01), 0.025, 0.02, DARK_OAK)
            z += 0.02
    if cover:
        for i in range(3):
            yy = y - width / 2 + (i + 0.5) * width / 3
            beam(S, f"{tag} couverture {i}", (x - length / 2 - 0.04, yy, z + 0.02), (x + length / 2 + 0.04, yy, z + 0.035), width / 3 - 0.01, 0.025, BOARDS)


def pit_saw(S, tag):
    """Niveau 1 : grume sur deux chevalets, scie de long engagée dans le trait."""
    trestle(S, f"{tag} chevalet avant", 0.0, 0.12, along='x')
    trestle(S, f"{tag} chevalet fond", 0.0, 0.78, along='x')
    log(S, f"{tag} grume", (0, -0.1, 0.6), (0, 1.0, 0.6), 0.13, seed=3)
    # scie de long : lame dans le trait, une poignée de chaque côté
    yc = 0.45
    beam(S, f"{tag} lame", (-0.42, yc, 0.73), (0.42, yc, 0.73), 0.012, 0.06, STEEL, chamfer=0.0)
    for s in (-1, 1):
        beam(S, f"{tag} poignee {s}", (s * 0.44, yc - 0.12, 0.73), (s * 0.44, yc + 0.12, 0.73), 0.03, 0.03, DARK_OAK)
    patch(S, f"{tag} sciure", (0.0, 0.45, 0), 0.32, 0.22, SAWDUST, seed=4)


def frame_saw(S, tag):
    """Niveaux 2 et 3 : scie à cadre (lames verticales) et chariot sur rails, grume à moitié débitée."""
    ys = 0.42  # plan des lames
    for s in (-1, 1):
        beam(S, f"{tag} guide {s}", (s * 0.34, ys, 0.0), (s * 0.34, ys, 1.12), 0.1, 0.1)
        beam(S, f"{tag} lisse basse {s}", (s * 0.34, ys - 0.22, 0.05), (s * 0.34, ys + 0.22, 0.05), 0.08, 0.08, DARK_OAK)
    beam(S, f"{tag} chapeau", (-0.42, ys, 1.12), (0.42, ys, 1.12), 0.1, 0.12)
    # châssis porte-lames
    for s in (-1, 1):
        beam(S, f"{tag} montant cadre {s}", (s * 0.24, ys, 0.3), (s * 0.24, ys, 0.98), 0.05, 0.05)
    for z in (0.3, 0.98):
        beam(S, f"{tag} traverse cadre {z}", (-0.28, ys, z), (0.28, ys, z), 0.05, 0.06)
    for x in (-0.07, 0.0, 0.07):
        beam(S, f"{tag} lame {x}", (x, ys, 0.32), (x, ys, 0.96), 0.004, 0.035, STEEL, roll=math.pi / 2, chamfer=0.0)
    # rails du chariot, sur traverses
    for x in (-0.13, 0.13):
        beam(S, f"{tag} rail {x}", (x, -0.62, 0.3), (x, 1.0, 0.3), 0.06, 0.07, DARK_OAK)
    for y in (-0.5, 0.15, 0.8):
        beam(S, f"{tag} support {y}", (-0.2, y, 0.13), (0.2, y, 0.13), 0.08, 0.26, DARK_OAK)
    # grume entière avant les lames, planches débitées après
    log(S, f"{tag} grume", (0, -0.6, 0.47), (0, ys - 0.02, 0.47), 0.13, seed=7)
    for k, x in enumerate((-0.105, -0.035, 0.035, 0.105)):
        outer = abs(x) > 0.1
        h = 0.2 if not outer else 0.13
        sl = beam(S, f"{tag} debit {k}", (x, ys + 0.01, 0.47), (x, 0.98, 0.47), h, 0.064, BARK if outer else OAK,
                  roll=math.pi / 2, chamfer=0.0)
    patch(S, f"{tag} sciure", (0.0, 0.35, 0), 0.42, 0.3, SAWDUST, seed=8)
    patch(S, f"{tag} sciure 2", (0.38, 0.62, 0), 0.18, 0.12, SAWDUST, seed=9)


def hoist(S, tag, x, y):
    """Niveau 3 : chèvre de levage à trois perches au-dessus des grumes."""
    apex = Vector((x + 0.08, y + 0.12, 1.55))
    for k in range(3):
        a = k * math.tau / 3 + 0.4
        foot = Vector((x + 0.08 + 0.4 * math.cos(a), y + 0.12 + 0.4 * math.sin(a), 0))
        log(S, f"{tag} perche {k}", foot, apex + (apex - foot).normalized() * 0.08, 0.035, n=8, seed=20 + k)
    disc(S, f"{tag} poulie", apex - Vector((0, 0, 0.12)), 0.06, 0.03, DARK_OAK, axis='x')
    beam(S, f"{tag} corde", apex - Vector((0, 0, 0.12)), (x, y, 0.42), 0.012, 0.012, ROPE, chamfer=0.0)
    beam(S, f"{tag} crochet", (x, y, 0.44), (x, y, 0.36), 0.03, 0.03, STEEL, chamfer=0.0)


# Mur du fond en calcaire, à tous les niveaux : il abrite l'atelier et sert d'appui sur le chantier.
WALL_A, WALL_B, WALL_COURSES = (-HALF - 0.07, Y1 + 0.09), (HALF + 0.07, Y1 + 0.09), 6


def sawmill(sc, level, origin):
    """Scierie de niveau 1 à 3 sur une case de 2,5 m centrée sur `origin`."""
    S = Scene(sc, origin)
    tag = f"scierie {level}"
    patch(S, f"{tag} cour", (0.0, 0.0, 0), 1.24, 1.2, EARTH, z=0.002, n=16, seed=level)
    trusses = [Y0, (Y0 + Y1) / 2, Y1]
    frame(S, tag, trusses)
    roof(S, tag, trusses, lantern=level >= 3)
    masonry(S, f"{tag} mur fond", WALL_A, WALL_B, 0.0, WALL_COURSES, seed=level)
    if level == 1:
        pit_saw(S, tag)
        log_pile(S, f"{tag} grumes", -0.55, -0.78, [2, 1], length=0.95, seed=30)
        plank_stack(S, f"{tag} planches", 0.62, -0.72, 2, length=0.8, per_layer=3, cover=False, seed=31)
    else:
        masonry(S, f"{tag} muret gauche", (-HALF - 0.09, Y0 + 0.12), (-HALF - 0.09, Y1 + 0.02), 0.0, 3, seed=10 + level)
        frame_saw(S, tag)
        log_pile(S, f"{tag} grumes", -0.52, -0.82, [3, 2] if level == 2 else [3, 2, 1], length=1.0, seed=40)
        plank_stack(S, f"{tag} planches", 0.6, -0.74, 3 if level == 2 else 4, length=0.86, per_layer=4, seed=41)
    if level >= 3:
        hoist(S, tag, -0.52, -0.82)
        plank_stack(S, f"{tag} planches 2", 1.06, 0.38, 3, length=0.7, per_layer=2, cover=False, seed=42)


# ---------- scierie actuelle, portée depuis sawmill-factory.ts (repère du jeu) ----------
def legacy(sc, level, origin):
    S = Scene(sc, origin)
    tag = f"actuelle {level}"
    g = lambda x, y, z: Vector((x, -z, y + 0.09))  # jeu → Blender, socle à 0,09
    L = LEGACY

    def gbox(name, w, h, d, x, y, z, mat, rot_z=0.0, rot_y=0.0):
        v, f = box_mesh(w, d, h)
        q = Quaternion((0, 0, 1), -rot_y) @ Quaternion((0, 1, 0), -rot_z)
        return S.obj(f"{tag} {name}", v, f, [mat], loc=g(x, y, z), quat=q)

    def gcyl(name, a, b, r, mat, n=8):
        a, b = Vector(a), Vector(b)
        verts, faces = [], []
        ln = (b - a).length
        for e in (-ln / 2, ln / 2):
            for i in range(n):
                t = i * math.tau / n
                verts.append((e, r * math.cos(t), r * math.sin(t)))
        for i in range(n):
            faces.append((i, (i + 1) % n, n + (i + 1) % n, n + i))
        faces += [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
        return S.obj(f"{tag} {name}", verts, faces, [mat], loc=(a + b) / 2, quat=orient(b - a))

    gbox("socle", 2.28, 0.16, 2.02, 0, 0, 0, L["stone"])
    for x, z, dia, sx, m, rot in ((-0.12, 0.06, 2.82, 1.08, "earth", 0.18), (0.92, -0.6, 0.88, 1.3, "sawdust", -0.34),
                                  (-1.02, 0.72, 0.92, 1.42, "earth", 0.52)):
        patch(S, f"{tag} cour {x}", g(x, -0.068, z) - Vector((0, 0, 0.0)), dia / 2 * sx, dia / 2, L[m], z=0, n=9, seed=1, rot=-rot)
    gbox("interieur", 1.62, 1.02, 0.12, 0, 0.62, 0.72, L["dark"])
    gbox("mur gauche", 0.13, 1.0, 1.38, -0.81, 0.6, 0.04, L["timber"])
    gbox("mur droit", 0.13, 0.68, 1.38, 0.81, 0.44, 0.04, L["timber"])
    fr = (lambda n, a, b, r: gbox(n, *b, L["dark"])) if False else None
    for x in (-0.9, 0.9):
        for z in (-0.76, 0.76):
            if level > 1:
                gbox(f"poteau {x} {z}", 0.14, 1.46, 0.14, x, 0.78, z, L["dark"])
            else:
                gcyl(f"poteau {x} {z}", g(x, 0.05, z), g(x, 1.51, z), 0.07, L["dark"], 10)
    for z in (-0.76, 0.76):
        if level > 1:
            gbox(f"poutre {z}", 2.0, 0.15, 0.15, 0, 1.46, z, L["dark"])
        else:
            gcyl(f"poutre {z}", g(-1.0, 1.46, z), g(1.0, 1.46, z), 0.075, L["dark"], 10)
    if level > 1:
        gbox("faitiere", 0.14, 0.14, 2.28, 0, 1.88, 0, L["dark"])
    else:
        gcyl("faitiere", g(0, 1.88, -1.14), g(0, 1.88, 1.14), 0.07, L["dark"], 10)
    gbox("toit gauche", 1.3, 0.13, 2.34, -0.54, 1.65, 0, L["roof"], rot_z=0.5)
    gbox("toit droit", 1.3, 0.13, 2.34, 0.54, 1.65, 0, L["roof"], rot_z=-0.5)
    gbox("plateforme", 1.48, 0.12, 0.54, -0.06, 0.1, -0.94, L["timber"])
    gbox("banc", 1.18, 0.12, 0.4, 0.14, 0.59, -0.47, L["light"])
    for x in (-0.39, 0.67):
        gbox(f"pied {x}", 0.1, 0.48, 0.1, x, 0.34, -0.47, L["dark"])
    disc(S, f"{tag} lame", g(0.12, 0.77, -0.47), 0.25, 0.055, L["stone"], n=12, axis='x')
    for i in range(4):
        x, y, ln = -1.04 + (i % 2) * 0.22, 0.18 + (i // 2) * 0.2, 1.22 - (i % 2) * 0.12
        gcyl(f"grume {i}", g(x, y, 0.34 - ln / 2), g(x, y, 0.34 + ln / 2), 0.11, L["light"])
    c = g(1.18, 0.08, 0.83)
    gcyl("souche", c - Vector((0, 0, 0.14)), c + Vector((0, 0, 0.14)), 0.23, L["trunk"], 9)
    if level >= 2:
        gbox("appentis toit", 1.12, 0.11, 1.92, 1.26, 1.09, 0.08, L["roof"], rot_z=-0.2)
        for z in (-0.72, 0.78):
            gbox(f"appentis poteau {z}", 0.11, 0.98, 0.11, 1.68, 0.52, z, L["dark"])
        gbox("sechoir", 0.14, 0.72, 1.42, 1.42, 0.47, 0.04, L["dark"])
        for y in (0.3, 0.55, 0.8):
            gcyl(f"bois seche {y}", g(1.38, y, 0.04 - 0.64), g(1.38, y, 0.04 + 0.64), 0.07, L["light"])
    if level >= 3:
        gbox("lanterne", 0.68, 0.34, 0.7, 0, 2.01, 0.26, L["dark"])
        gbox("lanterne toit g", 0.5, 0.09, 0.86, -0.2, 2.27, 0.26, L["roof"], rot_z=0.44)
        gbox("lanterne toit d", 0.5, 0.09, 0.86, 0.2, 2.27, 0.26, L["roof"], rot_z=-0.44)
        gbox("palan", 0.12, 0.12, 1.18, 0.6, 1.38, -1.24, L["dark"], rot_y=-0.18)
    for x, z, s in ((-1.4, -0.82, 0.18), (1.36, -0.96, 0.14), (-1.28, 1.02, 0.12)):
        block(S, f"{tag} caillou {x}", g(x, s * 0.45 - 0.06, z), (s * 1.6, s * 1.6, s), L["stone"], chamfer=0.3)


# ---------- scènes et rendus ----------
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
    bg.inputs[0].default_value = (*lin(hexc("9fb3bf")), 1)
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
    S = Scene(sc)
    S.obj(f"{name} sol", [(-40, -40, -0.001), (40, -40, -0.001), (40, 40, -0.001), (-40, 40, -0.001)], [(0, 1, 2, 3)], [GRASS])
    return sc


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


RIGHT = Vector((math.cos(0.588), math.sin(0.588), 0))
# Importé par chantier.py (SCIERIE_LIB) : pièces et fonctions seulement, sans rendu.
if not globals().get("SCIERIE_LIB"):
    RIGHT = Vector((math.cos(0.588), math.sin(0.588), 0))
    out = os.path.join(KIT, "previews")
    os.makedirs(out, exist_ok=True)
    look = [dict(skin=0, clothes=1, hair=1), dict(skin=1, clothes=3, hair=0), dict(skin=2, clothes=0, hair=2)]

    for style, build in (("actuelle", legacy), ("factory", sawmill)):
        sc = stage(f"SCIERIE {style}")
        for level in (1, 2, 3):
            at = RIGHT * ((level - 2) * 3.6)
            build(sc, level, (at.x, at.y))
            # devant la pile de grumes, dans la cour (la pile occupe y de −1,02 à −0,62)
            ns["build_figurine"](sc, f"{style} {level} scieur", (at.x - 0.3, at.y - 1.18, 0), 0.3, "repos", look[level - 1], "bonnet", "court")
        render(sc, (0, 0, 0.8), 11.5, (1200, 520), os.path.join(out, f"{style}-niveaux.png"))
        render(sc, (RIGHT * 3.6).to_tuple()[:2] + (0.8,), 4.6, (900, 700), os.path.join(out, f"{style}-niveau-3-proche.png"))

    # zoom moyen du jeu (villageois de 17 px) : actuelle et factory côte à côte, niveau 2
    sc = stage("SCIERIE zoom moyen")
    legacy(sc, 2, (-2.0, 1.0))
    sawmill(sc, 2, (2.2, -1.4))
    for k, at in enumerate(((-1.6, -0.4), (1.9, -2.6), (3.55, -1.9))):
        ns["build_figurine"](sc, f"zoom {k}", (*at, 0), 0.4 * k, "repos", look[k], "bonnet", "court")
    render(sc, (0.2, -0.2, 0.5), 24.6, (640, 400), os.path.join(out, "zoom-moyen.png"))

    def triangles(scene, prefix):
        """Triangles après chanfreins (modificateurs évalués), comme une fois exportés."""
        sc = bpy.data.scenes[scene]
        deps = sc.view_layers[0].depsgraph
        total = 0
        for o in sc.objects:
            if o.type == 'MESH' and o.name.startswith(prefix):
                me = o.evaluated_get(deps).to_mesh()
                me.calc_loop_triangles()
                total += len(me.loop_triangles)
                o.evaluated_get(deps).to_mesh_clear()
        return total


    print("triangles", {f"factory {lv}": triangles("SCIERIE factory", f"scierie {lv} ") for lv in (1, 2, 3)},
          {f"actuelle {lv}": triangles("SCIERIE actuelle", f"actuelle {lv} ") for lv in (1, 2, 3)})

    for name in [s.name for s in bpy.data.scenes if not s.name.startswith("SCIERIE")]:
        if len(bpy.data.scenes) > 1:
            bpy.data.scenes.remove(bpy.data.scenes[name])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(KIT, "scierie.blend"), copy=True, compress=True)
    print("ok")
