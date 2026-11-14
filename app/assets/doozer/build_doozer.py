# The 3D Doozer, built from a script so that it can always be rebuilt.
#
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup ^
#       --python app/assets/doozer/build_doozer.py
#
# Options go after a lone "--":
#   --out PATH        where to write the model (default: doozer.glb beside this file)
#   --preview DIR     also render a few stills of the model into DIR (for checking by eye)
#   --palette NAME    the palette the stills use (default: peach)
#
# Always run it with --background: no window may open on the owner's screen.
#
# What it makes (DESIGN_SPEC.md section 7, WORK_PLAN.md section 11):
#
#   - One creature with the 2D rig's proportions. Every number below is read off the 2D
#     rig (app/src/character/rig-markup.ts): its drawing space is 200 x 200 with Doozer
#     standing on y = 186, and one model unit is 100 of those pixels. `rx` and `ry` turn
#     a rig coordinate into a model coordinate, so the two can be compared line by line.
#     The face is laid onto the front of the body by straight projection, which makes
#     the front view match the drawing by construction.
#   - A small armature: root, body, earL, earR, tuft, armL, armR, footL, footR and
#     tail. Every bone points straight up with no roll, so in the exported file every
#     joint's rest rotation is zero and its axes are the model's own (x right, y up,
#     z toward the viewer). The page can then turn an ear about z without any bookkeeping.
#   - Shape keys for the face, named after the 2D rig's vocabulary (expressions.ts):
#     one per way of drawing the eyes on the `eyes` mesh and one per mouth on the `mouth`
#     mesh. An expression is a pair of them, read from the same table the 2D rig uses,
#     so the two renderings cannot drift apart. The resting shape is `open` eyes and the
#     `w` mouth, which is the `content` face.
#   - The five palettes as material parameters. Each material that follows the palette
#     carries the name of its palette colour in a custom property (`palette`), and the
#     five palettes themselves, read from app/src/character/palettes.ts, are stored on
#     the armature. The body's lighter belly is a vertex attribute (`_BELLY`), so the
#     belly colour is a parameter as well.
#
# Model space in this file: x right, y up, z toward the viewer. Blender is z-up with the
# viewer at -y, so points are converted in one place (`to_blender`), and the exporter
# converts back.

import json
import math
import os
import re
import sys

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.normpath(os.path.join(HERE, '..', '..'))
PALETTES_TS = os.path.join(APP, 'src', 'character', 'palettes.ts')


# ---- options -------------------------------------------------------------------------

def read_options():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    options = {'out': os.path.join(HERE, 'doozer.glb'), 'preview': None, 'palette': 'peach'}
    i = 0
    while i < len(argv):
        key = argv[i].lstrip('-')
        if key in options and i + 1 < len(argv):
            options[key] = argv[i + 1]
            i += 2
        else:
            raise SystemExit('unknown option: ' + argv[i])
    return options


# ---- the 2D rig's coordinates ----------------------------------------------------------

UNIT = 0.01           # one rig pixel in model units
GROUND_Y = 186.0      # where the 2D rig stands


def rx(x):
    return (x - 100.0) * UNIT


def ry(y):
    return (GROUND_Y - y) * UNIT


def rp(x, y):
    return (rx(x), ry(y))


def to_blender(p):
    return (p[0], -p[2], p[1])


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(edge0, edge1, x):
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def cubic(p0, p1, p2, p3, t):
    u = 1.0 - t
    return tuple(u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d for a, b, c, d in zip(p0, p1, p2, p3))


def quad(p0, p1, p2, t):
    u = 1.0 - t
    return tuple(u * u * a + 2 * u * t * b + t * t * c for a, b, c in zip(p0, p1, p2))


def polyline(points, count):
    """`count` points evenly spaced along a polyline."""
    lengths = [0.0]
    for a, b in zip(points, points[1:]):
        lengths.append(lengths[-1] + math.dist(a, b))
    total = lengths[-1]
    out = []
    k = 0
    for i in range(count):
        want = total * i / (count - 1)
        while k < len(points) - 2 and lengths[k + 1] < want:
            k += 1
        span = lengths[k + 1] - lengths[k]
        t = 0.0 if span <= 0 else (want - lengths[k]) / span
        out.append(tuple(lerp(a, b, t) for a, b in zip(points[k], points[k + 1])))
    return out


def sample(curves, per=24):
    """A dense polyline through a list of quadratic or cubic curves."""
    out = []
    for curve in curves:
        fn = cubic if len(curve) == 4 else quad if len(curve) == 3 else None
        for i in range(per + 1):
            point = fn(*curve, i / per) if fn else tuple(lerp(a, b, i / per) for a, b in zip(curve[0], curve[1]))
            if not out or math.dist(out[-1], point) > 1e-9:
                out.append(point)
    return out


# ---- the body's outline ----------------------------------------------------------------
# The 2D body path: M100 44 C142 44 164 82 164 122 C164 162 140 184 100 184 (and mirrored).

BODY_TOP = [(100, 44), (142, 44), (164, 82), (164, 122)]
BODY_BOTTOM = [(164, 122), (164, 162), (140, 184), (100, 184)]
BODY_DEPTH = 0.92     # the body is a little flatter front to back than it is wide


def body_profile(per):
    """(radius, height) from the top of the head to the underside."""
    points = sample([BODY_TOP, BODY_BOTTOM], per)
    return [(rx(x), ry(y)) for x, y in points]


_DENSE = body_profile(200)


def body_radius(height):
    """Half the body's width at a height."""
    if height >= _DENSE[0][1] or height <= _DENSE[-1][1]:
        return 0.0
    lo, hi = 0, len(_DENSE) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if _DENSE[mid][1] >= height:
            lo = mid
        else:
            hi = mid
    (r0, h0), (r1, h1) = _DENSE[lo], _DENSE[hi]
    t = 0.0 if h0 == h1 else (h0 - height) / (h0 - h1)
    return lerp(r0, r1, t)


def body_front(x, y):
    """How far forward the body's surface is at a point of the front view."""
    r = body_radius(y)
    return BODY_DEPTH * math.sqrt(max(0.0, r * r - x * x))


# ---- collecting geometry ---------------------------------------------------------------

class Part:
    """Vertices and faces of one piece, with one material and (optionally) skin weights."""

    def __init__(self, material):
        self.material = material
        self.verts = []
        self.faces = []
        self.weights = None     # per vertex: {bone: weight}
        self.belly = None       # per vertex: 0..1
        self.shapes = {}        # shape key name -> vertex positions

    def grid(self, rows, wrap=False):
        """Faces for a (len(rows)) x (len(rows[0])) grid of vertices already appended in order."""
        nu, nv = len(rows), len(rows[0])
        for i in range(nu - 1):
            for j in range(nv if wrap else nv - 1):
                a, b = rows[i][j], rows[i][(j + 1) % nv]
                c, d = rows[i + 1][(j + 1) % nv], rows[i + 1][j]
                self.faces.append((a, b, c, d))

    def add(self, point):
        self.verts.append(tuple(point))
        return len(self.verts) - 1


