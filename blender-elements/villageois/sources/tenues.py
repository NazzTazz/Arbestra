"""Kit de tenues des spécialisations et figure de l'Oracle (Opus 5.5).

À exécuter dans le même espace de noms que build_villageois.py.
Une spécialisation = tenue + couvre-chef + objets ; toutes les pièces sont
partageables entre villageois (thin instances côté moteur).
Les pièces de tenue ont des couleurs absolues (pas de teinte par villageois),
sauf `tunique` et `manteau`, teintées comme aujourd'hui.
"""
import bpy, math
from mathutils import Vector, Matrix

STEEL, STEEL_DARK = hexc("a3abb0"), hexc("5f666b")
GOLD, BRASS = hexc("d9b24a"), hexc("b9913f")
WHITE_CLOTH, BLACK = hexc("eeeae0"), hexc("2a2629")
TURQ, TURQ_LIGHT, TURQ_DEEP = hexc("2fb3ad"), hexc("8fdcd3"), hexc("1d8c88")


def cyl(r, z0, z1, n, col, caps=True, cap_col=None, sy=1.0):
    p = Part()
    rs = [ring(z0, r, n, sy), ring(z1, r, n, sy)]
    loft(p, rs, [col])
    if caps:
        cap_top(p, rs[1], Vector((0, 0, z1)), cap_col or col)
        cap_bottom(p, rs[0], Vector((0, 0, z0)), cap_col or col)
    return p


def two_sided(p, pts, col):
    p.face(pts, col)
    p.face(list(reversed(pts)), mul(col, (0.8,) * 3))


def along(axis):
    """Matrice qui couche l'axe local Z sur l'axe demandé."""
    return {"x": Matrix.Rotation(math.pi / 2, 4, 'Y'), "y": Matrix.Rotation(-math.pi / 2, 4, 'X'),
            "z": Matrix.Identity(4)}[axis]


HAND = Vector((0, -0.01, -0.225))  # centre de la main dans le repère du bras


# ---------- tenues ----------
def fig_coat():
    """Manteau long jusqu'aux chevilles (médecin, architecte) : teinté, 64 triangles."""
    p, n, sy = Part(), 8, 0.74
    rs = [ring(0.07, 0.165, n, sy, phase=math.pi / 8), ring(0.285, 0.12, n, sy, phase=math.pi / 8),
          ring(0.315, 0.117, n, sy, phase=math.pi / 8), ring(0.44, 0.112, n, sy, phase=math.pi / 8),
          ring(0.48, 0.07, n, sy, phase=math.pi / 8)]
    loft(p, rs, [(0.95,) * 3, (0.45, 0.4, 0.35), WHITE, (1.04,) * 3])
    cap_top(p, rs[-1], Vector((0, 0, 0.495)), (1.04,) * 3)
    cap_bottom(p, rs[0], Vector((0, 0, 0.08)), (0.6,) * 3)
    return p


def apron():
    """Tablier blanc posé devant la tunique (infirmier) : 4 triangles, double face inutile."""
    p = Part()
    p.face([(-0.1, -0.128, 0.2), (0.1, -0.128, 0.2), (0.085, -0.093, 0.43), (-0.085, -0.093, 0.43)], WHITE_CLOTH)
    p.face([(-0.085, -0.093, 0.43), (0.085, -0.093, 0.43), (0.06, -0.075, 0.47), (-0.06, -0.075, 0.47)], WHITE_CLOTH)
    return p


def tabard(col, emblem):
    """Tabard du garde ou cotte du chevalier : pans avant et arrière, emblème : 12 triangles."""
    p = Part()
    for s in (-1, 1):
        y0, y1 = s * 0.124, s * 0.088
        pts = [(-0.09, y0, 0.15), (0.09, y0, 0.15), (0.08, y1, 0.45), (-0.08, y1, 0.45)]
        p.face(pts if s < 0 else list(reversed(pts)), col)
        if s < 0:
            p.face([(-0.035, -0.112, 0.31), (0.035, -0.112, 0.31), (0.035, -0.103, 0.39), (-0.035, -0.103, 0.39)], emblem)
            p.face([(-0.035, -0.103, 0.39), (0.035, -0.103, 0.39), (0.0, -0.1, 0.42)], emblem)
    p.face([(-0.09, -0.124, 0.15), (-0.09, 0.124, 0.15), (0.09, 0.124, 0.15), (0.09, -0.124, 0.15)][::-1], mul(col, (0.6,) * 3))
    return p


