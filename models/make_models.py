"""
Generates two low-poly glTF binaries (GLB) with the FS logo:
  fs_bike.glb : delivery motorbike with a WHITE cargo box carrying the logo
  fs_car.glb  : white car carrying the logo on both doors and the roof

Conventions: +Y up, vehicle FRONT = -Z (glTF forward), +X = right side, units = meters.
"""
import json
import math
import struct
import sys
import numpy as np

LOGO = sys.argv[1] if len(sys.argv) > 1 else "logo.png"
OUT = sys.argv[2] if len(sys.argv) > 2 else "../modules/mapbox-navigation/android/src/main/assets/models"

BLUE = (0.075, 0.333, 0.471, 1.0)     # #13557a
YELLOW = (0.992, 0.812, 0.063, 1.0)   # #fdcf10
WHITE = (0.98, 0.98, 0.98, 1.0)
BLACK = (0.06, 0.06, 0.07, 1.0)
DARK = (0.16, 0.17, 0.19, 1.0)
SILVER = (0.72, 0.74, 0.77, 1.0)
GLASS = (0.10, 0.17, 0.24, 1.0)
RED = (0.85, 0.10, 0.10, 1.0)
LAMP = (1.0, 0.95, 0.70, 1.0)


class Scene:
    def __init__(self):
        self.materials = {}   # name -> dict(color, textured)
        self.prims = {}       # name -> dict(pos, nrm, uv, idx)

    def mat(self, name, color, textured=False, rough=0.65, metal=0.0):
        self.materials[name] = dict(color=color, textured=textured, rough=rough, metal=metal)
        self.prims.setdefault(name, dict(pos=[], nrm=[], uv=[], idx=[]))
        return name

    def add(self, mat, pos, nrm, uv, idx):
        p = self.prims[mat]
        base = len(p['pos'])
        p['pos'] += [tuple(v) for v in pos]
        p['nrm'] += [tuple(v) for v in nrm]
        p['uv'] += [tuple(v) for v in uv]
        p['idx'] += [base + i for i in idx]


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def box(scene, mat, center, size, rx=0.0, ry=0.0):
    sx, sy, sz = (s / 2 for s in size)
    R = rot_y(ry) @ rot_x(rx)
    faces = [
        ((1, 0, 0), [(sx, -sy, sz), (sx, -sy, -sz), (sx, sy, -sz), (sx, sy, sz)]),
        ((-1, 0, 0), [(-sx, -sy, -sz), (-sx, -sy, sz), (-sx, sy, sz), (-sx, sy, -sz)]),
        ((0, 1, 0), [(-sx, sy, sz), (sx, sy, sz), (sx, sy, -sz), (-sx, sy, -sz)]),
        ((0, -1, 0), [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, -sy, sz), (-sx, -sy, sz)]),
        ((0, 0, 1), [(-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]),
        ((0, 0, -1), [(sx, -sy, -sz), (-sx, -sy, -sz), (-sx, sy, -sz), (sx, sy, -sz)]),
    ]
    for n, verts in faces:
        pos = [R @ np.array(v) + np.array(center) for v in verts]
        nrm = [R @ np.array(n)] * 4
        scene.add(mat, pos, nrm, [(0, 0)] * 4, [0, 1, 2, 0, 2, 3])


