"""Prototype des poses de chantier (Opus 5.5), d'après docs/SPEC-CHANTIERS-ANIMES-SEQUENCES.md.

À exécuter dans le même espace de noms que build_villageois.py et tenues.py, avec
`G` = espace de noms de build_opus.py (carré potager). Crée la scène « VIL chantiers »
animée sur DUR secondes et la scène « VIL planche poses » (poses figées).

Conventions des angles (rotation X, identiques dans Babylon pour ce squelette) :
bras et jambes négatifs = vers l'avant ; buste positif = penché en avant.
"""
import bpy, math, json, random
from mathutils import Vector, Matrix

FPS, DUR = 24, 8.0
NF = int(FPS * DUR)
WAIST = 0.25  # pivot de taille, depuis le sol
RATIO = dict(prep=0.40, hold=0.10, strike=0.08, impact=0.07)  # le reste = retour
IMPACT_U = RATIO["prep"] + RATIO["hold"] + RATIO["strike"]
BLEND = 0.25  # fondu entre deux segments

# Le bras est porté par le buste : son angle au monde vaut bras − buste (un buste penché en avant
# ramène le bras vers l'arrière). Les impacts visent la hauteur de la cible :
# tronc 0,3 m à 0,7 m devant, haut de bûche 0,4 m à 0,77 m, paroi 0,2 m à 0,69 m, bloc 0,2 m à 0,67 m.
GESTURES = {
    "hache": dict(period=1.6, rest=dict(bR=-0.75, bL=-0.7, buste=0.1, jR=-0.18, jL=0.18),
                  prep=dict(bR=-2.7, bL=-2.6, buste=-0.15, jR=-0.18, jL=0.18),
                  hit=dict(bR=-1.72, bL=-1.67, buste=0.38, jR=-0.18, jL=0.18)),
    "fendre": dict(period=1.8, rest=dict(bR=-0.9, bL=-0.85, buste=0.15, jR=-0.12, jL=0.12),
                   prep=dict(bR=-2.9, bL=-2.85, buste=-0.1, jR=-0.12, jL=0.12),
                   hit=dict(bR=-2.02, bL=-1.97, buste=0.5, jR=-0.12, jL=0.12)),
    "pioche": dict(period=1.7, rest=dict(bR=-0.75, bL=-0.7, buste=0.1, jR=-0.2, jL=0.15),
                   prep=dict(bR=-2.4, bL=-2.35, buste=-0.1, jR=-0.2, jL=0.15),
                   hit=dict(bR=-1.6, bL=-1.55, buste=0.4, jR=-0.2, jL=0.15)),
    "masse": dict(period=1.5, rest=dict(bR=-0.7, bL=-0.65, buste=0.1, jR=-0.15, jL=0.15),
                  prep=dict(bR=-2.2, bL=-2.15, buste=0.0, jR=-0.15, jL=0.15),
                  hit=dict(bR=-1.59, bL=-1.54, buste=0.42, jR=-0.15, jL=0.15)),
}
# mains à hauteur du tronc couché (0,43 m) : angle au monde ~1,5
SAW = dict(period=1.1, arms=-1.75, arms_amp=0.25, buste=0.25, buste_amp=0.1)
POSES = {
    "neutre": dict(bR=0, bL=0, buste=0, jR=0, jL=0),
    "porter": dict(bR=-0.9, bL=-0.9, buste=-0.12),
    "ramasser": dict(bR=-0.6, bL=-0.6, buste=1.0, jR=-0.1, jL=0.1),
    "penche": dict(bR=-0.5, bL=-0.5, buste=0.95, jR=-0.1, jL=0.1),
    "arrache": dict(bR=-1.1, bL=-0.3, buste=0.6, jR=-0.1, jL=0.1),
    "front": dict(bR=-2.0, bL=-0.1, buste=-0.08),
    "dos": dict(bR=0.35, bL=0.35, buste=-0.22),
    "regarde": dict(bR=-0.1, bL=-0.05, buste=0.0),
}
JOINTS = ("bR", "bL", "buste", "jR", "jL")


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def mix(a, b, t):
    return {k: a.get(k, 0.0) + (b.get(k, 0.0) - a.get(k, 0.0)) * t for k in JOINTS}


def full(p):
    return {k: p.get(k, 0.0) for k in JOINTS}


def strike_pose(u, g):
    """Pose d'un coup, u dans [0, 1) : préparation, tenue, frappe accélérée, tenue d'impact, retour."""
    a = RATIO["prep"]
    b = a + RATIO["hold"]
    c = b + RATIO["strike"]
    d = c + RATIO["impact"]
    rest, prep, hit = full(g["rest"]), full(g["prep"]), full(g["hit"])
    if u < a:
        return mix(rest, prep, ease(u / a))
    if u < b:
        return prep
    if u < c:
        x = (u - b) / RATIO["strike"]
        return mix(prep, hit, x * x)
    if u < d:
        return hit
    return mix(hit, rest, ease((u - d) / (1 - d)))


def frame_of(t):
    return 1 + round(t * FPS)


