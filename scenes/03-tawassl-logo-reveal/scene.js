// Scene 03 — Tawassl Logo Reveal (4-second video intro)
// The logo rises out of darkness, turns to face the camera, a light sweeps across it,
// and the channel name appears below.
import { createStage } from '/lib/stage.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ───────── THINGS YOU CAN CHANGE ─────────
const SETTINGS = {
  brandColor: '#D4A53A',     // the metal colour of the logo
  logoFile: '/assets/logos/tawassl.svg',
  thickness: 0.32,           // how deep the 3D logo is
  bevel: 0.035,              // how rounded the edges are (0 = sharp)
  shine: 0.4,                // 0.15 = mirror-like, 0.6 = dull
  brushed: 0.5,              // strength of the brushed-metal streaks (0 = smooth)
  reflections: 0.55,         // how strongly the metal reflects the studio lights
  keyLight: 0.3,             // the main lamp shining on the front (higher = brighter highlight)
  sweepBrightness: 0.6,      // the light that slides across the logo
  backdropGlow: '#2a1e0c',   // soft glow behind the logo (not used in the transparent version)
  // Timing, in seconds (the whole intro is 4 seconds)
  riseStart: 0.15, riseEnd: 2.3,
  sweepStart: 2.2, sweepEnd: 3.25,
  nameStart: 2.65, nameEnd: 3.35,
};
// ─────────────────────────────────────────

const query = new URLSearchParams(location.search);
const transparent = query.has('transparent');

const { THREE, scene, camera, renderer, controls, start } = createStage({
  background: '#000000',
  cameraPosition: [0, 0, 14.5],
  lookAt: [0, 0, 0],
  fieldOfView: 30,
  transparent,
});

// Soft studio lighting for the metal to reflect (big gentle panels, no hard spots).
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.08).texture;
const key = new THREE.DirectionalLight('#fff1dc', 1);
key.position.set(-4, 5, 8);
scene.add(key);

// Backdrop: a dim warm glow fading to black at the edges.
let backdrop = null;
if (!transparent) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 288;
  const g = c.getContext('2d');
  const glow = g.createRadialGradient(256, 150, 0, 256, 150, 300);
  glow.addColorStop(0, SETTINGS.backdropGlow); glow.addColorStop(1, '#000000');
  g.fillStyle = glow; g.fillRect(0, 0, c.width, c.height);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  backdrop = new THREE.Mesh(new THREE.PlaneGeometry(40, 22.5),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  backdrop.position.z = -8;
  scene.add(backdrop);
}

// Brushed-metal streaks, drawn once and used for both the sheen and tiny grooves.
function brushedTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 1024, 1024);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 9000; i++) {
    const shade = 128 + (random() - 0.5) * 150;
    g.strokeStyle = `rgba(${shade},${shade},${shade},${0.10 + random() * 0.25})`;
    g.lineWidth = 0.5 + random() * 1.5;
    const y = random() * 1024, x = random() * 1024, length = 120 + random() * 700;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + length, y); g.stroke();
    g.beginPath(); g.moveTo(x - 1024, y); g.lineTo(x + length - 1024, y); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const streaks = brushedTexture();

