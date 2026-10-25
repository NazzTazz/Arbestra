"""Villageois : reproduction de la figure actuelle et proposition « figurine » (Opus 5.5).

Exécuter dans Blender avec, dans le même espace de noms, `GARDEN` = chemin de
../../contre-proposition-opus/sources/build_opus.py (pour la parcelle de décor).
Crée les scènes VIL actuel et VIL proposition sans toucher aux autres scènes.
Coordonnées Blender : Z haut, le villageois regarde vers -Y, racine au sol.
"""
import bpy, math
from mathutils import Vector, Matrix

# Palette du jeu (apps/world-web/src/scene/worker-figure.ts, WORKER_COLOURS)
def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

SKIN = [hexc(c) for c in ("e2ba94", "b98157", "684532")]
CLOTHES = [hexc(c) for c in ("42604a", "526e86", "b69a4c", "a95f47", "d9cfb4")]
HAIR = [hexc(c) for c in ("2d231e", "745039", "c4a364")]
PANTS = hexc("4b4033")
TIMBER, STONE = hexc("7a5532"), hexc("8d8f8c")
WHITE = (1.0, 1.0, 1.0)


def mul(a, b):
    return tuple(x * y for x, y in zip(a, b))


def lit_material():
    m = bpy.data.materials.get("VIL_lit")
    if m:
        return m
    m = bpy.data.materials.new("VIL_lit")
    m.use_nodes = True
    m.use_backface_culling = True
    nt = m.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 1.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = "Col"
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(col.outputs[0], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    return m


class Part:
    """Maillage d'une pièce rigide ; couleurs = multiplicateur (teinte de l'instance) ou absolues."""

    def __init__(self):
        self.v, self.f, self.c = [], [], []

    def face(self, pts, col):
        i = len(self.v)
        self.v += [Vector(p) for p in pts]
        self.f.append(tuple(range(i, i + len(pts))))
        self.c.append(col if isinstance(col, list) else [col] * len(pts))

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def add(self, other, mat=Matrix.Identity(4)):
        for idx, cols in zip(other.f, other.c):
            self.face([mat @ other.v[i] for i in idx], cols)
        return self

    def build(self, name, tint=WHITE):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.v], [], self.f)
        me.update()
        ca = me.color_attributes.new("Col", 'BYTE_COLOR', 'CORNER')
        for poly, cols in zip(me.polygons, self.c):
            for li, col in zip(poly.loop_indices, cols):
                c = mul(col, tint)
                ca.data[li].color_srgb = (min(1, c[0]), min(1, c[1]), min(1, c[2]), 1)
        me.materials.append(lit_material())
        return me


# ---------- primitives ----------
def ring(z, r, n, sy=1.0, cx=0.0, cy=0.0, phase=0.0):
    return [Vector((cx + r * math.cos(phase + i * math.tau / n), cy + r * sy * math.sin(phase + i * math.tau / n), z))
            for i in range(n)]


def loft(p, rings, cols):
    """Bandes entre anneaux successifs (du bas vers le haut), normales vers l'extérieur."""
    for k in range(len(rings) - 1):
        a, b, n = rings[k], rings[k + 1], len(rings[k])
        for i in range(n):
            j = (i + 1) % n
            p.face([a[i], a[j], b[j], b[i]], cols[k])


def cap_top(p, rg, apex, col):
    for i in range(len(rg)):
        p.face([rg[i], rg[(i + 1) % len(rg)], apex], col)


def cap_bottom(p, rg, apex, col):
    for i in range(len(rg)):
        p.face([rg[(i + 1) % len(rg)], rg[i], apex], col)


def sphere_rings(c, r, seg, lat_of, steps, phase=0.0):
    """Anneaux d'une calotte : lat_of(azimut) = latitude maximale depuis le pôle ; du haut vers le bas."""
    out = []
    for k in range(1, steps + 1):
        rg = []
        for i in range(seg):
            az = phase + i * math.tau / seg
            lat = lat_of(az) * k / steps
            rg.append(c + Vector((r * math.sin(lat) * math.cos(az), r * math.sin(lat) * math.sin(az), r * math.cos(lat))))
        out.append(rg)
    return out