def oracle_dress():
    """Robe de l'Oracle : jupe longue à plis, taille ceinturée d'or, buste et hanches marqués ; voile clair."""
    p, n = Part(), 12
    def folds(z, r, depth, sy=0.82):
        # plis : rayon alterné, plus marqué vers l'ourlet
        return [Vector((r * (1 + depth * (1 if i % 2 else -1)) * math.cos(i * math.tau / n),
                        r * sy * (1 + depth * (1 if i % 2 else -1)) * math.sin(i * math.tau / n), z)) for i in range(n)]
    rs = [folds(0.012, 0.215, 0.09), folds(0.17, 0.17, 0.05), folds(0.29, 0.13, 0.0),
          folds(0.33, 0.099, 0.0, 0.78), folds(0.355, 0.099, 0.0, 0.78), folds(0.425, 0.124, 0.0, 0.86),
          folds(0.47, 0.085, 0.0, 0.8)]
    loft(p, rs, [TURQ_DEEP, TURQ, TURQ, GOLD, TURQ, TURQ_LIGHT])
    cap_top(p, rs[-1], Vector((0, 0, 0.49)), TURQ_LIGHT)
    cap_bottom(p, rs[0], Vector((0, 0, 0.02)), mul(TURQ_DEEP, (0.6,) * 3))
    # voile : seconde jupe plus claire, ouverte devant, flottant au-dessus de la première
    veil = [folds(0.1, 0.205, 0.12), folds(0.33, 0.106, 0.0, 0.8)]
    for i in range(n):
        j = (i + 1) % n
        az = (i + 0.5) * math.tau / n
        if abs(math.sin(az) + 1) < 0.3:   # ouverture devant (-Y)
            continue
        p.face([veil[0][i], veil[0][j], veil[1][j], veil[1][i]], TURQ_LIGHT)
    return p


def bell_sleeve():
    """Manche ample de l'Oracle, couleur absolue : 24 triangles."""
    p, n = Part(), 6
    rs = [ring(-0.185, 0.058, n), ring(-0.07, 0.044, n), ring(0.02, 0.045, n)]
    loft(p, rs, [TURQ_LIGHT, TURQ])
    cap_bottom(p, rs[0], Vector((0, 0, -0.175)), mul(TURQ_LIGHT, (0.7,) * 3))
    cap_top(p, rs[-1], Vector((0, 0, 0.035)), TURQ)
    return p


