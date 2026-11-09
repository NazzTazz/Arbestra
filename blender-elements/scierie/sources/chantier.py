"""Chantier de la scierie : étapes de travaux et bâtisseurs animés (Opus 5.5).

Proposition d'extension de SPEC-FACTORY-BATIMENTS.md (« Représentations intermédiaires
de travaux ») : la liste ordonnée d'étapes visuelles, qui ne contient qu'une étape
`travaux` aujourd'hui, en reçoit quatre pour la construction initiale de la scierie :
1. implantation et maçonnerie : piquets et cordeaux, dés de pierre, mur du fond à mi-hauteur,
   échafaudage, palettes de pierres taillées, bois de charpente livré ;
2. assemblage au sol : mur achevé, plancher provisoire en planches, une ferme en
   assemblage à plat, deux fermes en attente appuyées contre le mur ;
3. levage : poteaux, aisseliers et sablières, deux fermes levées, la troisième encore
   appuyée, échafaudage le long du versant ;
4. couverture : pannes, planches posées sur un versant et demi, poste de sciage installé.

Bâtisseurs : poses figées par étape et une séquence animée de 8 s sur l'étape 1
(maçon sur l'échafaudage, porteur entre la palette et l'échafaudage, tailleur au banc).

À lancer sans interface, depuis la racine du dépôt :
  blender --background --factory-startup --python blender-elements/scierie/sources/chantier.py
Écrit chantier.blend, previews/chantier-*.png et previews/chantier-maconnerie.mp4.
"""
import math, os, random, sys
import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(KIT, "..", ".."))
VIL = os.path.join(ROOT, "blender-elements", "villageois", "sources")

L = {"__name__": "scierie", "__file__": os.path.join(HERE, "scierie.py"), "SCIERIE_LIB": True}
with open(os.path.join(HERE, "scierie.py"), encoding="utf-8") as f:
    exec(compile(f.read(), "scierie.py", "exec"), L)
P = {"__name__": "villageois"}
for name in ("build_villageois.py", "tenues.py", "poses.py"):
    with open(os.path.join(VIL, name), encoding="utf-8") as f:
        exec(compile(f.read(), name, "exec"), P)

Scene, beam, block, log, masonry, patch = L["Scene"], L["beam"], L["block"], L["log"], L["masonry"], L["patch"]
truss, roof, frame, pit_saw, plank_stack = L["truss"], L["roof"], L["frame"], L["pit_saw"], L["plank_stack"]
OAK, BOARDS, DARK_OAK, STONE, ROPE, EARTH = L["OAK"], L["BOARDS"], L["DARK_OAK"], L["STONE"], L["ROPE"], L["EARTH"]
HALF, Y0, Y1, EAVE, TIE_H = L["HALF"], L["Y0"], L["Y1"], L["EAVE"], L["TIE_H"]
WALL_A, WALL_B, WALL_COURSES = L["WALL_A"], L["WALL_B"], L["WALL_COURSES"]
rig, Worker, animate_worker, set_vis, heading_to = P["rig"], P["Worker"], P["animate_worker"], P["set_vis"], P["heading_to"]
full, POSES, GESTURES, JOINTS, FX, FPS, DUR, NF = P["full"], P["POSES"], P["GESTURES"], P["JOINTS"], P["FX"], P["FPS"], P["DUR"], P["NF"]

TRUSSES = [Y0, (Y0 + Y1) / 2, Y1]
WALL_FRONT = WALL_A[1] - 0.07
MODULE = (0.28, 0.14)
LOOKS = [dict(skin=0, clothes=1, hair=1), dict(skin=1, clothes=3, hair=0), dict(skin=2, clothes=0, hair=2),
         dict(skin=1, clothes=2, hair=1), dict(skin=0, clothes=4, hair=2)]
# Poses de bâtisseur, mêmes conventions que poses.py (bras négatifs = vers l'avant, buste positif = penché).
LIFT = dict(bR=-1.25, bL=-1.25, buste=0.15, jR=-0.1, jL=0.1)
PLACE = dict(bR=-1.45, bL=-1.45, buste=0.55, jR=-0.12, jL=0.12)
HAND_UP = dict(bR=-2.5, bL=-2.45, buste=-0.18, jR=-0.1, jL=0.1)
PULL = dict(bR=-1.35, bL=-1.2, buste=-0.35, jR=-0.35, jL=0.3)