def dome(p, c, r, seg, lat_of, steps, col_of, phase=0.0, close=False):
    """Calotte sphérique ouverte en bas, ou sphère fermée par le pôle sud (`close`).

    Les anneaux tournent dans le sens direct vu de dessus : normales vers l'extérieur.
    col_of(k) donne la couleur de la bande k (0 = calotte du pôle nord)."""
    rgs = sphere_rings(c, r, seg, lat_of, steps, phase)
    cap_top(p, rgs[0], c + Vector((0, 0, r)), col_of(0))
    for k in range(len(rgs) - 1):
        loft(p, [rgs[k + 1], rgs[k]], [col_of(k + 1)])
    if close:
        cap_bottom(p, rgs[-1], c - Vector((0, 0, r)), col_of(steps))


def ball(p, c, r, seg, divisions, col, phase=0.0):
    """Sphère facettée : `divisions` tranches de latitude, sans triangle dégénéré."""
    dome(p, c, r, seg, lambda az: math.pi * (divisions - 1) / divisions, divisions - 1, lambda k: col, phase, close=True)


def quad_on(p, c, n, w, h, col):
    n = n.normalized()
    u = Vector((0, 0, 1)).cross(n).normalized()
    v = n.cross(u)
    p.face([c - u * w - v * h, c + u * w - v * h, c + u * w + v * h, c - u * w + v * h], col)


def box(p, cx, cy, cz, w, d, h, col):
    """Pavé centré : 6 faces, 12 triangles (comme MeshBuilder.CreateBox)."""
    x0, x1, y0, y1, z0, z1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, cz - h / 2, cz + h / 2
    P = lambda x, y, z: (x, y, z)
    p.face([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], col)
    p.face([P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0), P(x0, y0, z0)], col)
    p.face([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], col)
    p.face([P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1)], col)
    p.face([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], col)
    p.face([P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1)], col)


def bab(x, y, z):
    """Babylon (Y haut, avant +Z) -> Blender (Z haut, avant -Y), racine Babylon à 0,215 m du sol."""
    return x, -z, y + 0.215


# ---------- figure actuelle (reproduction fidèle de buildWorkerFigure) ----------
def current_parts():
    def b(w, h, d, x, y, z, col):
        p = Part()
        bx, by, bz = bab(x, y, z)
        box(p, bx, by, bz, w, d, h, col)
        return p
    return {
        "body": (b(0.24, 0.27, 0.15, 0, 0.15, 0, "clothes"), None),
        "head": (b(0.15, 0.15, 0.15, 0, 0.36, 0, "skin"), None),
        "hair": (b(0.16, 0.045, 0.16, 0, 0.45, 0, "hair"), None),
        "face": (b(0.055, 0.035, 0.012, 0, 0.34, 0.08, "hair"), None),
    }


def current_limb(kind):
    p = Part()
    if kind == "arm":
        box(p, 0, 0, -0.11, 0.075, 0.075, 0.22, WHITE)
    else:
        box(p, 0, 0, -0.105, 0.085, 0.09, 0.21, WHITE)
    return p


# ---------- figurine proposée ----------
ARM_PIVOT = (0.15, 0.462)   # x, z : mêmes articulations que la figure actuelle, à 1 cm près
LEG_PIVOT = (0.065, 0.23)
HEAD_C = Vector((0, 0, 0.585))
HEAD_R = 0.112


def fig_tunic():
    """Tunique octogonale évasée, ceinture sombre, épaules arrondies : 64 triangles."""
    p, n, sy = Part(), 8, 0.74
    rs = [ring(0.19, 0.152, n, sy, phase=math.pi / 8), ring(0.285, 0.118, n, sy, phase=math.pi / 8),
          ring(0.315, 0.116, n, sy, phase=math.pi / 8), ring(0.44, 0.112, n, sy, phase=math.pi / 8),
          ring(0.48, 0.07, n, sy, phase=math.pi / 8)]
    loft(p, rs, [(0.92,) * 3, (0.42, 0.36, 0.3), WHITE, (1.04,) * 3])
    cap_top(p, rs[-1], Vector((0, 0, 0.495)), (1.04,) * 3)
    cap_bottom(p, rs[0], Vector((0, 0, 0.2)), (0.6,) * 3)
    return p


