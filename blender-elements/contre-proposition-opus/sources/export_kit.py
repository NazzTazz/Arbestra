"""Produit le kit « carré potager » : pièces GLB, atlas lointain, manifeste, validation.

Exécuter dans Blender après avoir chargé build_opus.py dans le même espace de noms
(voir README du kit). Écrit dans blender-elements/carre-potager/.
"""
import bpy, json, math, os
import numpy as np
from mathutils import Matrix, Vector

KIT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(SOURCE)))), "carre-potager")
AW, AH, TILE, PAD = 512, 256, 128, 4
CONTENT = TILE - 2 * PAD
TILES = ["stade-1", "stade-2", "stade-3", "stade-4", "stade-5", "stade-6", "stade-7", "sol"]


def lit_material(name, image=None):
    """Matériau éclairé simple face : couleur de sommets ou texture, rugosité 1, sans reflet."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True
    nt = m.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.links.new(tex.outputs[0], bsdf.inputs["Base Color"])
    else:
        col = nt.nodes.new("ShaderNodeVertexColor")
        col.layer_name = "Col"
        nt.links.new(col.outputs[0], bsdf.inputs["Base Color"])
    return m


def socle():
    mb = MB()
    mb.add(soil())
    for y in ROWS:
        mb.add(ridge(y))
    return mb


def centered_ridge():
    mb = MB()
    mb.add(ridge(0.0), Matrix.Translation((-CELL / 2, 0, 0)))
    return mb


# ---------- atlas ----------
def render_tiles(tmp):
    """Vue du dessus de chaque stade, sans bordure ni poteau, couleurs non ombrées."""
    sc = new_scene("OPUS atlas bake")
    sc.render.resolution_x = sc.render.resolution_y = CONTENT * 2
    sc.render.image_settings.file_format = 'PNG'
    ortho_cam(sc, "Cam OPUS atlas", Vector((CELL / 2, CELL / 2, 10)), (0, 0, 0), CELL)
    tufts = {"semis": tuft_sprout(), "jeune": tuft_young(), "mure": tuft_mature()}
    win, prev = bpy.context.window, bpy.context.window.scene
    paths = []
    for i, key in enumerate(TILES):
        for o in [o for o in sc.objects if o.type == 'MESH']:
            bpy.data.objects.remove(o, do_unlink=True)
        mb = socle() if key == "sol" else parcel((0, 0), i + 1, tufts, crate())
        ob = bpy.data.objects.new(f"atlas_{key}", mb.build(f"atlas_{key}", shade=False))
        sc.collection.objects.link(ob)
        win.scene = sc
        sc.render.filepath = os.path.join(tmp, f"tile-{key}.png")
        bpy.ops.render.render(write_still=True)
        paths.append(sc.render.filepath)
    win.scene = prev
    for o in list(sc.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.scenes.remove(sc)
    return paths


def read_rgba(path):
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(im)
    return a


def write_png(arr, path, name):
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.pixels[:] = arr.ravel()
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def tile_rect(i):
    """Case i : colonne i % 4, ligne i // 4 depuis le haut de l'image."""
    c, r = i % 4, i // 4
    return c, r


