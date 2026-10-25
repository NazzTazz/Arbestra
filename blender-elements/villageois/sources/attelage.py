"""Cheval (et licorne), carriole et gabarit de l'attelage (Opus 5.5).

À exécuter dans le même espace de noms que build_villageois.py, tenues.py et poses.py.
Échelle commune aux figurines : un villageois mesure 0,69 m, garrot du cheval à ~0,6 m.
Repère Blender : Z haut, l'animal regarde vers -Y, origine au sol sous le centre du corps.
"""
import bpy, math
from mathutils import Vector, Matrix

HORSE_COLOURS = {
    "bai": dict(body=hexc("8a5a35"), mane=hexc("2e2420"), muzzle=hexc("6e462a"), hoof=hexc("2a2420")),
    "alezan": dict(body=hexc("a8673a"), mane=hexc("d9b07a"), muzzle=hexc("8a5230"), hoof=hexc("3a2c22")),
    "gris": dict(body=hexc("b9b6b0"), mane=hexc("6d6b68"), muzzle=hexc("8f8c88"), hoof=hexc("3a3836")),
    "licorne": dict(body=hexc("efe9df"), mane=hexc("c4b2e6"), muzzle=hexc("e2d8cc"), hoof=hexc("bfa67a")),
}
LEATHER, LEATHER_DARK = hexc("6b3f22"), hexc("4a2a16")
WOOD_CART, WOOD_CART_DARK = hexc("a07a4c"), hexc("6e5132")
IRON = hexc("4f4f52")

# dimensions du cheval
BODY_Z = 0.47        # axe du tronc
LEG_TOP = 0.43       # pivot des jambes
LEG_X, LEG_Y = 0.085, 0.22
NECK_PIVOT = (0.0, -0.27, 0.55)
TAIL_PIVOT = (0.0, 0.33, 0.53)
NECK_TILT = 0.6       # cou vers l'avant
TAIL_TILT = 0.2       # queue qui tombe près de la croupe (positif = bas de la queue vers l'arrière)


def ring_y(y, r, n, zc, sz=1.0, phase=math.pi / 8):
    """Anneau autour de l'axe Y (corps couché le long de Y), sens direct vu depuis -Y."""
    return [Vector((r * math.cos(phase - i * math.tau / n), y, zc + r * sz * math.sin(phase - i * math.tau / n)))
            for i in range(n)]


def loft_y(p, rings, cols):
    """Bandes entre anneaux de Y décroissant (de l'arrière vers l'avant)."""
    loft(p, rings, cols)


def horse_body(c):
    p, n = Part(), 8
    rs = [ring_y(0.34, 0.07, n, BODY_Z + 0.02), ring_y(0.28, 0.13, n, BODY_Z, 1.05), ring_y(0.08, 0.15, n, BODY_Z - 0.01, 1.08),
          ring_y(-0.14, 0.15, n, BODY_Z, 1.1), ring_y(-0.29, 0.12, n, BODY_Z + 0.03, 1.15), ring_y(-0.34, 0.07, n, BODY_Z + 0.06)]
    loft(p, rs, [c["body"]] * 5)
    cap_top(p, list(reversed(rs[0])), Vector((0, 0.36, BODY_Z + 0.02)), c["body"])
    cap_top(p, rs[-1], Vector((0, -0.36, BODY_Z + 0.07)), c["body"])
    return p


def horse_leg(c, front):
    """Jambe hexagonale, sabot sombre ; origine au pivot (épaule ou hanche)."""
    p, n = Part(), 6
    top_r = 0.06 if front else 0.07
    rs = [ring(-LEG_TOP, 0.04, n), ring(-LEG_TOP + 0.045, 0.038, n), ring(-LEG_TOP + 0.05, 0.034, n),
          ring(-0.2, 0.038, n), ring(-0.05, top_r, n, 1.2), ring(0.04, top_r * 0.8, n, 1.2)]
    loft(p, rs, [c["hoof"], c["hoof"], c["body"], c["body"], c["body"]])
    cap_bottom(p, rs[0], Vector((0, 0, -LEG_TOP)), c["hoof"])
    cap_top(p, rs[-1], Vector((0, 0, 0.06)), c["body"])
    return p


