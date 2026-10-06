"""Smoke test for the Blender add-on, run inside Blender:

    blender -b --factory-startup -P tools/test_addon.py

Registers the add-on straight from the source tree, imports the example scheme through the operator, and checks that
the scene has the walls, the paint materials, the cameras and the lights.
"""
import os
import sys

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# HP_ADDON_PATH: a folder that contains the unzipped house_painter package, to test the built zip instead of the source tree
sys.path.insert(0, os.environ.get("HP_ADDON_PATH") or os.path.join(ROOT, "blender_addon"))
import house_painter  # noqa: E402

house_painter.register()
failures = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (" - " + str(detail) if detail else ""))
    if not ok:
        failures.append(name)


check("operator registered", hasattr(bpy.ops.import_scene, "house_painter"))
example = os.path.join(ROOT, "examples", "house-cozy-deco-emerald-brass.json")
res = bpy.ops.import_scene.house_painter(filepath=example)
check("import finished", res == {"FINISHED"}, res)
objs = bpy.data.objects
paint = [m for m in bpy.data.materials if m.name.startswith("Paint:")]
cams = [o for o in objs if o.type == "CAMERA"]
lights = [o for o in objs if o.type == "LIGHT"]
check("walls built", sum(1 for o in objs if o.name.startswith("Wall_")) >= 25, sum(1 for o in objs if o.name.startswith("Wall_")))
check("paint materials", len(paint) >= 150, len(paint))
check("wall surface keeps its colour", any(m.name == "Paint:MBR-W1" for m in paint))
check("cameras", any(o.name == "Cam_doll" for o in cams) and any(o.name == "Cam_export" for o in cams), len(cams))
check("room lights", len(lights) >= 10, len(lights))
check("scene camera set", bpy.context.scene.camera is not None)

# importing again replaces the scene instead of piling a second house on top
n1 = len(bpy.data.objects)
bpy.ops.import_scene.house_painter(filepath=example)
check("re-import replaces the scene", len(bpy.data.objects) == n1, (n1, len(bpy.data.objects)))

# a plain house file is compiled by Node.js (house-core.js), so this needs Node on the PATH
import shutil  # noqa: E402
if shutil.which("node"):
    cottage = os.path.join(ROOT, "houses", "starter-cottage", "house.json")
    res = bpy.ops.import_scene.house_painter(filepath=cottage)
    check("plain house file imported", res == {"FINISHED"} and any(m.name == "Paint:BR1-N" for m in bpy.data.materials), res)
    check("cottage replaced the previous house", not any(m.name == "Paint:MBR-W1" for m in bpy.data.materials))
else:
    print("SKIP plain house file (Node.js not found)")

# a file that is not a House Painter file is refused with a message, not a crash
bad = os.path.join(os.environ.get("TEMP", "/tmp"), "not_a_house.json")
with open(bad, "w", encoding="utf-8") as f:
    f.write('{"hello": "world"}')
try:                                              # an operator that reports an ERROR raises RuntimeError when run from a script
    res = bpy.ops.import_scene.house_painter(filepath=bad)
    refused = res == {"CANCELLED"}
except RuntimeError as e:
    refused = "not a House Painter file" in str(e)
check("bad file refused", refused)

house_painter.unregister()
print("\n%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