# ---------- éléments de chantier ----------
def group(S, name, objs, pivot):
    """Rassemble des pièces sous un repère placé en `pivot`, pour les déplacer ensemble."""
    e = bpy.data.objects.new(name, None)
    e.location = S.origin + Vector(pivot)
    S.sc.collection.objects.link(e)
    inv = Matrix.Translation(e.location).inverted()
    for o in objs:
        o.parent = e
        o.matrix_parent_inverse = inv
    return e


def leaning_truss(S, tag, k, y_base, tilt=0.24):
    """Ferme assemblée, posée sur son entrait et appuyée contre le mur du fond."""
    parts = truss(S, f"{tag} attente", k, 0.0)
    e = group(S, f"{tag} ferme en attente {k}", parts, (0, 0, EAVE - TIE_H / 2))
    e.location = S.origin + Vector((0, y_base, 0.0))
    e.rotation_euler = (-tilt, 0, 0)
    return e


def flat_truss(S, tag, y):
    """Ferme en cours d'assemblage, à plat sur des cales : il manque une contrefiche."""
    kept = []
    for o in truss(S, f"{tag} a plat", 9, 0.0):
        if "contrefiche" in o.name and o.name.endswith(" 1"):
            bpy.data.objects.remove(o, do_unlink=True)
        else:
            kept.append(o)
    parts = kept
    e = group(S, f"{tag} ferme a plat", parts, (0, 0, EAVE))
    e.location = S.origin + Vector((0, y, 0.16))
    e.rotation_euler = (math.pi / 2, 0, 0)
    for x in (-0.6, 0.0, 0.6):
        block(S, f"{tag} cale ferme {x}", (x, y + 0.05, 0.05), (0.1, 0.5, 0.1), L["DARK_OAK"], chamfer=0.1)
    return e


def pegs(S, tag):
    pts = [(-1.02, Y0 - 0.16), (1.02, Y0 - 0.16), (1.02, Y1 + 0.2), (-1.02, Y1 + 0.2)]
    for k, (x, y) in enumerate(pts):
        beam(S, f"{tag} piquet {k}", (x, y, 0.0), (x, y, 0.26), 0.03, 0.03, OAK)
    for k in range(4):
        (x0, y0), (x1, y1) = pts[k], pts[(k + 1) % 4]
        beam(S, f"{tag} cordeau {k}", (x0, y0, 0.22), (x1, y1, 0.22), 0.006, 0.006, ROPE, chamfer=0.0)


def pallet(S, tag, x, y, counts, rot=0.0):
    """Palette de pierres taillées (modules 0,28 × 0,14 × 0,14) : `counts` pierres par lit."""
    q = Quaternion((0, 0, 1), rot)
    c = Vector((x, y, 0))
    at = lambda dx, dy, z: c + q @ Vector((dx, dy, z))
    for dy in (-0.17, 0.0, 0.17):
        beam(S, f"{tag} longeron {dy}", at(-0.31, dy, 0.035), at(0.31, dy, 0.035), 0.07, 0.07, DARK_OAK)
    for dx in (-0.26, -0.13, 0.0, 0.13, 0.26):
        beam(S, f"{tag} planche palette {dx}", at(dx, -0.23, 0.08), at(dx, 0.23, 0.08), 0.1, 0.02, OAK, roll=0)
    slots = [(dx, dy) for dy in (-0.145, 0.0, 0.145) for dx in (-0.145, 0.145)]
    for layer, n in enumerate(counts):
        for k in range(n):
            dx, dy = slots[k]
            block(S, f"{tag} pierre {layer} {k}", at(dx, dy, 0.09 + 0.07 + layer * 0.142), (0.27, 0.135, 0.135), STONE,
                  chamfer=0.12, quat=q)


def timber_stack(S, tag, x, y, count, length=1.3):
    """Bois de charpente livré : poteaux équarris sur deux cales, selon y."""
    for s in (-0.35, 0.35):
        beam(S, f"{tag} cale {s}", (x - 0.25, y + s * length, 0.035), (x + 0.25, y + s * length, 0.035), 0.07, 0.07, DARK_OAK)
    for k in range(count):
        row, col = divmod(k, 3)
        xx = x + (col - 1) * 0.15 + row * 0.07
        beam(S, f"{tag} poteau livre {k}", (xx, y - length / 2, 0.14 + row * 0.14), (xx, y + length / 2, 0.14 + row * 0.14), 0.14, 0.14)