def fig_leg():
    """Jambe hexagonale, chaussure sombre ; origine à la hanche : 32 triangles."""
    p, n = Part(), 6
    rs = [ring(-0.21, 0.05, n, 1.15, cy=-0.012), ring(-0.165, 0.048, n, 1.1, cy=-0.008), ring(-0.15, 0.044, n),
          ring(0.0, 0.048, n)]
    loft(p, rs, [(0.38, 0.33, 0.3), (0.38, 0.33, 0.3), WHITE])
    cap_bottom(p, rs[0], Vector((0, -0.012, -0.21)), (0.3, 0.27, 0.25))
    cap_top(p, rs[-1], Vector((0, 0, 0.01)), WHITE)
    return p


def fig_arm():
    """Manche hexagonale effilée ; origine à l'épaule : 24 triangles."""
    p, n = Part(), 6
    rs = [ring(-0.19, 0.036, n), ring(-0.06, 0.042, n), ring(0.02, 0.045, n)]
    loft(p, rs, [WHITE, WHITE])
    cap_bottom(p, rs[0], Vector((0, 0, -0.2)), (0.85,) * 3)
    cap_top(p, rs[-1], Vector((0, 0, 0.035)), WHITE)
    return p


def fig_hand():
    """Main au bout de la manche, même matrice que le bras : 16 triangles."""
    p = Part()
    ball(p, Vector((0, 0, -0.225)), 0.036, 4, 3, WHITE, phase=math.pi / 4)
    return p


def fig_head():
    """Tête facettée (8 x 6) et deux yeux : 84 triangles."""
    p = Part()
    ball(p, HEAD_C, HEAD_R, 8, 6, WHITE, phase=math.pi / 8)
    for s in (-1, 1):
        az = -math.pi / 2 + s * 0.36
        lat = math.radians(96)
        nrm = Vector((math.sin(lat) * math.cos(az), math.sin(lat) * math.sin(az), math.cos(lat)))
        quad_on(p, HEAD_C + nrm * (HEAD_R * 0.985), nrm, 0.011, 0.016, (0.13, 0.12, 0.12))
    return p


def hair_lat(front, back):
    """Latitude de coupe : courte devant (-Y), longue derrière (+Y)."""
    return lambda az: front + (back - front) * (1 + math.sin(az)) / 2


def fig_hair(style):
    p = Part()
    lat = {"court": hair_lat(math.radians(62), math.radians(108)),
           "chignon": hair_lat(math.radians(58), math.radians(112)),
           "long": hair_lat(math.radians(66), math.radians(150))}[style]
    dome(p, HEAD_C, HEAD_R * 1.07, 8, lat, 4, lambda k: (1.0 - 0.05 * k,) * 3, phase=math.pi / 8)
    if style == "chignon":
        ball(p, HEAD_C + Vector((0, 0.085, 0.07)), 0.048, 6, 3, (0.9,) * 3)
    return p