const sweep = { value: -99 };
function metal() {
  const m = new THREE.MeshPhysicalMaterial({
    color: SETTINGS.brandColor, metalness: 1, roughness: SETTINGS.shine,
    roughnessMap: streaks, bumpMap: streaks, bumpScale: SETTINGS.brushed * 0.6,
    anisotropy: SETTINGS.brushed,
  });
  // The light sweep: a soft diagonal band of light that travels across the front of the logo.
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSweep = sweep;
    shader.uniforms.uSweepColor = { value: new THREE.Color(SETTINGS.brandColor).lerp(new THREE.Color('#ffffff'), 0.75) };
    shader.uniforms.uSweepPower = { value: SETTINGS.sweepBrightness };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSweepPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSweepPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSweepPos;\nuniform float uSweep;\nuniform vec3 uSweepColor;\nuniform float uSweepPower;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float sweepDistance = vSweepPos.x + vSweepPos.y * 0.45 - uSweep;
        float band = exp(-sweepDistance * sweepDistance / 0.3);
        totalEmissiveRadiance += uSweepColor * band * uSweepPower * (0.25 + 0.75 * pow(max(normal.z, 0.0), 2.0));`);
  };
  return m;
}
const logoMetal = metal();
const nameMetal = metal();
nameMetal.transparent = true;

// ── Turn the flat SVG drawing into solid 3D pieces ──
const svg = await new SVGLoader().loadAsync(SETTINGS.logoFile);
const pieces = [];
for (const path of svg.paths) {
  for (const shape of SVGLoader.createShapes(path)) {
    const box = new THREE.Box2().setFromPoints(shape.getPoints(8));
    pieces.push({ shape, box });
  }
}
const all = pieces.reduce((b, p) => b.union(p.box), new THREE.Box2());
const size = all.getSize(new THREE.Vector2()), centre = all.getCenter(new THREE.Vector2());
const scale = 5.2 / Math.max(size.y, size.x * 0.62); // fit nicely inside a 16:9 frame
// The small Latin "Tawassl" lettering at the bottom of the logo is the channel name;
// it is kept separate so it can appear on its own at the end.
const nameLine = all.min.y + size.y * 0.86;

function build(group, list, material, bevel) {
  const u = 1 / scale; // SVG units per scene unit
  for (const { shape } of list) {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: SETTINGS.thickness * u, curveSegments: 10,
      bevelEnabled: bevel > 0, bevelThickness: bevel * u, bevelSize: bevel * u,
      bevelOffset: -bevel * u, bevelSegments: 5,
    });
    // Stretch the brushed streaks to a sensible size across the metal.
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (2.2 * u), uv.getY(i) / (2.2 * u));
    group.add(new THREE.Mesh(geometry, material));
  }
  // SVG drawings are upside-down compared with 3D space, so flip and centre them.
  group.scale.set(scale, -scale, scale);
  group.position.set(-centre.x * scale, centre.y * scale, -SETTINGS.thickness / 2);
}
const logo = new THREE.Group(), emblem = new THREE.Group(), name = new THREE.Group();
build(emblem, pieces.filter((p) => p.box.getCenter(new THREE.Vector2()).y < nameLine), logoMetal, SETTINGS.bevel);
build(name, pieces.filter((p) => p.box.getCenter(new THREE.Vector2()).y >= nameLine), nameMetal, SETTINGS.bevel * 0.4);
const nameHolder = new THREE.Group();
nameHolder.add(name);
logo.add(emblem, nameHolder);
scene.add(logo);

// ── The 4-second animation ──
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const progress = (t, from, to) => clamp01((t - from) / (to - from));
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

function animate(t) {
  const S = SETTINGS;
  // 1. Rise out of darkness while turning to face the camera
  const rise = easeOut(progress(t, S.riseStart, S.riseEnd));
  logo.position.y = -1.0 * (1 - rise);
  logo.rotation.y = -1.95 * (1 - easeInOut(progress(t, S.riseStart, S.riseEnd)));
  logo.rotation.x = 0.4 * (1 - rise);
  const light = easeInOut(progress(t, S.riseStart, S.riseStart + 1.5));
  scene.environmentIntensity = light * S.reflections;
  key.intensity = S.keyLight * light;
  if (backdrop) backdrop.material.color.setScalar(easeInOut(progress(t, 0.4, 2.4)));
  window.__fade = light; // used for the transparent version, so the logo fades in instead of starting black

  // 2. The light sweep
  sweep.value = -6.5 + 13 * easeInOut(progress(t, S.sweepStart, S.sweepEnd));

  // 3. The channel name appears below
  const appear = easeOut(progress(t, S.nameStart, S.nameEnd));
  nameHolder.visible = appear > 0;
  nameHolder.position.y = -0.3 * (1 - appear);
  nameMetal.opacity = appear;

  // A slow, gentle push-in for the whole 4 seconds
  camera.position.set(0, 0, 14.5 - 0.9 * easeInOut(clamp01(t / 4)));
  controls.target.set(0, 0, 0);
}

// When simply watching in the browser, the intro loops with a one-second pause.
start((seconds) => animate(query.has('time') || query.has('capture') ? seconds : seconds % 5));