def plank_floor(S, tag, x0, x1, y0, y1, seed=0):
    """Sol provisoire : planches posées à même la terre, joints décalés."""
    rng = random.Random(seed)
    n = round((x1 - x0) / 0.15)
    w = (x1 - x0) / n
    for i in range(n):
        x = x0 + (i + 0.5) * w
        a, b = y0 + rng.uniform(-0.05, 0.03), y1 + rng.uniform(-0.03, 0.05)
        beam(S, f"{tag} plancher {i}", (x, a, 0.012), (x, b, 0.012), w - 0.012, 0.024, BOARDS, roll=0)


def scaffold(S, tag, along, s0, s1, inner, outer, decks, rail=True):
    """Échafaudage en perches : montants, lisses, boulins, platelage de trois planches, écharpe."""
    def P3(s, t, z):
        return (s, t, z) if along == 'x' else (t, s, z)
    n = max(2, math.ceil((s1 - s0) / 0.9) + 1)
    ss = [s0 + i * (s1 - s0) / (n - 1) for i in range(n)]
    top = decks[-1] + (0.5 if rail else 0.1)
    for s in ss:
        for t in (inner, outer):
            beam(S, f"{tag} montant {s:.2f} {t:.2f}", P3(s, t, 0.0), P3(s, t, top), 0.045, 0.045, OAK, chamfer=0.0)
        for z in decks:
            beam(S, f"{tag} boulin {s:.2f} {z}", P3(s, inner - 0.04 * (1 if outer < inner else -1), z - 0.03), P3(s, outer, z - 0.03),
                 0.04, 0.04, OAK, chamfer=0.0)
    for z in decks:
        for t in (inner, outer):
            beam(S, f"{tag} lisse {z} {t:.2f}", P3(s0 - 0.05, t, z - 0.07), P3(s1 + 0.05, t, z - 0.07), 0.04, 0.04, OAK, chamfer=0.0)
        for k in range(3):
            t = inner + (outer - inner) * (k + 0.5) / 3
            beam(S, f"{tag} platelage {z} {k}", P3(s0 - 0.08, t, z), P3(s1 + 0.08, t, z), abs(outer - inner) / 3 - 0.01, 0.025,
                 BOARDS, chamfer=0.05)
        if rail:
            beam(S, f"{tag} garde-corps {z}", P3(s0, outer, z + 0.45), P3(s1, outer, z + 0.45), 0.035, 0.035, OAK, chamfer=0.0)
    for a, b in zip(ss, ss[1:]):
        beam(S, f"{tag} echarpe {a:.2f}", P3(a, outer, 0.05), P3(b, outer, decks[-1] - 0.05), 0.035, 0.035, OAK, chamfer=0.0)


def course_blocks(row):
    """Centres et longueurs des pierres d'une assise du mur du fond, comme `masonry`."""
    a, b = Vector((*WALL_A, 0)), Vector((*WALL_B, 0))
    length = (b - a).length
    x, out = -length / 2, []
    first = MODULE[0] / 2 if row % 2 else MODULE[0]
    while x < length / 2 - 0.001:
        ln = min(first if x == -length / 2 else MODULE[0], length / 2 - x)
        out.append((x + ln / 2 + (a.x + b.x) / 2, ln))
        x += ln
    return out


def wall_stone(S, tag, row, k):
    cx, ln = course_blocks(row)[k]
    return block(S, f"{tag} pierre posee {row} {k}", (cx, WALL_A[1], (row + 0.5) * MODULE[1]), (ln - 0.008, 0.14, MODULE[1] - 0.008),
                 STONE, chamfer=0.12)


# ---------- bâtisseurs ----------
def builder(sc, S, name, at, facing, pose, look, hat="bonnet", tool=None, z=0.0, carry=None, carry_at=(0, -0.2, 0.32)):
    """Figurine posée ; `facing` est un point local vers lequel elle regarde ; `carry` : objet tenu devant elle."""
    w = S.origin + Vector((at[0], at[1], 0))
    h = heading_to(at, facing)
    n = rig(sc, f"{S.sc.name} {name}", (w.x, w.y), h, look, hat=hat, tool=tool)
    n["root"].location.z = z
    p = full(POSES[pose] if isinstance(pose, str) else pose)
    for k in JOINTS:
        n[k].rotation_euler = (p[k], 0, 0)
    if carry:
        carry.parent = n["root"]
        carry.matrix_parent_inverse = Matrix.Identity(4)
        carry.location = carry_at  # l'orientation de la pièce est conservée
    return n


SHOULDER = (0.13, 0.0, 0.5)  # planche sur l'épaule droite, dans l'axe de la marche


