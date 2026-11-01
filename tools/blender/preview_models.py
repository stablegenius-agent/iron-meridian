"""Renders a contact sheet of every exported GLB (workbench engine, material colors) to tools/blender/preview.png."""
import glob
import math
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = sorted(glob.glob(os.path.join(HERE, "..", "..", "assets", "models", "*.glb")))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
cols = 5
for i, path in enumerate(MODELS):
    bpy.ops.import_scene.gltf(filepath=path)
    objs = bpy.context.selected_objects
    for o in objs:
        if o.parent is None:
            o.location = ((i % cols) * 1.6, -(i // cols) * 1.6, 0)
            o.rotation_euler = (0, 0, math.radians(-35))
    bpy.ops.object.text_add(location=((i % cols) * 1.6 - 0.5, -(i // cols) * 1.6 - 0.75, 0))
    t = bpy.context.active_object
    t.data.body = os.path.splitext(os.path.basename(path))[0]
    t.data.size = 0.16

rows = math.ceil(len(MODELS) / cols)
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = cols * 1.6 + 0.4
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cx, cy = (cols - 1) * 1.6 / 2, -(rows - 1) * 1.6 / 2
cam.location = (cx, cy - 6, 6)
cam.rotation_euler = (math.radians(45), 0, 0)
scene.camera = cam
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "MATERIAL"
scene.display.shading.show_shadows = False
scene.render.resolution_x = 1600
scene.render.resolution_y = int(1600 * rows / cols) + 80
scene.render.filepath = os.path.join(HERE, "preview.png")
bpy.ops.render.render(write_still=True)
print("[preview] wrote", scene.render.filepath)