def face_normal_sum(verts, faces, toward=None):
    """Signed volume of a closed piece, or how much an open one faces `toward`."""
    total = 0.0
    for face in faces:
        p0 = Vector(verts[face[0]])
        for k in range(1, len(face) - 1):
            p1, p2 = Vector(verts[face[k]]), Vector(verts[face[k + 1]])
            n = (p1 - p0).cross(p2 - p0)
            total += n.dot(toward) if toward is not None else p0.dot(n)
    return total


def orient(part, toward=None, probes=()):
    """
    Make the faces point outward (a closed piece) or toward a direction (an open one).
    `probes` are other positions for the same vertices, tried in turn when the piece's own
    are folded away to a point and so have no facing.
    """
    seen = set()
    for face in part.faces:
        for a, b in zip(face, face[1:] + face[:1]):
            if (a, b) in seen:
                raise SystemExit('a %s piece is not wound consistently' % part.material)
            seen.add((a, b))
    for verts in (part.verts, *probes):
        facing = face_normal_sum(verts, part.faces, Vector(toward) if toward else None)
        if abs(facing) > 1e-9:
            if facing < 0:
                part.faces = [tuple(reversed(face)) for face in part.faces]
            break
    return part


def ellipsoid(material, centre, radii, segments=20, rings=12, turn_z=0.0):
    part = Part(material)
    cz, sz = math.cos(turn_z), math.sin(turn_z)

    def place(x, y, z):
        return (centre[0] + x * cz - y * sz, centre[1] + x * sz + y * cz, centre[2] + z)

    top = part.add(place(0, radii[1], 0))
    rows = []
    for i in range(1, rings):
        lat = math.pi * i / rings
        row = []
        for j in range(segments):
            lon = 2 * math.pi * j / segments
            row.append(part.add(place(radii[0] * math.sin(lat) * math.cos(lon), radii[1] * math.cos(lat), radii[2] * math.sin(lat) * math.sin(lon))))
        rows.append(row)
    bottom = part.add(place(0, -radii[1], 0))
    for j in range(segments):
        part.faces.append((top, rows[0][(j + 1) % segments], rows[0][j]))
        part.faces.append((bottom, rows[-1][j], rows[-1][(j + 1) % segments]))
    part.grid(rows, wrap=True)
    return orient(part)


def tube(material, spine, radii, segments=10, frames=None):
    """A round tube along `spine` (3D points), closed with a point at each end."""
    part = Part(material)
    count = len(spine)
    rows = []
    for i, point in enumerate(spine):
        p = Vector(point)
        if frames:
            side, up = frames[i]
        else:
            ahead = Vector(spine[min(count - 1, i + 1)]) - Vector(spine[max(0, i - 1)])
            ahead.normalize()
            up = Vector((0, 0, 1))
            side = up.cross(ahead)
            if side.length < 1e-6:
                side = Vector((1, 0, 0))
            side.normalize()
        row = []
        for j in range(segments):
            a = 2 * math.pi * j / segments
            row.append(part.add(p + (side * math.cos(a) + up * math.sin(a)) * radii[i]))
        rows.append(row)
    part.grid(rows, wrap=True)
    start, end = part.add(spine[0]), part.add(spine[-1])
    for j in range(segments):
        part.faces.append((start, rows[0][(j + 1) % segments], rows[0][j]))
        part.faces.append((end, rows[-1][j], rows[-1][(j + 1) % segments]))
    return orient(part)


# ---- pieces laid on the front of the body ----------------------------------------------
# A "blob" is a path with a width: the outline of a filled shape, or a stroke with round
# ends. It is built as a low dome over that outline and laid onto the body's surface.
# Every way of drawing the eyes (or the mouth) uses the same grid of vertices, which is
# what lets them be shape keys of one another.

BLOB_ALONG = 18       # vertices along the path
BLOB_ACROSS = 6       # across it (a half circle)


def spaced(i, n):
    """0..1, closer together at both ends, where the round ends need the detail."""
    return 0.5 * (1.0 - math.cos(math.pi * i / n))


def blob_outline(rx_, ry_, depth, centre=(0.0, 0.0)):
    """A filled ellipse."""
    spine, widths, depths = [], [], []
    for i in range(BLOB_ALONG + 1):
        a = math.pi * i / BLOB_ALONG
        spine.append((centre[0] - rx_ * math.cos(a), centre[1]))
        widths.append(ry_ * math.sin(a))
        depths.append(depth * math.sin(a))
    return spine, widths, depths


def blob_stroke(points, half_width, depth):
    """A stroke with round ends along a dense polyline. The ends reach half a width past the path."""
    def extend(a, b):
        d = Vector((b[0] - a[0], b[1] - a[1]))
        d.normalize()
        return (b[0] + d.x * half_width, b[1] + d.y * half_width)

    points = [extend(points[1], points[0])] + list(points) + [extend(points[-2], points[-1])]
    lengths = [0.0]
    for a, b in zip(points, points[1:]):
        lengths.append(lengths[-1] + math.dist(a, b))
    total = lengths[-1]
    spine, widths, depths = [], [], []
    k = 0
    for i in range(BLOB_ALONG + 1):
        want = total * spaced(i, BLOB_ALONG)
        while k < len(points) - 2 and lengths[k + 1] < want:
            k += 1
        span = lengths[k + 1] - lengths[k]
        t = 0.0 if span <= 0 else (want - lengths[k]) / span
        spine.append((lerp(points[k][0], points[k + 1][0], t), lerp(points[k][1], points[k + 1][1], t)))
        from_end = min(want, total - want)
        cap = 1.0 if from_end >= half_width else math.sqrt(max(0.0, 1.0 - (1.0 - from_end / half_width) ** 2))
        widths.append(half_width * cap)
        depths.append(depth * cap)
    return spine, widths, depths


def blob_points(outline):
    """(x, y, depth) for every vertex of a blob, in the fixed grid order."""
    spine, widths, depths = outline
    count = len(spine)
    out = []
    for i in range(count):
        a, b = spine[max(0, i - 1)], spine[min(count - 1, i + 1)]
        tangent = Vector((b[0] - a[0], b[1] - a[1]))
        if tangent.length < 1e-9:
            tangent = Vector((1, 0))
        tangent.normalize()
        normal = Vector((-tangent.y, tangent.x))
        for j in range(BLOB_ACROSS + 1):
            phi = math.pi * j / BLOB_ACROSS
            out.append((spine[i][0] + normal.x * widths[i] * math.cos(phi), spine[i][1] + normal.y * widths[i] * math.cos(phi), depths[i] * math.sin(phi)))
    return out