def stone_in_hand(S, name):
    return block(S, name, (0, 0, 0), (0.27, 0.135, 0.135), STONE, chamfer=0.12)


def plank_on_shoulder(S, name):
    o = beam(S, name, (0, -0.6, 0), (0, 0.6, 0), 0.12, 0.028, OAK)
    return o


# ---------- étapes ----------
def stage_site(sc, step, origin):
    S = Scene(sc, origin)
    tag = f"chantier {step}"
    patch(S, f"{tag} cour", (0.0, 0.0, 0), 1.24, 1.2, EARTH, z=0.002, n=16, seed=step)
    if step == 1:
        pegs(S, tag)
        frame(S, tag, TRUSSES, posts=False, plates=False)
        masonry(S, f"{tag} mur", WALL_A, WALL_B, 0.0, 3, seed=1)
        for k in range(2):
            wall_stone(S, tag, 3, k)
        scaffold(S, f"{tag} echafaudage", 'x', -0.8, 0.8, WALL_FRONT - 0.06, WALL_FRONT - 0.42, [0.3], rail=False)
        pallet(S, f"{tag} palette A", -0.62, -0.84, [6, 6, 4])
        pallet(S, f"{tag} palette B", 0.12, -0.72, [6, 3], rot=0.2)
        timber_stack(S, f"{tag} charpente", 0.55, -0.2, 5, length=1.0)
        banker = block(S, f"{tag} banc de taille", (0.62, -0.98, 0.16), (0.26, 0.26, 0.32), STONE, chamfer=0.1)
        block(S, f"{tag} pierre a tailler", (0.62, -0.98, 0.39), (0.27, 0.135, 0.135), STONE, chamfer=0.12)
        return S
    masonry(S, f"{tag} mur", WALL_A, WALL_B, 0.0, WALL_COURSES, seed=1)
    if step == 2:
        frame(S, tag, TRUSSES, posts=False, plates=False)
        plank_floor(S, tag, -0.78, 0.78, Y0 - 0.05, 0.62, seed=2)
        flat_truss(S, tag, 0.18)
        # la première touche le mur, la seconde s'appuie sur la première
        for k, (yb, tilt) in enumerate(((0.86, 0.33), (0.76, 0.42))):
            leaning_truss(S, tag, k, yb, tilt=tilt)
        pallet(S, f"{tag} palette", -0.62, -0.84, [5])
        for x in (0.25, 1.0):  # poteaux et sablières en attente, couchés sur deux cales
            beam(S, f"{tag} cale poteaux {x}", (x, -1.12, 0.035), (x, -0.4, 0.035), 0.07, 0.07, DARK_OAK)
        for k in range(4):
            y = -1.02 + k * 0.19
            beam(S, f"{tag} poteau couche {k}", (0.08, y, 0.14), (1.18, y, 0.14), 0.14, 0.14)
        return S
    frame(S, tag, TRUSSES)
    if step == 3:
        plank_floor(S, tag, -0.78, 0.78, Y0 - 0.05, 0.62, seed=3)
        roof(S, tag, TRUSSES, raised=(0, 1), purlins=False)
        flat_truss(S, f"{tag} derniere", 0.12)
        scaffold(S, f"{tag} echafaudage", 'y', Y0 - 0.1, Y1 - 0.05, HALF + 0.14, HALF + 0.38, [0.92])
        for k in range(4):
            y = -1.0 + k * 0.15
            beam(S, f"{tag} panne couchee {k}", (-0.2, y, 0.035), (1.0, y, 0.035), 0.07, 0.07)
        return S
    # étape 4 : couverture en cours
    roof(S, tag, TRUSSES, cover=(1.0, 0.45))
    scaffold(S, f"{tag} echafaudage", 'y', Y0 - 0.1, Y1 - 0.05, HALF + 0.14, HALF + 0.38, [0.92])
    pit_saw(S, tag)
    plank_stack(S, f"{tag} planches", -0.5, -0.8, 3, length=0.9, per_layer=4, cover=False, seed=44)
    return S