def fig_hat(kind):
    """Couvre-chefs de métier, couleurs absolues (non teintées)."""
    p = Part()
    top = HEAD_C.z + HEAD_R
    if kind == "paille":
        straw, band = hexc("d8b660"), hexc("8a4a2a")
        zb = top - 0.045
        inner, outer = ring(zb, 0.105, 10), ring(zb - 0.022, 0.215, 10)
        under_in, under_out = ring(zb - 0.012, 0.105, 10), ring(zb - 0.032, 0.215, 10)
        for i in range(10):
            j = (i + 1) % 10
            p.face([inner[i], outer[i], outer[j], inner[j]], straw)
            p.face([under_in[j], under_out[j], under_out[i], under_in[i]], mul(straw, (0.8,) * 3))
        loft(p, [under_out, outer], [mul(straw, (0.9,) * 3)])
        crown = [ring(zb, 0.105, 10), ring(zb + 0.022, 0.1, 10), ring(zb + 0.07, 0.085, 10)]
        loft(p, crown, [band, straw])
        cap_top(p, crown[-1], Vector((0, 0, zb + 0.08)), straw)
    elif kind == "bonnet":
        red, fold = hexc("a8432f"), hexc("c9654c")
        # bonnet de laine : revers clair, pointe qui retombe vers l'arrière (+Y)
        rs = [ring(top - 0.075, HEAD_R * 1.12, 8, phase=math.pi / 8), ring(top - 0.035, HEAD_R * 1.12, 8, phase=math.pi / 8),
              ring(top - 0.03, HEAD_R * 1.07, 8, phase=math.pi / 8),
              ring(top + 0.025, 0.085, 8, cy=0.025, phase=math.pi / 8),
              ring(top + 0.055, 0.045, 8, cy=0.08, phase=math.pi / 8)]
        loft(p, rs, [fold, mul(fold, (0.9,) * 3), red, red])
        cap_top(p, rs[-1], Vector((0, 0.15, top + 0.03)), mul(red, (0.9,) * 3))
    elif kind == "casque":
        leather, rim = hexc("6b4a2e"), hexc("4e3420")
        dome(p, HEAD_C + Vector((0, 0, 0.012)), HEAD_R * 1.13, 8, lambda az: math.radians(78), 3,
             lambda k: leather, phase=math.pi / 8)
        z = HEAD_C.z + 0.012 + HEAD_R * 1.13 * math.cos(math.radians(78))
        r0 = HEAD_R * 1.13 * math.sin(math.radians(78))
        a, b = ring(z, r0, 8, phase=math.pi / 8), ring(z - 0.02, r0 + 0.035, 8, phase=math.pi / 8)
        loft(p, [b, a], [rim])
    elif kind == "beret":
        blue = hexc("3d4f6e")
        rs = [ring(top - 0.035, HEAD_R * 1.05, 8, phase=math.pi / 8), ring(top - 0.005, 0.135, 8, cx=0.02, phase=math.pi / 8)]
        loft(p, rs, [blue])
        cap_top(p, rs[-1], Vector((0.02, 0, top + 0.02)), mul(blue, (1.15,) * 3))
    return p


# ---------- accessoires (identiques à l'actuel, pour isoler le changement de figure) ----------
def tool(role):
    p = Part()
    box(p, 0, -0.03, -0.18, 0.035, 0.035, 0.32, TIMBER)
    box(p, 0.04, -0.03, -0.33, 0.3 if role == "pick" else 0.15, 0.05, 0.07, STONE)
    return p


def basket():
    p = Part()
    box(p, 0.18, -0.02, 0.405, 0.22, 0.2, 0.2, TIMBER)
    return p


def log():
    p = Part()
    rs = [ring(-0.21, 0.06, 6), ring(0.21, 0.06, 6)]
    loft(p, rs, [TIMBER])
    cap_top(p, rs[1], Vector((0, 0, 0.21)), mul(TIMBER, (1.3,) * 3))
    cap_bottom(p, rs[0], Vector((0, 0, -0.21)), mul(TIMBER, (1.3,) * 3))
    return p


# ---------- assemblage ----------
def obj(sc, name, part, tint, parent, loc=(0, 0, 0), rot=(0, 0, 0)):
    o = bpy.data.objects.new(name, part.build(name, tint))
    sc.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    return o


def pose_angles(pose):
    """Rotations X (bras gauche, bras droit, jambe gauche, jambe droite), mêmes signes que le jeu."""
    s = 0.5
    return {"repos": (0, 0, 0, 0), "marche": (s, -s, -s, s), "porte": (-0.3, -0.9, -s, s),
            "jardin": (-0.25 - 0.8 * 0.65 * 0.43, -0.2 - 0.8 * 0.65, 0, 0),
            "pioche": (-0.25 - 0.8 * 1.15 * 0.43, -0.2 - 0.8 * 1.15, 0, 0)}[pose]