def blob_gone():
    """Folded away to a point under the surface."""
    return [(0.0, 0.0, -0.03)] * ((BLOB_ALONG + 1) * (BLOB_ACROSS + 1))


def lay(points, origin, lift, surface=body_front, mirror=False):
    """Blob points (x, y, depth), relative to `origin`, onto the surface."""
    out = []
    for x, y, depth in points:
        px = origin[0] + (-x if mirror else x)
        py = origin[1] + y
        out.append((px, py, surface(px, py) + lift + depth))
    return out


def blob_part(material, laid, shapes=None):
    part = Part(material)
    part.shapes = dict(shapes or {})
    rows = []
    k = 0
    for _ in range(BLOB_ALONG + 1):
        row = []
        for _ in range(BLOB_ACROSS + 1):
            row.append(part.add(laid[k]))
            k += 1
        rows.append(row)
    part.grid(rows)
    return orient(part, toward=(0, 0, 1), probes=part.shapes.values())


def disc(material, centre, radius_x, radius_y, lift, surface=body_front, rings=4, segments=18, bulge=0.0):
    """A filled ellipse laid on the surface (a cheek, the belly of a lens)."""
    part = Part(material)
    middle = part.add((centre[0], centre[1], surface(centre[0], centre[1]) + lift + bulge))
    rows = []
    for i in range(1, rings + 1):
        f = i / rings
        row = []
        for j in range(segments):
            a = 2 * math.pi * j / segments
            x, y = centre[0] + radius_x * f * math.cos(a), centre[1] + radius_y * f * math.sin(a)
            row.append(part.add((x, y, surface(x, y) + lift + bulge * math.sqrt(max(0.0, 1.0 - f * f)))))
        rows.append(row)
    for j in range(segments):
        part.faces.append((middle, rows[0][(j + 1) % segments], rows[0][j]))
    part.grid(rows, wrap=True)
    return orient(part, toward=(0, 0, 1))


# ---- the body and its limbs ------------------------------------------------------------

EAR_PIVOT = rp(68, 74)
EAR_CENTRE = rp(60, 60)
EAR_RADIUS = 19 * UNIT
EAR_Z = -0.035
EAR_THICK = 0.092
TUFT_ROOT = rp(100, 50)
SHOULDER = rp(47, 123)
ARM_CENTRE = rp(41, 134)
FOOT_PIVOT = rp(75, 178)
HAT_ANCHOR = rp(100, 46)
EYE = rp(74, 106)                   # the left eye; the right one is its mirror image
MOUTH = rp(100, 124)
CHEEK = rp(60, 124)

BONES = {
    # name: (parent, head)
    'root': (None, (0.0, 0.0, 0.0)),
    'body': ('root', (0.0, 0.0, 0.0)),
    'earL': ('body', (EAR_PIVOT[0], EAR_PIVOT[1], EAR_Z)),
    'earR': ('body', (-EAR_PIVOT[0], EAR_PIVOT[1], EAR_Z)),
    'tuft': ('body', (TUFT_ROOT[0], TUFT_ROOT[1], 0.0)),
    'armL': ('body', (SHOULDER[0], SHOULDER[1], 0.16)),
    'armR': ('body', (-SHOULDER[0], SHOULDER[1], 0.16)),
    'tail': ('body', (0.36, 0.33, -0.36)),
    'footL': ('root', (FOOT_PIVOT[0], FOOT_PIVOT[1], 0.12)),
    'footR': ('root', (-FOOT_PIVOT[0], FOOT_PIVOT[1], 0.12)),
}


def weigh(part, bone, pivot=None, reach=None, base='body'):
    """Everything on `bone`, or easing from `base` at the pivot to `bone` a `reach` away."""
    part.weights = []
    for v in part.verts:
        if pivot is None:
            part.weights.append({bone: 1.0})
            continue
        w = smoothstep(reach[0], reach[1], math.dist(v, pivot))
        part.weights.append({bone: w, base: 1.0 - w} if w < 1.0 else {bone: 1.0})
    return part


def build_body_parts():
    parts = []

    # The body: the 2D outline turned about its own middle, a little flatter in depth.
    body = Part('body')
    profile = body_profile(13)
    segments = 40
    top = body.add((0.0, profile[0][1], 0.0))
    rows = []
    for radius, height in profile[1:-1]:
        row = []
        for j in range(segments):
            a = 2 * math.pi * j / segments
            row.append(body.add((radius * math.cos(a), height, BODY_DEPTH * radius * math.sin(a))))
        rows.append(row)
    bottom = body.add((0.0, profile[-1][1], 0.0))
    for j in range(segments):
        body.faces.append((top, rows[0][(j + 1) % segments], rows[0][j]))
        body.faces.append((bottom, rows[-1][j], rows[-1][(j + 1) % segments]))
    body.grid(rows, wrap=True)
    orient(body)
    weigh(body, 'body')
    # The belly: the 2D rig's ellipse at (100, 148), 37 by 27, with a soft edge.
    belly_centre, belly_rx, belly_ry = rp(100, 148), 37 * UNIT, 27 * UNIT
    body.belly = []
    for x, y, z in body.verts:
        e = math.hypot((x - belly_centre[0]) / belly_rx, (y - belly_centre[1]) / belly_ry)
        body.belly.append(0.0 if z <= 0 else 1.0 - smoothstep(0.84, 1.1, e))
    parts.append(body)

    for name, side in (('L', 1), ('R', -1)):
        cx, cy = EAR_CENTRE[0] * side, EAR_CENTRE[1]
        pivot = (EAR_PIVOT[0] * side, EAR_PIVOT[1], EAR_Z)
        reach = (0.03, 0.2)

        ear = ellipsoid('skin', (cx, cy, EAR_Z), (EAR_RADIUS, EAR_RADIUS, EAR_THICK), segments=20, rings=12)
        parts.append(weigh(ear, 'ear' + name, pivot, reach))

        def ear_front(x, y, cx=cx, cy=cy):
            inside = 1.0 - ((x - cx) / EAR_RADIUS) ** 2 - ((y - cy) / EAR_RADIUS) ** 2
            return EAR_Z + EAR_THICK * math.sqrt(max(0.0, inside))

        # The inner ear: the 2D rig's smaller circle, one pixel lower.
        inner = disc('ear', (cx, cy - UNIT), 9.5 * UNIT, 9.5 * UNIT, 0.006, surface=ear_front, rings=3, segments=16)
        parts.append(weigh(inner, 'ear' + name, pivot, reach))

        # Arms: the 2D ellipse 10.5 by 15, leaning 18 degrees outward at the paw.
        arm = ellipsoid('skin', (ARM_CENTRE[0] * side, ARM_CENTRE[1], 0.15), (10.5 * UNIT, 15 * UNIT, 10 * UNIT), segments=14, rings=10, turn_z=math.radians(-18 * side))
        parts.append(weigh(arm, 'arm' + name, (SHOULDER[0] * side, SHOULDER[1], 0.16), (0.0, 0.12)))

        # Feet: the 2D ellipse 18 by 9.5, as a paw that reaches forward.
        foot = ellipsoid('shade', (rx(75) * side, 0.09, 0.17), (18 * UNIT, 9.5 * UNIT, 0.25), segments=16, rings=10)
        parts.append(weigh(foot, 'foot' + name))

    # The tuft: M100 52 C95 36 104 22 115 27 C123 31 119 43 111 39, as a tapering tube.
    centreline = polyline(sample([[(100, 52), (95, 36), (104, 22), (115, 27)], [(115, 27), (123, 31), (119, 43), (111, 39)]]), 22)
    spine = [(rx(x), ry(y), 0.0) for x, y in centreline]
    radii = [lerp(0.05, 0.036, i / (len(spine) - 1)) for i in range(len(spine))]
    radii[-1] *= 0.55
    frames = []
    for i in range(len(spine)):
        ahead = Vector(spine[min(len(spine) - 1, i + 1)]) - Vector(spine[max(0, i - 1)])
        ahead.normalize()
        frames.append((Vector((-ahead.y, ahead.x, 0.0)), Vector((0.0, 0.0, 1.0))))
    tuft = tube('shade', spine, radii, segments=10, frames=frames)
    root = (TUFT_ROOT[0], TUFT_ROOT[1], 0.0)
    parts.append(weigh(tuft, 'tuft', root, (0.02, 0.2)))

    # The tail: behind and to the right, so a little of it shows from the front as in 2D.
    tail = ellipsoid('shade', (0.41, 0.33, -0.4), (0.115, 0.115, 0.115), segments=14, rings=10)
    parts.append(weigh(tail, 'tail'))
    return parts


