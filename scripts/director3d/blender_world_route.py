"""Absolute, non-accumulating world translation for an offline Blender target."""

from mathutils import Matrix, Vector

from support_contact_metrics import vector


def capture_route_roots(target):
    import bpy
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH'
              and any(mod.type == 'ARMATURE' and mod.object == target for mod in obj.modifiers)]
    roots = set()
    for obj in [target, *meshes]:
        while obj.parent is not None:
            obj = obj.parent
        roots.add(obj)
    if any(root.constraints or root.animation_data for root in roots):
        raise ValueError('world route requires unanimated, unconstrained hierarchy roots')
    return [(root, root.matrix_world.copy()) for root in roots]


def apply_route_offset(roots, offset):
    transform = Matrix.Translation(Vector(vector(offset)))
    for root, baseline in roots:
        root.matrix_world = transform @ baseline