def build_atlas(tmp):
    atlas = np.zeros((AH, AW, 4), dtype=np.float32)
    atlas[..., 3] = 1
    stages_dir = os.path.join(KIT, "textures", "stades-240")
    os.makedirs(stages_dir, exist_ok=True)
    for i, path in enumerate(render_tiles(tmp)):
        full = read_rgba(path)
        write_png(full, os.path.join(stages_dir, f"{TILES[i]}.png"), f"tmp_{TILES[i]}")
        small = full.reshape(CONTENT, 2, CONTENT, 2, 4).mean(axis=(1, 3))
        padded = np.pad(small, ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge")
        c, r = tile_rect(i)
        y0 = AH - (r + 1) * TILE  # tableau numpy : ligne 0 en bas de l'image
        atlas[y0:y0 + TILE, c * TILE:(c + 1) * TILE] = padded
    for img in [i for i in bpy.data.images if i.name.startswith("tmp_")]:
        bpy.data.images.remove(img)
    path = os.path.join(KIT, "textures", "atlas-lointain.png")
    old = bpy.data.images.get("carre-potager-atlas")
    if old:
        bpy.data.images.remove(old)
    img = write_png(atlas, path, "carre-potager-atlas")
    img.name = "carre-potager-atlas"
    img.filepath = path
    img.reload()
    return img


def far_plate(i, name, mat):
    """Plaque lointaine : coin bas gauche à l'origine, 2,5 x 2,5 m, UV sur la case i de l'atlas."""
    c, r = tile_rect(i)
    u0, u1 = (c * TILE + PAD) / AW, (c * TILE + PAD + CONTENT) / AW
    v0, v1 = 1 - (r * TILE + PAD + CONTENT) / AH, 1 - (r * TILE + PAD) / AH
    me = bpy.data.meshes.new(name)
    me.from_pydata([(0, 0, 0), (CELL, 0, 0), (CELL, CELL, 0), (0, CELL, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for li, (u, v) in zip(me.polygons[0].loop_indices, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
        uv.data[li].uv = (u, v)
    me.materials.append(mat)
    return me, {"colonne": c, "ligne": r, "u": [round(u0, 6), round(u1, 6)], "v_blender": [round(v0, 6), round(v1, 6)]}


# ---------- export ----------
def export(sc, path):
    win, prev = bpy.context.window, bpy.context.window.scene
    win.scene = sc
    # Scène active seule : une sélection exporterait aussi les objets sélectionnés d'autres scènes.
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_active_scene=True, export_yup=True,
                              export_apply=False, export_vertex_color='ACTIVE', export_materials='EXPORT')
    win.scene = prev


def make_kit():
    os.makedirs(os.path.join(KIT, "assets"), exist_ok=True)
    tmp = os.path.join(KIT, "previews", "_tmp")
    os.makedirs(tmp, exist_ok=True)
    terroir = lit_material("OPUS_terroir")
    atlas = build_atlas(tmp)
    lointain = lit_material("OPUS_lointain", atlas)

    pieces = {
        "SOCLE": (socle(), "Coin bas gauche de la cellule à l'origine ; sol + trois buttes fusionnés."),
        "SOL": (soil(), "Coin bas gauche ; sol nu (chantier ou cellule réservée)."),
        "BUTTE": (centered_ridge(), "Centre XY de la butte, base Z=0 ; grand axe X."),
        "BORDURE": (border(), "Longe X de 0 à 2,5 m ; face extérieure à Y=0, intérieur vers +Y."),
        "POTEAU": (post(), "Centré sur le coin canonique, pied Z=0."),
        "SEMIS": (tuft_sprout(), "Pied au centre ; poser au sommet de la butte (Z=0,09)."),
        "TOUFFE_JEUNE": (tuft_young(), "Pied au centre ; poser au sommet de la butte (Z=0,09)."),
        "TOUFFE_MURE": (tuft_mature(), "Pied au centre ; poser au sommet de la butte (Z=0,09)."),
        "CAGETTE": (crate(), "Centre de la caisse, fond Z=0."),
    }
    sc = new_scene("OPUS export kit")
    manifest_pieces = {}
    for name, (mb, origin) in pieces.items():
        ob = bpy.data.objects.new(name, mb.build(name, shade=False, mat=terroir))
        sc.collection.objects.link(ob)
        manifest_pieces[name] = {"triangles": mb.tris(), "materiau": "OPUS_terroir", "origine": origin}
    atlas_tiles = {}
    for i, key in enumerate(TILES):
        name = f"LOINTAIN_{key.upper().replace('-', '_')}"
        me, rect = far_plate(i, name, lointain)
        sc.collection.objects.link(bpy.data.objects.new(name, me))
        manifest_pieces[name] = {"triangles": 2, "materiau": "OPUS_lointain",
                                 "origine": "Coin bas gauche de la cellule ; carré 2,5 x 2,5 m, Z=0."}
        atlas_tiles[key] = rect
    export(sc, os.path.join(KIT, "assets", "carre-potager.glb"))

    # exemple assemblé : le L de référence, stades 7 / 4 / 2, sans ombrage inscrit
    L = [(0, 0), (1, 0), (0, 1)]
    ex = garden(L, {(0, 0): 7, (1, 0): 4, (0, 1): 2})
    sc2 = new_scene("OPUS export exemple L")
    sc2.collection.objects.link(bpy.data.objects.new("EXEMPLE_L", ex.build("EXEMPLE_L", shade=False, mat=terroir)))
    export(sc2, os.path.join(KIT, "assets", "exemple-L.glb"))

    manifest = {
        "kit": "carre-potager",
        "version": 1,
        "date": "2026-10-25",
        "unites": "mètres ; coordonnées Blender (Z haut) dans ce manifeste, glTF Y haut dans les GLB",
        "cellule": CELL,
        "materiaux": {
            "OPUS_terroir": "éclairé, simple face, couleur = COLOR_0 (sRGB), rugosité 1, métal 0, sans texture",
            "OPUS_lointain": "éclairé, simple face, couleur = textures/atlas-lointain.png",
        },
        "pieces": manifest_pieces,
        "pose": {
            "rangs_y": list(ROWS),
            "touffes_x": list(SLOTS),
            "touffes_z": RIDGE_H,
            "variation_touffe": "par emplacement, graine déterministe : décalage ±0,04 (X) ±0,03 (Y), rotation Z libre, échelle 0,9 à 1,1 ; conservée entre stades",
            "croissance": [{"stade": i + 1, "piece": {"semis": "SEMIS", "jeune": "TOUFFE_JEUNE", "mure": "TOUFFE_MURE"}[p], "echelle": s}
                           for i, (p, s) in enumerate(GROWTH)],
            "cagette": {"stade": 7, "position": [2.12, 0.84, 0.0], "rotation_z": 0.12},
            "bordure": "un côté de cellule reçoit BORDURE seulement si la cellule voisine n'est pas du même jardin ; rotations 0, 90, 180, -90° autour du coin d'origine du côté",
            "poteaux": "aux extrémités de chaque côté exposé, dédupliqués par position canonique (topologie torique comprise)",
        },
        "atlas": {"fichier": "textures/atlas-lointain.png", "taille": [AW, AH], "case": TILE, "contenu": CONTENT,
                  "debord": PAD, "ordre": TILES, "cases": atlas_tiles,
                  "note": "vues du dessus sans bordure ni poteau, couleurs non ombrées ; UV exportées pour la convention glTF"},
        "budgets": {
            "parcelle_pleine_isolee": garden([(0, 0)], {(0, 0): 7}).tris(),
            "parcelle_stade_1_isolee": garden([(0, 0)], {(0, 0): 1}).tris(),
            "L_plein": garden(L, {c: 7 for c in L}).tris(),
            "exemple_L": ex.tris(),
            "lointain_par_cellule": 2,
        },
    }
    with open(os.path.join(KIT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    for s in (sc, sc2):
        for o in list(s.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.scenes.remove(s)
    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)
    return manifest


# ---------- validation ----------
def validate(manifest):
    """Réimporte les GLB : triangles, matériaux, COLOR_0, UV ; rend l'exemple éclairé."""
    report = {}
    sc = new_scene("OPUS validation")
    win, prev = bpy.context.window, bpy.context.window.scene
    win.scene = sc
    before_mats = set(bpy.data.materials)
    before_imgs = set(bpy.data.images)
    bpy.ops.import_scene.gltf(filepath=os.path.join(KIT, "assets", "carre-potager.glb"))
    kit = {}
    for o in sc.objects:
        if o.type != 'MESH':
            continue
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        kit[o.name] = {"tris": tris, "color0": bool(o.data.color_attributes), "uv": bool(o.data.uv_layers),
                       "mats": [m.name for m in o.data.materials],
                       "identite": o.matrix_world == Matrix.Identity(4)}
    errors = []
    for name, spec in manifest["pieces"].items():
        got = kit.get(name)
        if not got:
            errors.append(f"{name} absent")
        elif got["tris"] != spec["triangles"]:
            errors.append(f"{name}: {got['tris']} != {spec['triangles']}")
        elif not got["identite"]:
            errors.append(f"{name}: transformation non identité")
        elif name.startswith("LOINTAIN") and not got["uv"]:
            errors.append(f"{name}: UV manquantes")
        elif not name.startswith("LOINTAIN") and not got["color0"]:
            errors.append(f"{name}: COLOR_0 manquant")
    report["pieces_verifiees"] = len(kit)
    report["materiaux_importes"] = sorted({m for v in kit.values() for m in v["mats"]})
    for o in list(sc.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    bpy.ops.import_scene.gltf(filepath=os.path.join(KIT, "assets", "exemple-L.glb"))
    ex = [o for o in sc.objects if o.type == 'MESH']
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in ex)
    if tris != manifest["budgets"]["exemple_L"]:
        errors.append(f"exemple L: {tris} != {manifest['budgets']['exemple_L']}")
    report["exemple_L_triangles"] = tris
    # aperçu éclairé (soleil), comme le verra un matériau éclairé du jeu
    ref = bpy.data.scenes["V8 L_LOD0"].camera
    ortho_cam(sc, "Cam validation", ref.location.copy(), ref.rotation_euler.copy(), ref.data.ortho_scale)
    sun = bpy.data.lights.new("Soleil validation", 'SUN')
    sun.energy = 3.0
    so = bpy.data.objects.new("Soleil validation", sun)
    so.rotation_euler = (math.radians(40), 0, math.radians(-35))
    sc.collection.objects.link(so)
    sc.render.filepath = os.path.join(KIT, "previews", "reimport-exemple-L-eclaire.png")
    bpy.ops.render.render(write_still=True)
    win.scene = prev
    for o in list(sc.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.scenes.remove(sc)
    bpy.data.lights.remove(sun)
    for m in set(bpy.data.materials) - before_mats:
        bpy.data.materials.remove(m)
    for i in set(bpy.data.images) - before_imgs:
        bpy.data.images.remove(i)
    for me in [m for m in bpy.data.meshes if m.users == 0]:
        bpy.data.meshes.remove(me)
    report["erreurs"] = errors
    report["passe"] = not errors
    with open(os.path.join(KIT, "validation.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return report


m = make_kit()
print(json.dumps(m["budgets"], ensure_ascii=False))
print(json.dumps(validate(m), ensure_ascii=False))