# ---- the face --------------------------------------------------------------------------
# Eye shapes, in the 2D rig's units around the eye's centre (rig-markup.ts and rig.css).

EYE_RX, EYE_RY = 8.6 * UNIT, 10.8 * UNIT
EYE_DEPTH = 0.034
EYE_LIFT = 0.002
LINE_DEPTH = 0.02
EYE_KINDS = ['open', 'calm', 'half', 'heavy', 'sad', 'wide', 'happy', 'closed', 'squeeze']
LIDS = {'calm': 0.2, 'half': 0.44, 'heavy': 0.62}       # how far the lid is down (--dz-lid)


def lid_height(kind):
    """The height the lid cuts the eye at, measured from the eye's centre."""
    return EYE_RY - LIDS[kind] * 2 * EYE_RY


def eye_points(kind, right):
    """Every vertex of one eye for one way of drawing it: ball, two highlights, lid line, brow."""
    def rel(x, y):
        # A point of the left eye's drawing, relative to its centre, y up.
        return ((x - 74.0) * UNIT, (106.0 - y) * UNIT)

    scale = {'wide': 1.2, 'sad': 0.92}.get(kind, 1.0)
    lidded = kind in LIDS
    round_eye = kind in ('open', 'calm', 'half', 'heavy', 'sad', 'wide', 'blink')

    # The ball.
    if round_eye:
        ball = blob_points(blob_outline(EYE_RX * scale, EYE_RY * scale, EYE_DEPTH))
    elif kind == 'happy':
        ball = blob_points(blob_stroke(sample([[rel(65, 109), rel(74, 96), rel(83, 109)]]), 2.5 * UNIT, LINE_DEPTH))
    elif kind == 'closed':
        ball = blob_points(blob_stroke(sample([[rel(65, 104), rel(74, 113), rel(83, 104)]]), 2.5 * UNIT, LINE_DEPTH))
    else:  # squeeze: > on the left eye, pointing at the nose
        ball = blob_points(blob_stroke(sample([[rel(67, 99), rel(80, 106)], [rel(80, 106), rel(67, 113)]], 8), 2.5 * UNIT, LINE_DEPTH))

    # The highlights. They are not mirrored: the light comes from the same side for both eyes.
    def highlight(cx, cy, r):
        if not round_eye:
            return blob_gone()
        dx = -cx if right else cx       # undo the mirroring that `lay` applies to the right eye
        return [(x, y, d + EYE_DEPTH * 0.86) for x, y, d in blob_points(blob_outline(r * scale, r * scale, r * 0.5, (dx * scale, cy * scale)))]

    big = highlight(3 * UNIT, 4.6 * UNIT, 3.3 * UNIT)
    small = highlight(-2.6 * UNIT, -4 * UNIT, 1.5 * UNIT)

    if lidded or kind == 'blink':
        cut = lid_height(kind) if lidded else None

        def shut(points, keep_if_above=False):
            if kind == 'blink':
                # rig.css: the open eye squashed to 8 % of its height.
                return [(x, y * 0.08, d * 0.5) for x, y, d in points]
            if min(p[1] for p in points) >= cut - 0.004 and not keep_if_above:
                return blob_gone()
            return [(x, min(y, cut), d) for x, y, d in points]

        ball = shut(ball, keep_if_above=True)
        big, small = shut(big), shut(small)

    # The lid's own line, drawn where the lid stops.
    if lidded:
        y = (106 - 95.8) * UNIT - LIDS[kind] * 21.6 * UNIT
        width = 0.78 if kind == 'calm' else 1.0
        path = sample([[(-9.8 * UNIT * width, y), (0.0, y + 2.2 * UNIT), (9.8 * UNIT * width, y)]])
        lid = [(x, py, d + 0.012) for x, py, d in blob_points(blob_stroke(path, 2 * UNIT, LINE_DEPTH))]
    else:
        lid = blob_gone()

    # The worried brow: its inner end is the higher one.
    brow = blob_points(blob_stroke(sample([[rel(65, 93), rel(83, 87)]], 6), 2.5 * UNIT, LINE_DEPTH)) if kind == 'sad' else blob_gone()

    return {'ball': ball, 'big': big, 'small': small, 'lid': lid, 'brow': brow}


def build_eyes():
    """One mesh for both eyes. Returns parts whose `shapes` hold the other ways of drawing them."""
    pieces = [('ball', 'ink'), ('big', 'white'), ('small', 'white'), ('lid', 'ink'), ('brow', 'ink')]
    parts = []
    for right in (False, True):
        origin = (-EYE[0], EYE[1]) if right else EYE
        base = eye_points('open', right)
        others = {kind: eye_points(kind, right) for kind in EYE_KINDS[1:] + ['blink']}
        for name, material in pieces:
            shapes = {kind: lay(shape[name], origin, EYE_LIFT, mirror=right) for kind, shape in others.items()}
            parts.append(blob_part(material, lay(base[name], origin, EYE_LIFT, mirror=right), shapes))
    return parts


