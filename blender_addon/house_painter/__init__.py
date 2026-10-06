"""House Painter: import a painted house into Blender.

File > Import > House Painter scheme (.json) builds the house from a file saved with "Export for Blender" in the paint
studio (it contains the house and every surface's colour), or from a plain house.json (that one needs Node.js installed).
The scene gets the same paint surfaces as the web page: one material per wall face, ceiling, cabinet door and drawer,
door and trim piece, named "Paint:<key>", so you can re-colour any of them by hand. Cameras for the dollhouse view,
every room and (if the file has one) the view you exported are included.
"""
import os
import runpy
import sys

import bpy
from bpy.props import BoolProperty, EnumProperty, StringProperty
from bpy_extras.io_utils import ImportHelper

bl_info = {   # used when installed as a legacy add-on; extensions read blender_manifest.toml instead
    "name": "House Painter",
    "author": "House Painter authors",
    "version": (0, 1, 0),
    "blender": (4, 2, 0),
    "location": "File > Import > House Painter scheme (.json)",
    "description": "Import a house and paint scheme made with House Painter",
    "category": "Import-Export",
}

_HERE = os.path.dirname(os.path.abspath(__file__))


def _build_script():
    """The build script lives beside this file once packaged; in a source checkout it is two folders up."""
    for p in (os.path.join(_HERE, "build_house.py"), os.path.normpath(os.path.join(_HERE, "..", "..", "build_house.py"))):
        if os.path.exists(p):
            return p
    raise FileNotFoundError("build_house.py not found next to the add-on")


def _clear_scene():
    """Remove everything from the open file without touching preferences (a factory reset would turn this add-on off)."""
    for coll in ("objects", "collections", "meshes", "materials", "lights", "cameras", "images", "worlds"):
        data = getattr(bpy.data, coll)
        for item in list(data):
            try:
                data.remove(item)
            except Exception:
                pass


class IMPORT_SCENE_OT_house_painter(bpy.types.Operator, ImportHelper):
    """Build a house from a House Painter file"""
    bl_idname = "import_scene.house_painter"
    bl_label = "Import House Painter scheme"
    bl_options = {"REGISTER", "UNDO"}

    filename_ext = ".json"
    filter_glob: StringProperty(default="*.json", options={"HIDDEN"})
    lighting: EnumProperty(
        name="Lighting",
        description="Light the scene the way the web page does",
        items=[("file", "As exported", "The lighting chosen when the file was exported"), ("day", "Daylight", ""),
               ("overcast", "Overcast", ""), ("evening", "Evening lamps", ""), ("true", "True colour", "")],
        default="file",
    )
    clear: BoolProperty(name="Replace the open scene", description="Delete everything in this file first. Turn off to add the house to the scene as it is", default=True)

    def execute(self, context):
        try:
            script = _build_script()
        except FileNotFoundError as e:
            self.report({"ERROR"}, str(e))
            return {"CANCELLED"}
        if self.clear:
            _clear_scene()
        argv = ["blender", "--", "--keep-scene", "--no-save", "--scheme", self.filepath]
        if self.lighting != "file":
            argv += ["--light", self.lighting]
        # a scheme file carries its own house; a plain house file is built with --house instead
        try:
            import json
            with open(self.filepath, encoding="utf-8") as f:
                head = json.load(f)
            if head.get("format") == "house-painter/house":
                argv = ["blender", "--", "--keep-scene", "--no-save", "--house", self.filepath] + (["--light", self.lighting] if self.lighting != "file" else [])
            elif head.get("format") not in ("house-painter/scheme",):
                self.report({"ERROR"}, "That is not a House Painter file (expected a scheme export or a house file).")
                return {"CANCELLED"}
        except Exception as e:
            self.report({"ERROR"}, "Could not read the file: %s" % e)
            return {"CANCELLED"}
        old = sys.argv
        sys.argv = argv
        try:
            ns = runpy.run_path(script, run_name="__house_painter__")
        except SystemExit as e:                                   # the build script exits with a message for problems like a missing Node.js
            self.report({"ERROR"}, str(e.code) if e.code else "The house could not be built.")
            return {"CANCELLED"}
        except Exception as e:
            self.report({"ERROR"}, "Building the house failed: %s" % e)
            raise
        finally:
            sys.argv = old
        views = ns.get("VIEWS", {})
        self.report({"INFO"}, "Built %d paint materials and %d cameras. Pick a camera from the outliner (Cam_doll, Cam_<room>%s)."
                    % (len(ns.get("PAINT", {})), len(views), ", Cam_export" if "export" in views else ""))
        return {"FINISHED"}


def _menu(self, context):
    self.layout.operator(IMPORT_SCENE_OT_house_painter.bl_idname, text="House Painter scheme (.json)")


def register():
    bpy.utils.register_class(IMPORT_SCENE_OT_house_painter)
    bpy.types.TOPBAR_MT_file_import.append(_menu)


def unregister():
    bpy.types.TOPBAR_MT_file_import.remove(_menu)
    bpy.utils.unregister_class(IMPORT_SCENE_OT_house_painter)