def stage_builders(sc, S, step):
    if step == 1:
        builder(sc, S, "macon", (-0.37, WALL_FRONT - 0.24), (-0.37, 1.5), PLACE, LOOKS[0], z=0.32,
                carry=stone_in_hand(S, "pierre tenue macon"))
        builder(sc, S, "porteur", (-0.25, -0.35), (-0.05, 0.5), "porter", LOOKS[1], carry=stone_in_hand(S, "pierre tenue porteur"))
        builder(sc, S, "tailleur", (0.62, -1.24 + 0.02), (0.62, 0.0), GESTURES["masse"]["prep"], LOOKS[2], hat="casque", tool="masse")
    elif step == 2:
        builder(sc, S, "charpentier", (-0.45, -0.18), (-0.45, 0.3), GESTURES["masse"]["hit"], LOOKS[3], tool="masse")
        builder(sc, S, "aide", (0.5, -0.2), (0.3, 0.3), "ramasser", LOOKS[1])
        builder(sc, S, "porteur", (-0.3, -1.05), (0.4, -1.0), "porter", LOOKS[0], carry=plank_on_shoulder(S, "planche tenue"),
                carry_at=SHOULDER)
    elif step == 3:
        # deux hommes au cordage, un charpentier sur l'échafaudage
        apex = Vector((0.0, TRUSSES[1], L["RIDGE"]))  # la ferme qu'on vient de lever, tenue au cordage
        for k, at in enumerate(((-0.25, -0.75), (0.15, -0.95))):
            n = builder(sc, S, f"haleur {k}", at, (0.0, 1.0), PULL, LOOKS[k])
            hand = S.origin + Vector((at[0], at[1] + 0.2, 0.48))
            beam(S, f"cordage {k}", hand - S.origin, apex, 0.012, 0.012, ROPE, chamfer=0.0)
        builder(sc, S, "charpentier", (HALF + 0.26, 0.4), (0.0, 0.4), GESTURES["masse"]["prep"], LOOKS[3], tool="masse", z=0.94)
    elif step == 4:
        builder(sc, S, "couvreur", (HALF + 0.26, 0.55), (0.0, 0.55), "penche", LOOKS[4], z=0.94)
        builder(sc, S, "porteur", (0.25, -1.05), (1.0, -0.6), "porter", LOOKS[1], carry=plank_on_shoulder(S, "planche tenue"),
                carry_at=SHOULDER)


# ---------- séquence animée : maçonnerie (étape 1) ----------
def animate_masonry(sc, S):
    o = (S.origin.x, S.origin.y)
    deck = bpy.data.objects.new("plateforme macon", None)
    deck.location = (0, 0, 0.32)
    sc.collection.objects.link(deck)
    yM = WALL_FRONT - 0.24
    targets = [course_blocks(3)[k][0] for k in (2, 3, 4)]
    up, down = math.pi, 0.0  # face au mur, face à la cour
    # pierres déposées sur le platelage, côté cour, et pierres posées dans l'assise 4
    deck_stones = [block(S, f"pierre platelage {k}", (x - 0.1, WALL_FRONT - 0.38, 0.4), (0.27, 0.135, 0.135), STONE, chamfer=0.12)
                   for k, x in enumerate(targets)]
    laid = [wall_stone(S, "anime", 3, k) for k in (2, 3, 4)]
    picks, places = [1.2, 4.3, 6.9], [2.3, 5.2, 7.75]
    set_vis(deck_stones[0], [(0, picks[0])])
    set_vis(deck_stones[1], [(3.45, picks[1])])
    set_vis(deck_stones[2], [(0, picks[2])])
    for stone, t in zip(laid, places):
        set_vis(stone, [(t, DUR + 1)])

    m = Worker("macon", (targets[0], yM), up, 501)
    m.keys(0.0, 0.8, [(0.0, "regarde"), (0.8, "regarde")])
    for i, (tx, tp, tl) in enumerate(zip(targets, picks, places)):
        start = 0.8 if i == 0 else places[i - 1] + 0.5
        if i:
            m.walk(places[i - 1] + 0.4, start + 0.5, [(targets[i - 1], yM), (tx, yM)])
            start += 0.5
        m.keys(start, tp + 0.4, [(start, "regarde"), (tp - 0.15, "ramasser"), (tp + 0.4, LIFT)], turn=(up, down))
        m.keys(tp + 0.4, tl + 0.35, [(tp + 0.4, LIFT), (tl - 0.1, PLACE), (tl + 0.35, "regarde")], turn=(down, up))
    hand = stone_in_hand(S, "pierre en main macon")
    nodes = rig(sc, "macon anime", (0, 0), up, LOOKS[0], hat="bonnet")
    nodes["root"].parent = deck
    hand.parent = nodes["root"]
    hand.matrix_parent_inverse = Matrix.Identity(4)
    hand.location = (0, -0.22, 0.36)
    animate_worker(m, nodes, o)
    set_vis(hand, [(tp, tl) for tp, tl in zip(picks, places)])

    # porteur : palette A → pied de l'échafaudage → passe la pierre → retour
    pal, foot = (-0.5, -0.6), (-0.15, WALL_FRONT - 0.52)
    p = Worker("porteur", pal, heading_to(pal, (-0.62, -0.84)), 502)
    p.keys(0.0, 0.9, [(0.0, "regarde"), (0.5, "ramasser"), (0.9, "porter")])
    p.walk(0.9, 2.8, [pal, (-0.4, 0.0), foot], loaded=True)
    p.keys(2.8, 3.7, [(2.8, "porter"), (3.3, HAND_UP), (3.7, "regarde")], turn=(heading_to((-0.4, 0.0), foot), math.pi))
    p.walk(3.7, 5.6, [foot, (-0.4, 0.0), pal])
    p.keys(5.6, 6.6, [(5.6, "regarde"), (6.1, "ramasser"), (6.6, "porter")], turn=(heading_to((-0.4, 0.0), pal), heading_to(pal, (-0.62, -0.84))))
    p.walk(6.6, 8.0, [pal, (-0.4, 0.0), foot], loaded=True)
    pn = rig(sc, "porteur anime", (0, 0), 0.0, LOOKS[1], hat="bonnet")
    carried = stone_in_hand(S, "pierre portee")
    carried.parent = pn["root"]
    carried.matrix_parent_inverse = Matrix.Identity(4)
    carried.location = (0, -0.2, 0.32)
    animate_worker(p, pn, o)
    set_vis(carried, [(0.6, 3.45), (6.1, DUR + 1)])

    # tailleur au banc : coups de masse et éclats
    fx = FX(sc, seed=7)
    at = (0.62, -1.22)
    t = Worker("tailleur", at, heading_to(at, (0.62, 0.0)), 503)
    _, hits = t.strikes(0.2, DUR, "masse")
    tn = rig(sc, "tailleur anime", (0, 0), 0.0, LOOKS[2], hat="casque", tool="masse")
    animate_worker(t, tn, o)
    for h in hits:
        fx.bits(h, (S.origin.x + 0.62, S.origin.y - 0.98, 0.47), 3, "eclat", up=1.1, spread=0.5)