def horse_neck(c):
    """Cou le long de +Z local (incliné par le pivot), crinière sur l'arête arrière."""
    p, n = Part(), 6
    rs = [ring(-0.03, 0.085, n, 1.2), ring(0.12, 0.07, n, 1.15), ring(0.27, 0.055, n, 1.1)]
    loft(p, rs, [c["body"], c["body"]])
    cap_top(p, rs[-1], Vector((0, 0, 0.29)), c["body"])
    for k in range(4):
        z0 = 0.0 + k * 0.07
        two_sided(p, [(-0.012, 0.075 - k * 0.004, z0), (0.012, 0.075 - k * 0.004, z0), (0.0, 0.11 - k * 0.004, z0 + 0.06)],
                  c["mane"])
    return p


def horse_head(c, unicorn=False):
    """Tête le long de -Y local depuis le sommet du cou ; oreilles, yeux, naseaux."""
    p, n = Part(), 6
    rs = [ring_y(0.03, 0.055, n, 0.0, 1.1), ring_y(-0.08, 0.05, n, -0.02, 1.0), ring_y(-0.2, 0.038, n, -0.05, 0.9)]
    loft(p, rs, [c["body"], c["muzzle"]])
    cap_top(p, list(reversed(rs[0])), Vector((0, 0.05, 0.0)), c["body"])
    cap_top(p, rs[-1], Vector((0, -0.215, -0.055)), c["muzzle"])
    for s in (-1, 1):
        two_sided(p, [(s * 0.02, 0.02, 0.05), (s * 0.045, 0.03, 0.05), (s * 0.035, 0.035, 0.11)], c["body"])
        quad_on(p, Vector((s * 0.052, -0.04, 0.01)), Vector((s, -0.3, 0.2)), 0.008, 0.01, hexc("1c1a1a"))
    for k in range(3):
        two_sided(p, [(-0.01, 0.03 - k * 0.03, 0.055), (0.01, 0.03 - k * 0.03, 0.055), (0.0, 0.04 - k * 0.03, 0.09)], c["mane"])
    if unicorn:
        spiral = Part()
        rg = ring(0, 0.018, 5)
        cap_top(spiral, rg, Vector((0, 0, 0.16)), GOLD)
        cap_bottom(spiral, rg, Vector((0, 0, 0)), mul(GOLD, (0.7,) * 3))
        p.add(spiral, Matrix.Translation((0, -0.05, 0.05)) @ Matrix.Rotation(-0.6, 4, 'X'))
    return p


def horse_tail(c):
    p = Part()
    rs = [ring(0.0, 0.035, 5), ring(-0.12, 0.045, 5, cy=0.015)]
    loft(p, [rs[1], rs[0]], [c["mane"]])
    cap_bottom(p, rs[1], Vector((0, 0.03, -0.3)), c["mane"])
    cap_top(p, rs[0], Vector((0, 0, 0.02)), c["mane"])
    return p


def harness():
    """Collier et sellette ; repère du corps."""
    p = Part()
    a = ring_y(-0.27, 0.165, 8, BODY_Z + 0.04, 1.2)
    b = ring_y(-0.31, 0.165, 8, BODY_Z + 0.04, 1.2)
    loft(p, [b, a], [LEATHER])
    loft(p, [a, b], [LEATHER_DARK])
    for s in (-1, 1):
        box(p, s * 0.15, -0.05, BODY_Z + 0.02, 0.012, 0.06, 0.2, LEATHER_DARK)
    box(p, 0, -0.05, BODY_Z + 0.16, 0.2, 0.08, 0.025, LEATHER)
    return p


def horse_rig(sc, name, at, heading, coat="bai", unicorn=False, harnessed=False):
    c = HORSE_COLOURS["licorne" if unicorn else coat]
    root = bpy.data.objects.new(name, None)
    sc.collection.objects.link(root)
    root.location = (at[0], at[1], 0)
    root.rotation_euler = (0, 0, heading)
    body = bpy.data.objects.new(f"{name}_corps", None)
    sc.collection.objects.link(body)
    body.parent = root
    nodes = dict(root=root, corps=body)
    obj(sc, f"{name}_tronc", horse_body(c), WHITE, body)
    if harnessed:
        obj(sc, f"{name}_harnais", harness(), WHITE, body)
    for key, (sx, sy) in (("avG", (-1, -1)), ("avD", (1, -1)), ("arG", (-1, 1)), ("arD", (1, 1))):
        nodes[key] = obj(sc, f"{name}_{key}", horse_leg(c, sy < 0), WHITE, body, (sx * LEG_X, sy * LEG_Y, LEG_TOP))
    # rotation X positive = sommet vers l'avant (-Y) : le cou part vers l'avant, la tête pique du nez (0,6 − 0,1)
    neck = obj(sc, f"{name}_cou", horse_neck(c), WHITE, body, NECK_PIVOT, (NECK_TILT, 0, 0))
    nodes["cou"] = neck
    nodes["tete"] = obj(sc, f"{name}_tete", horse_head(c, unicorn), WHITE, neck, (0, -0.02, 0.27), (-0.1, 0, 0))
    nodes["queue"] = obj(sc, f"{name}_queue", horse_tail(c), WHITE, body, TAIL_PIVOT, (TAIL_TILT, 0, 0))
    return nodes