MOUTH_KINDS = ['w', 'smile', 'open', 'o', 'flat', 'frown', 'wavy', 'chew', 'yawn']
MOUTH_LIFT = 0.002


def mouth_points(kind):
    """Every vertex of the mouth for one way of drawing it: the line, the filled shape, its rim, the tongue."""
    def rel(x, y):
        return ((x - 100.0) * UNIT, (124.0 - y) * UNIT)

    lines = {
        'w': [[rel(90, 120), rel(95, 127.5), rel(100, 120)], [rel(100, 120), rel(105, 127.5), rel(110, 120)]],
        'smile': [[rel(91, 120), rel(100, 130), rel(109, 120)]],
        'flat': [[rel(93, 123), rel(107, 123)]],
        'frown': [[rel(92, 127), rel(100, 119), rel(108, 127)]],
        'wavy': [[rel(90, 124), rel(95, 118.5), rel(100, 124)], [rel(100, 124), rel(105, 129.5), rel(110, 124)]],
    }
    line = blob_points(blob_stroke(sample(lines[kind], 12), 2 * UNIT, LINE_DEPTH)) if kind in lines else blob_gone()

    def filled(grow, depth):
        if kind == 'o':
            return blob_points(blob_outline(4.6 * UNIT + grow, 5.6 * UNIT + grow, depth))
        if kind == 'chew':
            return blob_points(blob_outline(6.6 * UNIT + grow, 5.8 * UNIT + grow, depth))
        if kind == 'chew-shut':        # rig.css: the chewing mouth at its flattest
            return blob_points(blob_outline(6.9 * UNIT + grow, 1.7 * UNIT + grow, depth))
        if kind == 'yawn':
            return blob_points(blob_outline(9 * UNIT + grow, 11.5 * UNIT + grow, depth, rel(100, 127)))
        if kind == 'open':
            # M89 119 Q100 141 111 119 Z: flat on top, round underneath.
            spine, widths, depths = [], [], []
            half, top, drop = 11 * UNIT + grow, 5 * UNIT + grow, 11 * UNIT + 2 * grow
            for i in range(BLOB_ALONG + 1):
                a = math.pi * i / BLOB_ALONG
                u = -math.cos(a)
                tall = drop * (1.0 - u * u)
                spine.append((half * u, top - tall / 2))
                widths.append(tall / 2)
                depths.append(depth * math.sin(a))
            return blob_points((spine, widths, depths))
        return blob_gone()

    fill = filled(0.0, 0.012)
    # The dark rim the 2D rig strokes around a filled mouth: the same shape, a little
    # larger and a little lower, so that it shows all the way round.
    rim = [(x, y, d - 0.006) for x, y, d in filled(1.5 * UNIT, 0.01)]
    if kind == 'open':
        tongue = [(x, y, d + 0.01) for x, y, d in blob_points(blob_outline(5 * UNIT, 3.2 * UNIT, 0.008, rel(100, 128.5)))]
    elif kind == 'yawn':
        tongue = [(x, y, d + 0.01) for x, y, d in blob_points(blob_outline(5.4 * UNIT, 3.6 * UNIT, 0.008, rel(100, 133)))]
    else:
        tongue = blob_gone()
    return {'line': line, 'rim': rim, 'fill': fill, 'tongue': tongue}


def build_mouth():
    pieces = [('line', 'ink'), ('rim', 'ink'), ('fill', 'mouth'), ('tongue', 'tongue')]
    base = mouth_points('w')
    others = {kind: mouth_points(kind) for kind in MOUTH_KINDS[1:] + ['chew-shut']}
    parts = []
    for name, material in pieces:
        shapes = {kind: lay(shape[name], MOUTH, MOUTH_LIFT) for kind, shape in others.items()}
        parts.append(blob_part(material, lay(base[name], MOUTH, MOUTH_LIFT), shapes))
    return parts


def build_cheeks():
    return [disc('cheek', (CHEEK[0] * side, CHEEK[1]), 11.5 * UNIT, 7.5 * UNIT, 0.003, bulge=0.004) for side in (1, -1)]


def ring_stroke(material, centre, radius, half_width, lift, count=40, across=5):
    """A closed ring laid on the body: the rim of a lens."""
    part = Part(material)
    rows = []
    for i in range(count):
        a = 2 * math.pi * i / count
        row = []
        for j in range(across + 1):
            phi = math.pi * j / across
            r = radius + half_width * math.cos(phi)
            x, y = centre[0] + r * math.cos(a), centre[1] + r * math.sin(a)
            row.append(part.add((x, y, body_front(x, y) + lift + half_width * math.sin(phi))))
        rows.append(row)
    for i in range(count):
        for j in range(across):
            part.faces.append((rows[i][j], rows[i][j + 1], rows[(i + 1) % count][j + 1], rows[(i + 1) % count][j]))
    return orient(part, toward=(0, 0, 1))


def build_glasses():
    """Round glasses: lenses of 15.5 around each eye, a bridge, and a glint on each lens."""
    lift = 0.046
    parts = []
    for side in (1, -1):
        centre = (EYE[0] * side, EYE[1])
        parts.append(ring_stroke('ink', centre, 15.5 * UNIT, 1.75 * UNIT, lift))
        parts.append(disc('lens', centre, 15.5 * UNIT, 15.5 * UNIT, lift, rings=3, segments=24))
        # g-glint: M64.5 100 Q66.5 95.5 71 94, on the upper left of each lens.
        dx = centre[0] - EYE[0]
        glint = sample([[(rx(64.5) + dx, ry(100)), (rx(66.5) + dx, ry(95.5)), (rx(71) + dx, ry(94))]])
        parts.append(blob_part('white', lay(blob_points(blob_stroke(glint, 1.2 * UNIT, 0.006)), (0, 0), lift + 0.004)))
    bridge = sample([[rp(89.5, 105), rp(100, 99), rp(110.5, 105)]])
    parts.append(blob_part('ink', lay(blob_points(blob_stroke(bridge, 1.75 * UNIT, 1.75 * UNIT)), (0, 0), lift)))
    return parts


def build_dirt():
    """Grubby marks: three smudges and three scuffs, where the 2D rig has them."""
    parts = []
    for (x, y), (w, h) in (((126, 160), (7.5, 5)), ((60, 149), (6, 4.2)), ((138, 91), (5, 3.6))):
        parts.append(disc('dirt', rp(x, y), w * UNIT, h * UNIT, 0.004, rings=2, segments=12))
    for a, b in (((67, 92), (74, 96)), ((65, 98), (71, 101)), ((142, 138), (148, 135))):
        parts.append(blob_part('dirt', lay(blob_points(blob_stroke(sample([[rp(*a), rp(*b)]], 4), 1.3 * UNIT, 0.003)), (0, 0), 0.004)))
    return parts