def build_current(sc, name, at, heading, pose, look, cargo=None, tool_role=None):
    root = bpy.data.objects.new(name, None)
    sc.collection.objects.link(root)
    root.location = at
    root.rotation_euler = (0, 0, heading)
    skin, clothes, hair = SKIN[look["skin"]], CLOTHES[look["clothes"]], HAIR[look["hair"]]
    tint = {"clothes": clothes, "skin": skin, "hair": hair}
    for key, (part, _) in current_parts().items():
        role = part.c[0][0]  # current_parts marque chaque pavé par le nom de sa teinte
        part.c = [[WHITE] * len(c) for c in part.c]
        obj(sc, f"{name}_{key}", part, tint[role], root)
    la, ra, ll, rl = pose_angles(pose)
    arms = {}
    for side, ang in ((-1, la), (1, ra)):
        arms[side] = obj(sc, f"{name}_arm{side}", current_limb("arm"), clothes, root, (side * 0.16, 0, 0.485), (ang, 0, 0))
    for side, ang in ((-1, ll), (1, rl)):
        obj(sc, f"{name}_leg{side}", current_limb("leg"), PANTS, root, (side * 0.065, 0, 0.23), (ang, 0, 0))
    accessories(sc, name, root, arms, cargo, tool_role)
    return root


def build_figurine(sc, name, at, heading, pose, look, hat=None, hair_style="court", cargo=None, tool_role=None):
    root = bpy.data.objects.new(name, None)
    sc.collection.objects.link(root)
    root.location = at
    root.rotation_euler = (0, 0, heading)
    skin, clothes, hair = SKIN[look["skin"]], CLOTHES[look["clothes"]], HAIR[look["hair"]]
    obj(sc, f"{name}_tunique", fig_tunic(), clothes, root)
    obj(sc, f"{name}_tete", fig_head(), skin, root)
    obj(sc, f"{name}_cheveux", fig_hair(hair_style), hair, root)
    if hat:
        obj(sc, f"{name}_chapeau", fig_hat(hat), WHITE, root)
    la, ra, ll, rl = pose_angles(pose)
    arms = {}
    for side, ang in ((-1, la), (1, ra)):
        arm = obj(sc, f"{name}_bras{side}", fig_arm(), clothes, root, (side * ARM_PIVOT[0], 0, ARM_PIVOT[1]), (ang, 0, 0))
        obj(sc, f"{name}_main{side}", fig_hand(), skin, arm)
        arms[side] = arm
    for side, ang in ((-1, ll), (1, rl)):
        obj(sc, f"{name}_jambe{side}", fig_leg(), PANTS, root, (side * LEG_PIVOT[0], 0, LEG_PIVOT[1]), (ang, 0, 0))
    accessories(sc, name, root, arms, cargo, tool_role)
    return root


def accessories(sc, name, root, arms, cargo, tool_role):
    if tool_role:
        # l'outil est porté par le bras droit (limbs[1]) ; ses coordonnées sont relatives au pivot
        obj(sc, f"{name}_outil", tool(tool_role), WHITE, arms[1])
    if cargo == "panier":
        obj(sc, f"{name}_panier", basket(), WHITE, root)
    elif cargo == "buche":
        obj(sc, f"{name}_buche", log(), WHITE, root, (0.17, 0, 0.455), (0, math.pi / 2, 0))


CAST = [
    # nom, position, cap (rad, avant = -Y tourné), pose, apparence, chapeau, coiffure, charge, outil
    ("jardinier", (2.85, 0.95, 0), -math.pi / 2, "jardin", dict(skin=0, clothes=0, hair=1), "paille", "court", None, "garden"),
    ("jardiniere", (-0.32, 1.45, 0), math.pi / 2, "jardin", dict(skin=1, clothes=4, hair=0), "paille", "chignon", None, "garden"),
    ("porteuse", (3.55, -0.55, 0), -0.6, "porte", dict(skin=2, clothes=3, hair=0), None, "long", "panier", None),
    ("bucheron", (4.55, 0.7, 0), -2.2, "porte", dict(skin=0, clothes=1, hair=2), "bonnet", "court", "buche", None),
    ("mineur", (4.3, 2.35, 0), -1.9, "pioche", dict(skin=1, clothes=2, hair=1), "casque", "court", None, "pick"),
    ("arpenteuse", (3.1, 2.75, 0), -0.9, "marche", dict(skin=2, clothes=1, hair=2), "beret", "chignon", None, None),
]


