"""Run with Blender -b garden-v8.blend --python finalize_source.py.
Turn the dependency-only library into a normal editable .blend opening on the L.
"""
import bpy
scene=bpy.data.scenes['V8 L_LOD0']
for window in bpy.context.window_manager.windows:
    window.scene=scene
    for area in window.screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath,compress=True)
print('Editable source saved, active scene:',bpy.context.scene.name)