def build_drool():
    # dz-drool: a drop hanging from the right corner of the mouth, about 108 to 137.
    spine, widths, depths = [], [], []
    for i in range(BLOB_ALONG + 1):
        a = math.pi * i / BLOB_ALONG
        u = -math.cos(a)
        spine.append((rx(108) + 0.0, ry(131.75) - u * 5.25 * UNIT))
        widths.append(3.1 * UNIT * math.sin(a) * (0.55 + 0.45 * (u + 1) / 2))
        depths.append(0.014 * math.sin(a))
    return [blob_part('drool', lay(blob_points((spine, widths, depths)), (0, 0), 0.004))]


# ---- hats ------------------------------------------------------------------------------

def build_nightcap():
    """A floppy cap with a cream band and a pompom, worn while asleep."""
    parts = []
    around = 28

    def rim(a, grow=0.0):
        # A ring round the crown, higher on the forehead than behind, sitting on the body.
        y = 1.265 + 0.125 * math.sin(a)
        r = body_radius(y) + 0.022 + grow
        return Vector((r * math.cos(a), y, BODY_DEPTH * r * math.sin(a)))

    # The cap rises from the rim to a point that flops over to the right.
    spine = [Vector((rx(x), ry(y), z)) for x, y, z in ((100, 50, -0.06), (106, 30, -0.07), (118, 14, -0.06), (136, 12, -0.04), (152, 24, -0.02), (162, 42, 0.0), (167, 58, 0.01))]
    radii = [0.36, 0.26, 0.17, 0.118, 0.086, 0.066, 0.05]
    cap = Part('cap')
    rows = [[cap.add(rim(2 * math.pi * j / around)) for j in range(around)]]
    steps = 5
    dense = []
    for i in range(len(spine) - 1):
        for k in range(steps):
            t = k / steps
            dense.append((spine[i].lerp(spine[i + 1], t), lerp(radii[i], radii[i + 1], t)))
    dense.append((spine[-1], radii[-1]))
    for i, (point, radius) in enumerate(dense[1:], start=1):
        ahead = (dense[min(len(dense) - 1, i + 1)][0] - dense[i - 1][0]).normalized()
        side = ahead.cross(Vector((0, 0, 1))).normalized()
        front = side.cross(ahead).normalized()
        # Over the first stretch the cap eases from the rim, which follows the head, into a round cone.
        ease = smoothstep(0.0, 1.0, min(1.0, i / steps))
        row = []
        for j in range(around):
            a = 2 * math.pi * j / around
            circle = point + (side * math.cos(a) + front * math.sin(a)) * radius
            row.append(cap.add(rim(a).lerp(circle, ease)))
        rows.append(row)
    cap.grid(rows, wrap=True)
    tip = cap.add(dense[-1][0])
    for j in range(around):
        cap.faces.append((tip, rows[-1][j], rows[-1][(j + 1) % around]))
    # A closed piece is needed to tell inside from outside: close the rim for the test only.
    test = Part('cap')
    test.verts = cap.verts + [(0.0, 1.2, 0.0)]
    test.faces = cap.faces + [(len(cap.verts), rows[0][(j + 1) % around], rows[0][j]) for j in range(around)]
    if face_normal_sum(test.verts, test.faces) < 0:
        cap.faces = [tuple(reversed(face)) for face in cap.faces]
    parts.append(cap)

    # The band: a soft roll around the rim.
    band = Part('cap-trim')
    rows = []
    for j in range(around):
        a = 2 * math.pi * j / around
        centre = rim(a, 0.012)
        out = Vector((math.cos(a), 0.0, math.sin(a)))
        up = Vector((0.0, 1.0, 0.0))
        rows.append([band.add(centre + (out * math.cos(2 * math.pi * k / 8) + up * math.sin(2 * math.pi * k / 8)) * 0.058) for k in range(8)])
    for j in range(around):
        for k in range(8):
            band.faces.append((rows[j][k], rows[j][(k + 1) % 8], rows[(j + 1) % around][(k + 1) % 8], rows[(j + 1) % around][k]))
    parts.append(orient(band))

    parts.append(ellipsoid('cap-trim', (rx(168), ry(66), 0.02), (0.095, 0.095, 0.095), segments=14, rings=10))
    # Two little stars on the front of the cap, as the 2D rig has.
    skin = BVHTree.FromPolygons([Vector(v) for v in cap.verts], [list(face) for face in cap.faces])

    def cap_front(x, y):
        hit = skin.ray_cast(Vector((x, y, 4.0)), Vector((0.0, 0.0, -1.0)))[0]
        return hit.z if hit else 0.0

    for (x, y), size in (((104, 27), 0.05), ((131, 27), 0.036)):
        star = Part('cap-star')
        points = [(rx(x), ry(y))]
        for k in range(8):
            reach = size if k % 2 == 0 else size * 0.42
            points.append((rx(x) + reach * math.cos(math.pi * k / 4 + math.pi / 2), ry(y) + reach * math.sin(math.pi * k / 4 + math.pi / 2)))
        for px, py in points:
            star.add((px, py, cap_front(px, py) + 0.008))
        for k in range(8):
            star.faces.append((0, 1 + k, 1 + (k + 1) % 8))
        parts.append(orient(star, toward=(0, 0, 1)))
    return parts


def build_bow():
    """A small bow at the foot of the left ear: translate(69 47) rotate(-24) in the 2D rig."""
    parts = []
    centre = Vector((rx(69), ry(47), 0.09))
    turn = Matrix.Rotation(math.radians(24), 4, 'Z')

    def put(part):
        part.verts = [tuple(centre + turn @ Vector(v)) for v in part.verts]
        return part

    for side in (-1, 1):
        # Each loop: wide and round at the outside, pinched at the knot.
        loop = Part('bow')
        rows = []
        length = 0.24
        for i in range(9):
            t = i / 8
            x = side * (0.02 + length * t)
            half_h = 0.03 + 0.105 * math.sin(math.pi * min(1.0, t * 1.15) * 0.5) * (1.0 - 0.35 * t * t)
            half_d = 0.02 + 0.045 * math.sin(math.pi * t)
            rows.append([loop.add((x, half_h * math.sin(2 * math.pi * k / 10), half_d * math.cos(2 * math.pi * k / 10))) for k in range(10)])
        loop.grid(rows, wrap=True)
        a, b = loop.add((side * 0.02, 0, 0)), loop.add((side * (0.02 + length + 0.012), 0, 0))
        for k in range(10):
            loop.faces.append((a, rows[0][(k + 1) % 10], rows[0][k]))
            loop.faces.append((b, rows[-1][k], rows[-1][(k + 1) % 10]))
        parts.append(put(orient(loop)))
    parts.append(put(ellipsoid('bow-knot', (0, 0, 0.01), (0.055, 0.065, 0.055), segments=12, rings=8)))
    return parts