def cylinder_x(scene, mat, center, radius, length, seg=28):
    """Cylinder whose axis is X (wheels)."""
    cx, cy, cz = center
    h = length / 2
    ring = [(math.cos(2 * math.pi * i / seg), math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    # side
    pos, nrm, idx = [], [], []
    for i in range(seg):
        a, b = ring[i], ring[(i + 1) % seg]
        base = len(pos)
        for (c, s) in (a, b):
            pos.append((cx - h, cy + radius * s, cz + radius * c))
            nrm.append((0, s, c))
            pos.append((cx + h, cy + radius * s, cz + radius * c))
            nrm.append((0, s, c))
        # verts: a-, a+, b-, b+
        idx += [base, base + 1, base + 3, base, base + 3, base + 2]
    scene.add(mat, pos, nrm, [(0, 0)] * len(pos), idx)
    # caps
    for sign in (1, -1):
        pos = [(cx + sign * h, cy, cz)] + [(cx + sign * h, cy + radius * s, cz + radius * c) for c, s in ring]
        nrm = [(sign, 0, 0)] * len(pos)
        idx = []
        for i in range(seg):
            a, b = 1 + i, 1 + (i + 1) % seg
            idx += [0, a, b] if sign == 1 else [0, b, a]
        scene.add(mat, pos, nrm, [(0, 0)] * len(pos), idx)


def decal(scene, mat, center, normal, right, up, width, height):
    """Textured quad. `right`/`up` are unit vectors describing image axes in model space."""
    c = np.array(center, float)
    r = np.array(right, float) * width / 2
    u = np.array(up, float) * height / 2
    pos = [c - r - u, c + r - u, c + r + u, c - r + u]
    # glTF UV: (0,0) top-left, v grows downward
    uv = [(0, 1), (1, 1), (1, 0), (0, 0)]
    nrm = [normal] * 4
    scene.add(mat, pos, nrm, uv, [0, 1, 2, 0, 2, 3])


def logo_on_x_faces(scene, mat, x, y, z, w, h):
    """Logo on the right (+X) and left (-X) sides, upright when looking at the vehicle from the side."""
    # looking from +X: image right = -Z
    decal(scene, mat, (x, y, z), (1, 0, 0), (0, 0, -1), (0, 1, 0), w, h)
    # looking from -X: image right = +Z
    decal(scene, mat, (-x, y, z), (-1, 0, 0), (0, 0, 1), (0, 1, 0), w, h)


def build_bike():
    s = Scene()
    m_body = s.mat('blue', BLUE)
    m_yellow = s.mat('yellow', YELLOW)
    m_white = s.mat('white', WHITE, rough=0.5)
    m_black = s.mat('black', BLACK, rough=0.9)
    m_dark = s.mat('dark', DARK)
    m_silver = s.mat('silver', SILVER, rough=0.3, metal=0.6)
    m_lamp = s.mat('lamp', LAMP, rough=0.2)
    m_red = s.mat('red', RED)
    m_logo = s.mat('logo', (1, 1, 1, 1), textured=True, rough=0.6)

    # wheels
    for z in (0.62, -0.72):
        cylinder_x(s, m_black, (0, 0.33, z), 0.33, 0.13)
        cylinder_x(s, m_silver, (0, 0.33, z), 0.19, 0.145)
        cylinder_x(s, m_dark, (0, 0.33, z), 0.06, 0.16)

    # frame / engine block
    box(s, m_dark, (0, 0.40, 0.05), (0.20, 0.26, 0.55))
    # body panels
    box(s, m_body, (0, 0.62, -0.02), (0.26, 0.22, 0.80))
    box(s, m_body, (0, 0.80, -0.40), (0.30, 0.20, 0.42))       # front cowl / tank
    box(s, m_yellow, (0, 0.62, -0.02), (0.272, 0.05, 0.70))    # yellow stripe
    # seat
    box(s, m_black, (0, 0.78, 0.22), (0.24, 0.08, 0.50))
    # rear fender
    box(s, m_dark, (0, 0.68, 0.70), (0.16, 0.04, 0.55))
    # front fork + fender
    box(s, m_silver, (0.07, 0.63, -0.62), (0.04, 0.70, 0.04), rx=math.radians(19.5))
    box(s, m_silver, (-0.07, 0.63, -0.62), (0.04, 0.70, 0.04), rx=math.radians(19.5))
    box(s, m_body, (0, 0.62, -0.75), (0.17, 0.04, 0.46))
    # handlebar + grips + mirrors
    cylinder_x(s, m_black, (0, 0.99, -0.50), 0.022, 0.62)
    cylinder_x(s, m_dark, (0.30, 0.99, -0.50), 0.03, 0.12)
    cylinder_x(s, m_dark, (-0.30, 0.99, -0.50), 0.03, 0.12)
    # headlight
    box(s, m_lamp, (0, 0.90, -0.66), (0.16, 0.14, 0.06))
    box(s, m_dark, (0, 0.90, -0.62), (0.20, 0.18, 0.05))
    # exhaust
    box(s, m_silver, (0.14, 0.32, 0.50), (0.07, 0.07, 0.62))

    # --- WHITE delivery box with FS logo (rear)
    bx, by, bz = 0.0, 1.00, 0.72
    bw, bh, bl = 0.52, 0.50, 0.56
    box(s, m_dark, (0, 0.74, 0.72), (0.20, 0.06, 0.50))        # rack
    box(s, m_white, (bx, by, bz), (bw, bh, bl))
    box(s, m_yellow, (bx, by + bh / 2 + 0.012, bz), (bw + 0.02, 0.025, bl + 0.02))  # lid trim
    off = 0.004
    logo_on_x_faces(s, m_logo, bw / 2 + off, by - 0.01, bz, 0.40, 0.40)
    # back face (viewed from behind: image right = +X)
    decal(s, m_logo, (0, by - 0.01, bz + bl / 2 + off), (0, 0, 1), (1, 0, 0), (0, 1, 0), 0.40, 0.40)
    # top face (image up = front = -Z, right = +X)
    decal(s, m_logo, (0, by + bh / 2 + 0.026, bz), (0, 1, 0), (1, 0, 0), (0, 0, -1), 0.40, 0.40)
    # tail light
    box(s, m_red, (0, 0.72, 1.02), (0.14, 0.05, 0.03))
    return s


def build_car():
    s = Scene()
    m_white = s.mat('white', WHITE, rough=0.35, metal=0.1)
    m_blue = s.mat('blue', BLUE)
    m_yellow = s.mat('yellow', YELLOW)
    m_black = s.mat('black', BLACK, rough=0.9)
    m_dark = s.mat('dark', DARK)
    m_silver = s.mat('silver', SILVER, rough=0.3, metal=0.6)
    m_glass = s.mat('glass', GLASS, rough=0.1, metal=0.3)
    m_lamp = s.mat('lamp', LAMP, rough=0.2)
    m_red = s.mat('red', RED)
    m_logo = s.mat('logo', (1, 1, 1, 1), textured=True, rough=0.4)

    # wheels
    for x in (0.80, -0.80):
        for z in (1.38, -1.38):
            cylinder_x(s, m_black, (x, 0.34, z), 0.34, 0.24)
            cylinder_x(s, m_silver, (x, 0.34, z), 0.21, 0.255)
            cylinder_x(s, m_dark, (x, 0.34, z), 0.07, 0.27)

    # body
    box(s, m_white, (0, 0.58, 0), (1.80, 0.52, 4.40))                 # lower body
    box(s, m_white, (0, 0.92, -1.30), (1.74, 0.20, 1.55))             # hood
    box(s, m_white, (0, 0.92, 1.45), (1.74, 0.22, 1.20))              # trunk
    box(s, m_blue, (0, 0.40, 0), (1.82, 0.07, 4.40))                  # blue rocker stripe
    box(s, m_yellow, (0, 0.47, 0), (1.815, 0.025, 4.40))              # yellow pin-stripe
    # cabin
    box(s, m_glass, (0, 1.17, 0.12), (1.58, 0.46, 2.05))              # glasshouse
    box(s, m_white, (0, 1.42, 0.12), (1.62, 0.07, 1.95))              # roof
    # bumpers
    box(s, m_dark, (0, 0.40, -2.21), (1.78, 0.18, 0.10))
    box(s, m_dark, (0, 0.40, 2.21), (1.78, 0.18, 0.10))
    # lights
    for x in (0.62, -0.62):
        box(s, m_lamp, (x, 0.74, -2.205), (0.42, 0.13, 0.04))
        box(s, m_red, (x, 0.80, 2.205), (0.42, 0.12, 0.04))
    box(s, m_dark, (0, 0.62, -2.205), (0.55, 0.20, 0.03))             # grille
    # mirrors
    for x in (0.95, -0.95):
        box(s, m_white, (x, 1.05, -0.78), (0.10, 0.10, 0.18))

    # logo: both doors + roof
    off = 0.004
    logo_on_x_faces(s, m_logo, 0.90 + off, 0.64, 0.10, 0.62, 0.62)
    decal(s, m_logo, (0, 1.455 + off, 0.12), (0, 1, 0), (1, 0, 0), (0, 0, -1), 0.95, 0.95)
    return s


# ---------------------------------------------------------------- GLB writer
def write_glb(scene, path, logo_path):
    bin_data = bytearray()
    buffer_views, accessors, materials, meshes_prims = [], [], [], []

    def pad():
        while len(bin_data) % 4:
            bin_data.append(0)

    def add_view(data, target=None):
        pad()
        off = len(bin_data)
        bin_data.extend(data)
        bv = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            bv["target"] = target
        buffer_views.append(bv)
        return len(buffer_views) - 1

    def add_acc(view, comp, count, typ, mn=None, mx=None):
        a = {"bufferView": view, "componentType": comp, "count": count, "type": typ}
        if mn is not None:
            a["min"], a["max"] = mn, mx
        accessors.append(a)
        return len(accessors) - 1

    # texture image
    with open(logo_path, 'rb') as f:
        png = f.read()
    img_view = add_view(png)

    mat_index = {}
    for name, m in scene.materials.items():
        pbr = {"baseColorFactor": list(m['color']), "metallicFactor": m['metal'], "roughnessFactor": m['rough']}
        if m['textured']:
            pbr["baseColorTexture"] = {"index": 0}
        materials.append({"name": name, "pbrMetallicRoughness": pbr})
        mat_index[name] = len(materials) - 1

    for name, p in scene.prims.items():
        if not p['pos']:
            continue
        pos = np.array(p['pos'], dtype=np.float32)
        nrm = np.array(p['nrm'], dtype=np.float32)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
        idx = np.array(p['idx'], dtype=np.uint32)
        attrs = {}
        attrs["POSITION"] = add_acc(add_view(pos.tobytes(), 34962), 5126, len(pos), "VEC3",
                                    pos.min(axis=0).tolist(), pos.max(axis=0).tolist())
        attrs["NORMAL"] = add_acc(add_view(nrm.tobytes(), 34962), 5126, len(nrm), "VEC3")
        if scene.materials[name]['textured']:
            uv = np.array(p['uv'], dtype=np.float32)
            attrs["TEXCOORD_0"] = add_acc(add_view(uv.tobytes(), 34962), 5126, len(uv), "VEC2")
        ia = add_acc(add_view(idx.tobytes(), 34963), 5125, len(idx), "SCALAR")
        meshes_prims.append({"attributes": attrs, "indices": ia, "material": mat_index[name], "mode": 4})

    gltf = {
        "asset": {"version": "2.0", "generator": "fs-model-generator"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "vehicle"}],
        "meshes": [{"primitives": meshes_prims}],
        "materials": materials,
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "images": [{"bufferView": img_view, "mimeType": "image/png"}],
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(bin_data)}],
    }
    pad()
    gltf["buffers"][0]["byteLength"] = len(bin_data)
    js = json.dumps(gltf, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(bin_data)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(bin_data), 0x004E4942))
        f.write(bin_data)


if __name__ == '__main__':
    write_glb(build_bike(), f"{OUT}/fs_bike.glb", LOGO)
    write_glb(build_car(), f"{OUT}/fs_car.glb", LOGO)
    print("written")