# ---------- couvre-chefs ----------
def hat_extra(kind):
    p = Part()
    top = HEAD_C.z + HEAD_R
    if kind == "casque_garde":   # chapeau de fer à large bord
        dome(p, HEAD_C + Vector((0, 0, 0.015)), HEAD_R * 1.12, 8, lambda az: math.radians(72), 3, lambda k: STEEL, phase=math.pi / 8)
        z = HEAD_C.z + 0.015 + HEAD_R * 1.12 * math.cos(math.radians(72))
        r0 = HEAD_R * 1.12 * math.sin(math.radians(72))
        a, b = ring(z, r0, 8, phase=math.pi / 8), ring(z - 0.03, r0 + 0.075, 8, phase=math.pi / 8)
        for i in range(8):
            j = (i + 1) % 8
            two_sided(p, [a[i], b[i], b[j], a[j]][::-1], STEEL_DARK)
    elif kind == "coiffe":       # coiffe blanche nouée derrière
        dome(p, HEAD_C, HEAD_R * 1.08, 8, hair_lat(math.radians(70), math.radians(118)), 3, lambda k: WHITE_CLOTH, phase=math.pi / 8)
        ball(p, HEAD_C + Vector((0, 0.115, -0.01)), 0.035, 6, 3, WHITE_CLOTH)
    elif kind == "haut_de_forme":  # chapeau noir du médecin
        zb = top - 0.03
        brim_i, brim_o = ring(zb, 0.1, 10), ring(zb, 0.155, 10)
        for i in range(10):
            j = (i + 1) % 10
            two_sided(p, [brim_i[i], brim_o[i], brim_o[j], brim_i[j]], BLACK)
        p.add(cyl(0.095, zb, zb + 0.11, 10, BLACK, cap_col=mul(BLACK, (1.3,) * 3)))
        loft(p, [ring(zb + 0.005, 0.097, 10), ring(zb + 0.025, 0.097, 10)], [hexc("6b1f24")])
    elif kind == "heaume":       # heaume de chevalier, fente de visière, plumet
        rs = [ring(HEAD_C.z - 0.1, 0.128, 8, phase=math.pi / 8), ring(HEAD_C.z - 0.005, 0.128, 8, phase=math.pi / 8),
              ring(HEAD_C.z + 0.02, 0.128, 8, phase=math.pi / 8), ring(top + 0.02, 0.118, 8, phase=math.pi / 8)]
        loft(p, rs, [STEEL, STEEL_DARK, STEEL])
        cap_top(p, rs[-1], Vector((0, 0, top + 0.035)), STEEL)
        cap_bottom(p, rs[0], Vector((0, 0, HEAD_C.z - 0.1)), STEEL_DARK)
        for k in range(3):
            plume = cyl(0.025 - k * 0.005, 0, 0.06, 5, hexc("b8322c"))
            p.add(plume, Matrix.Translation((0, 0.03 + k * 0.045, top + 0.04 + k * 0.03 - k * k * 0.012))
                  @ Matrix.Rotation(-0.5 - k * 0.35, 4, 'X'))
    elif kind == "capuche":      # capuche d'archer, pointe dans le dos
        green = hexc("4f6b34")
        dome(p, HEAD_C + Vector((0, 0.008, 0.004)), HEAD_R * 1.16, 8, hair_lat(math.radians(78), math.radians(140)), 4,
             lambda k: mul(green, (1.0 - 0.06 * k,) * 3), phase=math.pi / 8)
        base = [Vector((0.05 * math.cos(a), 0.11 + 0.05 * math.sin(a) * 0.6, top - 0.03)) for a in
                (i * math.tau / 5 for i in range(5))]
        cap_top(p, base, Vector((0, 0.2, top - 0.1)), mul(green, (0.8,) * 3))
    elif kind == "explorateur":  # chapeau de feutre du géographe
        felt, band = hexc("8b6a45"), hexc("3a2c20")
        zb = top - 0.04
        inner, outer = ring(zb, 0.1, 10), ring(zb - 0.012, 0.185, 10)
        for i in range(10):
            j = (i + 1) % 10
            two_sided(p, [inner[i], outer[i], outer[j], inner[j]], felt)
        crown = [ring(zb, 0.1, 10, sy=0.9), ring(zb + 0.022, 0.097, 10, sy=0.9), ring(zb + 0.06, 0.08, 10, sy=0.75)]
        loft(p, crown, [band, felt])
        cap_top(p, crown[-1], Vector((0, 0, zb + 0.055)), mul(felt, (0.9,) * 3))
    elif kind == "diademe":      # diadème doré de l'Oracle, pierre turquoise au front
        a, b = ring(HEAD_C.z + 0.035, HEAD_R * 1.1, 10, phase=math.pi / 10), ring(HEAD_C.z + 0.06, HEAD_R * 1.08, 10, phase=math.pi / 10)
        loft(p, [a, b], [GOLD])
        nrm = Vector((0, -1, 0.35)).normalized()
        quad_on(p, HEAD_C + nrm * (HEAD_R * 1.12), nrm, 0.018, 0.022, TURQ_LIGHT)
    return p