# ---- palettes and materials ------------------------------------------------------------

def read_palettes():
    """The five palettes, from the file the 2D rig reads them from."""
    text = open(PALETTES_TS, encoding='utf-8').read()
    palettes = {}
    for name, body in re.findall(r"^\s*(\w+):\s*\{([^}]*)\},?\s*$", text, flags=re.M):
        colours = dict(re.findall(r"(\w+):\s*'(#[0-9A-Fa-f]{6})'", body))
        if {'body', 'shade', 'belly', 'cheek', 'ear', 'ink'} <= set(colours):
            palettes[name] = colours
    if len(palettes) != 5:
        raise SystemExit('expected five palettes in %s, found %s' % (PALETTES_TS, sorted(palettes)))
    return palettes


def linear(hex_colour):
    def channel(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    h = hex_colour.lstrip('#')
    return tuple(channel(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


# name: palette colour or a fixed colour, then how it is shaded.
MATERIALS = {
    'body':     {'palette': 'body', 'plush': True, 'vertex_colour': True},
    'skin':     {'palette': 'body', 'plush': True},
    'shade':    {'palette': 'shade', 'plush': True},
    'ear':      {'palette': 'ear', 'roughness': 0.85},
    'cheek':    {'palette': 'cheek', 'alpha': 0.62, 'roughness': 1.0},
    'ink':      {'palette': 'ink', 'roughness': 0.28},
    'white':    {'colour': '#FFFFFF', 'roughness': 0.4, 'glow': 1.0},
    'mouth':    {'colour': '#7A2E3A', 'roughness': 0.7},
    'tongue':   {'colour': '#FF8FA3', 'roughness': 0.6},
    'lens':     {'colour': '#FFFFFF', 'alpha': 0.26, 'roughness': 0.15},
    'drool':    {'colour': '#BFE8FF', 'roughness': 0.15},
    'dirt':     {'colour': '#7A5C3E', 'alpha': 0.5, 'roughness': 1.0},
    'cap':      {'colour': '#7684E0', 'plush': True},
    'cap-trim': {'colour': '#FFF8EC', 'plush': True},
    'cap-star': {'colour': '#FFE08A', 'roughness': 0.6},
    'bow':      {'colour': '#FF7A9E', 'plush': True},
    'bow-knot': {'colour': '#F2557F', 'plush': True},
}


def make_materials(palette):
    materials = {}
    for name, spec in MATERIALS.items():
        material = bpy.data.materials.new(name)
        if not material.node_tree:
            material.use_nodes = True
        shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
        colour = palette[spec['palette']] if 'palette' in spec else spec['colour']
        rgb = linear(colour)
        shader.inputs['Base Color'].default_value = (*rgb, 1.0)
        shader.inputs['Roughness'].default_value = spec.get('roughness', 0.82)
        if spec.get('plush'):
            # A soft toy: rough, with a pale fuzz at grazing angles.
            shader.inputs['Sheen Weight'].default_value = 1.0
            shader.inputs['Sheen Roughness'].default_value = 0.5
            shader.inputs['Sheen Tint'].default_value = (1.0, 1.0, 1.0, 1.0)
        if 'glow' in spec:
            shader.inputs['Emission Color'].default_value = (*rgb, 1.0)
            shader.inputs['Emission Strength'].default_value = spec['glow']
        if 'alpha' in spec:
            shader.inputs['Alpha'].default_value = spec['alpha']
            material.surface_render_method = 'BLENDED'
        if spec.get('vertex_colour'):
            # The body's colour comes from its vertices (body and belly mixed by `_BELLY`),
            # so the base colour is white.
            shader.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
            attribute = material.node_tree.nodes.new('ShaderNodeVertexColor')
            attribute.layer_name = 'Col'
            material.node_tree.links.new(attribute.outputs['Color'], shader.inputs['Base Color'])
            material['belly'] = 'belly'
        if 'palette' in spec:
            material['palette'] = spec['palette']
        material.diffuse_color = (*rgb, spec.get('alpha', 1.0))
        materials[name] = material
    return materials


# ---- into Blender ----------------------------------------------------------------------

def make_object(name, parts, materials, palette):
    """One mesh object from a list of parts."""
    verts, faces, face_materials = [], [], []
    used = []
    for part in parts:
        if part.material not in used:
            used.append(part.material)
    offsets = []
    for part in parts:
        offsets.append(len(verts))
        verts.extend(to_blender(v) for v in part.verts)
        for face in part.faces:
            faces.append(tuple(offsets[-1] + i for i in face))
            face_materials.append(used.index(part.material))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    for material in used:
        mesh.materials.append(materials[material])
    mesh.polygons.foreach_set('material_index', face_materials)
    mesh.polygons.foreach_set('use_smooth', [True] * len(faces))
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    shape_names = []
    for part in parts:
        for shape in part.shapes:
            if shape not in shape_names:
                shape_names.append(shape)
    if shape_names:
        obj.shape_key_add(name='Basis', from_mix=False)
        for shape in shape_names:
            key = obj.shape_key_add(name=shape, from_mix=False)
            for part, offset in zip(parts, offsets):
                for i, v in enumerate(part.shapes.get(shape, part.verts)):
                    key.data[offset + i].co = to_blender(v)
            key.value = 0.0

    if any(part.weights for part in parts):
        groups = {}
        for part, offset in zip(parts, offsets):
            for i, weights in enumerate(part.weights or []):
                for bone, weight in weights.items():
                    if weight <= 0:
                        continue
                    if bone not in groups:
                        groups[bone] = obj.vertex_groups.new(name=bone)
                    groups[bone].add([offset + i], weight, 'REPLACE')

    if any(part.belly for part in parts):
        mesh.attributes.new(name='_BELLY', type='FLOAT', domain='POINT')
        mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
        # Adding an attribute can move the others: look both up again before writing.
        mask, colours = mesh.attributes['_BELLY'], mesh.color_attributes['Col']
        body, belly = linear(palette['body']), linear(palette['belly'])
        for part, offset in zip(parts, offsets):
            for i in range(len(part.verts)):
                k = part.belly[i] if part.belly else 0.0
                mask.data[offset + i].value = k
                # Parts of this mesh that are not the body take their colour from their own
                # material; white leaves that colour alone.
                colours.data[offset + i].color = (*(lerp(a, b, k) for a, b in zip(body, belly)), 1.0) if part.belly else (1.0, 1.0, 1.0, 1.0)
    return obj


def make_armature():
    data = bpy.data.armatures.new('Doozer')
    armature = bpy.data.objects.new('Doozer', data)
    bpy.context.scene.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='EDIT')
    made = {}
    for name, (parent, head) in BONES.items():
        bone = data.edit_bones.new(name)
        bone.head = to_blender(head)
        bone.tail = to_blender((head[0], head[1] + 0.16, head[2]))
        # Straight up, with the bone's own z toward the viewer: the model's axes.
        bone.align_roll((0.0, -1.0, 0.0))
        bone.use_connect = False
        if parent:
            bone.parent = made[parent]
        made[name] = bone
    bpy.ops.object.mode_set(mode='OBJECT')
    expected = Matrix.Rotation(math.radians(90), 3, 'X')
    for bone in data.bones:
        drift = max(abs(a - b) for row_a, row_b in zip(bone.matrix_local.to_3x3(), expected) for a, b in zip(row_a, row_b))
        if drift > 1e-5:
            raise SystemExit('bone %s is not upright (off by %g)' % (bone.name, drift))
    return armature


def skin_to(obj, armature):
    obj.parent = armature
    modifier = obj.modifiers.new('Armature', 'ARMATURE')
    modifier.object = armature


def hang_on(obj, armature, bone):
    """Fix an object to one bone, leaving it where it was built."""
    obj.parent = armature
    obj.parent_type = 'BONE'
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = Matrix.Identity(4)
    bpy.context.view_layer.update()


def build(palettes, palette_name):
    palette = palettes[palette_name]
    materials = make_materials(palette)
    armature = make_armature()
    armature['palettes'] = palettes
    armature['palette'] = palette_name
    armature['eyes'] = EYE_KINDS
    armature['mouths'] = MOUTH_KINDS
    armature['hatAnchor'] = [HAT_ANCHOR[0], HAT_ANCHOR[1], 0.0]

    # Two skinned meshes on the one armature: the body, which carries the belly mask and
    # its vertex colours, and everything that grows out of it.
    parts = build_body_parts()
    body = make_object('doozer-body', [part for part in parts if part.material == 'body'], materials, palette)
    limbs = make_object('doozer-limbs', [part for part in parts if part.material != 'body'], materials, palette)
    skin_to(body, armature)
    skin_to(limbs, armature)

    on_body = {
        'eyes': build_eyes(),
        'mouth': build_mouth(),
        'cheeks': build_cheeks(),
        'glasses': build_glasses(),
        'dirt': build_dirt(),
        'drool': build_drool(),
        'hat-nightcap': build_nightcap(),
    }
    objects = {'body': body, 'limbs': limbs}
    for name, parts in on_body.items():
        objects[name] = make_object(name, parts, materials, palette)
        hang_on(objects[name], armature, 'body')
    objects['hat-bow'] = make_object('hat-bow', build_bow(), materials, palette)
    hang_on(objects['hat-bow'], armature, 'earL')
    return armature, objects


def export(path):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_def_bones=False,
        export_morph=True,
        export_morph_normal=True,
        export_morph_tangent=False,
        export_animations=False,
        export_extras=True,
        export_attributes=True,
        export_vertex_color='MATERIAL',
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_texcoords=False,
        export_tangents=False,
        use_selection=False,
    )


# ---- stills, for checking the model by eye ---------------------------------------------

def render_previews(folder, objects, armature):
    os.makedirs(folder, exist_ok=True)
    scene = bpy.context.scene
    camera_data = bpy.data.cameras.new('preview')
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 2.0
    camera = bpy.data.objects.new('preview', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    for name, energy, rotation in (('key', 3.0, (50, 0, 30)), ('fill', 1.2, (70, 0, -60))):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        light.data.energy = energy
        light.rotation_euler = [math.radians(a) for a in rotation]
        scene.collection.objects.link(light)
    world = bpy.data.worlds.new('preview')
    scene.world = world
    if not world.node_tree:
        world.use_nodes = True
    background = next(node for node in world.node_tree.nodes if node.type == 'BACKGROUND')
    background.inputs['Color'].default_value = (0.9, 0.88, 0.86, 1.0)
    background.inputs['Strength'].default_value = 0.7
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'BLENDER_WORKBENCH'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = scene.render.resolution_y = 560
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'

    def shot(name, location, rotation):
        camera.location = location
        camera.rotation_euler = [math.radians(a) for a in rotation]
        scene.render.filepath = os.path.join(folder, name + '.png')
        bpy.ops.render.render(write_still=True)

    def face(eyes, mouth):
        for obj, want in ((objects['eyes'], eyes), (objects['mouth'], mouth)):
            for key in obj.data.shape_keys.key_blocks[1:]:
                key.value = 1.0 if key.name == want else 0.0

    extras = ('glasses', 'dirt', 'drool', 'hat-nightcap', 'hat-bow')
    for name in extras:
        objects[name].hide_render = True
    front = ((0, -6, 0.78), (90, 0, 0))
    shot('front-content', *front)
    shot('three-quarter', (3.4, -5.0, 1.9), (79, 0, 34))
    shot('side', (6, 0, 0.78), (90, 0, 90))
    shot('back', (0, 6, 0.78), (90, 0, 180))
    for label, eyes, mouth in (('joyful', 'happy', 'open'), ('hungry', 'sad', 'o'), ('bored', 'half', 'flat'), ('sleepy', 'heavy', 'o'),
                               ('asleep', 'closed', 'smile'), ('wow', 'wide', 'o'), ('no', 'squeeze', 'wavy'), ('yawn', 'squeeze', 'yawn'),
                               ('eat', 'happy', 'chew'), ('focus', 'calm', 'smile'), ('meh', 'open', 'flat'), ('blink', 'blink', 'w')):
        face(eyes, mouth)
        objects['glasses'].hide_render = label != 'focus'
        objects['drool'].hide_render = label != 'hungry'
        objects['hat-nightcap'].hide_render = label != 'asleep'
        shot('face-' + label, *front)
    face('open', 'w')
    for name in extras:
        objects[name].hide_render = name not in ('hat-bow', 'dirt')
    shot('bow-and-dirt', *front)
    for name in extras:
        objects[name].hide_render = name != 'hat-nightcap'
    shot('nightcap-three-quarter', (3.4, -5.0, 1.9), (79, 0, 34))
    for name in extras:
        objects[name].hide_render = False


def main():
    options = read_options()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    palettes = read_palettes()
    if options['palette'] not in palettes:
        raise SystemExit('no palette called ' + options['palette'])
    # The file always carries Peach, the default; --palette only changes the stills.
    armature, objects = build(palettes, 'peach' if not options['preview'] else options['palette'])
    if options['preview']:
        render_previews(options['preview'], objects, armature)
        if options['palette'] != 'peach':
            print('doozer: stills only (the model file is always exported in Peach)')
            return
    export(options['out'])
    size = os.path.getsize(options['out'])
    triangles = sum(sum(len(p.vertices) - 2 for p in obj.data.polygons) for obj in objects.values())
    print('doozer: wrote %s (%d bytes, %d triangles, %d bones)' % (options['out'], size, triangles, len(BONES)))


main()