# ---------- planificateur ----------
class Worker:
    """Fil de segments (t0, t1, fonction) ; la fonction renvoie pose, position et cap optionnels."""

    def __init__(self, name, at, heading, seed):
        self.name, self.at, self.heading = name, Vector((at[0], at[1], 0)), heading
        self.rng = random.Random(seed)
        self.segs, self.events = [], []

    def add(self, t0, t1, fn):
        self.segs.append((t0, t1, fn))
        return t1

    # --- segments ---
    def strikes(self, t0, t1, gesture, on_impact=None, max_hits=None):
        g = GESTURES[gesture]
        starts, s = [], t0
        while True:
            period = g["period"] * (1 + self.rng.uniform(-0.12, 0.12))
            if s + period > t1 + 1e-6 or (max_hits is not None and len(starts) >= max_hits):
                break
            starts.append((s, period))
            s += period
        for i, (s0, period) in enumerate(starts):
            self.events.append((s0 + IMPACT_U * period, gesture, i, on_impact))

        def fn(t):
            for s0, period in starts:
                if s0 <= t < s0 + period:
                    return dict(pose=strike_pose((t - s0) / period, g))
            return dict(pose=full(g["rest"]))
        return self.add(t0, t1, fn), [s0 + IMPACT_U * p for s0, p in starts]

    def saw(self, t0, t1, phase):
        def fn(t):
            w = math.sin(2 * math.pi * (t - t0) / SAW["period"] + phase)
            return dict(pose=full(dict(bR=SAW["arms"] + SAW["arms_amp"] * w, bL=SAW["arms"] + SAW["arms_amp"] * w,
                                       buste=SAW["buste"] + SAW["buste_amp"] * w, jR=-0.15, jL=0.15)))
        return self.add(t0, t1, fn)

    def hold(self, t0, t1, pose, yaw=0.0):
        p = full(POSES[pose] if isinstance(pose, str) else pose)

        def fn(t):
            return dict(pose=p, yaw=yaw * ease((t - t0) / 0.4) * ease((t1 - t) / 0.4))
        return self.add(t0, t1, fn)

    def keys(self, t0, t1, keys, turn=None):
        """Poses clés [(t, pose)] interpolées en douceur ; `turn` = (cap initial, cap final) sur 0,3 s."""
        ks = [(k, full(POSES[p] if isinstance(p, str) else p)) for k, p in keys]

        def fn(t):
            out = dict(pose=ks[-1][1])
            if t <= ks[0][0]:
                out = dict(pose=ks[0][1])
            for (ta, pa), (tb, pb) in zip(ks, ks[1:]):
                if ta <= t <= tb:
                    out = dict(pose=mix(pa, pb, ease((t - ta) / max(1e-6, tb - ta))))
                    break
            if turn:
                out["heading"] = turn[0] + (turn[1] - turn[0]) * ease((t - t0) / 0.3)
            return out
        return self.add(t0, t1, fn)

    def walk(self, t0, t1, pts, loaded=False):
        pts = [Vector((x, y, 0)) for x, y in pts]
        lengths = [(b - a).length for a, b in zip(pts, pts[1:])]
        total = sum(lengths)

        def fn(t):
            d = total * max(0, min(1, (t - t0) / (t1 - t0)))
            acc = 0
            for (a, b), l in zip(zip(pts, pts[1:]), lengths):
                if d <= acc + l or l == lengths[-1]:
                    u = min(1, (d - acc) / max(1e-6, l))
                    pos = a + (b - a) * u
                    dirv = b - a
                    break
                acc += l
            swing = math.sin(d * 6.3) * (0.35 if loaded else 0.5)
            base = full(POSES["porter"]) if loaded else dict(bR=-swing * 0.8, bL=swing * 0.8, buste=0.04)
            pose = full(base)
            pose["jR"], pose["jL"] = swing, -swing
            return dict(pose=pose, at=pos, heading=math.atan2(dirv.x, -dirv.y))
        return self.add(t0, t1, fn)

    # --- évaluation ---
    def eval(self, t):
        segs = sorted(self.segs, key=lambda s: s[0])
        cur, prev = None, None
        for i, s in enumerate(segs):
            if s[0] <= t < s[1] or (i == len(segs) - 1 and t >= s[0]):
                cur, prev = s, segs[i - 1] if i else None
                break
            if t < s[0]:
                cur, prev = s, segs[i - 1] if i else None
                t = s[0]
                break
        out = cur[2](t)
        if prev is not None and t - cur[0] < BLEND:
            before = prev[2](prev[1] - 1e-3)
            out["pose"] = mix(before["pose"], out["pose"], ease((t - cur[0]) / BLEND))
        # dernière position connue si le segment n'en impose pas
        if "at" not in out:
            out["at"] = self._last_at(t, segs)
        if "heading" not in out:
            out["heading"] = self._last_heading(t, segs)
        return out

    def _last_at(self, t, segs):
        at = self.at
        for s in segs:
            if s[0] > t:
                break
            r = s[2](min(t, s[1] - 1e-3))
            if "at" in r:
                at = s[2](s[1] - 1e-3)["at"] if t >= s[1] else r["at"]
        return at

    def _last_heading(self, t, segs):
        h = self.heading
        for s in segs:
            if s[0] > t:
                break
            r = s[2](min(t, s[1] - 1e-3))
            if "heading" in r:
                h = s[2](s[1] - 1e-3)["heading"] if t >= s[1] else r["heading"]
        return h


# ---------- rig ----------
def tool_part(kind):
    p = Part()
    hz = -0.225
    L = {"hache": 0.42, "merlin": 0.45, "pioche": 0.42, "masse": 0.4}[kind]
    p.add(cyl(0.014, hz - L, hz + 0.06, 5, TIMBER))
    # Le fer est du côté +Y du bras : bras levé puis abattu, c'est le côté qui frappe.
    if kind == "hache":
        box(p, 0, 0.05, hz - L + 0.04, 0.025, 0.12, 0.09, STEEL)
    elif kind == "merlin":
        box(p, 0, 0.035, hz - L + 0.04, 0.05, 0.13, 0.1, STEEL_DARK)
    elif kind == "pioche":
        box(p, 0, 0, hz - L + 0.02, 0.035, 0.36, 0.035, STEEL)
    elif kind == "masse":
        box(p, 0, 0, hz - L + 0.03, 0.09, 0.16, 0.09, STEEL_DARK)
    return p


def carrot_part():
    p = Part()
    rg = ring(0, 0.022, 5)
    cap_bottom(p, rg, Vector((0, 0, -0.1)), hexc("ee8a2c"))
    cap_top(p, rg, Vector((0, 0, 0.004)), hexc("c8641a"))
    for k in range(3):
        a = k * math.tau / 3
        two_sided(p, [(0, 0, 0), (0.02 * math.cos(a), 0.02 * math.sin(a), 0.07), (0.03 * math.cos(a + 0.3), 0.03 * math.sin(a + 0.3), 0.12)],
                  hexc("4f8d2f"))
    return p


