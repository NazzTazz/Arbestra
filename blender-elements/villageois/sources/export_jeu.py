"""Export des figurines vers le jeu : pièces rigides et poses (Opus 5.5).

À lancer sans interface, depuis la racine du dépôt :
  blender --background --factory-startup --python blender-elements/villageois/sources/export_jeu.py

Écrit apps/world-web/src/scene/villager-kit.json. Chaque pièce est exprimée dans le
repère de l'articulation qui la porte, aux axes du jeu (Y haut, avant +Z) :
- buste (pivot de taille) : tunique, tête, coiffures, couvre-chefs ;
- bras (épaule) : bras, main, outils, carotte, panier tenu ;
- jambe (hanche) : jambe ;
- racine (sol + 0,215 m, comme la figure actuelle) : charges portées devant soi.
Triangles non indexés (facettes), positions en dixièmes de millimètre, couleurs en
multiplicateurs × 200 : une pièce teintée prend la couleur de son matériau.
"""
import json, math, os, sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "apps", "world-web", "src", "scene", "villager-kit.json")

ns = {"__name__": "villageois"}
for name in ("build_villageois.py", "tenues.py", "poses.py"):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        exec(compile(f.read(), name, "exec"), ns)

Part, WAIST, ARM_PIVOT, LEG_PIVOT = ns["Part"], ns["WAIST"], ns["ARM_PIVOT"], ns["LEG_PIVOT"]
ROOT_HEIGHT = 0.215  # hauteur de la racine du jeu au-dessus du sol (village-workers.ts)


def piece(part, offset=Matrix.Identity(4)):
    """Triangles en éventail, axes Blender (x, y, z) → jeu (x, z, −y)."""
    positions, colors = [], []
    for idx, cols in zip(part.f, part.c):
        pts = [offset @ part.v[i] for i in idx]
        for k in range(1, len(pts) - 1):
            for p in (pts[0], pts[k], pts[k + 1]):
                positions += [round(p.x * 1e4), round(p.z * 1e4), round(-p.y * 1e4)]
            # une couleur par triangle : moyenne des coins (les faces sont unies)
            c = [sum(col[j] for col in cols) / len(cols) for j in range(3)]
            colors += [round(v * 200) for v in c]
    return {"positions": positions, "colors": colors}


down = Matrix.Translation((0, 0, -WAIST))
ground = Matrix.Translation((0, 0, -ROOT_HEIGHT))
pieces = {
    # buste
    "tunique": piece(ns["fig_tunic"](), down),
    "tete": piece(ns["fig_head"](), down),
    **{f"cheveux-{s}": piece(ns["fig_hair"](s), down) for s in ("court", "chignon", "long")},
    **{f"chapeau-{h}": piece(ns["fig_hat"](h), down) for h in ("paille", "bonnet", "casque", "beret")},
    # bras
    "bras": piece(ns["fig_arm"]()),
    "main": piece(ns["fig_hand"]()),
    **{f"outil-{k}": piece(ns["tool_part"](k)) for k in ("hache", "merlin", "pioche", "masse")},
    "carotte": piece(ns["carrot_part"](), Matrix.Translation((0, -0.01, -0.235)) @ Matrix.Rotation(math.pi, 4, "X")),
    "panier-main": piece(ns["basket_part"](), Matrix.Translation((0, 0, -0.33))),
    # jambe
    "jambe": piece(ns["fig_leg"]()),
    # racine : charges devant soi, bras en pose « porter »
    "charge-buches": piece(
        Part()
        .add(ns["log_part"](0.34, 0.06), Matrix.Translation((0, -0.06, 0)))
        .add(ns["log_part"](0.3, 0.055), Matrix.Translation((0, 0.06, 0.02))),
        ground @ Matrix.Translation((0, -0.24, 0.36)) @ Matrix.Rotation(math.pi / 2, 4, "Y"),
    ),
    "charge-panier": piece(ns["basket_part"](ns["hexc"]("a3a39b")), ground @ Matrix.Translation((0, -0.22, 0.27))),
}

with open(os.path.join(ROOT, "blender-elements", "villageois", "poses", "poses.json"), encoding="utf-8") as f:
    poses = json.load(f)

kit = {
    "source": "blender-elements/villageois/sources/export_jeu.py",
    "units": {"position": 1e-4, "color": 1 / 200},
    "pivots": {
        "waist": round(WAIST - ROOT_HEIGHT, 4),
        "arm": [ARM_PIVOT[0], round(ARM_PIVOT[1] - WAIST, 4)],
        "leg": [LEG_PIVOT[0], round(LEG_PIVOT[1] - ROOT_HEIGHT, 4)],
    },
    "pieces": pieces,
    "gestures": poses["gestes"],
    "saw": poses["scie"],
    "poses": poses["poses"],
    "strike": poses["decoupage_coup"],
    "blend": poses["fondu_segments_s"],
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(kit, f, ensure_ascii=False, separators=(",", ":"))
tris = {k: len(v["colors"]) // 3 for k, v in pieces.items()}
print("villager-kit", os.path.getsize(OUT), "octets", json.dumps(tris), file=sys.stderr)
