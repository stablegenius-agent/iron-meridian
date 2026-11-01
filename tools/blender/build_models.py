"""Procedurally builds IRON MERIDIAN's unit models and exports one GLB per unit.

Run headless:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup --python tools/blender/build_models.py

Conventions (so the game can treat every model the same way):
  * Nose / bow points to Blender -Y  ->  glTF +Z  ->  three.js Object3D.lookAt() aims it at the target.
  * Up is Blender +Z.  Longest dimension is ~1.0 unit; the game scales per unit type.
  * Material names are semantic: "Hull" is recolored per faction at runtime, "Glow"/"Glass" are emissive.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Vector

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "models")
OUT_DIR = os.path.normpath(OUT_DIR)
os.makedirs(OUT_DIR, exist_ok=True)

MATS = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()


def mat(name, color, metallic=0.2, rough=0.55, emit=None, strength=4.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    MATS[name] = m
    return m


def palette():
    return {
        "hull": mat("Hull", (0.42, 0.47, 0.52), 0.35, 0.5),
        "dark": mat("Dark", (0.08, 0.09, 0.11), 0.4, 0.6),
        "deck": mat("Deck", (0.16, 0.17, 0.19), 0.1, 0.85),
        "glass": mat("Glass", (0.05, 0.25, 0.35), 0.0, 0.1, emit=(0.2, 0.8, 1.0), strength=2.5),
        "glow": mat("Glow", (1.0, 0.45, 0.1), 0.0, 0.3, emit=(1.0, 0.45, 0.1), strength=8.0),
        "panel": mat("Panel", (0.05, 0.12, 0.35), 0.6, 0.25, emit=(0.15, 0.35, 1.0), strength=1.5),
        "accent": mat("Accent", (0.9, 0.75, 0.2), 0.3, 0.4),
        "white": mat("White", (0.85, 0.87, 0.9), 0.1, 0.6),
    }


def _finish(obj, m, loc=(0, 0, 0), rot=(0, 0, 0)):
    obj.location = loc
    obj.rotation_euler = Euler(rot)
    if m is not None:
        obj.data.materials.append(m)
    return obj


def box(sx, sy, sz, loc=(0, 0, 0), m=None, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        mod = o.modifiers.new("b", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return _finish(o, m, loc, rot)


def cyl(r, depth, loc=(0, 0, 0), m=None, rot=(0, 0, 0), verts=12, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth)
    return _finish(bpy.context.active_object, m, loc, rot)


def sphere(r, loc=(0, 0, 0), m=None, scale=(1, 1, 1), segs=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=r)
    o = bpy.context.active_object
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return _finish(o, m, loc)


def prism(points, thickness, loc=(0, 0, 0), m=None, rot=(0, 0, 0), taper=1.0):
    """Extrude a 2D outline (XY plane) by `thickness` along Z. taper<1 shrinks the top face."""
    me = bpy.data.meshes.new("prism")
    bm = bmesh.new()
    bot = [bm.verts.new((x, y, -thickness / 2)) for x, y in points]
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    top = [bm.verts.new((cx + (x - cx) * taper, cy + (y - cy) * taper, thickness / 2)) for x, y in points]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("prism", me)
    bpy.context.collection.objects.link(o)
    return _finish(o, m, loc, rot)


def loft(sections, m=None, verts=10):
    """Fuselage from circular sections [(y, radius, z_offset, x_scale)] along Y."""
    me = bpy.data.meshes.new("loft")
    bm = bmesh.new()
    rings = []
    for y, r, z, xs in sections:
        ring = []
        for k in range(verts):
            a = 2 * math.pi * k / verts
            ring.append(bm.verts.new((math.cos(a) * r * xs, y, z + math.sin(a) * r)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(verts):
            k2 = (k + 1) % verts
            bm.faces.new((a[k], a[k2], b[k2], b[k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("loft", me)
    bpy.context.collection.objects.link(o)
    return _finish(o, m)


def export(name):
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # normalize: longest side -> 1.0, centered on XY, bottom at z=0 for ground units
    dims = o.dimensions
    s = 1.0 / max(dims)
    o.scale = (s, s, s)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.shade_flat()
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    path = os.path.join(OUT_DIR, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True, export_normals=True,
                              export_materials="EXPORT")
    print(f"[models] {name}: {tris} tris -> {path}")


# ---------------------------------------------------------------- aircraft
def fighter():
    reset(); P = palette()
    loft([(-1.0, 0.02, 0, 1), (-0.8, 0.07, 0.01, 1), (-0.45, 0.11, 0.02, 1.15), (0.1, 0.12, 0.0, 1.35),
          (0.55, 0.11, 0.0, 1.4), (0.75, 0.08, 0, 1.2)], P["hull"], verts=10)
    sphere(0.07, (0, -0.52, 0.09), P["glass"], scale=(0.8, 2.6, 0.8))
    prism([(0.0, -0.25), (0.75, 0.35), (0.75, 0.48), (0.1, 0.45), (0.0, 0.45)], 0.025, (0.08, 0, 0), P["hull"])
    prism([(0.0, -0.25), (-0.75, 0.35), (-0.75, 0.48), (-0.1, 0.45), (0.0, 0.45)], 0.025, (-0.08, 0, 0), P["hull"])
    for sx in (1, -1):
        # canted twin fins: outline mirrored per side so both rotate up and outward
        prism([(0, 0.45), (sx * 0.34, 0.66), (sx * 0.34, 0.77), (0, 0.78)], 0.02, (sx * 0.1, 0, 0.05), P["hull"],
              rot=(0, sx * math.radians(-62), 0))
        prism([(0, 0.55), (sx * 0.3, 0.75), (sx * 0.3, 0.82), (0, 0.82)], 0.018, (sx * 0.08, 0, -0.01), P["hull"])
    cyl(0.07, 0.06, (0, 0.77, 0), P["glow"], rot=(math.radians(90), 0, 0))
    export("fighter")


def bomber():
    reset(); P = palette()
    pts = [(0, -0.55), (1.0, 0.35), (0.85, 0.48), (0.62, 0.36), (0.42, 0.5), (0.22, 0.38), (0, 0.48),
           (-0.22, 0.38), (-0.42, 0.5), (-0.62, 0.36), (-0.85, 0.48), (-1.0, 0.35)]
    prism(pts, 0.06, (0, 0, 0), P["hull"], taper=0.92)
    loft([(-0.55, 0.01, 0.02, 1), (-0.35, 0.09, 0.03, 2.2), (0.0, 0.11, 0.03, 2.6), (0.3, 0.07, 0.02, 2.2)], P["hull"])
    sphere(0.05, (0, -0.33, 0.09), P["glass"], scale=(1.8, 1.4, 0.5))
    for sx in (0.25, -0.25):
        cyl(0.035, 0.02, (sx, 0.36, 0.04), P["glow"], rot=(math.radians(90), 0, 0))
    export("bomber")


def drone():
    reset(); P = palette()
    loft([(-0.55, 0.02, 0, 1), (-0.45, 0.07, 0.01, 1), (-0.2, 0.07, 0, 1), (0.35, 0.045, 0, 1), (0.5, 0.025, 0, 1)],
         P["hull"], verts=10)
    sphere(0.075, (0, -0.42, 0.03), P["dark"], scale=(1, 1.4, 0.9))
    prism([(-1.0, 0.0), (1.0, 0.0), (1.0, 0.07), (-1.0, 0.07)], 0.015, (0, -0.02, 0.03), P["hull"])
    for sx in (1, -1):
        prism([(0, 0.38), (0.22, 0.5), (0.22, 0.54), (0, 0.5)], 0.012, (0, 0, 0), P["hull"],
              rot=(0, sx * math.radians(-40), 0))
    box(0.2, 0.01, 0.02, (0, 0.52, 0), P["dark"])
    sphere(0.035, (0, -0.25, -0.07), P["glass"])
    export("drone")


def helicopter():
    reset(); P = palette()
    loft([(-0.45, 0.05, 0.02, 1), (-0.35, 0.13, 0.03, 1.0), (0.0, 0.14, 0.03, 1.0), (0.15, 0.1, 0.05, 0.8),
          (0.6, 0.03, 0.09, 0.8), (0.7, 0.025, 0.1, 0.8)], P["hull"])
    sphere(0.09, (0, -0.33, 0.07), P["glass"], scale=(1.1, 1, 0.8))
    cyl(0.03, 0.06, (0, -0.05, 0.2), P["dark"])
    for a in range(4):
        box(0.95, 0.04, 0.008, (0, -0.05, 0.23), P["dark"], rot=(0, 0, math.radians(45 + a * 90 / 2 * 2)))
    prism([(0, 0.6), (0.0, 0.72), (0.18, 0.75), (0.15, 0.6)], 0.012, (0, 0, 0.1), P["hull"], rot=(0, math.radians(-90), 0))
    cyl(0.07, 0.008, (0.03, 0.7, 0.16), P["dark"], rot=(0, math.radians(90), 0), verts=10)
    for sx in (1, -1):
        box(0.02, 0.4, 0.02, (sx * 0.1, -0.05, -0.15), P["dark"])
        box(0.12, 0.05, 0.05, (sx * 0.17, 0.0, 0.0), P["dark"])
    export("helicopter")


def transport():
    reset(); P = palette()
    loft([(-1.0, 0.04, -0.02, 1), (-0.85, 0.12, 0.0, 1), (-0.5, 0.14, 0.01, 1), (0.4, 0.14, 0.02, 1),
          (0.8, 0.06, 0.1, 1), (0.95, 0.03, 0.12, 1)], P["hull"])
    sphere(0.06, (0, -0.86, 0.07), P["glass"], scale=(1.6, 1, 0.6))
    prism([(0, -0.25), (1.0, 0.0), (1.0, 0.1), (0, 0.05)], 0.025, (0, 0, 0.12), P["hull"])
    prism([(0, -0.25), (-1.0, 0.0), (-1.0, 0.1), (0, 0.05)], 0.025, (0, 0, 0.12), P["hull"])
    for x in (0.35, 0.6, -0.35, -0.6):
        cyl(0.04, 0.16, (x, -0.12, 0.06), P["dark"], rot=(math.radians(90), 0, 0))
        cyl(0.03, 0.01, (x, -0.04, 0.06), P["glow"], rot=(math.radians(90), 0, 0))
    prism([(0, 0.7), (0, 0.98), (0.28, 0.98), (0.22, 0.75)], 0.02, (0, 0, 0.12), P["hull"], rot=(0, math.radians(-90), 0))
    prism([(-0.32, 0.88), (0.32, 0.88), (0.32, 0.98), (-0.32, 0.98)], 0.02, (0, 0, 0.4), P["hull"])
    export("transport")


# ---------------------------------------------------------------- ground
def tank():
    reset(); P = palette()
    prism([(-0.36, -0.55), (0.36, -0.55), (0.4, -0.4), (0.4, 0.5), (-0.4, 0.5), (-0.4, -0.4)], 0.16, (0, 0, 0.17), P["hull"], taper=0.9)
    for sx in (1, -1):
        box(0.16, 1.05, 0.15, (sx * 0.38, 0, 0.08), P["dark"], bevel=0.03)
        for k in range(6):
            cyl(0.06, 0.17, (sx * 0.38, -0.4 + k * 0.16, 0.06), P["dark"], rot=(0, math.radians(90), 0), verts=8)
    prism([(-0.25, -0.3), (0.25, -0.3), (0.3, 0.1), (0.25, 0.3), (-0.25, 0.3), (-0.3, 0.1)], 0.13, (0, 0.05, 0.31), P["hull"], taper=0.85)
    cyl(0.03, 0.75, (0, -0.55, 0.33), P["hull"], rot=(math.radians(90), 0, 0), verts=8)
    box(0.06, 0.08, 0.05, (0.12, 0.1, 0.4), P["dark"])
    box(0.03, 0.03, 0.12, (-0.15, 0.22, 0.43), P["accent"])
    export("tank")


def sam():
    reset(); P = palette()
    box(0.36, 0.95, 0.16, (0, 0, 0.16), P["hull"], bevel=0.02)
    box(0.34, 0.25, 0.22, (0, -0.4, 0.3), P["hull"], bevel=0.02)
    for sx in (1, -1):
        for k in range(4):
            cyl(0.055, 0.1, (sx * 0.17, -0.35 + k * 0.23, 0.05), P["dark"], rot=(0, math.radians(90), 0), verts=8)
    for i, sx in enumerate((-0.09, 0.09)):
        for sz in (0, 0.11):
            cyl(0.05, 0.6, (sx, 0.12, 0.38 + sz + 0.12), P["dark"], rot=(math.radians(55), 0, 0), verts=8)
    box(0.24, 0.02, 0.16, (0, -0.4, 0.55), P["panel"], rot=(math.radians(-20), 0, 0))
    export("sam")


def base():
    reset(); P = palette()
    prism([(math.cos(a) * 1.0, math.sin(a) * 1.0) for a in [i * math.pi / 3 for i in range(6)]], 0.06, (0, 0, 0.03), P["deck"])
    box(0.22, 1.5, 0.02, (0.25, 0, 0.07), P["dark"], rot=(0, 0, math.radians(30)))
    for k in range(6):
        box(0.03, 0.12, 0.005, (0.25 + math.sin(math.radians(30)) * (-0.6 + k * 0.24) * -1, -0.6 + k * 0.24, 0.085), P["white"],
            rot=(0, 0, math.radians(30)))
    box(0.32, 0.26, 0.16, (-0.45, 0.25, 0.14), P["hull"], bevel=0.04)
    box(0.08, 0.08, 0.38, (-0.35, -0.35, 0.25), P["hull"])
    box(0.16, 0.16, 0.07, (-0.35, -0.35, 0.47), P["glass"])
    sphere(0.12, (-0.65, -0.05, 0.15), P["white"], segs=10, rings=6)
    export("base")


# ---------------------------------------------------------------- naval
def hull_shape(length, beam, depth, bow=0.25):
    half = beam / 2
    return [(0, -length / 2), (half * 0.6, -length / 2 + bow * length * 0.5), (half, -length / 2 + bow * length),
            (half, length / 2 - 0.04), (half * 0.8, length / 2), (-half * 0.8, length / 2), (-half, length / 2 - 0.04),
            (-half, -length / 2 + bow * length), (-half * 0.6, -length / 2 + bow * length * 0.5)]


def carrier():
    reset(); P = palette()
    prism(hull_shape(1.0, 0.16, 0.08), 0.1, (0, 0, 0.0), P["hull"], taper=0.92)
    prism([(-0.13, -0.5), (0.09, -0.5), (0.11, 0.48), (-0.2, 0.48), (-0.22, 0.05), (-0.13, -0.2)], 0.02, (0, 0, 0.06), P["deck"])
    box(0.012, 0.6, 0.002, (-0.02, -0.12, 0.072), P["white"], rot=(0, 0, math.radians(-9)))
    box(0.012, 0.8, 0.002, (0.03, 0.05, 0.072), P["white"])
    box(0.04, 0.12, 0.09, (0.09, 0.12, 0.11), P["hull"])
    box(0.03, 0.06, 0.06, (0.09, 0.1, 0.18), P["glass"])
    cyl(0.004, 0.08, (0.09, 0.12, 0.24), P["dark"], verts=6)
    for k in range(5):
        prism([(0, -0.03), (0.02, 0.01), (0, 0.0), (-0.02, 0.01)], 0.006, (-0.08 + (k % 2) * 0.03, 0.2 + k * 0.05, 0.075), P["hull"])
    export("carrier")


def destroyer():
    reset(); P = palette()
    prism(hull_shape(1.0, 0.13, 0.07, bow=0.3), 0.08, (0, 0, 0), P["hull"], taper=0.9)
    box(0.09, 0.32, 0.06, (0, 0.02, 0.07), P["hull"], bevel=0.01)
    box(0.07, 0.14, 0.06, (0, -0.06, 0.13), P["hull"])
    box(0.06, 0.02, 0.03, (0, -0.135, 0.14), P["glass"])
    cyl(0.005, 0.14, (0, -0.02, 0.21), P["dark"], verts=6)
    box(0.07, 0.008, 0.008, (0, -0.02, 0.25), P["dark"])
    cyl(0.025, 0.04, (0, 0.12, 0.12), P["dark"], verts=8)
    cyl(0.022, 0.03, (0, -0.33, 0.06), P["hull"], verts=8)
    cyl(0.004, 0.08, (0, -0.37, 0.07), P["dark"], rot=(math.radians(90), 0, 0), verts=6)
    box(0.07, 0.08, 0.004, (0, -0.22, 0.042), P["dark"])
    box(0.06, 0.06, 0.004, (0, 0.3, 0.042), P["dark"])
    export("destroyer")


def submarine():
    reset(); P = palette()
    loft([(-0.5, 0.01, 0, 1), (-0.45, 0.05, 0, 1), (-0.35, 0.065, 0, 1), (0.25, 0.065, 0, 1), (0.42, 0.04, 0, 1),
          (0.5, 0.012, 0, 1)], P["dark"], verts=12)
    prism([(-0.035, -0.16), (0.035, -0.16), (0.03, -0.02), (-0.03, -0.02)], 0.025, (0, 0, 0.1), P["dark"],
          rot=(0, 0, 0))
    box(0.025, 0.12, 0.07, (0, -0.1, 0.09), P["dark"])
    box(0.16, 0.02, 0.006, (0, -0.1, 0.1), P["dark"])
    for r in (0, 90):
        box(0.2, 0.04, 0.006, (0, 0.43, 0), P["dark"], rot=(0, math.radians(r), 0))
    cyl(0.02, 0.01, (0, 0.5, 0), P["hull"], rot=(math.radians(90), 0, 0), verts=8)
    export("submarine")


# ---------------------------------------------------------------- space / weapons
def satellite():
    reset(); P = palette()
    box(0.22, 0.22, 0.3, (0, 0, 0), P["accent"], bevel=0.01)
    for sx in (1, -1):
        cyl(0.008, 0.18, (sx * 0.2, 0, 0), P["dark"], rot=(0, math.radians(90), 0), verts=6)
        box(0.42, 0.2, 0.008, (sx * 0.5, 0, 0), P["panel"])
        for k in range(3):
            box(0.004, 0.2, 0.012, (sx * (0.36 + k * 0.14), 0, 0), P["dark"])
    cyl(0.1, 0.05, (0, 0, 0.2), P["white"], r2=0.02, verts=12)
    cyl(0.006, 0.12, (0, 0, 0.27), P["dark"], verts=6)
    export("satellite")


def missile():
    reset(); P = palette()
    cyl(0.05, 0.8, (0, 0, 0), P["white"], rot=(math.radians(90), 0, 0), verts=10)
    cyl(0.05, 0.22, (0, -0.51, 0), P["accent"], rot=(math.radians(-90), 0, 0), r2=0.0, verts=10)
    for a in range(4):
        prism([(0, 0.25), (0.11, 0.38), (0.11, 0.42), (0, 0.4)], 0.01, (0, 0, 0), P["dark"],
              rot=(0, math.radians(a * 90), 0))
    cyl(0.035, 0.05, (0, 0.42, 0), P["glow"], rot=(math.radians(90), 0, 0), verts=10)
    export("missile")


BUILDERS = [fighter, bomber, drone, helicopter, transport, tank, sam, base, carrier, destroyer, submarine, satellite, missile]

if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for b in BUILDERS:
        if not only or b.__name__ in only:
            b()
    print("[models] done")