def basket_part(fill_col=None):
    p = Part()
    rs = [ring(0.0, 0.085, 8, 0.8), ring(0.11, 0.105, 8, 0.8)]
    loft(p, rs, [hexc("a07a45")])
    cap_bottom(p, rs[0], Vector((0, 0, 0)), hexc("7a5a32"))
    inner = [ring(0.1, 0.095, 8, 0.8)]
    cap_top(p, inner[0], Vector((0, 0, 0.1)), fill_col or hexc("5a4126"))
    return p


def rig(sc, name, at, heading, look, hat=None, hair="court", cloth=None, tool=None):
    root = bpy.data.objects.new(name, None)
    sc.collection.objects.link(root)
    root.location = (at[0], at[1], 0)
    root.rotation_euler = (0, 0, heading)
    buste = bpy.data.objects.new(f"{name}_buste", None)
    sc.collection.objects.link(buste)
    buste.parent = root
    buste.location = (0, 0, WAIST)
    skin, hair_c = SKIN[look["skin"]], HAIR[look["hair"]]
    clothes = cloth or CLOTHES[look["clothes"]]
    down = (0, 0, -WAIST)
    obj(sc, f"{name}_tunique", fig_tunic(), clothes, buste, down)
    obj(sc, f"{name}_tete", fig_head(), skin, buste, down)
    if hat not in ("heaume", "coiffe"):
        obj(sc, f"{name}_cheveux", fig_hair(hair), hair_c, buste, down)
    if hat:
        part = fig_hat(hat) if hat in ("casque", "beret", "paille", "bonnet") else hat_extra(hat)
        obj(sc, f"{name}_chapeau", part, WHITE, buste, down)
    nodes = dict(root=root, buste=buste)
    for side, key in ((-1, "bL"), (1, "bR")):
        arm = obj(sc, f"{name}_bras{side}", fig_arm(), clothes, buste, (side * ARM_PIVOT[0], 0, ARM_PIVOT[1] - WAIST))
        obj(sc, f"{name}_main{side}", fig_hand(), skin, arm)
        nodes[key] = arm
    for side, key in ((-1, "jL"), (1, "jR")):
        nodes[key] = obj(sc, f"{name}_jambe{side}", fig_leg(), PANTS, root, (side * LEG_PIVOT[0], 0, LEG_PIVOT[1]))
    if tool:
        nodes["outil"] = obj(sc, f"{name}_{tool}", tool_part(tool), WHITE, nodes["bR"])
    return nodes


# ---------- animation par images clés ----------
def set_vis(o, windows):
    """Visible seulement pendant les fenêtres [(t0, t1)] ; enfants inclus."""
    objs = [o] + list(o.children_recursive)
    for ob in objs:
        ob.hide_render = True
        ob.hide_viewport = True
        ob.keyframe_insert("hide_render", frame=1)
        ob.keyframe_insert("hide_viewport", frame=1)
        for t0, t1 in windows:
            for f, v in ((frame_of(t0), False), (frame_of(t1), True)):
                if f > NF + 1:
                    continue
                ob.hide_render = v
                ob.hide_viewport = v
                ob.keyframe_insert("hide_render", frame=max(1, f))
                ob.keyframe_insert("hide_viewport", frame=max(1, f))


def animate_worker(w, nodes, origin):
    o = Vector((origin[0], origin[1], 0))
    for f in range(1, NF + 1):
        t = (f - 1) / FPS
        r = w.eval(t)
        nodes["root"].location = o + r["at"]
        nodes["root"].rotation_euler = (0, 0, r["heading"] + r.get("yaw", 0.0))
        nodes["root"].keyframe_insert("location", frame=f)
        nodes["root"].keyframe_insert("rotation_euler", frame=f)
        for k in JOINTS:
            nodes[k].rotation_euler = (r["pose"][k], 0, 0)
            nodes[k].keyframe_insert("rotation_euler", frame=f)


def key_track(o, fn, t0=0.0, t1=DUR, prop="location"):
    """Anime une propriété par une fonction du temps (une clé par image)."""
    for f in range(frame_of(t0), min(NF, frame_of(t1)) + 1):
        setattr(o, prop, fn((f - 1) / FPS))
        o.keyframe_insert(prop, frame=f)


def heading_to(a, b):
    return math.atan2(b[0] - a[0], -(b[1] - a[1]))


def ahead(at, heading, d):
    return (at[0] + math.sin(heading) * d, at[1] - math.cos(heading) * d)