def gait(t, speed, kind="pas"):
    """Pas : quatre temps ; trot : bipèdes diagonaux. Renvoie angles des jambes, tangage et rebond."""
    if speed <= 0.01:
        return dict(avG=0, avD=0, arG=0, arD=0, bob=0.0, cou=NECK_TILT, queue=TAIL_TILT)
    stride = 0.55 if kind == "pas" else 0.8          # mètres par cycle
    ph = (t * speed / stride) * math.tau
    amp = 0.32 if kind == "pas" else 0.45
    if kind == "pas":
        offs = dict(arG=0.0, avG=0.25, arD=0.5, avD=0.75)
    else:
        offs = dict(avG=0.0, arD=0.0, avD=0.5, arG=0.5)
    out = {k: amp * math.sin(ph + o * math.tau) for k, o in offs.items()}
    out["bob"] = 0.012 * math.sin(2 * ph) * (1.6 if kind == "trot" else 1.0)
    out["cou"] = NECK_TILT + 0.08 * math.sin(2 * ph + 0.6)
    out["queue"] = TAIL_TILT + 0.1 * math.sin(ph)
    return out


# ---------- carriole ----------
WHEEL_R = 0.22
TRACK = 0.62          # entraxe des roues
BED = dict(x=0.27, y0=-0.26, y1=0.36, z=0.33)
SHAFT_LEN = 0.78      # de l'avant de la caisse au collier
HITCH = -BED["y0"] + SHAFT_LEN   # distance essieu -> collier (bout des brancards) : 1,04 m
COLLAR = 0.29         # du centre du cheval au collier, vers l'avant


