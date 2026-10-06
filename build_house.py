"""
House Painter: Blender build + render.

Builds a house with the same paint surfaces as the web studio (every wall face, ceiling, cabinet door/drawer, door and
trim piece has its own material, keyed exactly as on the page), applies a scheme exported from the page
("Export for Blender"), and renders views.

  blender -b -P build_house.py -- [--scheme FILE.json] [--house houses/<id>/house.json]
                                 [--views export,doll,top,rooms,kitchen,...]
                                 [--light day|overcast|evening|true] [--samples 64] [--res 1600x1000] [--render]
                                 [--keep-scene] [--no-save]

  --scheme   JSON from the page's "Export for Blender" button. It contains the house too, so nothing else is needed.
             Without it, the house is primer white with its cabinets in their default colours.
  --house    a house file to build when the scheme doesn't carry one (default: the example house). House files are
             compiled with Node.js (export_house_json.js), so Node must be installed for this.
  --views    export   the camera you were looking through when you exported
             doll     dollhouse three-quarter view      top    top-down plan      out   front exterior
             rooms    an eye-level corner shot of every main room (the house file's renderRooms)
             <room>   one room, by its id in the house file
             (default: export if the file has a camera, plus doll and rooms)
  --render   render the views (otherwise just build and save the .blend)
  --keep-scene  build into the scene that is already open instead of starting an empty one (used by the Blender add-on)
  --no-save  don't write house_<scheme>.blend

Outputs: house_<scheme>.blend and renders/<scheme>/<view>.png next to this file.
Units: plan feet (x east, y south, z up) -> Blender metres (X = x, Y = -y, Z up).
"""
import bpy, bmesh, json, math, os, re, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) and not ARGS[i + 1].startswith('--') else True
    return default

SCHEME = json.load(open(arg('--scheme'), encoding='utf-8')) if arg('--scheme') else None

def load_house():
    """The compiled house: from the scheme file, or compiled from a house file with Node (house-core.js)."""
    if SCHEME and SCHEME.get('house'): return SCHEME['house']
    path = arg('--house') or os.path.join(HERE, 'houses', 'waterford-4563c', 'house.json')
    data = json.load(open(path, encoding='utf-8'))
    if data.get('surfaces'): return data                     # already compiled
    import subprocess
    try:
        out = subprocess.run(['node', os.path.join(HERE, 'export_house_json.js'), path, '-'], capture_output=True, check=True)
    except FileNotFoundError:
        sys.exit('Reading a house file needs Node.js (https://nodejs.org). Or pass a scheme exported from the page: it includes the house.')
    except subprocess.CalledProcessError as e:
        sys.exit(e.stderr.decode('utf-8', 'replace'))
    return json.loads(out.stdout.decode('utf-8'))

H = load_house()
RESOLVED = (SCHEME or {}).get('resolved', {})
SLUG = re.sub(r'[^a-z0-9]+', '-', ((SCHEME or {}).get('scheme', {}).get('name') or 'default').lower()).strip('-') or 'default'

FT = 0.3048
W, D, E, T = H['W'], H['D'], H['E'], H['T']
CEIL = H['ceilingHeight']                                   # openings carry their own z0 / z1 (sill-head, 0-door height)
K = max(W, D) / 56                                          # camera distances were tuned on a 56' house
BASE_H, BASE_T, CASE_W, CASE_T, DOOR_T, DOOR_OPEN = 0.375, 0.03, 0.29, 0.035, 0.115, 68
GROUND_Z = -2.0
SHEEN = {'flat': 0.96, 'matte': 0.92, 'eggshell': 0.82, 'satin': 0.64, 'semigloss': 0.42, 'gloss': 0.24}
DEFAULTS = {'wall': '#F1EFEA', 'ceiling': '#F5F4F0', 'trim': '#F6F6F3', 'exttrim': '#F4F4F0', 'doors': '#F3F3EF', 'extdoors': '#F3F3EF', 'siding': '#E9E8E2'}
ITEM = {it['key']: it for it in H.get('items', [])}           # the house's cabinet runs and special doors
for it in ITEM.values(): DEFAULTS[it['key']] = it.get('default') or ('#F3F3EF' if it.get('kind') == 'door' else '#F1F0EC')
WOODS = {   # same species and parameters as house3d.js
    'walnut':   ('Walnut', '#8C5D3E', '#3A2215', 9, 0.55, 0.30), 'teak': ('Teak', '#B57E49', '#6A4220', 7, 0.45, 0.22),
    'whiteoak': ('White oak', '#CDAA7C', '#8C6A45', 12, 0.35, 0.35), 'redoak': ('Red oak', '#C48D63', '#86513A', 10, 0.6, 0.35),
    'cherry':   ('Cherry', '#A8603F', '#6A3322', 8, 0.4, 0.12), 'maple': ('Maple', '#E2C99E', '#BE9C70', 14, 0.3, 0.08),
    'rosewood': ('Rosewood', '#743A26', '#29120B', 7, 0.7, 0.25), 'ebonized': ('Ebonized oak', '#3E3630', '#191513', 12, 0.35, 0.35)}
TILE_W, TILE_H = 2.5, 5.0

# ----------------------------------------------------------------------------- scene
KEEP_SCENE, NO_SAVE = bool(arg('--keep-scene')), bool(arg('--no-save'))   # the Blender add-on builds into the open scene and leaves saving to the user
if not KEEP_SCENE: bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
COLL = {}
def coll(name):
    if name not in COLL:
        c = bpy.data.collections.new(name); scene.collection.children.link(c); COLL[name] = c
    return COLL[name]

def lin(hexstr):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)

