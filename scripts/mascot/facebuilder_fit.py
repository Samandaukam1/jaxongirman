"""Headless FaceBuilder reconstruction of Jaxongir's head.

    blender -b -P facebuilder_fit.py -- [--probe] [--out DIR] [--rigidity F]

KeenTools FaceBuilder is normally driven by dragging pins in the viewport, but
pykeentools exposes the whole thing as a Python API, including the face
detector that places the preset pins:

    fb.detect_faces(rgba, pixel_aspect_ratio)   -> face rectangles
    fb.detect_face_pose(keyframe, rectangle)    -> preset pins + camera pose
    fb.solve_for_current_pins(keyframe)         -> fit the head to those pins

so the fit runs in background mode with no GUI. The same API then projects the
reference photographs onto the fitted UVs to bake the skin texture, which is
where the identity actually lands.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np

import bkit

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
# Two reference sets: the original transparent crops, and the tiles split from
# the later contact sheets. Both are searched by name.
VIEW_DIRS = [os.path.join(REPO, "docs", "mascot", "reference", "views"),
             os.path.join(REPO, "docs", "mascot", "reference", "views2")]


def view_path(name):
    for folder in VIEW_DIRS:
        candidate = os.path.join(folder, f"{name}.png")
        if os.path.exists(candidate):
            return candidate
    return None

# Views worth giving FaceBuilder, frontal first because the detector is most
# reliable there and the rest solve against the shape it establishes. `down` is
# excluded: eyes closed and an extreme angle make it a liability.
VIEWS = [
    # Original set, transparent background
    "front", "quarter_a", "quarter_b", "profile", "up",
    # Multi-view sheet
    "m_front", "m_q_left", "m_profile", "m_q_right", "m_up",
    # Hair/head sheet
    "h_front", "h_q_left", "h_profile", "h_q_right", "h_up",
    "h_q_left2", "h_q_right2",
    # Pose-only: eyes closed or no face at all, so they cover pixels the other
    # views never see but must not pull on the shape.
    "down", "m_down", "h_down_a", "h_down_b", "h_back",
]

TEXTURE_ONLY = {"down", "m_down", "h_down_a", "h_down_b", "h_back"}

# The projector is given a curated subset rather than every solved view.
# Feeding it all twenty-one deadlocks the bake, and the extra frames add no
# coverage: these eight already see the whole face plus the crown.
TEXTURE_VIEWS = {"front", "quarter_a", "quarter_b", "profile", "up",
                 "down", "m_down", "h_down_a"}

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PROBE = "--probe" in argv
OUT_DIR = os.path.join(REPO, "output")
if "--out" in argv:
    OUT_DIR = argv[argv.index("--out") + 1]
RIGIDITY = float(argv[argv.index("--rigidity") + 1]) if "--rigidity" in argv else None
# Measured, not guessed: solving straight at 0.08 lands in a narrower local
# minimum, and carrying on below 0.08 narrows the face again. This ladder gave
# the closest match to the reference silhouettes on front and profile together.
DEFAULT_SCHEDULE = [1.0, 0.4, 0.15, 0.08]
SCHEDULE = ([float(v) for v in argv[argv.index("--schedule") + 1].split(",")]
            if "--schedule" in argv else DEFAULT_SCHEDULE)
TEX_SIZE = int(argv[argv.index("--tex") + 1]) if "--tex" in argv else 2048
SKIP_TEX = "--no-tex" in argv
SHARED_FOCAL = "--shared-focal" in argv


def log(tag, *rest):
    print(f"[{tag:6s}]", *rest, flush=True)


# ----------------------------------------------------------------- core gate

def require_core():
    try:
        from keentools.blender_independent_packages import pykeentools_loader as loader
    except Exception as error:
        raise SystemExit(f"KeenTools addon not importable: {error}")
    if not loader.is_installed():
        raise SystemExit(
            "KeenTools Core is not installed.\n"
            "Blender > Edit > Preferences > Add-ons > KeenTools:\n"
            "  tick the EULA checkbox, then press 'Install online'.")
    return loader


# ---------------------------------------------------------------- image load

def load_rgba(path):
    """Float32 (h, w, 4) exactly the way the addon feeds detector and baker."""
    image = bpy.data.images.load(path)
    w, h = image.size[:2]
    buffer = np.empty((h, w, image.channels), dtype=np.float32)
    image.pixels.foreach_get(buffer.ravel())
    if image.channels == 3:
        buffer = np.dstack([buffer, np.ones((h, w, 1), dtype=np.float32)])
    bpy.data.images.remove(image)
    return buffer


class CameraInput:
    """Per-view sizes and focal lengths, feeding FaceBuilder its projections.

    The focal has to be fed *back*: FaceBuilder estimates one per keyframe while
    solving, and if this callback keeps returning the initial guess instead, the
    solver is fighting a camera that does not match its own estimate and pays
    for it by deforming the skull. `proj_mat` works in pixels - fx comes out as
    `fl_to_haperture * width` - so the estimate converts straight back.
    """

    def __init__(self, pkt, sizes, focal_mm=50.0, sensor_mm=36.0):
        self.pkt = pkt
        self.sizes = sizes
        self.focal_px = [focal_mm / sensor_mm * float(w) for w, _ in sizes]

    def matrix(self, keyframe):
        w, h = self.sizes[keyframe]
        return self.pkt.math.proj_mat(
            fl_to_haperture=self.focal_px[keyframe] / float(w),
            w=float(w), h=float(h), pixel_aspect_ratio=1.0, near=0.1, far=1000.0)

    def sync_focals(self, fb, keyframes):
        """Adopt one shared focal for every view.

        All six references are crops of a single reference sheet at 1:1, and
        cropping does not change focal length in pixels - so one number has to
        explain every view. Taking the median of the plausible estimates is far
        better conditioned than letting each view invent its own lens, which is
        how a solve ends up explaining a wrong skull with a wrong camera.
        """
        estimates = []
        for keyframe in keyframes:
            try:
                estimate = float(fb.focal_length_at(keyframe))
            except Exception:
                continue
            width = float(self.sizes[keyframe][0])
            if not (0.4 * width <= estimate <= 12.0 * width):
                continue
            estimates.append(estimate)
            if not SHARED_FOCAL:
                self.focal_px[keyframe] = estimate
        if not estimates:
            return None
        if SHARED_FOCAL:
            shared = float(np.median(estimates))
            for keyframe in range(len(self.focal_px)):
                self.focal_px[keyframe] = shared
            return shared
        return float(np.median(estimates))

    def build(self):
        outer = self

        class Input(outer.pkt.FaceBuilderCameraInputI):
            def projection(self, keyframe):
                return outer.matrix(keyframe)

            def view(self, keyframe):
                return np.eye(4)

            def image_size(self, keyframe):
                return outer.sizes[keyframe]

        return Input()


# --------------------------------------------------------------------- probe

def probe(loader):
    pkt = loader.module()
    print("\n=== top-level names ===")
    print(", ".join(sorted(n for n in dir(pkt) if not n.startswith("_"))))
    cam = CameraInput(pkt, [(1024, 1024)])
    fb = pkt.FaceBuilder(cam.build())
    print("\n=== FaceBuilder methods ===")
    print(", ".join(sorted(n for n in dir(fb) if not n.startswith("_"))))
    print("\nmodels:", [(m.name, m.level_of_detail) for m in fb.models_list()])
    print("uv sets:", fb.uv_sets_list())
    print("detector:", fb.is_face_detector_available())
    for index in range(len(fb.models_list())):
        fb.select_model(index)
        count = fb.applied_args_model().mesh(0).points_count()
        print(f"  model {index}: {count} verts, FACS={pkt.FacsExecutor.facs_available(count)}")


# ----------------------------------------------------------------------- fit

def rect_area(rect):
    for attr in (("x1", "y1", "x2", "y2"), ("left", "top", "right", "bottom")):
        if all(hasattr(rect, a) for a in attr):
            a, b, c, d = (getattr(rect, x) for x in attr)
            return abs((c - a) * (d - b))
    return 0.0


def fit(loader):
    pkt = loader.module()

    images, sizes = [], []
    for name in VIEWS:
        path = view_path(name)
        if path is None:
            raise SystemExit(f"missing reference view: {name}")
        rgba = load_rgba(path)
        images.append(rgba)
        sizes.append((rgba.shape[1], rgba.shape[0]))
        log("view", f"{name}: {rgba.shape[1]}x{rgba.shape[0]}")

    cam = CameraInput(pkt, sizes)
    fb = pkt.FaceBuilder(cam.build())
    fb.select_model(0)                       # high poly: the detail carries the likeness
    fb.select_uv_set(0)                      # butterfly, KeenTools' baking layout
    fb.set_use_emotions(False)               # a neutral identity head, not a captured expression
    # The views now come from several sheets at different pixel scales, so a
    # single shared focal can no longer explain all of them; each view gets its
    # own, seeded at a plausible portrait value and fed back after each solve.
    if SHARED_FOCAL:
        seed = 2.2 * float(np.median([w for w, _ in sizes]))
        cam.focal_px = [seed] * len(sizes)
        fb.set_static_focal_length_estimation(seed)
    else:
        cam.focal_px = [2.2 * float(w) for w, _ in sizes]
        fb.set_varying_focal_length_estimation()

    if RIGIDITY is not None:
        fb.set_shape_rigidity(RIGIDITY)
    log("setup", f"model=high uv=butterfly rigidity={fb.shape_rigidity():.4f} "
                 f"(min {fb.min_rigidity():.4f} max {fb.max_rigidity():.4f})")

    if not fb.is_face_detector_available():
        raise SystemExit("Core has no face detector")

    placed, shape = [], []
    for keyframe, (name, rgba) in enumerate(zip(VIEWS, images)):
        # The keyframe has to exist before the detector may pose it; this is
        # what the addon does when a camera is added to a head.
        fb.set_centered_geo_keyframe(keyframe)
        try:
            par = fb.pixel_aspect_ratio(keyframe)
            rects = fb.detect_faces(rgba, par)
        except Exception as error:
            log("fit", f"{name}: detect_faces failed: {error}")
            continue
        if not rects:
            log("fit", f"{name}: no face detected")
            continue
        rect = max(rects, key=rect_area)
        try:
            ok = fb.detect_face_pose(keyframe, rect)
        except Exception as error:
            log("fit", f"{name}: detect_face_pose raised: {error}")
            continue
        if not ok:
            log("fit", f"{name}: pose estimation failed")
            continue
        placed.append(keyframe)
        if name in TEXTURE_ONLY:
            # Pose only: enough to project pixels, no pins to pull the shape.
            log("fit", f"{name}: pose only (texture coverage)")
            continue
        # detect_face_pose only sets the camera pose; the preset pins that
        # actually drive the shape come from this pair, as in the addon.
        fb.remove_pins(keyframe)
        fb.add_preset_pins_and_solve(keyframe)
        shape.append(keyframe)
        log("fit", f"{name}: {fb.pins_count(keyframe)} pins, "
                   f"focal {fb.focal_length_at(keyframe):.1f}")

    if not shape:
        raise SystemExit("no view produced pins; cannot fit")

    # Coarse to fine. Solving straight at the final rigidity drops the shape
    # into whichever local minimum the template sits next to; loosening in
    # stages lets the large proportions settle before detail is free to move.
    # Each keyframe's solve moves the shared identity, so every stage revisits
    # all of them.
    ladder = SCHEDULE or [RIGIDITY if RIGIDITY is not None else 1.0]
    for step, rigidity in enumerate(ladder):
        fb.set_shape_rigidity(rigidity)
        for _ in range(4):
            for keyframe in shape:
                try:
                    fb.solve_for_current_pins(keyframe)
                except Exception as error:
                    log("solve", f"kf {keyframe}: {error}")
            cam.sync_focals(fb, shape)
        log("solve", f"stage {step + 1}/{len(ladder)} rigidity {rigidity:g} "
                     f"focal {cam.focal_px[shape[0]]:.0f}")

    # No center_geo here: it moves the geometry after the solve, which would
    # invalidate the model matrices the matched-camera comparison relies on.
    return fb, images, placed, cam


# -------------------------------------------------------------------- output

def geo_to_blender(fb, name="JaxongirHead"):
    mesh_source = fb.applied_args_model().mesh(0)
    n_points = mesh_source.points_count()
    n_faces = mesh_source.faces_count()
    verts = [tuple(mesh_source.point(i)) for i in range(n_points)]
    faces, loops = [], []
    for f in range(n_faces):
        size = mesh_source.face_size(f)
        faces.append(tuple(mesh_source.face_point(f, v) for v in range(size)))
        loops.append(size)

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    n_uvs = mesh_source.uvs_count()
    log("mesh", f"{n_points} verts, {n_faces} faces, {n_uvs} uvs")
    if n_uvs:
        layer = mesh.uv_layers.new(name="UVMap")
        flat = np.empty(len(mesh.loops) * 2, dtype=np.float32)
        if n_uvs == n_points:
            # per-vertex UVs: follow each loop back to its vertex
            for loop in mesh.loops:
                u, v = mesh_source.uv(loop.vertex_index)[:2]
                flat[loop.index * 2] = u
                flat[loop.index * 2 + 1] = v
        else:
            # per-corner UVs, laid out in face order like the faces themselves
            corner = 0
            for f in range(n_faces):
                for v in range(mesh_source.face_size(f)):
                    u, vv = mesh_source.uv(corner)[:2]
                    flat[corner * 2] = u
                    flat[corner * 2 + 1] = vv
                    corner += 1
        layer.uv.foreach_set("vector", flat)

    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    # KeenTools works Y-up with the face down +Z; Blender is Z-up with the
    # front view looking along +Y. One rotation about X reconciles both, and
    # baking it in keeps every downstream script free of the correction.
    obj.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    obj.select_set(False)
    return obj


# Blender is Z-up, KeenTools is Y-up; right-multiplied because the addon's own
# helpers are, and the blendshape vertices come back in KeenTools space.
XZ_TO_XY = np.array([[1., 0., 0.], [0., 0., -1.], [0., 1., 0.]], dtype=np.float32)
XY_TO_XZ = np.array([[1., 0., 0.], [0., 0., 1.], [0., -1., 0.]], dtype=np.float32)

# The runtime drives five morphs; KeenTools ships the 51 ARKit shapes, so each
# app morph is a sum of the FACS shapes that make it up. Keeping only five in
# the export matters: 51 targets over 18k vertices would dwarf the mesh itself.
APP_MORPHS = {
    "BlinkL": ["eyeBlinkLeft"],
    "BlinkR": ["eyeBlinkRight"],
    "Smile": ["mouthSmileLeft", "mouthSmileRight", "cheekSquintLeft", "cheekSquintRight"],
    "BrowRaise": ["browInnerUp", "browOuterUpLeft", "browOuterUpRight"],
    "MouthOpen": ["jawOpen"],
}


def add_blendshapes(pkt, obj, scale, keep_all=False):
    """Derive the app's morph targets from KeenTools' fitted FACS rig."""
    count = len(obj.data.vertices)
    base = np.empty(count * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", base)
    base = base.reshape(count, 3)
    kt_base = np.ascontiguousarray(base @ XZ_TO_XY, dtype=np.float32)

    try:
        executor = pkt.FacsExecutor(kt_base, float(scale))
    except Exception as error:
        log("facs", f"FacsExecutor failed: {error}")
        return 0
    if not executor.facs_enabled():
        log("facs", "FACS not enabled for this topology")
        return 0

    names = list(executor.facs_names)
    index = {name: i for i, name in enumerate(names)}
    obj.shape_key_add(name="Basis", from_mix=False)

    wanted = {n: [n] for n in names} if keep_all else APP_MORPHS
    made = 0
    for app_name, sources in wanted.items():
        missing = [s for s in sources if s not in index]
        if missing:
            log("facs", f"{app_name}: missing {missing}")
            continue
        target = kt_base.copy()
        for source in sources:
            target += executor.get_facs_blendshape(index[source]).reshape(count, 3) - kt_base
        key = obj.shape_key_add(name=app_name, from_mix=False)
        key.data.foreach_set("co", np.ascontiguousarray(target @ XY_TO_XZ, dtype=np.float32).ravel())
        key.value = 0.0
        made += 1
    log("facs", f"{made} morph targets from {len(names)} FACS shapes")
    return made


def bake_texture(loader, fb, images, placed, cam, size):
    pkt = loader.module()

    def frame_data_loader(index):
        keyframe = placed[index]
        data = pkt.texture_builder.FrameData()
        data.geo = fb.applied_args_model_at(keyframe)
        data.image = images[keyframe]
        data.model = fb.model_mat(keyframe)
        data.view = np.eye(4)
        data.projection = cam.matrix(keyframe)
        return data

    class Progress(pkt.ProgressCallback):
        def set_progress_and_check_abort(self, progress):
            return False

    log("tex", f"baking {size}x{size} from {len(placed)} views")
    built = pkt.texture_builder.build_texture(
        len(placed), frame_data_loader, Progress(),
        size, size,
        pkt.texture_builder.default_face_angles_affection(),
        2.0,   # wider UV bleed: the reference set leaves real gaps to cover
        pkt.texture_builder.default_back_face_culling(),
        # The five references were lit separately, so equalising is not
        # cosmetic here - without it the seams between views are visible.
        True, True, True)
    return built


def save_texture(array, path):
    h, w = array.shape[:2]
    image = bpy.data.images.new("HeadAlbedo", w, h, alpha=False)
    rgba = array
    if rgba.shape[2] == 3:
        rgba = np.dstack([rgba, np.ones((h, w, 1), dtype=np.float32)])
    image.pixels.foreach_set(np.ascontiguousarray(rgba, dtype=np.float32).ravel())
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    # Pack it too: the .blend gets opened by other scripts from other working
    # directories, and an unpacked reference turns the head magenta.
    image.filepath = path
    image.pack()
    log("tex", "wrote", path)
    return image


def apply_material(obj, image):
    material = bpy.data.materials.new("JaxongirSkin")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    tex = material.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = image
    material.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.52
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.45
    obj.data.materials.append(material)
    return material


def main():
    loader = require_core()
    if PROBE:
        probe(loader)
        return

    os.makedirs(OUT_DIR, exist_ok=True)
    bkit.reset_scene()   # drop Blender's startup cube, camera and light
    fb, images, placed, cam = fit(loader)
    obj = geo_to_blender(fb)
    log("out", "head dimensions:", [round(v, 4) for v in obj.dimensions])
    add_blendshapes(loader.module(), obj, fb.current_scale(), keep_all="--all-facs" in argv)

    # The solved cameras are what make validation rigorous: rendering through
    # them puts the model in the same frame as the photograph it was fitted to.
    cameras = []
    for keyframe in placed:
        cameras.append({
            "name": VIEWS[keyframe],
            "keyframe": keyframe,
            "width": cam.sizes[keyframe][0],
            "height": cam.sizes[keyframe][1],
            "focal_px": float(fb.focal_length_at(keyframe)),
            "model_mat": np.asarray(fb.model_mat(keyframe), dtype=float).tolist(),
        })
    with open(os.path.join(OUT_DIR, "cameras.json"), "w") as handle:
        json.dump(cameras, handle, indent=1)
    log("out", "wrote cameras.json")

    state = os.path.join(OUT_DIR, "facebuilder_state.bin")
    with open(state, "wb") as handle:
        handle.write(fb.serialize().encode() if isinstance(fb.serialize(), str) else fb.serialize())
    log("out", "wrote", state)

    bake_frames = [k for k in placed if VIEWS[k] in TEXTURE_VIEWS]
    if SKIP_TEX:
        bake_frames = []
    try:
        if not bake_frames:
            raise RuntimeError("texture bake skipped")
        array = bake_texture(loader, fb, images, bake_frames, cam, TEX_SIZE)
        image = save_texture(np.asarray(array), os.path.join(OUT_DIR, "head_albedo.png"))
        apply_material(obj, image)
    except Exception as error:
        log("tex", f"texture bake failed: {error}")

    blend = os.path.join(OUT_DIR, "likeness_fit.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    log("out", "wrote", blend)


if __name__ == "__main__":
    main()