def video(sc, path):
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, NF
    im = sc.render.image_settings
    if hasattr(im, "media_type"):
        im.media_type = 'VIDEO'
    im.file_format = 'FFMPEG'
    sc.render.ffmpeg.format = 'MPEG4'
    sc.render.ffmpeg.codec = 'H264'
    sc.render.ffmpeg.constant_rate_factor = 'HIGH'
    sc.render.filepath = path
    bpy.ops.render.render(animation=True, scene=sc.name)


out = os.path.join(KIT, "previews")
RIGHT = Vector((math.cos(0.588), math.sin(0.588), 0))
stage, render = L["stage"], L["render"]

# planche : quatre étapes et la scierie achevée (niveau 1)
sc = stage("CHANTIER etapes")
sites = []
for k in range(5):
    at = RIGHT * ((k - 2) * 3.7)
    if k < 4:
        S = stage_site(sc, k + 1, (at.x, at.y))
        stage_builders(sc, S, k + 1)
        sites.append(at)
    else:
        L["sawmill"](sc, 1, (at.x, at.y))
        sites.append(at)
render(sc, (0, 0, 0.7), 19.5, (1700, 560), os.path.join(out, "chantier-etapes.png"))
for k in range(4):
    render(sc, (sites[k].x, sites[k].y, 0.6), 4.7, (900, 700), os.path.join(out, f"chantier-etape-{k + 1}.png"))

# séquence animée
if "--sans-video" not in sys.argv:
    sc = stage("CHANTIER maconnerie animee")
    S = stage_site(sc, 1, (0, 0))
    animate_masonry(sc, S)
    cam_target = (0.0, 0.0, 0.55)
    L["render"](sc, cam_target, 4.4, (960, 720), os.path.join(out, "chantier-maconnerie-image.png"))
    video(sc, os.path.join(out, "chantier-maconnerie.mp4"))

for name in [s.name for s in bpy.data.scenes if not s.name.startswith("CHANTIER")]:
    if len(bpy.data.scenes) > 1:
        bpy.data.scenes.remove(bpy.data.scenes[name])
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(KIT, "chantier.blend"), copy=True, compress=True)
print("ok")