# ---------- effets ----------
class FX:
    def __init__(self, sc, seed=11):
        self.sc, self.rng, self.n = sc, random.Random(seed), 0

    def _obj(self, part, name):
        self.n += 1
        o = bpy.data.objects.new(f"fx_{name}_{self.n}", part.build(f"fx_{name}_{self.n}"))
        self.sc.collection.objects.link(o)
        return o

    def bits(self, t0, at, count, kind, life=0.6, up=1.6, spread=0.9):
        col = {"copeau": hexc("d8b27a"), "eclat": hexc("9a9a94"), "terre": hexc("6b4a2e")}[kind]
        for _ in range(count):
            p = Part()
            s = 0.022 if kind != "eclat" else 0.028
            if kind == "eclat":
                rg = ring(0, s, 3)
                cap_top(p, rg, Vector((0, 0, s * 1.3)), col)
                cap_bottom(p, rg, Vector((0, 0, -s * 0.3)), mul(col, (0.7,) * 3))
            else:
                two_sided(p, [(-s, 0, 0), (0, -s * 0.5, 0), (s, 0, 0), (0, s * 0.5, 0)], col)
            o = self._obj(p, kind)
            a = self.rng.uniform(0, math.tau)
            v = Vector((math.cos(a) * spread * self.rng.uniform(0.4, 1), math.sin(a) * spread * self.rng.uniform(0.4, 1),
                        up * self.rng.uniform(0.6, 1.1)))
            spin = Vector((self.rng.uniform(-14, 14), self.rng.uniform(-14, 14), self.rng.uniform(-8, 8)))
            start = Vector(at)

            def pos(t, v=v, start=start):
                dt = max(0.0, t - t0)
                p_ = start + v * dt + Vector((0, 0, -4.9 * dt * dt))
                p_.z = max(0.01, p_.z)
                return p_
            key_track(o, pos, t0, t0 + life)
            key_track(o, lambda t, spin=spin: tuple(spin * max(0.0, t - t0)), t0, t0 + life, "rotation_euler")
            set_vis(o, [(t0, t0 + life)])

    def dust(self, t0, at, size=0.5, life=0.7):
        p = Part()
        rg = ring(0, 1.0, 8)
        cap_top(p, rg, Vector((0, 0, 0.25)), hexc("cdbb9a"))
        o = self._obj(p, "poussiere")
        base = Vector((at[0], at[1], 0.0))

        def sc_(t):
            x = (t - t0) / life
            s = size * (0.3 + 0.7 * ease(x))
            return (s, s, s * 0.6)
        key_track(o, sc_, t0, t0 + life, "scale")
        key_track(o, lambda t: base + Vector((0, 0, 0.03 - 0.12 * ease((t - t0) / life))), t0, t0 + life)
        set_vis(o, [(t0, t0 + life)])

    def leaves(self, t0, at, count, height, life=1.5, spread=0.6):
        for _ in range(count):
            p = Part()
            two_sided(p, [(-0.03, 0, 0), (0, -0.015, 0), (0.03, 0, 0), (0, 0.015, 0)], hexc("5f9a35"))
            o = self._obj(p, "feuille")
            start = Vector((at[0] + self.rng.uniform(-spread, spread), at[1] + self.rng.uniform(-spread, spread),
                            height * self.rng.uniform(0.6, 1.0)))
            ph, amp = self.rng.uniform(0, math.tau), self.rng.uniform(0.05, 0.15)
            delay = self.rng.uniform(0, 0.3)

            def pos(t, start=start, ph=ph, amp=amp, delay=delay):
                x = max(0.0, (t - t0 - delay) / life)
                return start + Vector((math.sin(ph + x * 9) * amp, math.cos(ph + x * 7) * amp,
                                       -start.z * min(1.0, x * 1.1) + 0.01))
            key_track(o, pos, t0, t0 + life + 0.35)
            key_track(o, lambda t, ph=ph: (math.sin(t * 7 + ph) * 0.6, math.cos(t * 5 + ph) * 0.6, t * 3), t0,
                      t0 + life + 0.35, "rotation_euler")
            set_vis(o, [(t0 + delay, t0 + life + 0.35)])


# ---------- décors ----------
def put_part(sc, name, part, loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, part.build(name))
    sc.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    return o


def tree_part():
    p = Part()
    # fût dégagé jusqu'à 0,8 m : la zone d'impact de la hache reste visible depuis la caméra plongeante
    p.add(cyl(0.075, 0.0, 1.1, 6, hexc("6b4a2e")))
    for z0, r, h, col in ((0.8, 0.42, 0.7, hexc("3f7a34")), (1.2, 0.32, 0.6, hexc("4f8d3a")), (1.55, 0.2, 0.5, hexc("5fa042"))):
        rg = ring(z0, r, 8, phase=math.pi / 8)
        cap_top(p, rg, Vector((0, 0, z0 + h)), col)
        cap_bottom(p, rg, Vector((0, 0, z0)), mul(col, (0.6,) * 3))
    return p


def log_part(length, r=0.08, col=hexc("7a5532"), end=hexc("c9a571")):
    return cyl(r, -length / 2, length / 2, 6, col, cap_col=end)


def trestle_part():
    p = Part()
    for s in (-1, 1):
        q = Part()
        box(q, 0, 0, 0.2, 0.04, 0.04, 0.46, TIMBER)
        p.add(q, Matrix.Rotation(s * 0.5, 4, 'Y'))
    return p


def rock_part(seed, r):
    p = Part()
    ball(p, Vector((0, 0, 0)), r, 7, 5, hexc("8f918c"))
    rng = random.Random(seed)
    cache = {}
    for i, v in enumerate(p.v):
        key = (round(v.x, 4), round(v.y, 4), round(v.z, 4))
        if key not in cache:
            cache[key] = 1 + rng.uniform(-0.18, 0.18)
        p.v[i] = v * cache[key]
    return p