def stage(name, garden_ns):
    old = bpy.data.scenes.get(name)
    if old:
        for o in list(old.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.scenes.remove(old)
    sc = bpy.data.scenes.new(name)
    sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE_NEXT'
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.get("VIL monde") or bpy.data.worlds.new("VIL monde")
    w.use_nodes = True
    nt = w.node_tree
    bg = next((n for n in nt.nodes if n.type == 'BACKGROUND'), None)
    if bg is None:
        bg = nt.nodes.new("ShaderNodeBackground")
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_WORLD'), None) or nt.nodes.new("ShaderNodeOutputWorld")
        nt.links.new(bg.outputs[0], out.inputs[0])
    bg.inputs[0].default_value = (*[c ** 2.2 for c in hexc("9fb3bf")], 1)
    bg.inputs[1].default_value = 0.9
    sc.world = w
    sun = bpy.data.lights.get("VIL soleil") or bpy.data.lights.new("VIL soleil", 'SUN')
    sun.energy = 3.2
    sun.angle = math.radians(3)
    so = bpy.data.objects.new(f"{name} soleil", sun)
    so.rotation_euler = (math.radians(42), 0, math.radians(-35))
    sc.collection.objects.link(so)
    # sol herbeux et une parcelle du carré potager au stade 5
    g = Part()
    g.face([(-30, -30, -0.002), (30, -30, -0.002), (30, 30, -0.002), (-30, 30, -0.002)], hexc("6e8247"))
    o = bpy.data.objects.new(f"{name} sol", g.build(f"{name} sol"))
    sc.collection.objects.link(o)
    mb = garden_ns["garden"]([(0, 0)], {(0, 0): 5})
    o = bpy.data.objects.new(f"{name} parcelle", mb.build(f"{name} parcelle", shade=False, mat=lit_material()))
    sc.collection.objects.link(o)
    cd = bpy.data.cameras.new(f"{name} camera")
    cd.type = 'ORTHO'
    cam = bpy.data.objects.new(f"{name} camera", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc


def frame(sc, target, scale, res):
    """Caméra du jeu : inclinaison 50° depuis la verticale, venant de +X/-Y (comme les aperçus jardins)."""
    cam = sc.camera
    cam.rotation_euler = (0.877, 0, 0.588)
    d = cam.rotation_euler.to_matrix() @ Vector((0, 0, -1))
    cam.location = Vector(target) - d * 30
    cam.data.ortho_scale = scale
    cam.data.clip_end = 100
    sc.render.resolution_x, sc.render.resolution_y = res


def build(garden_ns):
    counts = {}
    for style in ("actuel", "proposition"):
        sc = stage(f"VIL {style}", garden_ns)
        for (nm, at, hd, pose, look, hat, hs, cargo, tr) in CAST:
            if style == "actuel":
                build_current(sc, f"{style}_{nm}", at, hd, pose, look, cargo, tr)
            else:
                build_figurine(sc, f"{style}_{nm}", at, hd, pose, look, hat, hs, cargo, tr)
    # comptes d'une figure seule, sans outil ni charge
    cur = sum(p.tris() for p, _ in current_parts().values()) + 2 * current_limb("arm").tris() + 2 * current_limb("leg").tris()
    fig = fig_tunic().tris() + fig_head().tris() + 2 * (fig_arm().tris() + fig_hand().tris() + fig_leg().tris())
    counts["actuel_triangles"] = cur
    counts["actuel_maillages"] = 8
    counts["figurine_triangles_sans_coiffure"] = fig
    counts["coiffures"] = {s: fig_hair(s).tris() for s in ("court", "chignon", "long")}
    counts["chapeaux"] = {h: fig_hat(h).tris() for h in ("paille", "bonnet", "casque", "beret")}
    return counts