def wheel():
    p, n = Part(), 12
    for s in (-1, 1):
        x = s * 0.025
        outer = [Vector((x, WHEEL_R * math.cos(i * math.tau / n), WHEEL_R + WHEEL_R * math.sin(i * math.tau / n))) for i in range(n)]
        inner = [Vector((x, (WHEEL_R - 0.035) * math.cos(i * math.tau / n), WHEEL_R + (WHEEL_R - 0.035) * math.sin(i * math.tau / n))) for i in range(n)]
        for i in range(n):
            j = (i + 1) % n
            q = [inner[i], outer[i], outer[j], inner[j]]
            p.face(q if s > 0 else list(reversed(q)), IRON)
    o0 = [Vector((-0.025, WHEEL_R * math.cos(i * math.tau / n), WHEEL_R + WHEEL_R * math.sin(i * math.tau / n))) for i in range(n)]
    o1 = [Vector((0.025, WHEEL_R * math.cos(i * math.tau / n), WHEEL_R + WHEEL_R * math.sin(i * math.tau / n))) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        p.face([o0[j], o0[i], o1[i], o1[j]], IRON)
    for k in range(6):
        a = k * math.tau / 6
        spoke = Part()
        box(spoke, 0, 0, (WHEEL_R - 0.03) / 2, 0.018, 0.02, WHEEL_R - 0.03, WOOD_CART_DARK)
        p.add(spoke, Matrix.Translation((0, 0, WHEEL_R)) @ Matrix.Rotation(a, 4, 'X'))
    p.add(cyl(0.035, -0.04, 0.04, 6, WOOD_CART_DARK), Matrix.Translation((0, 0, WHEEL_R)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    return p


def cart_body():
    """Caisse, ridelles, brancards et essieu ; origine au sol sous l'essieu, avant vers -Y."""
    p = Part()
    x, y0, y1, z = BED["x"], BED["y0"], BED["y1"], BED["z"]
    box(p, 0, (y0 + y1) / 2, z, 2 * x, y1 - y0, 0.04, WOOD_CART)
    for s in (-1, 1):
        box(p, s * (x - 0.012), (y0 + y1) / 2, z + 0.09, 0.024, y1 - y0, 0.14, WOOD_CART_DARK)
    box(p, 0, y0 + 0.012, z + 0.09, 2 * x, 0.024, 0.14, WOOD_CART_DARK)
    box(p, 0, y1 - 0.012, z + 0.07, 2 * x, 0.024, 0.1, WOOD_CART_DARK)
    for s in (-1, 1):
        # brancard de l'avant de la caisse au collier, de part et d'autre du cheval, en montant de 0,16 m
        a = Vector((s * 0.18, y0 + 0.05, z))
        b = Vector((s * 0.18, y0 - SHAFT_LEN, z + 0.16))
        d = b - a
        sh = Part()
        box(sh, 0, 0, 0, 0.03, d.length, 0.03, WOOD_CART_DARK)
        # pavé le long de Y : une rotation X de -atan2(dz, -dy) l'aligne sur (0, -dy, dz)
        p.add(sh, Matrix.Translation((a + b) / 2) @ Matrix.Rotation(-math.atan2(d.z, -d.y), 4, 'X'))
    box(p, 0, 0, WHEEL_R, TRACK, 0.05, 0.05, IRON)
    return p


def load_part(kind):
    p = Part()
    x, y0, y1, z = BED["x"], BED["y0"], BED["y1"], BED["z"] + 0.02
    if kind == "bois":
        for i, (dx, dz) in enumerate(((-0.13, 0), (0, 0), (0.13, 0), (-0.065, 0.1), (0.065, 0.1))):
            p.add(cyl(0.055, y0 + 0.04, y1 - 0.04, 6, hexc("7a5532"), cap_col=hexc("c9a571")),
                  Matrix.Translation((dx, 0, z + 0.06 + dz)) @ Matrix.Rotation(-math.pi / 2, 4, 'X'))
    elif kind == "pierre":
        for i, (dx, dy, dz) in enumerate(((-0.12, -0.12, 0), (0.1, -0.1, 0), (-0.05, 0.15, 0), (0.12, 0.14, 0), (0.0, 0.0, 0.1))):
            box(p, dx, dy, z + 0.06 + dz, 0.16, 0.15, 0.12, hexc("9a9b96"))
    elif kind == "sacs":
        for i, (dx, dy) in enumerate(((-0.12, -0.1), (0.12, -0.1), (-0.12, 0.17), (0.12, 0.17))):
            ball(p, Vector((dx, dy, z + 0.08)), 0.1, 6, 4, hexc("d8c79c"))
    elif kind == "carottes":
        for i, (dx, dy) in enumerate(((-0.1, -0.08), (0.1, -0.08), (0.0, 0.18))):
            box(p, dx, dy, z + 0.07, 0.2, 0.15, 0.14, hexc("b98a55"))
            q = [(dx - 0.08, dy - 0.06, z + 0.14), (dx + 0.08, dy - 0.06, z + 0.14), (dx + 0.08, dy + 0.06, z + 0.14), (dx - 0.08, dy + 0.06, z + 0.14)]
            for k in range(4):
                p.face([q[k], q[(k + 1) % 4], (dx, dy, z + 0.2)], hexc("ee8a2c") if k % 2 else hexc("c8641a"))
    return p


def cart_rig(sc, name, load=None):
    root = bpy.data.objects.new(name, None)
    sc.collection.objects.link(root)
    obj(sc, f"{name}_caisse", cart_body(), WHITE, root)
    wheels = []
    for s in (-1, 1):
        wheels.append(obj(sc, f"{name}_roue{s}", wheel(), WHITE, root, (s * (TRACK / 2 + 0.03), 0, 0)))
    if load:
        obj(sc, f"{name}_charge_{load}", load_part(load), WHITE, root)
    return dict(root=root, roues=wheels)


# ---------- cinématique de remorque ----------
def trailer(path_pts, step=0.02):
    """Le cheval suit le tracé ; l'essieu de la carriole est tiré au bout d'une barre de longueur HITCH.
    Renvoie [(position cheval, cap cheval, position essieu, cap carriole, distance)] par pas de `step`."""
    pts = [Vector((x, y, 0)) for x, y in path_pts]
    seg = [(a, b, (b - a).length) for a, b in zip(pts, pts[1:])]
    total = sum(s[2] for s in seg)
    out, d = [], 0.0
    first_dir = (pts[1] - pts[0]).normalized()
    axle = pts[0] + first_dir * COLLAR - first_dir * HITCH
    while d <= total:
        acc, pos, dirv = 0.0, pts[-1], first_dir
        for a, b, l in seg:
            if d <= acc + l:
                pos = a + (b - a) * ((d - acc) / l)
                dirv = (b - a).normalized()
                break
            acc += l
        hitch = pos + dirv * COLLAR   # le cheval tire au collier, devant son centre
        v = hitch - axle
        axle = hitch - v.normalized() * HITCH
        out.append((pos.copy(), math.atan2(dirv.x, -dirv.y), axle.copy(), math.atan2(v.x, -v.y), d))
        d += step
    return out