# ---------- chantiers ----------
def site_wood(sc, fx, O):
    """Abatteur à la hache, binôme de scie sur tronc couché, fendeur, porteur."""
    ox, oy = O
    # abatteur et arbre accessoire
    A = (0.0, 0.0)
    hA = heading_to((0, 0), (1, 1))
    tree_at = ahead(A, hA, 0.62)  # le fer (0,7 m devant) entre dans le fût (rayon ~0,09)
    yaw = bpy.data.objects.new("bois_arbre_cap", None)
    sc.collection.objects.link(yaw)
    yaw.location = (ox + tree_at[0], oy + tree_at[1], 0)
    yaw.rotation_euler = (0, 0, hA)
    tilt = bpy.data.objects.new("bois_arbre_bascule", None)
    sc.collection.objects.link(tilt)
    tilt.parent = yaw
    put_part(sc, "bois_arbre", tree_part(), parent=tilt).scale = (1.15, 1.15, 1.15)

    w = Worker("bucheron", A, hA, 101)
    _, hits = w.strikes(0.15, 4.6, "hache", max_hits=3)
    fall = hits[-1] + 0.12
    w.hold(fall, fall + 1.6, "regarde", yaw=0.35)
    w.hold(fall + 1.6, fall + 2.6, "front")
    w.hold(fall + 2.6, DUR, "dos")
    n = rig(sc, "bucheron", A, hA, dict(skin=0, clothes=1, hair=2), hat="bonnet", tool="hache")
    animate_worker(w, n, O)
    for i, t in enumerate(hits):
        p = ahead(A, hA, 0.62)
        fx.bits(t, (ox + p[0], oy + p[1], 0.3), 4, "copeau")
        fx.leaves(t, (ox + tree_at[0], oy + tree_at[1]), 2, 1.6, spread=0.35)

    def tilt_angle(t):
        # rotation X positive du repère « cap » : la cime part vers -Y local, à l'opposé de l'abatteur
        if t < fall:
            a = 0.0
            for h in hits:
                if h <= t < h + 0.45:
                    a += 0.035 * math.exp(-(t - h) / 0.12) * math.sin((t - h) * 40)
            return (a, 0, 0)
        x = (t - fall) / 1.2
        if x < 1:
            return ((math.pi / 2) * x * x, 0, 0)
        y = (t - fall - 1.2) / 0.3
        return (math.pi / 2 - (0.08 * math.sin(math.pi * y) if y < 1 else 0), 0, 0)
    key_track(tilt, tilt_angle, 0, DUR, "rotation_euler")
    top = ahead(tree_at, hA, 1.6)
    fx.dust(fall + 1.2, (ox + top[0], oy + top[1]), size=0.9, life=1.0)
    fx.dust(fall + 0.1, (ox + tree_at[0], oy + tree_at[1]), size=0.35)
    fx.leaves(fall + 1.1, (ox + top[0], oy + top[1]), 12, 0.6, spread=0.5)

    # tronc couché sur chevalets, binôme de scie
    trunk_c, trunk_len = (0.2, -1.3), 1.8
    for dx in (-0.6, 0.55):
        put_part(sc, f"bois_chevalet{dx}", trestle_part(), (ox + trunk_c[0] + dx, oy + trunk_c[1], 0))
    cut1, cut2 = 0.75, 0.40
    end_x = trunk_c[0] + trunk_len / 2
    stay = put_part(sc, "bois_tronc", log_part(cut1 - (trunk_c[0] - trunk_len / 2)),
                    (ox + ((trunk_c[0] - trunk_len / 2) + cut1) / 2, oy + trunk_c[1], 0.43), (0, math.pi / 2, 0))
    section = put_part(sc, "bois_troncon", log_part(end_x - cut1), (0, 0, 0), (0, math.pi / 2, 0))
    cut_t = 5.2

    def sec_loc(t):
        base = Vector((ox + (cut1 + end_x) / 2, oy + trunk_c[1], 0.43))
        if t < cut_t:
            return base
        x = min(1.0, (t - cut_t) / 0.35)
        return base + Vector((0.12 * x, -0.25 * x, -0.35 * x * x))
    key_track(section, sec_loc)
    key_track(section, lambda t: (0.6 * min(1, max(0, (t - cut_t) / 0.35)), math.pi / 2, 0.4 * min(1, max(0, (t - cut_t) / 0.35))),
              0, DUR, "rotation_euler")
    fx.dust(cut_t + 0.35, (ox + end_x - 0.1, oy + trunk_c[1] - 0.25), size=0.3)
    fx.bits(cut_t, (ox + cut1, oy + trunk_c[1], 0.43), 4, "copeau", up=0.8)

    sp = Part()
    box(sp, 0, 0, 0, 0.015, 0.75, 0.07, STEEL)
    box(sp, 0, -0.39, 0.02, 0.03, 0.04, 0.1, TIMBER)
    box(sp, 0, 0.39, 0.02, 0.03, 0.04, 0.1, TIMBER)
    saw = put_part(sc, "bois_scie", sp)
    pair = []
    for k, (side, ph) in enumerate(((-1, 0.0), (1, math.pi))):
        at = (cut1, trunk_c[1] + side * 0.3)
        h = heading_to(at, (cut1, trunk_c[1]))
        sw = Worker(f"scieur{k}", at, h, 200 + k)
        sw.saw(0.0, cut_t, ph)
        if k == 0:
            sw.hold(cut_t, 6.2, "dos")
        else:
            sw.hold(cut_t, 6.2, "regarde", yaw=-0.4)
        at2 = (cut2, trunk_c[1] + side * 0.3)
        sw.walk(6.2, 6.7, [at, at2])
        sw.add(6.7, 6.7, lambda t, h=h: dict(pose=full(POSES["neutre"]), heading=h))
        sw.saw(6.7, DUR, ph)
        look = [dict(skin=1, clothes=0, hair=0), dict(skin=2, clothes=3, hair=1)][k]
        animate_worker(sw, rig(sc, f"scieur{k}", at, h, look, hat="bonnet" if k else None), O)
        pair.append(sw)

    def saw_loc(t):
        x = cut1 if t < 6.2 else cut1 + (cut2 - cut1) * ease((t - 6.2) / 0.5)
        if t < cut_t:
            w_ = math.sin(2 * math.pi * t / SAW["period"])
        elif 6.7 <= t:
            w_ = math.sin(2 * math.pi * (t - 6.7) / SAW["period"])
        else:
            w_ = 0.0
        return Vector((ox + x, oy + trunk_c[1] + 0.12 * w_, 0.45))
    key_track(saw, saw_loc)

    # fendeur au billot
    F = (2.0, 0.3)
    hF = heading_to(F, (F[0] - 1, F[1] - 1))
    billot_at = ahead(F, hF, 0.77)
    put_part(sc, "bois_billot", cyl(0.13, 0, 0.2, 7, hexc("6b4a2e"), cap_col=hexc("c9a571")), (ox + billot_at[0], oy + billot_at[1], 0))
    fw = Worker("fendeur", F, hF, 301)
    t_, hits1 = fw.strikes(0.3, 3.9, "fendre", max_hits=2)
    fw.keys(3.9, 4.9, [(3.9, GESTURES["fendre"]["rest"]), (4.25, "ramasser"), (4.6, "ramasser"), (4.9, GESTURES["fendre"]["rest"])])
    t_, hits2 = fw.strikes(4.9, DUR, "fendre", max_hits=2)
    animate_worker(fw, rig(sc, "fendeur", F, hF, dict(skin=2, clothes=2, hair=0), tool="merlin"), O)
    for t in hits1 + hits2:
        fx.bits(t, (ox + billot_at[0], oy + billot_at[1], 0.4), 5, "copeau")
    # bûche entière, puis deux moitiés à chaque fente
    for k, (t_on, t_split) in enumerate(((0.0, hits1[-1]), (4.6, hits2[-1] if len(hits2) > 1 else DUR + 1))):
        whole = put_part(sc, f"bois_buche{k}", cyl(0.065, 0, 0.2, 6, hexc("7a5532"), cap_col=hexc("c9a571")),
                         (ox + billot_at[0], oy + billot_at[1], 0.2))
        set_vis(whole, [(t_on, t_split)])
        for s in (-1, 1):
            half = Part()
            box(half, 0, 0, 0.1, 0.06, 0.12, 0.2, hexc("c9a571"))
            hobj = put_part(sc, f"bois_demi{k}{s}", half)

            def hl(t, s=s):
                x = min(1.0, max(0.0, (t - t_split) / 0.3))
                return Vector((ox + billot_at[0] + s * 0.1 * x, oy + billot_at[1], 0.2 - 0.2 * x * x))
            key_track(hobj, hl, 0, DUR)
            key_track(hobj, lambda t, s=s: (0, s * 1.3 * min(1.0, max(0.0, (t - t_split) / 0.3)), 0), 0, DUR, "rotation_euler")
            set_vis(hobj, [(t_split, (4.6 if k == 0 else DUR + 1))])

    # porteur de bûches
    P0, P1 = (1.2, -1.85), (2.6, -0.95)
    hP = heading_to(P0, P1)
    pw = Worker("porteur", P0, hP, 401)
    pw.keys(0.0, 0.8, [(0.0, "ramasser"), (0.5, "ramasser"), (0.8, "porter")])
    pw.walk(0.8, 3.4, [P0, P1], loaded=True)
    pw.keys(3.4, 4.4, [(3.4, "porter"), (3.8, "ramasser"), (4.1, "ramasser"), (4.4, "neutre")])
    pw.walk(4.4, 6.5, [P1, P0])
    pw.hold(6.5, 7.2, "dos")
    pw.keys(7.2, DUR, [(7.2, "neutre"), (7.6, "ramasser"), (DUR, "ramasser")])
    pn = rig(sc, "porteur", P0, hP, dict(skin=0, clothes=4, hair=1))
    carried = put_part(sc, "porteur_buches", Part().add(log_part(0.34, 0.06), Matrix.Translation((0, -0.06, 0)))
                       .add(log_part(0.3, 0.055), Matrix.Translation((0, 0.06, 0.02))), (0, -0.24, 0.36), (0, math.pi / 2, 0), pn["root"])
    set_vis(carried, [(0.45, 3.9), (7.7, DUR + 1)])
    animate_worker(pw, pn, O)
    pile = (2.95, -0.75)
    for i, (dx, dz) in enumerate(((0, 0), (0.13, 0), (0.065, 0.11), (0.2, 0.11))):
        lg = put_part(sc, f"bois_tas{i}", log_part(0.34, 0.06), (ox + pile[0] + dx, oy + pile[1] - dx * 0.4, 0.06 + dz), (math.pi / 2, 0, 0.6))
        if i == 3:
            set_vis(lg, [(3.9, DUR + 1)])