# ---------- objets ----------
def held(kind):
    """Objets portés par un bras, dans le repère du bras (origine à l'épaule, main en HAND)."""
    p = Part()
    H = Matrix.Translation(HAND)
    if kind == "lance":
        p.add(cyl(0.014, -0.75, 0.5, 5, TIMBER, caps=False), H)
        tip = Part()
        rs = [ring(0, 0.03, 4, phase=math.pi / 4)]
        cap_top(tip, rs[0], Vector((0, 0, 0.12)), STEEL)
        cap_bottom(tip, rs[0], Vector((0, 0, -0.02)), STEEL_DARK)
        p.add(tip, H @ Matrix.Translation((0, 0, 0.5)))
    elif kind == "epee":
        blade = Part()
        two_sided(blade, [(-0.016, 0, 0), (0.016, 0, 0), (0.0, 0, 0.42)], STEEL)
        two_sided(blade, [(-0.07, 0, -0.005), (0.07, 0, -0.005), (0.07, 0, 0.012), (-0.07, 0, 0.012)], GOLD)
        p.add(blade, H @ Matrix.Translation((0, 0, 0.03)))
        p.add(cyl(0.014, -0.06, 0.0, 5, hexc("4a2c1d")), H)
    elif kind == "bouclier":
        disc = Part()
        rg = ring(0, 0.13, 8, phase=math.pi / 8)
        for i in range(8):
            j = (i + 1) % 8
            col = hexc("2f4f8f") if i % 2 else hexc("d9b24a")
            disc.face([Vector((0, 0, 0.012)), rg[i], rg[j]], col)       # face extérieure
            disc.face([rg[j], rg[i], Vector((0, 0, -0.005))], STEEL_DARK)  # dos
        # disque tourné vers l'extérieur du bras gauche (-X)
        p.add(disc, Matrix.Translation((-0.055, -0.01, -0.13)) @ Matrix.Rotation(-math.pi / 2, 4, 'Y'))
    elif kind == "arc":
        wood = hexc("7b4a26")
        pts = [(0.0, -0.04 * math.sin(t * math.pi), -0.36 + 0.72 * t) for t in (i / 6 for i in range(7))]
        for a, b in zip(pts, pts[1:]):
            two_sided(p, [H @ Vector((a[0] - 0.012, a[1], a[2])), H @ Vector((a[0] + 0.012, a[1], a[2])),
                          H @ Vector((b[0] + 0.012, b[1], b[2])), H @ Vector((b[0] - 0.012, b[1], b[2]))], wood)
        two_sided(p, [H @ Vector((-0.002, 0.0, -0.36)), H @ Vector((0.002, 0.0, -0.36)),
                      H @ Vector((0.002, 0.0, 0.36)), H @ Vector((-0.002, 0.0, 0.36))], WHITE_CLOTH)
    elif kind == "marteau":
        p.add(cyl(0.013, -0.04, 0.2, 5, TIMBER), H)
        box(p, HAND.x, HAND.y, HAND.z + 0.2, 0.12, 0.035, 0.035, STEEL)
    elif kind == "rouleau":
        p.add(cyl(0.03, -0.17, 0.17, 6, hexc("e8e2cf"), cap_col=hexc("3d5f8f")), H @ along("x"))
    elif kind == "longue_vue":
        p.add(cyl(0.022, -0.05, 0.14, 6, BRASS, cap_col=hexc("2b2b2b")), H)
        p.add(cyl(0.028, 0.14, 0.24, 6, mul(BRASS, (0.8,) * 3), cap_col=hexc("2b2b2b")), H)
    elif kind == "sacoche_medecin":
        bag = Part()
        box(bag, 0, 0, -0.1, 0.18, 0.09, 0.12, BLACK)
        box(bag, 0, 0, -0.03, 0.06, 0.02, 0.025, GOLD)
        p.add(bag, H)
    return p


def worn(kind):
    """Objets portés sur le corps, dans le repère de la racine."""
    p = Part()
    if kind == "carquois":
        q = cyl(0.045, 0.0, 0.26, 6, hexc("6b4426"), cap_col=hexc("3a2616"))
        for k, dx in enumerate((-0.02, 0.0, 0.02)):
            two_sided(q, [(dx - 0.012, 0, 0.26), (dx + 0.012, 0, 0.26), (dx, 0, 0.33 + 0.01 * k)], WHITE_CLOTH)
        p.add(q, Matrix.Translation((0.05, 0.12, 0.26)) @ Matrix.Rotation(-0.35, 4, 'Y') @ Matrix.Rotation(0.15, 4, 'X'))
    elif kind == "sacoche":
        box(p, -0.155, 0.0, 0.25, 0.05, 0.13, 0.11, hexc("6b4a2e"))
        two_sided(p, [(-0.125, -0.05, 0.3), (-0.115, -0.05, 0.3), (0.11, -0.04, 0.47), (0.1, -0.04, 0.47)], hexc("4e3420"))
    return p


# ---------- spécialisations ----------
SPECS = [
    # nom, tenue, teinte, surcouche, couvre-chef, coiffure, main droite, main gauche, porté
    ("garde", "tunique", hexc("5d5a55"), ("tabard", hexc("8c2f2a"), hexc("d9b24a")), "casque_garde", "court", "lance", None, None),
    ("infirmier", "tunique", hexc("8fb0c4"), ("tablier",), "coiffe", "chignon", None, None, "sacoche"),
    ("medecin", "manteau", hexc("3b3550"), None, "haut_de_forme", "court", "sacoche_medecin", None, None),
    ("chevalier", "tunique", hexc("6d7480"), ("tabard", hexc("e9e4d6"), hexc("2f4f8f")), "heaume", "court", "epee", "bouclier", None),
    ("archer", "tunique", hexc("5b6e3a"), None, "capuche", "court", None, "arc", "carquois"),
    ("geologue", "tunique", hexc("b69a4c"), None, "casque", "court", "marteau", None, "sacoche"),
    ("architecte", "manteau", hexc("6e5642"), None, "beret", "chignon", "rouleau", None, None),
    ("geographe", "tunique", hexc("526e86"), None, "explorateur", "long", "longue_vue", None, "sacoche"),
]