# ----------------------------------------------------------------------------- materials
MATS = {}
def fixed(name, hexstr, rough=0.5, metal=0.0, transmission=0.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(hexstr); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if transmission:
        for k in ('Transmission Weight', 'Transmission'):
            if k in b.inputs: b.inputs[k].default_value = transmission
        if 'IOR' in b.inputs: b.inputs['IOR'].default_value = 1.45
    m.diffuse_color = lin(hexstr); MATS[name] = m
    return m

M = {k: fixed(*v) for k, v in {
    'cut': ('Wall_Cut', '#B7B4AD', 0.95), 'counter': ('Counter_White', '#F3F3F0', 0.22), 'tile': ('Backsplash_Tile', '#EEEEEA', 0.12),
    'appwhite': ('Appliance_White', '#ECEEEE', 0.3), 'steel': ('Stainless', '#BFC3C7', 0.28, 1.0), 'black': ('Black', '#141518', 0.2),
    'brass': ('Brass', '#B8923C', 0.3, 1.0), 'chrome': ('Chrome', '#D8DADD', 0.12, 1.0), 'porc': ('Porcelain', '#FBFBFA', 0.1),
    'winframe': ('Window_Frame', '#F7F7F5', 0.45), 'glass': ('Glass', '#FFFFFF', 0.0, 0.0, 1.0), 'wire': ('Wire_Shelf', '#E8E8E6', 0.5),
    'heater': ('Water_Heater', '#E2E4E6', 0.4), 'pump': ('Pump', '#35607F', 0.45), 'skirt': ('Skirting', '#C9C6BD', 0.85),
    'deck': ('Deck_Wood', '#7A5A3B', 0.75), 'ground': ('Ground', '#6E7E58', 0.95), 'reveal': ('Reveal', '#3A3C40', 0.6)}.items()}

def part_group(key):
    m = re.match(r'^(\w+):(door|drawer)\d+$', key); return m.group(1) if m else None
def default_hex(key):
    if key in DEFAULTS: return DEFAULTS[key]
    g = part_group(key)
    if g: return DEFAULTS.get(g, DEFAULTS['wall'])
    if key.startswith('C:'): return DEFAULTS['ceiling']
    if key.startswith('EXT-'): return DEFAULTS['siding']
    return DEFAULTS['wall']
def default_sheen(key):
    if key.startswith('C:'): return 'flat'
    if key in ('trim', 'exttrim', 'doors', 'extdoors') or ITEM.get(key, {}).get('kind') == 'door': return 'semigloss'
    if key in ITEM or part_group(key): return 'satin'
    return 'eggshell'

# --- wood: the same tileable procedural veneer as the web page, generated with numpy
WOOD_IMG = {}
def wood_image(wid):
    if wid in WOOD_IMG: return WOOD_IMG[wid]
    import numpy as np
    name, light, dark, freq, warp_amt, pores = WOODS[wid]
    Wpx, Hpx = 384, 768
    def hsh(ix, iy, s):
        h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + s * 982451653) & 0xFFFFFFFF
        h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
        h = h ^ (h >> 16)
        return h.astype(np.float64) / 4294967295.0
    def vnoise(x, y, px, py, s):
        x0, y0 = np.floor(x), np.floor(y); fx, fy = x - x0, y - y0
        sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        X0, X1 = np.mod(x0, px), np.mod(x0 + 1, px); Y0, Y1 = np.mod(y0, py), np.mod(y0 + 1, py)
        a, b, c, d = hsh(X0, Y0, s), hsh(X1, Y0, s), hsh(X0, Y1, s), hsh(X1, Y1, s)
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
    def fbm(u, v, fx, fy, octs, s):
        total, amp, f, norm = 0.0, 0.5, 1, 0.0
        for o in range(octs):
            total = total + amp * vnoise(u * fx * f, v * fy * f, fx * f, fy * f, s + o); norm += amp; amp *= 0.5; f *= 2
        return total / norm
    v, u = np.mgrid[0:Hpx, 0:Wpx].astype(np.float64)
    u /= Wpx; v /= Hpx
    f = freq * 2.6
    wp = fbm(u, v, 3, 2, 3, 1) - 0.5
    r = u * f + wp * warp_amt * f * 0.22 + (fbm(u, v, 4, 6, 2, 7) - 0.5) * 0.9
    g = r - np.floor(r)
    band = 0.7 * np.exp(-(((g - 0.82) / 0.07) ** 2)) + 0.35 * np.exp(-(((g - 0.75) / 0.22) ** 2))
    streak = fbm(u, v, 96, 3, 2, 31) - 0.5
    pore = (vnoise(u * 220, v * 14, 220, 14, 11) > 0.78).astype(np.float64)
    tone = fbm(u, v, 2, 1, 2, 21) - 0.5
    t = np.clip(band * 0.45 + streak * 0.5 + pore * pores * 0.7 + tone * 0.4 + 0.22, 0, 1)
    L = np.array([int(light[i:i + 2], 16) for i in (1, 3, 5)]) / 255.0
    Dk = np.array([int(dark[i:i + 2], 16) for i in (1, 3, 5)]) / 255.0
    rgb = L[None, None, :] + (Dk - L)[None, None, :] * t[:, :, None]
    rgba = np.concatenate([rgb, np.ones((Hpx, Wpx, 1))], axis=2)[::-1]          # Blender images start at the bottom row
    img = bpy.data.images.new('Wood_' + wid, Wpx, Hpx, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.pack()
    WOOD_IMG[wid] = img
    return img

PAINT = {}
def paint_mat(key):
    """One material per paint key, named after the key, configured from the scheme (or the defaults)."""
    if key in PAINT: return PAINT[key]
    m = bpy.data.materials.new('Paint:' + key); m.use_nodes = True
    PAINT[key] = m
    r = RESOLVED.get(key)
    hexv = (r or {}).get('hex') or default_hex(key)
    sheen = (r or {}).get('sheen') or default_sheen(key)
    wood = (r or {}).get('wood')
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = SHEEN.get(sheen, 0.8)
    m.diffuse_color = lin(hexv)
    if wood and wood in WOODS:
        uv = nt.nodes.new('ShaderNodeUVMap')
        mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / TILE_W, 1 / TILE_H, 1)
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = wood_image(wood); tex.extension = 'REPEAT'
        nt.links.new(uv.outputs['UV'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], tex.inputs['Vector'])
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
        bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.08
        nt.links.new(tex.outputs['Color'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
        b.inputs['Roughness'].default_value = min(0.7, SHEEN.get(sheen, 0.64))
    else:
        b.inputs['Base Color'].default_value = lin(hexv)
    m['paint_key'] = key; m['paint_name'] = (r or {}).get('name') or 'Primer white'; m['paint_code'] = (r or {}).get('code') or ''
    return m

def floor_material():
    fl = H['floor']
    m = bpy.data.materials.new('Floor_' + re.sub(r'\W+', '_', fl.get('name') or 'Plank')); m.use_nodes = True
    img = None
    tex_ref = fl.get('texture') or ''
    if fl.get('wood') in WOODS: img = wood_image(fl['wood'])               # a wood species, drawn like the cabinet veneers
    elif tex_ref.startswith('data:'):                                      # a photo embedded in the house file
        import base64, tempfile
        raw = base64.b64decode(tex_ref.split(',', 1)[1]); fd, tmp = tempfile.mkstemp(suffix='.jpg' if 'jpeg' in tex_ref[:30] else '.png'); os.write(fd, raw); os.close(fd)
        img = bpy.data.images.load(tmp); img.pack()
    elif tex_ref and os.path.exists(os.path.join(HERE, tex_ref)):
        img = bpy.data.images.load(os.path.join(HERE, tex_ref)); img.pack()
    if img is None:                                                        # no plank image: plain colour
        b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = lin(fl.get('color') or '#B09672')
        b.inputs['Roughness'].default_value = 0.42; return m
    photo = not fl.get('wood')
    nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new
    out = N('ShaderNodeOutputMaterial'); bsdf = N('ShaderNodeBsdfPrincipled'); nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    pw, pl = fl['plankW'] * FT, fl['plankL'] * FT
    ratio = img.size[1] / img.size[0]
    geo = N('ShaderNodeNewGeometry'); sep = N('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Position'], sep.inputs['Vector'])
    comb = N('ShaderNodeCombineXYZ'); nt.links.new(sep.outputs['X'], comb.inputs['X']); nt.links.new(sep.outputs['Y'], comb.inputs['Y'])
    def brick(c1, c2, mortar):
        bk = N('ShaderNodeTexBrick'); bk.offset = 0.33; bk.offset_frequency = 1; bk.squash = 1.0
        bk.inputs['Color1'].default_value = c1; bk.inputs['Color2'].default_value = c2; bk.inputs['Mortar'].default_value = mortar
        bk.inputs['Scale'].default_value = 1.0; bk.inputs['Mortar Size'].default_value = 0.0025; bk.inputs['Mortar Smooth'].default_value = 0.2
        bk.inputs['Brick Width'].default_value = pl; bk.inputs['Row Height'].default_value = pw
        nt.links.new(comb.outputs['Vector'], bk.inputs['Vector']); return bk
    grooves = brick((1, 1, 1, 1), (1, 1, 1, 1), (0.42, 0.34, 0.25, 1)); rnd = brick((0, 0, 0, 1), (1, 1, 1, 1), (1, 1, 1, 1))
    bw = N('ShaderNodeRGBToBW'); nt.links.new(rnd.outputs['Color'], bw.inputs['Color'])
    u = N('ShaderNodeMath'); u.operation = 'DIVIDE'; u.inputs[1].default_value = pw; nt.links.new(sep.outputs['Y'], u.inputs[0])
    v1 = N('ShaderNodeMath'); v1.operation = 'DIVIDE'; v1.inputs[1].default_value = pw * ratio; nt.links.new(sep.outputs['X'], v1.inputs[0])
    v2 = N('ShaderNodeMath'); v2.operation = 'MULTIPLY_ADD'; v2.inputs[1].default_value = 7.31
    nt.links.new(bw.outputs['Val'], v2.inputs[0]); nt.links.new(v1.outputs['Value'], v2.inputs[2])
    uvc = N('ShaderNodeCombineXYZ'); nt.links.new(u.outputs['Value'], uvc.inputs['X']); nt.links.new(v2.outputs['Value'], uvc.inputs['Y'])
    tex = N('ShaderNodeTexImage'); tex.image = img; tex.extension = 'REPEAT'; nt.links.new(uvc.outputs['Vector'], tex.inputs['Vector'])
    hs = N('ShaderNodeHueSaturation'); hs.inputs['Value'].default_value = 1.28 if photo else 1.0; nt.links.new(tex.outputs['Color'], hs.inputs['Color'])
    mix = N('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1.0
    nt.links.new(hs.outputs['Color'], mix.inputs[6]); nt.links.new(grooves.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = 0.42
    return m

# ----------------------------------------------------------------------------- geometry builder
def P(x, y, z): return Vector((x * FT, -y * FT, z * FT))

class Obj:
    """One Blender object: a bmesh with per-face materials and UVs in feet."""
    def __init__(self, c, name):
        self.c, self.name, self.bm, self.slots, self.uvs = c, name, bmesh.new(), [], {}
    def slot(self, mat):
        if mat not in self.slots: self.slots.append(mat)
        return self.slots.index(mat)
    def face(self, verts, mat, uv=None):
        f = self.bm.faces.new(verts); f.material_index = self.slot(mat)
        if uv: self.uvs[f] = {v: u for v, u in zip(verts, uv)}                 # (along, up) in feet, for faces that aren't axis-aligned
        return f
    def prism(self, pts, z0, z1, mat):
        lo = [self.bm.verts.new(P(x, y, z0)) for x, y in pts]; hi = [self.bm.verts.new(P(x, y, z1)) for x, y in pts]
        n = len(pts)
        self.face(lo, mat); self.face(hi[::-1], mat)
        for i in range(n):
            j = (i + 1) % n; self.face((lo[i], lo[j], hi[j], hi[i]), mat)
    def box(self, x0, y0, z0, x1, y1, z1, mats):
        """mats: one material, or a dict with xmin xmax ymin ymax zmin zmax (plan axes; ymin = north side)."""
        x0, x1 = sorted((x0, x1)); y0, y1 = sorted((y0, y1)); z0, z1 = sorted((z0, z1))
        if x1 - x0 < 1e-5 or y1 - y0 < 1e-5 or z1 - z0 < 1e-5: return
        g = (lambda k: mats[k]) if isinstance(mats, dict) else (lambda k: mats)
        v = {(i, j, k): self.bm.verts.new(P((x0, x1)[i], (y0, y1)[j], (z0, z1)[k])) for i in (0, 1) for j in (0, 1) for k in (0, 1)}
        self.face([v[0, 0, 0], v[0, 1, 0], v[0, 1, 1], v[0, 0, 1]], g('xmin')); self.face([v[1, 0, 0], v[1, 0, 1], v[1, 1, 1], v[1, 1, 0]], g('xmax'))
        self.face([v[0, 0, 0], v[0, 0, 1], v[1, 0, 1], v[1, 0, 0]], g('ymin')); self.face([v[0, 1, 0], v[1, 1, 0], v[1, 1, 1], v[0, 1, 1]], g('ymax'))
        self.face([v[0, 0, 0], v[1, 0, 0], v[1, 1, 0], v[0, 1, 0]], g('zmin')); self.face([v[0, 0, 1], v[0, 1, 1], v[1, 1, 1], v[1, 0, 1]], g('zmax'))
    def obox(self, S, s0, s1, z0, z1, off, thick, mats):
        """A box along an angled wall S, from s0 to s1 (feet from the start of its line), offset sideways by `off` (positive = right).
        mats: one material, or a dict with end_a end_b lo hi bottom top."""
        if s1 - s0 < 1e-5 or z1 - z0 < 1e-5 or thick < 1e-5: return
        g = (lambda k: mats[k]) if isinstance(mats, dict) else (lambda k: mats)
        u, nr, p0, h = S['u'], S['nr'], S['p0'], thick / 2
        V = {(i, j, k): self.bm.verts.new(P(p0[0] + u[0] * (s0, s1)[i] + nr[0] * (off + (-h, h)[j]), p0[1] + u[1] * (s0, s1)[i] + nr[1] * (off + (-h, h)[j]), (z0, z1)[k]))
             for i in (0, 1) for j in (0, 1) for k in (0, 1)}
        self.face([V[0, 0, 0], V[1, 0, 0], V[1, 0, 1], V[0, 0, 1]], g('lo'), [(s0, z0), (s1, z0), (s1, z1), (s0, z1)])
        self.face([V[0, 1, 0], V[1, 1, 0], V[1, 1, 1], V[0, 1, 1]], g('hi'), [(s0, z0), (s1, z0), (s1, z1), (s0, z1)])
        self.face([V[0, 0, 0], V[0, 1, 0], V[0, 1, 1], V[0, 0, 1]], g('end_a'), [(0, z0), (thick, z0), (thick, z1), (0, z1)])
        self.face([V[1, 0, 0], V[1, 1, 0], V[1, 1, 1], V[1, 0, 1]], g('end_b'), [(0, z0), (thick, z0), (thick, z1), (0, z1)])
        self.face([V[0, 0, 0], V[1, 0, 0], V[1, 1, 0], V[0, 1, 0]], g('bottom'), [(s0, 0), (s1, 0), (s1, thick), (s0, thick)])
        self.face([V[0, 0, 1], V[1, 0, 1], V[1, 1, 1], V[0, 1, 1]], g('top'), [(s0, 0), (s1, 0), (s1, thick), (s0, thick)])
    def ellipse(self, cx, cy, rx, ry, z0, z1, mat, n=32):
        self.prism([(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)], z0, z1, mat)
    def finish(self, props=None):
        bm = self.bm
        if not bm.faces: bm.free(); return None
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        uvl = bm.loops.layers.uv.new('UVMap')
        for f in bm.faces:                                    # UVs in feet, projected on the face's main axis (grain runs up walls)
            n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
            for lp in f.loops:
                co = lp.vert.co / FT
                lp[uvl].uv = self.uvs[f][lp.vert] if f in self.uvs else ((co.y, co.z) if ax == 0 else (co.x, co.z) if ax == 1 else (co.x, co.y))
        me = bpy.data.meshes.new(self.name); bm.to_mesh(me); bm.free()
        for m in self.slots: me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me); coll(self.c).objects.link(ob)
        for k, val in (props or {}).items(): ob[k] = val
        return ob

OBJS = {}
def obj(c, name):
    if (c, name) not in OBJS: OBJS[(c, name)] = Obj(c, name)
    return OBJS[(c, name)]

# ----------------------------------------------------------------------------- walls (same algorithm as house3d.js)
SURF_BY_WALL = {}
for s in H['surfaces']:
    if s.get('wall') is not None: SURF_BY_WALL.setdefault(s['wall'], []).append(s)

def build_walls():
    for wi, w in enumerate(H['walls']):
        if w.get('status') == 'removed': continue
        horiz = (w['x1'] - w['x0']) >= (w['y1'] - w['y0'])
        s, e = (w['x0'], w['x1']) if horiz else (w['y0'], w['y1'])
        ops = sorted([o for o in w.get('openings', []) if o['type'] != 'panel'], key=lambda o: o['a'])
        surfs = SURF_BY_WALL.get(wi, [])
        top = CEIL - 0.0007 * (wi % 9)
        ob = obj('Walls', f"Wall_{wi:02d}_{w.get('id') or ('ext' if w.get('ext') else 'int')}")
        def face_key(side, t):
            for x in surfs:
                if x['side'] == side and x['kind'] != 'end' and x['a'] - 1e-3 <= t <= x['b'] + 1e-3: return x['id']
            return None
        def nearest(side, t):
            best, bd = None, 0.4
            for x in surfs:
                if x['side'] == side and x['kind'] != 'end':
                    d = x['a'] - t if t < x['a'] else t - x['b'] if t > x['b'] else 0
                    if d < bd: best, bd = x['id'], d
            return best
        def end_key(side):
            for x in surfs:
                if x['kind'] == 'end' and x['side'] == side: return x['id']
            return None
        is_ext = lambda k: bool(k) and k.startswith('EXT-')
        cuts = {s, e}
        for o in ops: cuts.update((o['a'], o['b']))
        for x in surfs:
            if x['kind'] != 'end': cuts.update((max(s, min(e, x['a'])), max(s, min(e, x['b']))))
        ts = sorted(cuts)
        for i in range(len(ts) - 1):
            t0, t1 = ts[i], ts[i + 1]
            if t1 - t0 < 1e-3: continue
            tm = (t0 + t1) / 2
            o = next((q for q in ops if q['a'] < tm < q['b']), None)
            zr = [(0, top)] if not o else [(0, o['z0']), (o['z1'], top)] if o['type'] == 'window' else [(o['z1'], top)]
            lo, hi = face_key('lo', tm), face_key('hi', tm)
            fallback = lo or hi
            def end_mat(t, d):
                if any(abs(q['a'] - t) < 1e-3 or abs(q['b'] - t) < 1e-3 for q in ops): return paint_mat('trim')
                for x in H['surfaces']:                           # flush with another wall's face: wrap that colour round the corner
                    if x['kind'] == 'end': continue
                    (ax0, ay0), (ax1, ay1) = x['seg']
                    if horiz and x['normal'] == [d, 0] and abs(ax0 - t) < 0.02 and min(ay0, ay1) <= w['y1'] + 0.02 and max(ay0, ay1) >= w['y0'] - 0.02:
                        return paint_mat(x['id'])
                    if not horiz and x['normal'] == [0, d] and abs(ay0 - t) < 0.02 and min(ax0, ax1) <= w['x1'] + 0.02 and max(ax0, ax1) >= w['x0'] - 0.02:
                        return paint_mat(x['id'])
                ek = (abs(t - s) < 1e-3 and end_key('start')) or (abs(t - e) < 1e-3 and end_key('end'))
                if ek: return paint_mat(ek)
                k = fallback or nearest('lo', t) or nearest('hi', t)
                return paint_mat(k) if k else M['cut']
            st, en = end_mat(t0, -1), end_mat(t1, 1)
            loK, hiK = lo or nearest('lo', tm), hi or nearest('hi', tm)
            fm = lambda k: paint_mat(k) if k else M['cut']
            for z0, z1 in zr:
                topm = M['cut'] if z1 >= top - 1e-3 else paint_mat('trim'); botm = M['cut'] if z0 <= 1e-3 else paint_mat('trim')
                if horiz:
                    ob.box(t0, w['y0'], z0, t1, w['y1'], z1, {'xmin': st, 'xmax': en, 'ymin': fm(loK), 'ymax': fm(hiK), 'zmin': botm, 'zmax': topm})
                else:
                    ob.box(w['x0'], t0, z0, w['x1'], t1, z1, {'xmin': fm(loK), 'xmax': fm(hiK), 'ymin': st, 'ymax': en, 'zmin': botm, 'zmax': topm})
                if z0 <= 1e-3:
                    tb = obj('Trim', 'Baseboards')
                    for k, side in ((lo, 'lo'), (hi, 'hi')):
                        if not k or is_ext(k): continue
                        if horiz: tb.box(t0, w['y0'] - BASE_T if side == 'lo' else w['y1'], 0, t1, w['y0'] if side == 'lo' else w['y1'] + BASE_T, BASE_H, paint_mat('trim'))
                        else: tb.box(w['x0'] - BASE_T if side == 'lo' else w['x1'], t0, 0, w['x0'] if side == 'lo' else w['x1'] + BASE_T, t1, BASE_H, paint_mat('trim'))
        for k, o in enumerate(ops):                               # casings, windows, doors
            room_l = (o['a'] - ops[k - 1]['b']) / 2 if k > 0 else CASE_W
            room_r = (ops[k + 1]['a'] - o['b']) / 2 if k + 1 < len(ops) else CASE_W
            el, er = min(CASE_W, room_l) - 0.002, min(CASE_W, room_r) - 0.002
            z0, z1 = o['z0'], o['z1']
            tc = obj('Trim', 'Casings')
            for side in ('lo', 'hi'):
                fk = face_key(side, (o['a'] + o['b']) / 2) or face_key(side, o['a'] - 0.05)
                mat = paint_mat('exttrim' if is_ext(fk) else 'trim')
                def cb(a0, a1, zz0, zz1):
                    if horiz: tc.box(a0, w['y0'] - CASE_T if side == 'lo' else w['y1'], zz0, a1, w['y0'] if side == 'lo' else w['y1'] + CASE_T, zz1, mat)
                    else: tc.box(w['x0'] - CASE_T if side == 'lo' else w['x1'], a0, zz0, w['x0'] if side == 'lo' else w['x1'] + CASE_T, a1, zz1, mat)
                cb(o['a'] - el, o['a'], z0, z1); cb(o['b'], o['b'] + er, z0, z1); cb(o['a'] - el, o['b'] + er, z1, z1 + CASE_W)
                if o['type'] == 'window': cb(o['a'] - el, o['b'] + er, z0 - CASE_W * 0.8, z0)
            if o['type'] == 'window': build_window(w, horiz, o, z0, z1)
            if o['type'] == 'door': build_door(w, horiz, o)

def build_window(w, horiz, o, z0, z1):
    cx, cy = (w['x0'] + w['x1']) / 2, (w['y0'] + w['y1']) / 2
    fw, dep = 0.11, 0.12
    wf, wg = obj('Windows', 'Window_Frames'), obj('Windows', 'Window_Glass')
    def fb(a0, a1, zz0, zz1):
        if horiz: wf.box(a0, cy - dep / 2, zz0, a1, cy + dep / 2, zz1, M['winframe'])
        else: wf.box(cx - dep / 2, a0, zz0, cx + dep / 2, a1, zz1, M['winframe'])
    fb(o['a'], o['a'] + fw, z0, z1); fb(o['b'] - fw, o['b'], z0, z1); fb(o['a'] + fw, o['b'] - fw, z0, z0 + fw); fb(o['a'] + fw, o['b'] - fw, z1 - fw, z1)
    n = o.get('panes', 1)
    for k in range(1, n):
        p = o['a'] + (o['b'] - o['a']) * k / n; fb(p - 0.04, p + 0.04, z0 + fw, z1 - fw)
    fb(o['a'] + fw, o['b'] - fw, (z0 + z1) / 2 - 0.03, (z0 + z1) / 2 + 0.03)
    if horiz: wg.box(o['a'] + fw, cy - 0.01, z0 + fw, o['b'] - fw, cy + 0.01, z1 - fw, M['glass'])
    else: wg.box(cx - 0.01, o['a'] + fw, z0 + fw, cx + 0.01, o['b'] - fw, z1 - fw, M['glass'])

def build_door(w, horiz, o):
    cx, cy = (w['x0'] + w['x1']) / 2, (w['y0'] + w['y1']) / 2
    hv, ov = (o['a'], o['b']) if o['hinge'] == 'a' else (o['b'], o['a'])
    hinge = Vector((hv, cy)) if horiz else Vector((cx, hv)); other = Vector((ov, cy)) if horiz else Vector((cx, ov))
    nrm = Vector((0, 1 if o['swing'] == 's' else -1)) if horiz else Vector((1 if o['swing'] == 'e' else -1, 0))
    door_leaf(hinge, other, nrm, bool(w.get('ext')), o['z1'])

def door_leaf(hinge, other, nrm, ext, dh):
    """hinge, other: the two ends of the doorway in plan; nrm: the side the door swings to."""
    d = (other - hinge).normalized(); L = (other - hinge).length - 0.012
    ang = math.radians(0 if ext else DOOR_OPEN)
    dr = d * math.cos(ang) + nrm * math.sin(ang); pp = Vector((-dr.y, dr.x)); hh = hinge + d * 0.006; t2 = DOOR_T / 2
    key = 'extdoors' if ext else 'doors'; mat = paint_mat(key)
    q = lambda u0, u1, p0, p1: [tuple(hh + dr * u0 + pp * p0), tuple(hh + dr * u1 + pp * p0), tuple(hh + dr * u1 + pp * p1), tuple(hh + dr * u0 + pp * p1)]
    lv = obj('Doors', 'Door_Leaves'); hw = obj('Doors', 'Door_Hardware')
    ks = dh / 6.667                                             # panel layout scales with the door's height
    lv.prism(q(0, L, -t2, t2), 0.03, dh - 0.05, mat)
    for sgn in (1, -1):
        for (u0, u1) in ((0.30, L / 2 - 0.08), (L / 2 + 0.08, L - 0.30)):
            for (z0, z1) in ((0.9 * ks, 2.5 * ks), (2.9 * ks, 4.3 * ks), (4.7 * ks, 6.1 * ks)):
                lv.prism(q(u0, u1, t2, t2 + 0.012) if sgn > 0 else q(u0, u1, -t2 - 0.012, -t2), z0, z1, mat)
        k = hh + dr * (L - 0.28) + pp * (sgn * (t2 + 0.05))
        hw.box(k.x - 0.045, k.y - 0.045, 2.95, k.x + 0.045, k.y + 0.045, 3.05, M['brass'])

# ----------------------------------------------------------------------------- angled walls (same pieces as the straight ones, along each line)
def build_slants():
    by = {}
    for s in H['surfaces']:
        if s.get('slant') is not None: by.setdefault(s['slant'], []).append(s)
    for S in H.get('slants', []):
        if S.get('status') == 'removed': continue
        surfs = by.get(S['i'], [])
        ops = sorted([o for o in S['openings'] if o['type'] != 'panel'], key=lambda o: o['a'])
        ob = obj('Walls', f"Slant_{S['i']:02d}_{S.get('id') or ('ext' if S['ext'] else 'int')}")
        top = CEIL - 0.0007 * ((S['i'] + 4) % 9)
        def face_key(side, t):
            for x in surfs:
                if x['side'] == side and x['a'] - 1e-3 <= t <= x['b'] + 1e-3: return x['id']
            return None
        def nearest(side, t):
            best, bd = None, 0.4
            for x in surfs:
                if x['side'] == side:
                    d = x['a'] - t if t < x['a'] else t - x['b'] if t > x['b'] else 0
                    if d < bd: best, bd = x['id'], d
            return best
        is_ext = lambda k: bool(k) and k.startswith('EXT-')
        lo0, hi0 = -S['e0'], S['len'] + S['e1']
        cuts = {lo0, hi0}
        for o in ops: cuts.update((o['a'], o['b']))
        for x in surfs: cuts.update((max(lo0, min(hi0, x['a'])), max(lo0, min(hi0, x['b']))))
        ts = sorted(cuts)
        for i in range(len(ts) - 1):
            t0, t1 = ts[i], ts[i + 1]
            if t1 - t0 < 1e-3: continue
            tm = (t0 + t1) / 2
            o = next((q for q in ops if q['a'] < tm < q['b']), None)
            zr = [(0, top)] if not o else [(0, o['z0']), (o['z1'], top)] if o['type'] == 'window' else [(o['z1'], top)]
            lo, hi = face_key('lo', tm), face_key('hi', tm)
            lo_k, hi_k = lo or nearest('lo', tm), hi or nearest('hi', tm)
            def end_m(t):
                if any(abs(q['a'] - t) < 1e-3 or abs(q['b'] - t) < 1e-3 for q in ops): return paint_mat('trim')
                if abs(t - lo0) < 1e-3 or abs(t - hi0) < 1e-3:
                    k = lo_k or hi_k
                    return paint_mat(k) if k else M['cut']
                return M['cut']
            fm = lambda k: paint_mat(k) if k else M['cut']
            for z0, z1 in zr:
                ob.obox(S, t0, t1, z0, z1, 0, S['t'], {'end_a': end_m(t0), 'end_b': end_m(t1), 'lo': fm(lo_k), 'hi': fm(hi_k),
                        'top': M['cut'] if z1 >= top - 1e-3 else paint_mat('trim'), 'bottom': M['cut'] if z0 <= 1e-3 else paint_mat('trim')})
                if z0 <= 1e-3:
                    tb = obj('Trim', 'Baseboards')
                    for k, side in ((lo, -1), (hi, 1)):
                        if k and not is_ext(k): tb.obox(S, t0, t1, 0, BASE_H, side * (S['t'] / 2 + BASE_T / 2), BASE_T, paint_mat('trim'))
        for k, o in enumerate(ops):                                   # casings, windows, doors
            room_l = (o['a'] - ops[k - 1]['b']) / 2 if k > 0 else CASE_W
            room_r = (ops[k + 1]['a'] - o['b']) / 2 if k + 1 < len(ops) else CASE_W
            el, er = min(CASE_W, room_l) - 0.002, min(CASE_W, room_r) - 0.002
            z0, z1 = o['z0'], o['z1']
            tc = obj('Trim', 'Casings')
            for side in (-1, 1):
                fk = face_key('lo' if side < 0 else 'hi', (o['a'] + o['b']) / 2) or face_key('lo' if side < 0 else 'hi', o['a'] - 0.05)
                mat = paint_mat('exttrim' if is_ext(fk) else 'trim'); off = side * (S['t'] / 2 + CASE_T / 2)
                tc.obox(S, o['a'] - el, o['a'], z0, z1, off, CASE_T, mat); tc.obox(S, o['b'], o['b'] + er, z0, z1, off, CASE_T, mat)
                tc.obox(S, o['a'] - el, o['b'] + er, z1, z1 + CASE_W, off, CASE_T, mat)
                if o['type'] == 'window': tc.obox(S, o['a'] - el, o['b'] + er, z0 - CASE_W * 0.8, z0, off, CASE_T, mat)
            if o['type'] == 'window':
                wf, wg = obj('Windows', 'Window_Frames'), obj('Windows', 'Window_Glass'); fw, dep = 0.11, 0.12
                fb = lambda a0, a1, zz0, zz1: wf.obox(S, a0, a1, zz0, zz1, 0, dep, M['winframe'])
                fb(o['a'], o['a'] + fw, z0, z1); fb(o['b'] - fw, o['b'], z0, z1); fb(o['a'] + fw, o['b'] - fw, z0, z0 + fw); fb(o['a'] + fw, o['b'] - fw, z1 - fw, z1)
                for q in range(1, o.get('panes', 1)):
                    pp = o['a'] + (o['b'] - o['a']) * q / o.get('panes', 1); fb(pp - 0.04, pp + 0.04, z0 + fw, z1 - fw)
                fb(o['a'] + fw, o['b'] - fw, (z0 + z1) / 2 - 0.03, (z0 + z1) / 2 + 0.03)
                wg.obox(S, o['a'] + fw, o['b'] - fw, z0 + fw, z1 - fw, 0, 0.02, M['glass'])
            if o['type'] == 'door':
                at = lambda t: Vector((S['p0'][0] + S['u'][0] * t, S['p0'][1] + S['u'][1] * t))
                door_leaf(at(o['a'] if o.get('hinge', 'a') == 'a' else o['b']), at(o['b'] if o.get('hinge', 'a') == 'a' else o['a']),
                          Vector(S['nl'] if o.get('swing') == 'l' else S['nr']), bool(S.get('ext')), o['z1'])

# ----------------------------------------------------------------------------- cabinets, fixtures (same frames and numbering as house3d.js)
# Fixtures are built in their own frame (fixtures.js): p = depth from the back to the front, q = across the front.
DEFAULT_FRONT = {'app': 'e', 'range': 'e', 'front': 'e', 'shower': 'n', 'sink2': 's', 'barn': 's'}
def facing(f):
    if f['k'] == 'toilet': return f.get('dir', 'w')
    return f.get('front') or DEFAULT_FRONT.get('app' if f['k'] == 'box' and f.get('c') == 'app' else f['k'])

class Frame:
    def __init__(self, f):
        x0, y0, x1, y1 = f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']
        self.d = d = facing(f) or 'e'
        self.swap = d in ('n', 's')
        self.P, self.Q = (y1 - y0, x1 - x0) if self.swap else (x1 - x0, y1 - y0)
        self.pt = lambda p, q: (x0 + p, y0 + q) if d == 'e' else (x1 - p, y1 - q) if d == 'w' else (x1 - q, y0 + p) if d == 's' else (x0 + q, y1 - p)
    def box(self, target, p0, q0, z0, p1, q1, z1, mat):
        a, b = self.pt(p0, q0), self.pt(p1, q1)
        target.box(min(a[0], b[0]), min(a[1], b[1]), z0, max(a[0], b[0]), max(a[1], b[1]), z1, mat)
    def ellipse(self, target, p, q, rp, rq, z0, z1, mat):
        x, y = self.pt(p, q)
        target.ellipse(x, y, rq if self.swap else rp, rp if self.swap else rq, z0, z1, mat)

PART_N = {}
DOOR_PROUD, GAP = 0.045, 0.022
def cabinet_front(f, z0, z1, counter):
    """style: 'door-drawer' (a drawer over each door), 'doors', or 'drawers' (a stack of three)."""
    if not f.get('front') or not f.get('paint'): return
    F = Frame(f)
    n = max(1, f.get('doors') or math.floor(F.Q / 1.5 + 0.5)); dw = F.Q / n
    style = f.get('style') or ('door-drawer' if counter else 'doors')
    cab, hw = obj('Cabinetry', 'Cabinet_Fronts'), obj('Cabinetry', 'Cabinet_Hardware')
    def slab(q0, q1, zz0, zz1, o0, o1, mat, target): F.box(target, F.P + o0, q0, zz0, F.P + o1, q1, zz1, mat)
    kick = 0 if style == 'doors' else 0.35; split = z1 - 0.55 if style == 'door-drawer' else z1
    def next_key(kind):
        c = PART_N.setdefault(f['paint'], {'door': 0, 'drawer': 0}); c[kind] += 1; return f"{f['paint']}:{kind}{c[kind]}"
    if kick: slab(0, F.Q, 0, kick, 0, 0.004, M['reveal'], hw)
    rev = F.d in ('s', 'w')                                   # numbered west to east / north to south, as on the page
    for j in range(n):
        i = n - 1 - j if rev else j
        b0, b1 = i * dw + GAP, (i + 1) * dw - GAP
        if style == 'drawers':
            h = z1 - kick; cuts = (kick, kick + h * 0.38, kick + h * 0.76, z1)
            for k in (2, 1, 0):
                slab(b0, b1, cuts[k] + GAP, cuts[k + 1] - GAP, 0, DOOR_PROUD, paint_mat(next_key('drawer')), cab)
                zc = cuts[k + 1] - 0.28; slab((b0 + b1) / 2 - 0.25, (b0 + b1) / 2 + 0.25, zc - 0.025, zc + 0.025, DOOR_PROUD, DOOR_PROUD + 0.06, M['black'], hw)
            continue
        slab(b0, b1, (kick or z0) + GAP, split - GAP, 0, DOOR_PROUD, paint_mat(next_key('door')), cab)
        hx = b0 + 0.14 if (j % 2 == 1) != rev else b1 - 0.14
        hz = split - 0.75 if style == 'door-drawer' else ((z0 + z1) / 2 if z1 - z0 > 4 else z0 + 0.35)
        slab(hx - 0.02, hx + 0.02, hz - 0.22, hz + 0.22, DOOR_PROUD, DOOR_PROUD + 0.06, M['black'], hw)
        if style == 'door-drawer':
            slab(b0, b1, split + GAP, z1 - GAP, 0, DOOR_PROUD, paint_mat(next_key('drawer')), cab)
            slab((b0 + b1) / 2 - 0.25, (b0 + b1) / 2 + 0.25, z1 - 0.3, z1 - 0.25, DOOR_PROUD, DOOR_PROUD + 0.06, M['black'], hw)

def counter_top(f, z):
    o, all_sides = 0.1, f.get('counter') == 'all'
    x0, y0, x1, y1 = f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']
    fr = f.get('front')
    if all_sides or fr == 'w': x0 -= o
    if all_sides or fr == 'e': x1 += o
    if all_sides or fr == 'n': y0 -= o
    if all_sides or fr == 's': y1 += o
    obj('Cabinetry', 'Countertops').box(x0, y0, z, x1, y1, z + 0.125, M['counter'])

def sink_in(F, target, z, p0, p1, q0, q1):
    half = (q1 - q0) / 2
    for i in range(2): F.box(target, p0, q0 + i * half + 0.07, z, p1, q0 + (i + 1) * half - 0.07, z + 0.006, M['steel'])
    qm = (q0 + q1) / 2
    F.ellipse(target, p0 - 0.12, qm, 0.05, 0.05, z, z + 0.6, M['chrome']); F.box(target, p0 - 0.12, qm - 0.03, z + 0.55, p0 + 0.45, qm + 0.03, z + 0.62, M['chrome'])

def basin(target, x, y, rx, ry, z):
    target.ellipse(x, y, rx, ry, z, z + 0.012, M['porc']); target.ellipse(x, y, rx * 0.78, ry * 0.78, z + 0.004, z + 0.016, M['reveal'])

def build_fixtures():
    fx, ap = obj('Fixtures', 'Fixtures'), obj('Appliances', 'Appliances')
    for f in H['fixtures']:
        if f.get('st') == 'removed': continue
        k = f['k']
        x0, y0 = f.get('x', 0), f.get('y', 0); x1, y1 = x0 + f.get('w', 0), y0 + f.get('h', 0)
        if k == 'box':
            if f.get('paint'):
                # z1: cabinet height; counter: false for tall units, 'all' to overhang every side (islands)
                zt = f.get('z1') or (2.8 if f.get('c') == 'cabW' else 3.0)
                counter = f.get('counter', zt <= 4)
                obj('Cabinetry', 'Cabinet_Boxes').box(x0, y0, 0, x1, y1, zt, paint_mat(f['paint']))
                cabinet_front(f, 0, zt, bool(counter))
                if counter: counter_top(f, zt)
                if f.get('front') and (f.get('sink') or f.get('basin')):
                    F, z = Frame(f), zt + 0.125
                    if f.get('sink'):
                        w, d = min(2.4, F.Q - 0.3), min(1.4, F.P - 0.5); sink_in(F, fx, z, 0.3, 0.3 + d, (F.Q - w) / 2, (F.Q + w) / 2)
                    else:
                        cx, cy = F.pt(F.P / 2 + 0.05, F.Q / 2); rq, rp = min(0.78, F.Q / 2 - 0.2), min(0.55, F.P / 2 - 0.2)
                        basin(fx, cx, cy, rq if F.swap else rp, rp if F.swap else rq, z)
            elif f.get('c') == 'app':                          # refrigerator
                F = Frame(f)
                F.box(ap, 0, 0, 0, F.P, F.Q, 5.9, M['appwhite']); F.box(ap, F.P, F.Q / 2 - 0.01, 0.4, F.P + 0.01, F.Q / 2 + 0.01, 5.8, M['black'])
                for q in (F.Q / 2 - 0.2, F.Q / 2 + 0.2): F.box(ap, F.P, q - 0.025, 2.4, F.P + 0.07, q + 0.025, 4.6, M['steel'])
            elif f.get('c') == 'counter':
                obj('Cabinetry', 'Countertops').box(x0, y0, 2.5, x1, y1, 2.625, M['counter'])
        elif k == 'upper':
            obj('Cabinetry', 'Cabinet_Boxes').box(x0, y0, f['z0'], x1, y1, f['z1'], paint_mat(f['paint'])); cabinet_front(f, f['z0'], f['z1'], False)
        elif k == 'splash':
            obj('Cabinetry', 'Backsplash').box(x0, y0, f['z0'], x1, y1, f['z1'], M['tile'])
        elif k == 'oval':
            basin(fx, f['cx'], f['cy'], f['rx'], f['ry'], 2.925)
        elif k == 'sink2':
            F = Frame(f); sink_in(F, fx, 3.125, 0, F.P, 0, F.Q)
        elif k == 'range':                                     # range with a microwave above, controls on the front
            F = Frame(f)
            F.box(ap, 0, 0, 0, F.P, F.Q, 3.0, M['steel']); F.box(ap, 0.05, 0.05, 3.0, F.P - 0.05, F.Q - 0.05, 3.025, M['black'])
            F.box(ap, F.P, 0.3, 1.0, F.P + 0.01, F.Q - 0.3, 2.4, M['black']); F.box(ap, F.P, 0.2, 2.5, F.P + 0.12, F.Q - 0.2, 2.56, M['steel'])
            F.box(ap, 0, 0, 4.9, 1.4, F.Q, 6.3, M['appwhite']); F.box(ap, 1.4, 0.2, 5.0, 1.41, F.Q - 0.9, 6.2, M['black'])
        elif k == 'heater': fx.ellipse(f['cx'], f['cy'], f['r'] * 0.85, f['r'] * 0.85, 0, 4.4, M['heater'])
        elif k == 'pumps': fx.box(x0, y0, 0, x1, y1, 2.0, M['pump'])
        elif k == 'front':                                     # front-loading washer / dryer
            F = Frame(f)
            F.box(ap, 0, 0, 0, F.P, F.Q, 3.0, M['appwhite']); F.box(ap, 0.02, 0.1, 3.0, 0.4, F.Q - 0.1, 3.4, M['steel'])
            F.box(ap, F.P, F.Q / 2 - 0.55, 1.1, F.P + 0.012, F.Q / 2 + 0.55, 2.3, M['black'])
        elif k == 'shelf':
            z = 5.9 if f.get('label') else 5.0
            fx.box(x0, y0, z, x1, y1, z + 0.04, M['wire']); fx.box(x0 + f['w'] / 2 - 0.03, y0, z - 0.45, x0 + f['w'] / 2 + 0.03, y1, z - 0.39, M['black'])
        elif k == 'toilet':
            r = math.radians({'w': 0, 'n': 90, 'e': 180, 's': 270}[f.get('dir', 'w')]); cs, sn = math.cos(r), math.sin(r)
            tr = lambda dx, dy: (f['cx'] + dx * cs - dy * sn, f['cy'] + dx * sn + dy * cs)
            fx.prism([tr(.35, -.55), tr(.95, -.55), tr(.95, .55), tr(.35, .55)], 1.0, 2.4, M['porc'])
            bx, by = tr(-0.1, 0); swap = abs(sn) > 0.5
            fx.ellipse(bx, by, 0.52 if swap else 0.75, 0.75 if swap else 0.52, 0, 1.45, M['porc'])
        elif k == 'tub':
            t = 0.28
            for a, b2, c2, d2 in ((x0, y0, x1, y0 + t), (x0, y1 - t, x1, y1), (x0, y0 + t, x0 + t, y1 - t), (x1 - t, y0 + t, x1, y1 - t)): fx.box(a, b2, 0, c2, d2, 1.5, M['porc'])
            fx.box(x0 + t, y0 + t, 0, x1 - t, y1 - t, 0.35, M['porc'])
        elif k == 'shower':                                    # the glass door is on the front
            F = Frame(f)
            F.box(fx, 0, 0, 0, F.P, F.Q, 0.2, M['porc']); F.ellipse(fx, F.P / 2, F.Q / 2, 0.12, 0.12, 0.2, 0.205, M['black'])
            F.box(obj('Windows', 'Window_Glass'), F.P, 0, 0.2, F.P + 0.02, F.Q, 6.5, M['glass']); F.box(fx, F.P - 0.01, 0, 6.4, F.P + 0.03, F.Q, 6.5, M['chrome'])
        elif k == 'barn':                                      # slides along a horizontal wall, on its front side
            s = -1 if facing(f) == 'n' else 1; o = T / 2 + 0.14
            Y = lambda d0, d1: (f['y'] + d0, f['y'] + d1) if s > 0 else (f['y'] - d1, f['y'] - d0)
            bx0, bx1 = f['x1'] - 0.15, f['x2'] + 0.15; dm = paint_mat(f.get('paint') or 'barn'); dd, hw = obj('Doors', 'Barn_Door'), obj('Doors', 'Door_Hardware')
            def yb(target, d0, d1, a, b, z0, z1, mat): ya, yb2 = Y(o + d0, o + d1); target.box(a, ya, z0, b, yb2, z1, mat)
            yb(dd, 0, 0.1, bx0, bx1, 0.12, 7.1, dm)
            for zz in (1.0, 6.0): yb(dd, 0.1, 0.12, bx0, bx1, zz, zz + 0.45, dm)
            yb(hw, -0.02, 0.05, bx0 - 0.1, bx0 + 2 * (bx1 - bx0) + 0.1, 7.3, 7.36, M['black'])
            for hx in (bx0 + 0.3, bx1 - 0.3): yb(hw, 0.02, 0.06, hx - 0.03, hx + 0.03, 7.0, 7.34, M['black'])
            yb(hw, 0.12, 0.2, bx1 - 0.35, bx1 - 0.3, 3.0, 4.2, M['black'])
        elif k == 'steps':
            t1, t2 = y0 + f['h'] * 0.45, y0 + f['h'] * 0.72; st = obj('Exterior', 'Steps')
            st.box(x0, y0, GROUND_Z, x1, t1, -0.25, M['deck']); st.box(x0, t1, GROUND_Z, x1, t2, -1.0, M['deck']); st.box(x0, t2, GROUND_Z, x1, y1, -1.7, M['deck'])
        elif k == 'deck':
            st = obj('Exterior', 'Steps'); st.box(x0, y0 + 0.9, GROUND_Z, x1, y1, -0.25, M['deck']); st.box(x0, y0, GROUND_Z, x1, y0 + 0.9, -1.15, M['deck'])

def build_shell():
    fl = obj('Floor', 'Floor'); fm = floor_material()
    for x0, y0, x1, y1 in H.get('floorRects') or [[E, E, W - E, D - E]]:
        vs = [fl.bm.verts.new(P(x, y, 0)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]; fl.face(vs, fm)
    if H.get('slants'):
        for x0, y0, x1, y1 in H.get('floorRects') or []: obj('Exterior', 'Skirting').box(x0 - 0.3, y0 - 0.3, GROUND_Z, x1 + 0.3, y1 + 0.3, -0.02, M['skirt'])
    else: obj('Exterior', 'Skirting').box(-0.05, -0.05, GROUND_Z, W + 0.05, D + 0.05, -0.02, M['skirt'])
    obj('Exterior', 'Ground').box(-150, -150, GROUND_Z - 0.5, W + 150, D + 150, GROUND_Z, M['ground'])
    k = 0
    for r in H['rooms']:                                      # one ceiling per room, painted with its own key
        c = obj('Ceiling', 'Ceiling_' + r['id']); m = paint_mat('C:' + r['id'])
        for x0, y0, x1, y1 in r['rects']:                     # pieces may overlap: a hair of height apart so no faces coincide
            k += 1; c.box(x0, y0, CEIL - 0.004 - 0.0003 * k, x1, y1, CEIL + 0.06, m)
    obj('Ceiling', 'Roof_Lighttight').box(0, 0, CEIL + 0.07, W, D, CEIL + 0.4, M['cut'])   # stops sky light leaking in at ceiling edges

build_shell(); build_walls(); build_slants(); build_fixtures()
for o in list(OBJS.values()): o.finish()
COLL['Ceiling'].hide_render = True

# ----------------------------------------------------------------------------- lights, world, cameras
LIGHT = arg('--light') or ((SCHEME or {}).get('view', {}).get('lighting')) or 'day'
if LIGHT not in ('day', 'overcast', 'evening', 'true'): LIGHT = 'day'
world = bpy.data.worlds.new('World'); scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']
sun_d = bpy.data.lights.new('Sun', 'SUN'); sun_d.angle = math.radians(1.5)
sun = bpy.data.objects.new('Sun', sun_d); sun.rotation_euler = (math.radians(50), math.radians(8), math.radians(-35)); coll('Lighting').objects.link(sun)
ROOM_LIGHTS = []
for r in H['rooms']:
    big = max(r['rects'], key=lambda q: (q[2] - q[0]) * (q[3] - q[1]))
    cx, cy = (big[0] + big[2]) / 2, (big[1] + big[3]) / 2
    area = sum((q[2] - q[0]) * (q[3] - q[1]) for q in r['rects'])
    ld = bpy.data.lights.new('Light_' + r['id'], 'AREA'); ld.shape = 'SQUARE'; ld.size = 1.0
    lo = bpy.data.objects.new('Light_' + r['id'], ld); lo.location = (cx * FT, -cy * FT, (CEIL - 0.15) * FT)
    coll('Room_Lights').objects.link(lo); ROOM_LIGHTS.append((ld, area))
def set_light(mode, inside):
    """inside: the camera is in a room with the ceiling on, so daylight needs help from ceiling lights."""
    sky = {'day': ((0.62, 0.72, 0.88, 1), 1.0), 'overcast': ((0.80, 0.83, 0.88, 1), 1.6), 'evening': ((0.05, 0.06, 0.1, 1), 0.3), 'true': ((1, 1, 1, 1), 1.0)}[mode]
    bg.inputs['Color'].default_value, bg.inputs['Strength'].default_value = sky
    sun_d.energy = {'day': 4.0, 'overcast': 0.0, 'evening': 0.0, 'true': 0.0}[mode]
    for ld, area in ROOM_LIGHTS:
        # calibrated: ~0.5 W of ceiling light per sq ft renders a wall facing the camera close to its paint chip
        if mode == 'evening': ld.color = (1.0, 0.72, 0.45); ld.energy = 0.8 * area
        elif mode == 'true': ld.color = (1, 1, 1); ld.energy = 0.55 * area if inside else 0
        else: ld.color = (1.0, 0.97, 0.93); ld.energy = (0.5 if mode == 'day' else 0.6) * area if inside else 0
    COLL['Ceiling'].hide_render = not inside

def look(cam, eye, target):
    cam.location = eye; cam.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
def make_cam(name):
    cd = bpy.data.cameras.new(name); ob = bpy.data.objects.new(name, cd); coll('Cameras').objects.link(ob); return ob
pv = lambda p: Vector((p[0] * FT, -p[1] * FT, p[2] * FT))          # plan feet -> metres

VIEWS = {}                                                     # name -> (camera object, inside?)
cx, cy = W / 2 * FT, -D / 2 * FT
c = make_cam('Cam_doll'); c.data.lens = 30; look(c, (cx + 9 * K, cy - 15.5 * K, 13 * K), (cx, cy + 0.3, 0)); VIEWS['doll'] = (c, False)
c = make_cam('Cam_top'); c.data.type = 'ORTHO'; c.data.ortho_scale = max(W, D * 1.6) * FT * 1.1; look(c, (cx, cy, 40), (cx, cy, 0)); VIEWS['top'] = (c, False)
c = make_cam('Cam_out'); c.data.lens = 28; look(c, (cx - 8 * K, cy - 16 * K, 3.0), (cx, cy, 1.2)); VIEWS['out'] = (c, False)
ROOM_VIEW_IDS = H.get('renderRooms') or [r['id'] for r in H['rooms'] if r.get('area', 0) >= 40]
for r in H['rooms']:                                          # eye-level corner shot: stand in one corner, look across to the far one
    big = max(r['rects'], key=lambda q: (q[2] - q[0]) * (q[3] - q[1]))
    x0, y0, x1, y1 = big
    inset = min(1.0, (x1 - x0) / 4, (y1 - y0) / 4)
    corners = [(x0 + inset, y0 + inset), (x1 - inset, y0 + inset), (x1 - inset, y1 - inset), (x0 + inset, y1 - inset)]
    ex, ey = corners[2]; tx, ty = corners[0]                    # stand in the south-east corner, look north-west
    c = make_cam('Cam_' + r['id']); c.data.sensor_fit = 'HORIZONTAL'; c.data.angle = math.radians(92)
    look(c, pv((ex, ey, 5.0)), pv((tx, ty, 3.6))); VIEWS[r['id']] = (c, True)
ex_view = (SCHEME or {}).get('view', {})
if ex_view.get('camera') and any(ex_view['camera'].get('position') or [0]):
    cam = ex_view['camera']; c = make_cam('Cam_export'); c.data.sensor_fit = 'VERTICAL'; c.data.angle = math.radians(ex_view.get('fov') or 60)
    look(c, pv(cam['position']), pv(cam['target'])); VIEWS['export'] = (c, ex_view.get('kind') in ('wall', 'walk'))

r = scene.render
res = (arg('--res') or '1600x1000').split('x'); r.resolution_x, r.resolution_y = int(res[0]), int(res[1])
scene.render.engine = 'CYCLES'; scene.cycles.samples = int(arg('--samples') or 64); scene.cycles.use_denoising = True; scene.cycles.device = 'CPU'
scene.view_settings.view_transform = 'Standard'          # keeps paint colours true (AgX pales strong colours)
scene.camera = VIEWS['doll'][0]
set_light(LIGHT, False)

blend = os.path.join(HERE, f'house_{SLUG}.blend')
if not NO_SAVE: bpy.ops.wm.save_as_mainfile(filepath=blend)
print('SAVED', blend, '| scheme:', (SCHEME or {}).get('scheme', {}).get('name', '(none)'), '| light:', LIGHT,
      '| paint materials:', len(PAINT), '| cabinet fronts:', sum(v['door'] + v['drawer'] for v in PART_N.values()))

if arg('--render'):
    want = arg('--views')
    if not want or want is True: names = (['export'] if 'export' in VIEWS else []) + ['doll'] + ROOM_VIEW_IDS
    else:
        names = []
        for v in want.split(','):
            names += ROOM_VIEW_IDS if v == 'rooms' else [v]
    outdir = os.path.join(HERE, 'renders', SLUG); os.makedirs(outdir, exist_ok=True)
    for name in names:
        if name not in VIEWS: print('SKIP unknown view', name); continue
        cam, inside = VIEWS[name]
        scene.camera = cam; set_light(LIGHT, inside)
        r.filepath = os.path.join(outdir, name + '.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED', r.filepath)