def site_stone(sc, fx, O):
    ox, oy = O
    C = Vector((0.5, 0.7, 0))
    for i, (dx, dy, r) in enumerate(((0, 0, 0.55), (0.45, 0.2, 0.4), (-0.25, 0.45, 0.35))):
        put_part(sc, f"pierre_roche{i}", rock_part(50 + i, r), (ox + C.x + dx, oy + C.y + dy, r * 0.45))
    hits_by = []
    for k, d in enumerate(((0.707, 0.707), (-0.2, 0.98))):
        dv = Vector((d[0], d[1], 0)).normalized()
        at = C - dv * 1.22  # fer à 0,69 m devant le piocheur : il touche la paroi (rayon ~0,55 à 0,2 m de haut)
        h = heading_to(at, C)
        w = Worker(f"piocheur{k}", (at.x, at.y), h, 500 + k)
        if k == 0:
            _, hits = w.strikes(0.1, 5.4, "pioche")
            w.hold(5.4, 6.6, "front")
            _, more = w.strikes(6.6, DUR, "pioche")
            hits += more
        else:
            _, hits = w.strikes(0.7, DUR, "pioche")
        animate_worker(w, rig(sc, f"piocheur{k}", (at.x, at.y), h, [dict(skin=1, clothes=2, hair=1), dict(skin=0, clothes=1, hair=0)][k],
                              hat="casque", tool="pioche"), O)
        for i, t in enumerate(hits):
            p = ahead((at.x, at.y), h, 0.66)
            fx.bits(t, (ox + p[0], oy + p[1], 0.2), 3, "eclat", up=1.2)
            fx.dust(t, (ox + p[0], oy + p[1]), size=0.3, life=0.6)
        hits_by.append((at, h, hits))
    # blocs détachés (réservoir de 3 au plus)
    for k, (at, h, hits) in enumerate(hits_by):
        if len(hits) < 3:
            continue
        t0 = hits[2]
        p = ahead((at.x, at.y), h, 0.62)
        side = ahead((at.x, at.y), h + math.pi / 2, 0.25)
        b = Part()
        box(b, 0, 0, 0, 0.16, 0.14, 0.12, hexc("8f918c"))
        bo = put_part(sc, f"pierre_bloc{k}", b)

        def bl(t, p=p, side=side, at=at):
            x = min(1.0, max(0.0, (t - t0) / 0.4))
            q = Vector((p[0], p[1], 0)) + (Vector((side[0], side[1], 0)) - Vector((at.x, at.y, 0))) * 0.6 * x
            return Vector((ox, oy, 0)) + q + Vector((0, 0, 0.06 + 0.05 * math.sin(math.pi * x)))
        key_track(bo, bl)
        key_track(bo, lambda t: (0, 3.0 * min(1.0, max(0.0, (t - t0) / 0.4)), 0), 0, DUR, "rotation_euler")
        set_vis(bo, [(t0, DUR + 1)])
    # casseur à la masse
    K = (1.75, -0.55)
    hK = heading_to(K, (K[0] - 1, K[1] - 1))
    target = ahead(K, hK, 0.67)
    kw = Worker("casseur", K, hK, 601)
    _, khits = kw.strikes(0.2, DUR, "masse")
    animate_worker(kw, rig(sc, "casseur", K, hK, dict(skin=2, clothes=0, hair=2), tool="masse"), O)
    b = Part()
    box(b, 0, 0, 0.08, 0.24, 0.2, 0.16, hexc("8f918c"))
    block = put_part(sc, "pierre_bloc_casse", b, (ox + target[0], oy + target[1], 0))
    steps = [1.0, 1.0, 0.8, 0.8, 0.6, 0.6, 0.0]

    def bscale(t):
        n = sum(1 for h in khits if h <= t)
        s = steps[min(n, len(steps) - 1)]
        return (max(s, 0.001),) * 3
    key_track(block, bscale, 0, DUR, "scale")
    for t in khits:
        fx.bits(t, (ox + target[0], oy + target[1], 0.15), 3, "eclat", up=1.0)
        fx.dust(t, (ox + target[0], oy + target[1]), size=0.25, life=0.5)
    gravel = Part()
    rg = ring(0, 0.16, 7)
    cap_top(gravel, rg, Vector((0, 0, 0.08)), hexc("a3a39b"))
    gobj = put_part(sc, "pierre_gravier", gravel, (ox + target[0], oy + target[1], 0))
    if len(khits) >= 6:
        set_vis(gobj, [(khits[5], DUR + 1)])
        set_vis(block, [(0, khits[5])])
    # manutentionnaire au panier
    M0, M1 = (1.15, -1.6), (2.95, -1.2)  # au sud du bloc du casseur, sans traverser son poste
    hM = heading_to(M0, M1)
    mw = Worker("manutention", M0, hM, 701)
    mw.keys(0.0, 0.9, [(0.0, "ramasser"), (0.6, "ramasser"), (0.9, "porter")])
    mw.walk(0.9, 3.6, [M0, M1], loaded=True)
    mw.keys(3.6, 4.6, [(3.6, "porter"), (3.95, "ramasser"), (4.25, "ramasser"), (4.6, "neutre")])
    mw.walk(4.6, 6.6, [M1, M0])
    mw.hold(6.6, 7.3, "regarde", yaw=0.5)
    mw.keys(7.3, DUR, [(7.3, "neutre"), (7.7, "ramasser"), (DUR, "ramasser")])
    mn = rig(sc, "manutention", M0, hM, dict(skin=1, clothes=3, hair=2))
    full_b = put_part(sc, "manutention_panier_plein", basket_part(hexc("a3a39b")), (0, -0.22, 0.27), parent=mn["root"])
    empty_b = put_part(sc, "manutention_panier_vide", basket_part(), (0, -0.22, 0.27), parent=mn["root"])
    set_vis(full_b, [(0.6, 4.1), (7.8, DUR + 1)])
    set_vis(empty_b, [(4.1, 7.8)])
    animate_worker(mw, mn, O)
    pile = ahead(M1, hM, 0.45)
    pp = Part()
    rg = ring(0, 0.3, 9)
    cap_top(pp, rg, Vector((0, 0, 0.16)), hexc("a3a39b"))
    po = put_part(sc, "pierre_tas", pp, (ox + pile[0], oy + pile[1], 0))
    key_track(po, lambda t: (1.0, 1.0, 1.0 if t < 4.1 else 1.0 + 0.35 * ease((t - 4.1) / 0.4)), 0, DUR, "scale")
    fx.dust(4.1, (ox + pile[0], oy + pile[1]), size=0.45)