def build_specialist(sc, name, at, heading, spec, look):
    nm, outfit, cloth, overlay, hat, hair_style, right, left, back = spec
    root = bpy.data.objects.new(name, None)
    sc.collection.objects.link(root)
    root.location = at
    root.rotation_euler = (0, 0, heading)
    skin, hair = SKIN[look["skin"]], HAIR[look["hair"]]
    body = fig_coat() if outfit == "manteau" else fig_tunic()
    obj(sc, f"{name}_{outfit}", body, cloth, root)
    if overlay:
        part = apron() if overlay[0] == "tablier" else tabard(overlay[1], overlay[2])
        obj(sc, f"{name}_{overlay[0]}", part, WHITE, root)
    obj(sc, f"{name}_tete", fig_head(), skin, root)
    if hat not in ("heaume", "coiffe"):  # ces deux-là couvrent entièrement la chevelure
        obj(sc, f"{name}_cheveux", fig_hair(hair_style), hair, root)
    obj(sc, f"{name}_chapeau", fig_hat(hat) if hat in ("casque", "beret", "paille", "bonnet") else hat_extra(hat), WHITE, root)
    angles = {-1: -0.35 if left else 0.05, 1: -0.45 if right else -0.05}
    if right == "lance":
        angles[1] = -0.15
    arms = {}
    for side in (-1, 1):
        arm = obj(sc, f"{name}_bras{side}", fig_arm(), cloth, root, (side * ARM_PIVOT[0], 0, ARM_PIVOT[1]), (angles[side], 0, 0))
        obj(sc, f"{name}_main{side}", fig_hand(), skin, arm)
        arms[side] = arm
    for side in (-1, 1):
        obj(sc, f"{name}_jambe{side}", fig_leg(), PANTS if outfit != "manteau" else mul(PANTS, (0.7,) * 3), root,
            (side * LEG_PIVOT[0], 0, LEG_PIVOT[1]))
    if right:
        obj(sc, f"{name}_{right}", held(right), WHITE, arms[1])
    if left:
        obj(sc, f"{name}_{left}", held(left), WHITE, arms[-1])
    if back:
        obj(sc, f"{name}_{back}", worn(back), WHITE, root)
    tris = sum(o.data.polygons and sum(len(pg.vertices) - 2 for pg in o.data.polygons) or 0
               for o in sc.objects if o.type == 'MESH' and o.name.startswith(name + "_"))
    return tris


def build_oracle(sc, name, at, heading):
    root = bpy.data.objects.new(name, None)
    sc.collection.objects.link(root)
    root.location = at
    root.rotation_euler = (0, 0, heading)
    skin, hair = SKIN[1], HAIR[0]
    obj(sc, f"{name}_robe", oracle_dress(), WHITE, root)
    obj(sc, f"{name}_tete", fig_head(), skin, root)
    obj(sc, f"{name}_cheveux", fig_hair("long"), hair, root)
    obj(sc, f"{name}_diademe", hat_extra("diademe"), WHITE, root)
    for side, ang in ((-1, -0.25), (1, -0.6)):
        arm = obj(sc, f"{name}_bras{side}", bell_sleeve(), WHITE, root,
                  (side * (ARM_PIVOT[0] - 0.01), 0, ARM_PIVOT[1] - 0.01), (ang, 0, side * -0.12))
        obj(sc, f"{name}_main{side}", fig_hand(), skin, arm)
    return sum(sum(len(pg.vertices) - 2 for pg in o.data.polygons)
               for o in sc.objects if o.type == 'MESH' and o.name.startswith(name + "_"))


def build_lineup(garden_ns):
    sc = stage("VIL specialites", garden_ns)
    # pas de parcelle dans cette scène : on la retire
    for o in [o for o in sc.objects if o.name.endswith("parcelle")]:
        bpy.data.objects.remove(o, do_unlink=True)
    looks = [dict(skin=i % 3, hair=(i + 1) % 3) for i in range(len(SPECS))]
    report = {}
    for i, spec in enumerate(SPECS):
        x = (i % 5) * 0.7
        y = (i // 5) * 0.9
        report[spec[0]] = build_specialist(sc, f"spec_{spec[0]}", (x, y, 0), -0.35, spec, looks[i])
    report["oracle"] = build_oracle(sc, "spec_oracle", (3 * 0.7 + 0.35, 0.9, 0), -0.35)
    return report
