"""Packages the Blender add-on as an extension zip:  python tools/build_addon.py   ->   dist/house_painter-<version>.zip

The zip holds the add-on, the build script it runs, the default floor texture, and the three small scripts that
compile a plain house file (Node.js is only needed for that last case). Install it in Blender with
Edit > Preferences > Get Extensions > Install from Disk.
"""
import os
import re
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "blender_addon", "house_painter")
manifest = open(os.path.join(SRC, "blender_manifest.toml"), encoding="utf-8").read()
version = re.search(r'^version\s*=\s*"([^"]+)"', manifest, re.M).group(1)

files = [
    (os.path.join(SRC, "__init__.py"), "__init__.py"),
    (os.path.join(SRC, "blender_manifest.toml"), "blender_manifest.toml"),
    (os.path.join(ROOT, "build_house.py"), "build_house.py"),
    (os.path.join(ROOT, "export_house_json.js"), "export_house_json.js"),
    (os.path.join(ROOT, "house-core.js"), "house-core.js"),
    (os.path.join(ROOT, "fixtures.js"), "fixtures.js"),
    (os.path.join(ROOT, "textures", "desert_sand_plank.png"), "textures/desert_sand_plank.png"),
    (os.path.join(ROOT, "LICENSE"), "LICENSE"),
]
os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
out = os.path.join(ROOT, "dist", "house_painter-%s.zip" % version)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for path, name in files:
        if not os.path.exists(path):
            raise SystemExit("missing " + path)
        z.write(path, name)
print("wrote", out, "(%d KB)" % (os.path.getsize(out) // 1024))