def site_garden(sc, fx, O, G):
    ox, oy = O
    T = Matrix.Translation((ox, oy, 0))
    socle = G["MB"]()
    socle.add(G["soil"](), T)
    for y in G["ROWS"]:
        socle.add(G["ridge"](y), T)
    bd, ps = G["border"](), G["post"]()
    for rot, px, py in ((0, 0, 0), (math.pi / 2, 2.5, 0), (math.pi, 2.5, 2.5), (-math.pi / 2, 0, 2.5)):
        socle.add(bd, T @ Matrix.Translation((px, py, 0)) @ Matrix.Rotation(rot, 4, 'Z'))
        socle.add(ps, T @ Matrix.Translation((px, py, 0)))
    o = bpy.data.objects.new("jardin_parcelle", socle.build("jardin_parcelle", shade=False, mat=lit_material()))
    sc.collection.objects.link(o)
    tuft = G["tuft_mature"]()
    tufts = {}
    order = []
    for i, y in enumerate(G["ROWS"]):
        xs = G["SLOTS"] if i % 2 == 0 else tuple(reversed(G["SLOTS"]))
        order += [(x, y) for x in xs]
    for k, (x, y) in enumerate(order):
        m = G["MB"]()
        m.add(tuft, T @ G["tuft_matrix"](x, y, 77 + k))
        to = bpy.data.objects.new(f"jardin_touffe{k}", m.build(f"jardin_touffe{k}", shade=False, mat=lit_material()))
        sc.collection.objects.link(to)
        tufts[k] = to
    # calendrier des touffes : t_k = W0 + (k + 0,5) / 12 × (W1 − W0) ; ici trois touffes en 8 s
    tk = [1.4, 3.9, 6.4]
    yA = 0.84
    gw = Worker("jardinier", (0.2, yA), 0.0, 801)
    prev_x, t = 0.2, 0.0
    for k, t_k in enumerate(tk):
        x = order[k][0]
        walk0 = t_k - 0.35 - 0.8
        if walk0 > t:
            gw.hold(t, walk0, "regarde" if k else "neutre", yaw=0.3 if k else 0.0)
        gw.walk(walk0, t_k - 0.35, [(prev_x, yA), (x, yA)])
        # face au rang 0 (vers -Y) en se penchant ; la marche le laissait tourné vers +X
        gw.keys(t_k - 0.35, t_k + 0.75, [(t_k - 0.35, "neutre"), (t_k, "penche"), (t_k + 0.35, "arrache"),
                                          (t_k + 0.75, dict(bR=-0.6, bL=-0.2, buste=0.45))], turn=(math.pi / 2, 0.0))
        gw.events.append((t_k, "arrache", k, None))
        prev_x, t = x, t_k + 0.75
        set_vis(tufts[k], [(0, t_k)])
        fx.bits(t_k, (ox + x, oy + order[k][1], 0.1), 3, "terre", up=0.9, spread=0.4)
    gw.keys(t, DUR, [(t, dict(bR=-0.6, bL=-0.2, buste=0.45)), (t + 0.4, "neutre"), (DUR, "neutre")])
    gn = rig(sc, "jardinier", (0.2, yA), 0.0, dict(skin=0, clothes=0, hair=1), hat="paille")
    for k in range(3, 12):
        set_vis(tufts[k], [(0, DUR + 1)])
    # carotte en main pendant l'arrachage, puis dans le panier
    for k, t_k in enumerate(tk):
        c = put_part(sc, f"jardin_carotte_main{k}", carrot_part(), (0, -0.01, -0.235), (math.pi, 0, 0), gn["bR"])
        set_vis(c, [(t_k, t_k + 0.7)])
    # panier : tenu pendant la marche, posé pendant l'arrachage
    hand_b = put_part(sc, "jardin_panier_main", basket_part(), (0, 0, -0.33), parent=gn["bL"])
    ground_b = put_part(sc, "jardin_panier_sol", basket_part())
    windows_hand, windows_ground, last = [], [], 0.0
    for k, t_k in enumerate(tk):
        windows_hand.append((last, t_k - 0.3))
        windows_ground.append((t_k - 0.3, t_k + 0.85))
        last = t_k + 0.85
    windows_hand.append((last, DUR + 1))
    set_vis(hand_b, windows_hand)
    set_vis(ground_b, windows_ground)

    def gb(t):
        for k, t_k in enumerate(tk):
            if t < t_k + 0.85:
                return Vector((ox + order[k][0] - 0.28, oy + yA - 0.05, 0))
        return Vector((ox + order[-1][0], oy + yA, 0))
    key_track(ground_b, gb)
    for k, t_k in enumerate(tk):
        for base, name in ((hand_b, "main"), (ground_b, "sol")):
            c = put_part(sc, f"jardin_panier_{name}_carotte{k}", carrot_part(), (0.03 * (k - 1), 0.0, 0.1 + 0.01 * k),
                         (math.pi / 2 + 0.3 * (k - 1), 0, 0.5 * k), base)
            c.scale = (0.9, 0.9, 0.9)
            win = [w for w in (windows_hand if base is hand_b else windows_ground)]
            set_vis(c, [(max(a, t_k + 0.7), b) for a, b in win if b > t_k + 0.7])
    animate_worker(gw, gn, O)


