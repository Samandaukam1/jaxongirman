import {
  ACESFilmicToneMapping, AmbientLight, AnimationMixer, Box3, DirectionalLight,
  Group, LoopOnce, LoopRepeat, Mesh, MeshStandardMaterial, PCFShadowMap,
  PerspectiveCamera, PlaneGeometry, PMREMGenerator, Quaternion, Scene, ShadowMaterial,
  SkinnedMesh, Vector3, WebGLRenderer, type AnimationAction, type Bone, type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * The live scene behind the account card.
 *
 * It owns a real WebGL renderer and the rigged GLB — the skeletal Idle and
 * Greet actions come from the file, while blinks and the smile are driven from
 * here through the face morph targets, so they stay irregular instead of
 * repeating on the animation's period.
 */
export type Stage = {
  /** Sizes to the GL drawing buffer, which is already device-scaled. */
  resize(width: number, height: number): void;
  frame(deltaSeconds: number): void;
  greet(): void;
  setPaused(paused: boolean): void;
  dispose(): void;
};

export type StageOptions = {
  /** Radians the body turns away from the camera; the head turns back. */
  bodyTurn?: number;
  /** Vertical slice of the character to frame, in model units. */
  framing?: { bottom: number; top: number; width: number };
  reducedMotion?: boolean;
};

const DEFAULT_FRAMING = { bottom: 0.24, top: 2.10, width: 1.16 };

/** Distance at which a box of `height` x `width` fits the given viewport. */
function fitDistance(fovDegrees: number, aspect: number, height: number, width: number) {
  const half = Math.tan((fovDegrees * Math.PI) / 360);
  return Math.max(height / 2 / half, width / 2 / (half * Math.max(aspect, 0.0001)));
}

export async function createStage(
  gl: WebGL2RenderingContext,
  data: ArrayBuffer,
  options: StageOptions = {},
): Promise<Stage> {
  const canvas = (gl as unknown as { canvas?: HTMLCanvasElement }).canvas;
  const renderer = new WebGLRenderer({
    canvas,
    context: gl,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  // A procedural room is the whole reflection environment: it is what stops the
  // metallic purple reading as flat plastic, and it ships no files.
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.62;

  const key = new DirectionalLight(0xfff3e6, 2.5);
  key.position.set(-2.2, 3.4, 3.0);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 12;
  key.shadow.camera.left = -1.4;
  key.shadow.camera.right = 1.4;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -0.4;
  key.shadow.bias = -0.0015;
  key.shadow.radius = 3;
  scene.add(key);

  const fill = new DirectionalLight(0xc9d6ff, 0.85);
  fill.position.set(3.0, 1.4, 2.2);
  scene.add(fill);

  const rim = new DirectionalLight(0xd8c4ff, 2.0);
  rim.position.set(1.4, 2.6, -3.2);
  scene.add(rim);
  scene.add(new AmbientLight(0xffffff, 0.22));

  const gltf = await new GLTFLoader().parseAsync(data, "");
  const root = new Group();
  root.add(gltf.scene);
  scene.add(root);

  const bodyTurn = options.bodyTurn ?? -0.20;
  gltf.scene.rotation.y = bodyTurn;

  let head: Bone | null = null;
  const faces: Mesh[] = [];
  gltf.scene.traverse((child: Object3D) => {
    if ((child as Bone).isBone && child.name === "head") head = child as Bone;
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Skinned meshes with morph targets keep bounds from the rest pose, so a
    // raised arm can cull the whole character mid-wave.
    if ((mesh as SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
    const material = mesh.material as MeshStandardMaterial;
    if (material && material.isMeshStandardMaterial) {
      material.envMapIntensity = material.metalness > 0.5 ? 1.15 : 0.75;
      material.dithering = true;
    }
    if (mesh.morphTargetDictionary) faces.push(mesh);
  });

  // A shadow catcher rather than a lit floor, so only the shadow lands on the
  // card and the rest of the plane stays transparent.
  const ground = new Mesh(new PlaneGeometry(3.2, 3.2), new ShadowMaterial({ opacity: 0.34 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.001;
  ground.receiveShadow = true;
  scene.add(ground);

  const framing = options.framing ?? DEFAULT_FRAMING;
  const bounds = new Box3().setFromObject(gltf.scene);
  const focusY = (framing.bottom + framing.top) / 2;
  const focusHeight = Math.max(framing.top - framing.bottom, 0.1);
  const camera = new PerspectiveCamera(26, 1, 0.1, 40);
  const target = new Vector3(bounds.getCenter(new Vector3()).x * 0.15, focusY, 0);

  const mixer = new AnimationMixer(gltf.scene);
  const byName = (name: string) =>
    gltf.animations.find((clip) => clip.name === name) ?? null;
  const idleClip = byName("Idle");
  const greetClip = byName("Greet");
  const idle: AnimationAction | null = idleClip ? mixer.clipAction(idleClip) : null;
  const greet: AnimationAction | null = greetClip ? mixer.clipAction(greetClip) : null;
  if (idle) {
    idle.setLoop(LoopRepeat, Infinity);
    idle.play();
  }
  if (greet) {
    greet.setLoop(LoopOnce, 1);
    greet.clampWhenFinished = true;
  }

  const morph = (name: string, value: number) => {
    for (const mesh of faces) {
      const index = mesh.morphTargetDictionary?.[name];
      if (index !== undefined && mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences[index] = value;
      }
    }
  };

  const headYaw = new Quaternion();
  const headAxis = new Vector3(0, 1, 0);
  headYaw.setFromAxisAngle(headAxis, -bodyTurn * 0.78);

  let elapsed = 0;
  let nextBlink = 1.4;
  let blinkAt = -1;
  let greeting = 0;
  let paused = false;
  let logged = false;
  const reduced = options.reducedMotion === true;

  function updateFace(dt: number) {
    elapsed += dt;
    let lid = 0;
    if (!reduced) {
      if (blinkAt < 0 && elapsed >= nextBlink) {
        blinkAt = elapsed;
        nextBlink = elapsed + 2.6 + Math.random() * 4.2;
      }
      if (blinkAt >= 0) {
        const t = (elapsed - blinkAt) / 0.22;
        if (t >= 1) blinkAt = -1;
        else lid = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
      }
    }
    morph("BlinkL", lid);
    morph("BlinkR", lid);
    const breathe = reduced ? 0 : Math.sin(elapsed * 0.9) * 0.06;
    const smile = Math.min(1, 0.38 + breathe + greeting * 0.52);
    morph("Smile", smile);
    morph("BrowRaise", greeting * 0.45);
    morph("MouthOpen", greeting * 0.16);
  }

  function frame(dt: number) {
    if (paused) return;
    const step = Math.min(dt, 0.06);
    if (!reduced) mixer.update(step);
    if (greeting > 0) greeting = Math.max(0, greeting - step / 2.2);
    updateFace(step);
    if (head) (head as Bone).quaternion.multiply(headYaw);
    renderer.render(scene, camera);
    const flush = gl as unknown as { endFrameEXP?: () => void };
    flush.endFrameEXP?.();
  }

  return {
    resize(width, height) {
      const aspect = width / Math.max(height, 1);
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      camera.aspect = aspect;
      const distance = fitDistance(camera.fov, aspect, focusHeight, framing.width);
      camera.position.set(target.x + distance * 0.06, focusY + distance * 0.035, distance);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      if (__DEV__ && !logged) {
        logged = true;
        console.log("[mascot] frame", { width, height, distance,
          cam: camera.position.toArray().map((v) => +v.toFixed(2)),
          bounds: [bounds.min.toArray().map((v) => +v.toFixed(2)),
                   bounds.max.toArray().map((v) => +v.toFixed(2))],
          clips: gltf.animations.map((c: { name: string }) => c.name) });
      }
    },
    frame,
    greet() {
      if (!greet || reduced) return;
      greeting = 1;
      greet.reset();
      greet.setEffectiveWeight(1);
      greet.play();
      if (idle) greet.crossFadeFrom(idle, 0.25, false);
      mixer.addEventListener("finished", function done(event) {
        if ((event as { action?: AnimationAction }).action !== greet) return;
        mixer.removeEventListener("finished", done);
        if (idle) {
          idle.reset();
          idle.play();
          idle.crossFadeFrom(greet, 0.45, false);
        }
      });
    },
    setPaused(value) {
      paused = value;
    },
    dispose() {
      mixer.stopAllAction();
      environment.texture.dispose();
      pmrem.dispose();
      scene.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      renderer.dispose();
    },
  };
}
