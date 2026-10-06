"""
Waterford Park 4563C — base 3D model (Rev A), built from house.json (exported from house-data.js).

Run (headless):
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b -P build_house.py -- [--render] [--ceiling]

Outputs next to this file: house_base.blend  (+ renders/*.png with --render)

Defaults used where nothing was measured (change the constants below, re-run):
  8' flat ceiling · 6'8" doors · windows 3'0" sill → 6'8" head · 4.5" baseboard · 3.5" casing
  walls all white (paint comes later) · Desert Sand LVP everywhere · no roof (dollhouse view)
Coordinates: plan feet (x east, y south) → Blender metres (X = x, Y = -y, Z up).
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DO_RENDER = '--render' in ARGS
SHOW_CEILING = '--ceiling' in ARGS

FT = 0.3048
CEIL = 8.0            # ceiling height (ft)
DOOR_H = 6.667        # door / header height
SILL = 3.0            # default window sill
HEAD = 6.667          # window head
BASE_H = 0.375        # baseboard height
BASE_T = 0.03         # baseboard thickness
CASE_W = 0.29         # casing width (3.5")
CASE_T = 0.035
DOOR_T = 0.115        # door leaf thickness
DOOR_OPEN_DEG = 70    # interior doors drawn part-open (plan shows the swing); exterior doors closed
GROUND_Z = -2.0       # grade is 24" below finished floor (typical manufactured home)

H = json.load(open(os.path.join(HERE, 'house.json'), encoding='utf-8'))
W, D, E, T = H['W'], H['D'], H['E'], H['T']

# ----------------------------------------------------------------------------- scene / collections
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

COLL = {}
def coll(name):
    if name not in COLL:
        c = bpy.data.collections.new(name)
        scene.collection.children.link(c)
        COLL[name] = c
    return COLL[name]

# ----------------------------------------------------------------------------- materials
def lin(hexstr):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)

MATS = {}
def mat(name, hexstr='#ffffff', rough=0.5, metal=0.0, **extra):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = lin(hexstr)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    for k, v in extra.items():
        try:
            b.inputs[k.replace('_', ' ')].default_value = v
        except KeyError:
            pass
    m.diffuse_color = lin(hexstr)
    MATS[name] = m
    return m

def floor_material():
    fl = H['floor']
    m = bpy.data.materials.new('Floor_DesertSand_LVP')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    N = nt.nodes.new
    out = N('ShaderNodeOutputMaterial'); bsdf = N('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    plank_w = fl['plankW'] * FT
    plank_l = fl['plankL'] * FT
    img = bpy.data.images.load(os.path.join(HERE, fl['texture']))
    img.pack()
    ratio = img.size[1] / img.size[0]          # texture is one plank: width across, length along

    geo = N('ShaderNodeNewGeometry'); sep = N('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep.inputs['Vector'])
    comb = N('ShaderNodeCombineXYZ')                       # planks run along world X
    nt.links.new(sep.outputs['X'], comb.inputs['X']); nt.links.new(sep.outputs['Y'], comb.inputs['Y'])

    def brick(c1, c2, mortar):
        b = N('ShaderNodeTexBrick')
        b.offset = 0.33; b.offset_frequency = 1; b.squash = 1.0
        b.inputs['Color1'].default_value = c1; b.inputs['Color2'].default_value = c2
        b.inputs['Mortar'].default_value = mortar
        b.inputs['Scale'].default_value = 1.0
        b.inputs['Mortar Size'].default_value = 0.0025
        b.inputs['Mortar Smooth'].default_value = 0.2
        b.inputs['Brick Width'].default_value = plank_l
        b.inputs['Row Height'].default_value = plank_w
        nt.links.new(comb.outputs['Vector'], b.inputs['Vector'])
        return b
    grooves = brick((1, 1, 1, 1), (1, 1, 1, 1), (0.42, 0.34, 0.25, 1))   # white planks, soft seams
    rnd = brick((0, 0, 0, 1), (1, 1, 1, 1), (1, 1, 1, 1))                 # random 0..1 per plank
    bw = N('ShaderNodeRGBToBW'); nt.links.new(rnd.outputs['Color'], bw.inputs['Color'])

    u = N('ShaderNodeMath'); u.operation = 'DIVIDE'; u.inputs[1].default_value = plank_w
    nt.links.new(sep.outputs['Y'], u.inputs[0])
    v1 = N('ShaderNodeMath'); v1.operation = 'DIVIDE'; v1.inputs[1].default_value = plank_w * ratio
    nt.links.new(sep.outputs['X'], v1.inputs[0])
    v2 = N('ShaderNodeMath'); v2.operation = 'MULTIPLY_ADD'; v2.inputs[1].default_value = 7.31
    nt.links.new(bw.outputs['Val'], v2.inputs[0]); nt.links.new(v1.outputs['Value'], v2.inputs[2])
    uv = N('ShaderNodeCombineXYZ')
    nt.links.new(u.outputs['Value'], uv.inputs['X']); nt.links.new(v2.outputs['Value'], uv.inputs['Y'])

    tex = N('ShaderNodeTexImage'); tex.image = img; tex.extension = 'REPEAT'; tex.interpolation = 'Smart'
    nt.links.new(uv.outputs['Vector'], tex.inputs['Vector'])
    hs = N('ShaderNodeHueSaturation'); hs.inputs['Value'].default_value = 1.28
    nt.links.new(tex.outputs['Color'], hs.inputs['Color'])

    mix = N('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1.0
    nt.links.new(hs.outputs['Color'], mix.inputs[6]); nt.links.new(grooves.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.42
    return m

PAINT = mat('Paint_White', '#f4f3ef', 0.85)           # all walls for now — swapped per wall later
TRIM = mat('Trim_White', '#f7f7f5', 0.35)
DOOR = mat('Door_White', '#f2f2ee', 0.4)
CEILING = mat('Ceiling_White', '#f6f5f2', 0.95)
CAB_BLUE = mat('Cabinet_Blue', '#4f6779', 0.45)
CAB_WHITE = mat('Cabinet_White', '#f1f0ec', 0.4)
COUNTER = mat('Counter_White', '#f3f3f0', 0.22)
TILE = mat('Backsplash_Subway', '#eeeeea', 0.12)
APP_WHITE = mat('Appliance_White', '#eceeee', 0.3)
STEEL = mat('Stainless', '#bfc3c7', 0.28, metal=1.0)
BLACK = mat('Black_Glass', '#0d0e10', 0.12)
BRASS = mat('Brass', '#b8923c', 0.3, metal=1.0)
CHROME = mat('Chrome', '#d8dadd', 0.12, metal=1.0)
PORC = mat('Porcelain', '#fbfbfa', 0.1)
GLASS = mat('Glass', '#ffffff', 0.0)
try:
    GLASS.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
    GLASS.node_tree.nodes['Principled BSDF'].inputs['IOR'].default_value = 1.45
except KeyError:
    pass
WIRE = mat('Wire_Shelf', '#e8e8e6', 0.5)
HEATER = mat('Water_Heater', '#e4e6e8', 0.35)
PUMP = mat('Pump_Blue', '#35607f', 0.4)
SKIRT = mat('Skirting', '#c9c6bd', 0.8)
DECK = mat('Deck_Wood', '#7a5a3b', 0.7)
GRASS = mat('Ground_Grass', '#4d6b35', 0.95)
FLOOR = floor_material()

# ----------------------------------------------------------------------------- geometry builder
def P(x, y, z):
    return Vector((x * FT, -y * FT, z * FT))

class Builder:
    def __init__(self):
        self.g = {}
    def _bm(self, c, name, m):
        key = (c, name, m.name)
        if key not in self.g:
            self.g[key] = (bmesh.new(), m)
        return self.g[key][0]
    def poly_prism(self, c, name, m, pts, z0, z1):
        bm = self._bm(c, name, m)
        lo = [bm.verts.new(P(x, y, z0)) for x, y in pts]
        hi = [bm.verts.new(P(x, y, z1)) for x, y in pts]
        n = len(pts)
        bm.faces.new(lo); bm.faces.new(hi[::-1])
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    def box(self, c, name, m, x0, y0, z0, x1, y1, z1):
        x0, x1 = sorted((x0, x1)); y0, y1 = sorted((y0, y1)); z0, z1 = sorted((z0, z1))
        if x1 - x0 < 1e-5 or y1 - y0 < 1e-5 or z1 - z0 < 1e-5:
            return
        self.poly_prism(c, name, m, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1)
    def ellipse(self, c, name, m, cx, cy, rx, ry, z0, z1, n=32):
        pts = [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]
        self.poly_prism(c, name, m, pts, z0, z1)
    def finish(self):
        for (c, name, _), (bm, m) in self.g.items():
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            me = bpy.data.meshes.new(name)
            bm.to_mesh(me); bm.free()
            me.materials.append(m)
            for p in me.polygons:
                p.use_smooth = False
            ob = bpy.data.objects.new(name, me)
            coll(c).objects.link(ob)
        self.g = {}

B = Builder()

# ----------------------------------------------------------------------------- walls
def wall_axis(w):
    horiz = (w['x1'] - w['x0']) >= (w['y1'] - w['y0'])
    return horiz, (w['x0'] if horiz else w['y0']), (w['x1'] if horiz else w['y1'])

def wbox(c, name, m, w, horiz, a, b, z0, z1, grow=(0, 0)):
    """box spanning [a,b] along the wall axis, full thickness, optionally grown on the low/high face"""
    if horiz:
        B.box(c, name, m, a, w['y0'] - grow[0], z0, b, w['y1'] + grow[1], z1)
    else:
        B.box(c, name, m, w['x0'] - grow[0], a, z0, w['x1'] + grow[1], b, z1)

def exterior_face_flags(w, horiz):
    """(low_face_is_exterior, high_face_is_exterior)"""
    if not w.get('ext'):
        return (False, False)
    if horiz:
        return (w['y0'] < D / 2, w['y1'] > D / 2)
    return (w['x0'] < W / 2, w['x1'] > W / 2)

def _inside(r, x, y, tol=1e-6):
    return r['x0'] - tol <= x <= r['x1'] + tol and r['y0'] - tol <= y <= r['y1'] + tol

def tuck_ends(i, w, horiz, s, e):
    """Where a wall end butts into another wall, run it to that wall's centreline so no faces are coplanar
    (coincident faces render as black speckles in Cycles)."""
    cx, cy = (w['x0'] + w['x1']) / 2, (w['y0'] + w['y1']) / 2
    for j, n in enumerate(H['walls']):
        if j == i or n.get('status') == 'removed':
            continue
        ncx, ncy = (n['x0'] + n['x1']) / 2, (n['y0'] + n['y1']) / 2
        if horiz:
            if _inside(n, s, cy) and ncx < s: s = ncx
            if _inside(n, e, cy) and ncx > e: e = ncx
        else:
            if _inside(n, cx, s) and ncy < s: s = ncy
            if _inside(n, cx, e) and ncy > e: e = ncy
    return s, e

def build_walls():
    for i, w in enumerate(H['walls']):
        if w.get('status') == 'removed':
            continue
        horiz, s, e = wall_axis(w)
        s, e = tuck_ends(i, w, horiz, s, e)
        top = CEIL - 0.0007 * (i % 9)            # tiny per-wall height offset: overlapping wall tops never coincide
        wid = w.get('id') or ('ext' if w.get('ext') else 'int')
        name = f'Wall_{i:02d}_{wid}'
        ops_all = w.get('openings', [])
        ops = sorted([o for o in ops_all if o['type'] != 'panel'], key=lambda o: o['a'])
        lo_ext, hi_ext = exterior_face_flags(w, horiz)
        # solid pieces between openings
        pieces, cur = [], s
        for o in ops:
            pieces.append((cur, o['a'])); cur = o['b']
        pieces.append((cur, e))
        for a, b in pieces:
            if b - a < 0.01:
                continue
            wbox('Walls', name, PAINT, w, horiz, a, b, 0, top)
            # baseboards on the interior-facing side(s)
            if not lo_ext:
                if horiz: B.box('Trim', 'Baseboard', TRIM, a, w['y0'] - BASE_T, 0, b, w['y0'], BASE_H)
                else:     B.box('Trim', 'Baseboard', TRIM, w['x0'] - BASE_T, a, 0, w['x0'], b, BASE_H)
            if not hi_ext:
                if horiz: B.box('Trim', 'Baseboard', TRIM, a, w['y1'], 0, b, w['y1'] + BASE_T, BASE_H)
                else:     B.box('Trim', 'Baseboard', TRIM, w['x1'], a, 0, w['x1'] + BASE_T, b, BASE_H)
        # openings: headers (+ sills) and trim; casing is clamped so neighbouring openings share the gap
        for k, o in enumerate(ops):
            room_l = (o['a'] - ops[k - 1]['b']) / 2 if k > 0 else CASE_W
            room_r = (ops[k + 1]['a'] - o['b']) / 2 if k + 1 < len(ops) else CASE_W
            ext = (min(CASE_W, room_l), min(CASE_W, room_r))
            if o['type'] == 'door':
                wbox('Walls', name, PAINT, w, horiz, o['a'], o['b'], DOOR_H, top)
                build_casing(w, horiz, o, 0, DOOR_H, ext)
                build_door(w, horiz, o)
            elif o['type'] == 'window':
                sill = o.get('sill') or SILL
                wbox('Walls', name, PAINT, w, horiz, o['a'], o['b'], 0, sill)
                wbox('Walls', name, PAINT, w, horiz, o['a'], o['b'], HEAD, top)
                build_casing(w, horiz, o, sill, HEAD, ext)
                build_window(w, horiz, o, sill, HEAD)

def build_casing(w, horiz, o, z0, z1, ext=(CASE_W, CASE_W)):
    cw, ct = CASE_W, CASE_T
    el, er = ext[0] - 0.002, ext[1] - 0.002     # stop just short of a neighbour's casing
    for face in (0, 1):                        # both wall faces: thin shells that sit ON the wall surface
        def b(a0, a1, zz0, zz1):
            if horiz:
                y0, y1 = (w['y0'] - ct, w['y0']) if face == 0 else (w['y1'], w['y1'] + ct)
                B.box('Trim', 'Casing', TRIM, a0, y0, zz0, a1, y1, zz1)
            else:
                x0, x1 = (w['x0'] - ct, w['x0']) if face == 0 else (w['x1'], w['x1'] + ct)
                B.box('Trim', 'Casing', TRIM, x0, a0, zz0, x1, a1, zz1)
        # jambs stop at the head line, the head runs over them → no overlapping volumes
        b(o['a'] - el, o['a'], z0, z1)
        b(o['b'], o['b'] + er, z0, z1)
        b(o['a'] - el, o['b'] + er, z1, z1 + cw)
        if o['type'] == 'window':
            b(o['a'] - el, o['b'] + er, z0 - cw * 0.8, z0)

def build_window(w, horiz, o, z0, z1):
    cx, cy = (w['x0'] + w['x1']) / 2, (w['y0'] + w['y1']) / 2
    fw = 0.11                                         # frame width
    dep = 0.12                                        # frame depth (centred in the wall)
    def fbox(a0, a1, zz0, zz1, m=TRIM, c='Windows'):
        if horiz:
            B.box(c, 'Window_Frames', m, a0, cy - dep / 2, zz0, a1, cy + dep / 2, zz1)
        else:
            B.box(c, 'Window_Frames', m, cx - dep / 2, a0, zz0, cx + dep / 2, a1, zz1)
    fbox(o['a'], o['a'] + fw, z0, z1); fbox(o['b'] - fw, o['b'], z0, z1)
    fbox(o['a'] + fw, o['b'] - fw, z0, z0 + fw); fbox(o['a'] + fw, o['b'] - fw, z1 - fw, z1)
    n = o.get('panes', 1)
    for k in range(1, n):                                                  # mullions between window panes
        p = o['a'] + (o['b'] - o['a']) * k / n
        fbox(p - 0.04, p + 0.04, z0 + fw, z1 - fw)
    # meeting rail, split around the mullions
    xs = [o['a'] + fw] + [o['a'] + (o['b'] - o['a']) * k / n + (-0.04 if j == 0 else 0.04)
                          for k in range(1, n) for j in (0, 1)] + [o['b'] - fw]
    for j in range(0, len(xs), 2):
        fbox(xs[j], xs[j + 1], (z0 + z1) / 2 - 0.03, (z0 + z1) / 2 + 0.03)
    # glass
    if horiz:
        B.box('Windows', 'Window_Glass', GLASS, o['a'] + fw, cy - 0.01, z0 + fw, o['b'] - fw, cy + 0.01, z1 - fw)
    else:
        B.box('Windows', 'Window_Glass', GLASS, cx - 0.01, o['a'] + fw, z0 + fw, cx + 0.01, o['b'] - fw, z1 - fw)

def build_door(w, horiz, o):
    cx, cy = (w['x0'] + w['x1']) / 2, (w['y0'] + w['y1']) / 2
    hv, ov = (o['a'], o['b']) if o['hinge'] == 'a' else (o['b'], o['a'])
    if horiz:
        hinge, other = Vector((hv, cy)), Vector((ov, cy)); n = Vector((0, 1 if o['swing'] == 's' else -1))
    else:
        hinge, other = Vector((cx, hv)), Vector((cx, ov)); n = Vector((1 if o['swing'] == 'e' else -1, 0))
    d = (other - hinge).normalized()
    L = (other - hinge).length - 0.012
    ang = math.radians(0 if w.get('ext') else DOOR_OPEN_DEG)
    dr = d * math.cos(ang) + n * math.sin(ang)
    pp = Vector((-dr.y, dr.x))
    hh = hinge + d * 0.006
    t2 = DOOR_T / 2
    quad = lambda u0, u1, p0, p1: [tuple(hh + dr * u0 + pp * p0), tuple(hh + dr * u1 + pp * p0),
                                    tuple(hh + dr * u1 + pp * p1), tuple(hh + dr * u0 + pp * p1)]
    B.poly_prism('Doors', 'Door_Leaves', DOOR, quad(0, L, -t2, t2), 0.03, DOOR_H - 0.05)
    # six raised panels each side
    cols = [(0.30, L / 2 - 0.08), (L / 2 + 0.08, L - 0.30)]
    rows = [(0.9, 2.5), (2.9, 4.3), (4.7, 6.1)]
    for side in (1, -1):
        for (u0, u1) in cols:
            for (z0, z1) in rows:
                p0, p1 = (t2, t2 + 0.012) if side > 0 else (-t2 - 0.012, -t2)
                B.poly_prism('Doors', 'Door_Panels', DOOR, quad(u0, u1, p0, p1), z0, z1)
        kp = t2 + 0.05 if side > 0 else -t2 - 0.05
        k = hh + dr * (L - 0.28) + pp * kp
        B.box('Doors', 'Door_Hardware', BRASS, k.x - 0.045, k.y - 0.045, 2.9, k.x + 0.045, k.y + 0.045, 3.1)

# ----------------------------------------------------------------------------- fixtures
def top_slab(x0, y0, x1, y1, z, over=0.0, t=0.125, m=COUNTER, c='Cabinetry'):
    B.box(c, 'Countertops', m, x0 - over, y0 - over, z, x1 + over, y1 + over, z + t)

def build_fixture(f):
    k = f['k']
    if f.get('st') == 'removed':
        return
    if k == 'box':
        c, lab = f.get('c'), f.get('label')
        x0, y0, x1, y1 = f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']
        if c == 'cabB' and lab == 'PANTRY':
            B.box('Cabinetry', 'Cabinets_Blue', CAB_BLUE, x0, y0, 0, x1, y1, 7.0)
        elif c == 'cabB':
            B.box('Cabinetry', 'Cabinets_Blue', CAB_BLUE, x0, y0, 0, x1, y1, 3.0)
            top_slab(x0, y0, x1, y1, 3.0, over=0.1 if lab == 'ISLAND' else 0.0)
        elif c == 'cabW' and lab == 'LINEN':
            B.box('Cabinetry', 'Cabinets_White', CAB_WHITE, x0, y0, 0, x1, y1, 6.5)
        elif c == 'cabW':
            B.box('Cabinetry', 'Cabinets_White', CAB_WHITE, x0, y0, 0, x1, y1, 2.8)
            top_slab(x0, y0, x1, y1, 2.8, over=0.05)
        elif c == 'app' and lab == 'FRIDGE':
            B.box('Appliances', 'Fridge', APP_WHITE, x0, y0, 0, x1, y1, 5.9)
            B.box('Appliances', 'Fridge', BLACK, x1, (y0 + y1) / 2 - 0.01, 0.4, x1 + 0.01, (y0 + y1) / 2 + 0.01, 5.8)
            for yy in ((y0 + y1) / 2 - 0.2, (y0 + y1) / 2 + 0.2):
                B.box('Appliances', 'Fridge_Handles', STEEL, x1, yy - 0.025, 2.4, x1 + 0.07, yy + 0.025, 4.6)
            B.box('Cabinetry', 'Cabinets_White', CAB_WHITE, x0, y0, 6.0, x0 + 2.0, y1, 7.5)       # cabinet over fridge
        elif c == 'counter':                                    # desk top (lower than kitchen counters)
            top_slab(x0, y0, x1, y1, 2.5)
            # white backsplash + upper cabinets over the desk
            B.box('Cabinetry', 'Backsplash', TILE, x0, y1 - 0.02 - 0.0, 2.625, x1, y1, 4.5)
            B.box('Cabinetry', 'Cabinets_White', CAB_WHITE, x0 + 0.03, y1 - 1.0, 4.5, x1 - 0.1, y1, 7.0)
    elif k == 'oval':
        z = 2.8 + 0.125 + 0.05
        B.ellipse('Fixtures', 'Basins', PORC, f['cx'], f['cy'], f['rx'], f['ry'], z - 0.01, z + 0.003)
        B.ellipse('Fixtures', 'Basin_Wells', BLACK, f['cx'], f['cy'], f['rx'] * 0.78, f['ry'] * 0.78, z, z + 0.006)
    elif k == 'sink2':
        z = 3.125
        for i in range(2):
            x0 = f['x'] + i * f['w'] / 2 + 0.07
            B.box('Fixtures', 'Kitchen_Sink', STEEL, x0, f['y'], z, x0 + f['w'] / 2 - 0.14, f['y'] + f['h'], z + 0.006)
        cx = f['x'] + f['w'] / 2
        B.ellipse('Fixtures', 'Faucet', CHROME, cx, f['y'] - 0.12, 0.05, 0.05, z, z + 0.6)
        B.box('Fixtures', 'Faucet', CHROME, cx - 0.03, f['y'] - 0.12, z + 0.55, cx + 0.03, f['y'] + 0.45, z + 0.62)
    elif k == 'range':
        x0, y0, x1, y1 = f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']
        B.box('Appliances', 'Range', STEEL, x0, y0, 0, x1, y1, 3.0)
        B.box('Appliances', 'Range_Top', BLACK, x0 + 0.05, y0 + 0.05, 3.0, x1 - 0.05, y1 - 0.05, 3.025)
        B.box('Appliances', 'Range_Oven_Glass', BLACK, x1, y0 + 0.3, 1.0, x1 + 0.01, y1 - 0.3, 2.4)
        B.box('Appliances', 'Range_Handle', STEEL, x1, y0 + 0.2, 2.5, x1 + 0.12, y1 - 0.2, 2.56)
        B.box('Appliances', 'Microwave', APP_WHITE, x0, y0, 4.9, x0 + 1.4, y1, 6.3)
        B.box('Appliances', 'Microwave_Door', BLACK, x0 + 1.4, y0 + 0.2, 5.0, x0 + 1.41, y1 - 0.9, 6.2)
        # base + backsplash + uppers along the west wall run (range area)
    elif k == 'heater':
        B.ellipse('Fixtures', 'Water_Heater', HEATER, f['cx'], f['cy'], f['r'] * 0.85, f['r'] * 0.85, 0, 4.4)
    elif k == 'pumps':
        B.box('Fixtures', 'Pumps', PUMP, f['x'], f['y'], 0, f['x'] + f['w'], f['y'] + f['h'], 2.0)
    elif k == 'front':                                            # washer / dryer
        x0, y0, x1, y1 = f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']
        B.box('Appliances', 'Washer_Dryer', APP_WHITE, x0, y0, 0, x1, y1, 3.0)
        B.box('Appliances', 'WD_Control_Panel', STEEL, x0 + 0.02, y0 + 0.1, 3.0, x0 + 0.4, y1 - 0.1, 3.4)
        B.box('Appliances', 'WD_Door', BLACK, x1, (y0 + y1) / 2 - 0.55, 1.1, x1 + 0.012, (y0 + y1) / 2 + 0.55, 2.3)
    elif k == 'shelf':
        z = 5.9 if f.get('label') else 5.0
        B.box('Fixtures', 'Shelves', WIRE, f['x'], f['y'], z, f['x'] + f['w'], f['y'] + f['h'], z + 0.04)
        rod_x = f['x'] + f['w'] * 0.5
        B.box('Fixtures', 'Shelves', BLACK, rod_x - 0.03, f['y'], z - 0.45, rod_x + 0.03, f['y'] + f['h'], z - 0.39)
    elif k == 'toilet':
        rot = {'w': 0, 'n': 90, 'e': 180, 's': 270}[f.get('dir', 'w')]
        r = math.radians(rot); cs, sn = math.cos(r), math.sin(r)
        tr = lambda dx, dy: (f['cx'] + dx * cs - dy * sn, f['cy'] + dx * sn + dy * cs)
        tank = [tr(.35, -.55), tr(.95, -.55), tr(.95, .55), tr(.35, .55)]
        B.poly_prism('Fixtures', 'Toilets', PORC, tank, 1.0, 2.4)
        bx, by = tr(-0.1, 0)
        swap = rot in (90, 270)
        B.ellipse('Fixtures', 'Toilets', PORC, bx, by, 0.52 if swap else 0.75, 0.75 if swap else 0.52, 0, 1.45)
    elif k == 'tub':
        x0, y0, x1, y1, t = f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h'], 0.28
        for (a, b2, c2, d2) in ((x0, y0, x1, y0 + t), (x0, y1 - t, x1, y1), (x0, y0 + t, x0 + t, y1 - t), (x1 - t, y0 + t, x1, y1 - t)):
            B.box('Fixtures', 'Tub', PORC, a, b2, 0, c2, d2, 1.5)
        B.box('Fixtures', 'Tub', PORC, x0 + t, y0 + t, 0, x1 - t, y1 - t, 0.35)
    elif k == 'shower':
        x0, y0, x1, y1 = f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']
        B.box('Fixtures', 'Shower', PORC, x0, y0, 0, x1, y1, 0.2)
        B.ellipse('Fixtures', 'Shower', BLACK, (x0 + x1) / 2, (y0 + y1) / 2, 0.12, 0.12, 0.2, 0.205)
        B.box('Fixtures', 'Shower_Glass', GLASS, x0, y0 - 0.02, 0.2, x1, y0, 6.5)        # fixed glass panel on the open (toilet) side
        B.box('Fixtures', 'Shower', CHROME, x0, y0 - 0.03, 6.4, x1, y0 + 0.01, 6.5)
    elif k == 'barn':
        x0, x1, y = f['x1'] - 0.15, f['x2'] + 0.15, f['y'] + T / 2 + 0.14
        B.box('Doors', 'Barn_Door', DOOR, x0, y, 0.12, x1, y + 0.1, 7.1)
        for zz in (1.0, 6.0):
            B.box('Doors', 'Barn_Door', DOOR, x0, y + 0.1, zz, x1, y + 0.12, zz + 0.45)       # Z-brace rails
        B.box('Doors', 'Barn_Track', BLACK, x0 - 0.1, y - 0.02, 7.3, x0 + 2 * (x1 - x0) + 0.1, y + 0.05, 7.36)
        for hx in (x0 + 0.3, x1 - 0.3):
            B.box('Doors', 'Barn_Hangers', BLACK, hx - 0.03, y + 0.02, 7.0, hx + 0.03, y + 0.06, 7.34)
        B.box('Doors', 'Barn_Handle', BLACK, x1 - 0.35, y + 0.12, 3.0, x1 - 0.3, y + 0.2, 4.2)
    elif k == 'steps':                                           # front stoop: 3 treads down to grade
        x0, x1 = f['x'], f['x'] + f['w']
        y0 = f['y']; y_end = f['y'] + f['h']
        t1, t2 = y0 + f['h'] * 0.45, y0 + f['h'] * 0.72
        B.box('Exterior', 'Front_Steps', DECK, x0, y0, GROUND_Z, x1, t1, -0.25)
        B.box('Exterior', 'Front_Steps', DECK, x0, t1, GROUND_Z, x1, t2, -1.0)
        B.box('Exterior', 'Front_Steps', DECK, x0, t2, GROUND_Z, x1, y_end, -1.7)
    elif k == 'deck':                                            # back steps at the utility door
        x0, x1, y0, y1 = f['x'], f['x'] + f['w'], f['y'], f['y'] + f['h']
        B.box('Exterior', 'Back_Steps', DECK, x0, y0 + 0.9, GROUND_Z, x1, y1, -0.25)
        B.box('Exterior', 'Back_Steps', DECK, x0, y0, GROUND_Z, x1, y0 + 0.9, -1.15)

def build_kitchen_extras():
    """Uppers + backsplash that the plan only implies (taken from the photos)."""
    # north wall run: uppers each side of the window, tile on the wall under/around it
    for (a, b) in ((18.97, 21.65), (26.95, 28.37)):
        B.box('Cabinetry', 'Cabinets_White', CAB_WHITE, a, E, 4.5, b, E + 1.0, 7.0)
        B.box('Cabinetry', 'Backsplash', TILE, a, E, 3.125, b, E + 0.02, 4.5)
    # west wall run: backsplash corner → fridge, uppers either side of the microwave
    B.box('Cabinetry', 'Backsplash', TILE, 18.8 + T / 2, 2.5, 3.125, 18.8 + T / 2 + 0.02, 7.7, 4.5)
    B.box('Cabinetry', 'Cabinets_White', CAB_WHITE, 18.97, 2.5, 4.5, 19.97, 4.0, 7.0)
    B.box('Cabinetry', 'Cabinets_White', CAB_WHITE, 18.97, 6.5, 4.5, 19.97, 7.7, 7.0)
    B.box('Cabinetry', 'Cabinets_White', CAB_WHITE, 18.97, 4.0, 6.3, 19.97, 6.5, 7.0)          # above microwave

def build_floor_and_shell():
    # LVP floor (one plane, material is world-space so planks run continuously through every room)
    bm =B._bm('Floor', 'Floor_LVP', FLOOR)
    vs = [bm.verts.new(P(x, y, 0)) for x, y in ((E, E), (W - E, E), (W - E, D - E), (E, D - E))]
    bm.faces.new(vs)
    # underbelly / skirting
    B.box('Exterior', 'Skirting', SKIRT, -0.05, -0.05, GROUND_Z, W + 0.05, D + 0.05, -0.02)
    # ceiling (hidden by default so the dollhouse view works)
    B.box('Ceiling', 'Ceiling', CEILING, E, E, CEIL, W - E, D - E, CEIL + 0.1)
    # ground
    B.box('Exterior', 'Ground', GRASS, -80, -80, GROUND_Z - 0.5, W + 80, D + 80, GROUND_Z)

# ----------------------------------------------------------------------------- build
build_floor_and_shell()
build_walls()
for f in H['fixtures']:
    build_fixture(f)
build_kitchen_extras()
B.finish()

# per-wall bookkeeping for the later paint tool
for ob in bpy.data.objects:
    if ob.name.startswith('Wall_'):
        ob['paint'] = 'Paint_White'
        ob['is_exterior'] = '_ext' in ob.name
if not SHOW_CEILING:
    COLL['Ceiling'].hide_viewport = True
    COLL['Ceiling'].hide_render = True

# ----------------------------------------------------------------------------- lighting / cameras / world
sun_data = bpy.data.lights.new('Sun', 'SUN'); sun_data.energy = 4.5; sun_data.angle = math.radians(1.5)
sun = bpy.data.objects.new('Sun', sun_data)
sun.rotation_euler = (math.radians(48), math.radians(8), math.radians(-35))
coll('Lighting').objects.link(sun)

world = bpy.data.worlds.new('World'); scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.62, 0.72, 0.88, 1); bg.inputs['Strength'].default_value = 1.0

def make_cam(name, loc, target, lens=28, ortho=None):
    cd = bpy.data.cameras.new(name)
    if ortho:
        cd.type = 'ORTHO'; cd.ortho_scale = ortho
    else:
        cd.lens = lens
    ob = bpy.data.objects.new(name, cd)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    coll('Cameras').objects.link(ob)
    return ob

cx, cy = W / 2 * FT, -D / 2 * FT
cam_top = make_cam('Cam_Dollhouse_Top', (cx, cy, 40), (cx, cy, 0), ortho=W * FT * 1.12)
cam_iso = make_cam('Cam_Dollhouse_Iso', (cx + 9, cy - 15.5, 13), (cx, cy + 0.3, 0), lens=30)
cam_great = make_cam('Cam_GreatRoom', (41.2 * FT, -17.5 * FT, 5.4 * FT), (20 * FT, -7.5 * FT, 3.6 * FT), lens=20)
scene.camera = cam_iso

# interior fill lights: they live in the Ceiling collection, so they only exist when the ceiling is shown
for k, (lx, ly) in enumerate(((24, 6.5), (36, 6.5), (30, 19), (38, 19), (21, 12), (48, 6.5))):
    ld = bpy.data.lights.new(f'Room_Light_{k}', 'AREA'); ld.energy = 45; ld.size = 1.2; ld.shape = 'SQUARE'
    lo = bpy.data.objects.new(f'Room_Light_{k}', ld)
    lo.location = (lx * FT, -ly * FT, (CEIL - 0.1) * FT)
    COLL['Ceiling'].objects.link(lo)

r = scene.render
r.resolution_x, r.resolution_y = 1600, 900
try:
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.cycles.device = 'CPU'
except Exception as ex:
    print('engine setup:', ex)
scene.view_settings.view_transform = 'Standard'

blend = os.path.join(HERE, 'house_base.blend')
bpy.ops.wm.save_as_mainfile(filepath=blend)
print('SAVED', blend)
print('OBJECTS', len(bpy.data.objects), 'MESH-VERTS', sum(len(o.data.vertices) for o in bpy.data.objects if o.type == 'MESH'))

if DO_RENDER:
    os.makedirs(os.path.join(HERE, 'renders'), exist_ok=True)
    for cam, fn, with_ceiling in ((cam_top, 'top.png', False), (cam_iso, 'iso.png', False), (cam_great, 'great_room.png', True)):
        scene.camera = cam
        COLL['Ceiling'].hide_render = not (with_ceiling or SHOW_CEILING)
        r.filepath = os.path.join(HERE, 'renders', fn)
        bpy.ops.render.render(write_still=True)
        print('RENDERED', r.filepath)