def build_worksites(G):
    sc = stage("VIL chantiers", G)
    for o in [o for o in sc.objects if o.name.endswith("parcelle")]:
        bpy.data.objects.remove(o, do_unlink=True)
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, NF
    fx = FX(sc)
    site_wood(sc, fx, (0.0, 0.0))
    site_stone(sc, fx, (6.5, 0.0))
    site_garden(sc, fx, (-6.8, -0.6), G)
    return sc


# ---------- planche de poses figées ----------
SHEET = [
    ("hache", "prep"), ("hache", "hit"), ("fendre", "prep"), ("fendre", "hit"),
    ("pioche", "prep"), ("pioche", "hit"), ("masse", "prep"), ("masse", "hit"),
    ("scie", None), ("porter", None), ("ramasser", None), ("penche", None), ("arrache", None),
    ("front", None), ("dos", None),
]


def build_sheet(G):
    sc = stage("VIL planche poses", G)
    for o in [o for o in sc.objects if o.name.endswith("parcelle")]:
        bpy.data.objects.remove(o, do_unlink=True)
    tools = {"hache": "hache", "fendre": "merlin", "pioche": "pioche", "masse": "masse"}
    # trois quarts face : la caméra regarde vers (-0,555 ; 0,832) au sol
    h = heading_to((0, 0), (1.387, -0.277))
    for i, (g, phase) in enumerate(SHEET):
        x = (i % 8) * 0.9
        y = -(i // 8) * 1.2
        if g in GESTURES:
            pose = full(GESTURES[g][phase])
        elif g == "scie":
            pose = full(dict(bR=SAW["arms"], bL=SAW["arms"], buste=SAW["buste"], jR=-0.15, jL=0.15))
        else:
            pose = full(POSES[g])
        n = rig(sc, f"planche{i}", (x, y), h, dict(skin=i % 3, clothes=i % 5, hair=(i + 1) % 3), tool=tools.get(g))
        for k in JOINTS:
            n[k].rotation_euler = (pose[k], 0, 0)
    return sc


def export_poses(path):
    data = {
        "convention": "rotation X en radians, repère de chaque articulation ; bras et jambes négatifs = vers l'avant ; "
                      "buste positif = penché en avant. Même squelette et mêmes signes dans Babylon (worker-figure.ts).",
        "pivots": {"buste": {"hauteur": WAIST}, "bras": {"x": ARM_PIVOT[0], "hauteur": ARM_PIVOT[1]},
                   "jambes": {"x": LEG_PIVOT[0], "hauteur": LEG_PIVOT[1]}},
        "decoupage_coup": {**RATIO, "retour": round(1 - sum(RATIO.values()), 3), "impact_u": round(IMPACT_U, 3),
                           "variation_cadence": 0.12},
        "gestes": GESTURES,
        "scie": SAW,
        "poses": POSES,
        "fondu_segments_s": BLEND,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return path
