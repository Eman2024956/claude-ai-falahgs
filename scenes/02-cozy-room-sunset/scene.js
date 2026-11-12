// Scene 02 — Cozy Room at Sunset
// A small living room. Low orange sunlight comes in through the window on the left,
// and a floor lamp glows in the corner. Furniture and textures are free Poly Haven assets.
import { createStage } from '/lib/stage.js';
import { loadModel, loadSurface, loadSky, place } from '/lib/assets.js';

// ───────── THINGS YOU CAN CHANGE ─────────
const SETTINGS = {
  wallColor: '#e9d9c3',      // warm cream
  rugColor: '#b5533c',       // terracotta
  sunColor: '#ff8a3c',       // deep orange
  sunStrength: 9,            // 0 = no sunbeam
  sunHeight: 24,             // degrees above the horizon (lower = longer beams)
  sunTurn: -8,               // degrees; slides the sunbeam towards the sofa (-) or the camera (+)
  lampOn: true,
  lampColor: '#ffb066',
  lampStrength: 5,
  roomGlow: 1.0,             // overall soft light so shadows are not pitch black
  brightness: 1.0,           // like a camera's exposure
  sky: 'qwantani_sunset',    // the photo seen through the window (also saved: belfast_sunset)
  skyBrightness: 0.5,
};
// ─────────────────────────────────────────

const ROOM = { width: 5, depth: 4.2, height: 2.7 };
const WINDOW = { from: -1.3, to: 0.5, bottom: 0.75, top: 2.25 }; // along the left wall
const X = ROOM.width / 2, Z = ROOM.depth / 2;

const { THREE, scene, start } = createStage({
  background: '#20150f',
  cameraPosition: [2.2, 1.55, 1.85],
  lookAt: [-0.6, 0.85, -0.8],
  fieldOfView: 55,
  exposure: SETTINGS.brightness,
  extraViews: {
    window: { position: [1.6, 1.4, -0.2], lookAt: [-2.5, 1.45, -0.4] },
    sofa: { position: [-0.2, 1.3, 1.7], lookAt: [-0.3, 0.8, -1.6] },
  },
});

// ── Load everything (free CC0 assets from Poly Haven) ──
const [
  floorMat, wallMat, rugMat, sky,
  sofa, armchair, coffeeTable, sideTable, plant, pillows, frame, vase, books,
] = await Promise.all([
  loadSurface('herringbone_parquet', { tileSize: 1.6 }),
  loadSurface('painted_plaster_wall', { tileSize: 2, color: SETTINGS.wallColor, usePhotoColor: false }),
  loadSurface('wool_boucle', { tileSize: 0.5, color: SETTINGS.rugColor }),
  loadSky(SETTINGS.sky),
  ...['sofa_03', 'ArmChair_01', 'modern_coffee_table_01', 'side_table_01', 'potted_plant_02',
    'throw_pillows_01', 'hanging_picture_frame_01', 'ceramic_vase_01', 'book_encyclopedia_set_01',
  ].map(loadModel),
]);

// ── Sunlight ──
const up = THREE.MathUtils.degToRad(SETTINGS.sunHeight);
const turn = THREE.MathUtils.degToRad(SETTINGS.sunTurn);
// Direction from the room towards the sun (the sun is outside the left wall).
const toSun = new THREE.Vector3(-Math.cos(up) * Math.cos(turn), Math.sin(up), Math.cos(up) * Math.sin(turn));
const sun = new THREE.DirectionalLight(SETTINGS.sunColor, SETTINGS.sunStrength);
sun.position.copy(toSun).multiplyScalar(12).add(new THREE.Vector3(0, 1, 0));
sun.target.position.set(0, 1, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, bottom: -3.5, top: 3.5, near: 1, far: 25 });
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
scene.add(sun, sun.target);

// Sky photo: seen through the window, and turned so its sun matches our sunlight.
const skyTurn = Math.atan2(toSun.z, toSun.x) - sky.userData.sunAngle;
scene.background = sky;
scene.environment = sky;
scene.backgroundRotation.y = scene.environmentRotation.y = -skyTurn;
scene.backgroundIntensity = SETTINGS.skyBrightness;
scene.environmentIntensity = 0.12;

// Soft overall light: cool dusk from above, warm bounce from the floor.
scene.add(new THREE.HemisphereLight('#d9c8dc', '#dcc0a2', SETTINGS.roomGlow));
// Warm glow where the sunbeam lands, as if it bounced off the floor.
const bounce = new THREE.PointLight(SETTINGS.sunColor, SETTINGS.sunStrength * 0.12, 6, 2);
bounce.position.set(-0.4, 0.5, -0.2);
scene.add(bounce);

// ── The room shell ──
// Walls only show from the inside, so you can orbit outside and still look in (like a dollhouse).
function wall(width, x, z, turnDegrees, hole) {
  const shape = new THREE.Shape()
    .moveTo(-width / 2, 0).lineTo(width / 2, 0)
    .lineTo(width / 2, ROOM.height).lineTo(-width / 2, ROOM.height).closePath();
  if (hole) {
    shape.holes.push(new THREE.Path()
      .moveTo(hole.x0, hole.y0).lineTo(hole.x0, hole.y1)
      .lineTo(hole.x1, hole.y1).lineTo(hole.x1, hole.y0).closePath());
  }
  const mat = wallMat.clone();
  mat.shadowSide = THREE.DoubleSide;
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = THREE.MathUtils.degToRad(turnDegrees);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
}
wall(ROOM.width, 0, -Z, 0);                                   // back
wall(ROOM.width, 0, Z, 180);                                  // front (behind the camera)
wall(ROOM.depth, X, 0, -90);                                  // right
wall(ROOM.depth, -X, 0, 90, {                                 // left, with the window
  x0: -WINDOW.to, x1: -WINDOW.from, y0: WINDOW.bottom, y1: WINDOW.top });

const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.depth), floorMat);
floor.geometry.attributes.uv.array.forEach((v, i, uv) => { uv[i] = v * (i % 2 ? ROOM.depth : ROOM.width); });
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const ceilingMat = new THREE.MeshStandardMaterial({ color: '#efe6d8', roughness: 1 });
ceilingMat.shadowSide = THREE.DoubleSide;
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.depth), ceilingMat);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = ROOM.height;
ceiling.castShadow = true;
scene.add(ceiling);

// Small helper for plain painted/wooden blocks.
function block(w, h, d, x, y, z, color, roughness = 0.6) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness });
  mat.shadowSide = THREE.FrontSide;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// Skirting boards along the bottom of the walls
const trim = '#f3ece0';
block(ROOM.width, 0.1, 0.02, 0, 0.05, -Z + 0.01, trim);
block(0.02, 0.1, ROOM.depth, -X + 0.01, 0.05, 0, trim);
block(0.02, 0.1, ROOM.depth, X - 0.01, 0.05, 0, trim);

// Window frame: four sides, a sill, and a cross in the middle
{
  const wz = (WINDOW.from + WINDOW.to) / 2, wy = (WINDOW.bottom + WINDOW.top) / 2;
  const w = WINDOW.to - WINDOW.from, h = WINDOW.top - WINDOW.bottom, x = -X - 0.04;
  block(0.16, 0.07, w + 0.14, x, WINDOW.top + 0.035, wz, trim);
  block(0.16, 0.07, w + 0.14, x, WINDOW.bottom - 0.035, wz, trim);
  block(0.16, h, 0.07, x, wy, WINDOW.from - 0.035, trim);
  block(0.16, h, 0.07, x, wy, WINDOW.to + 0.035, trim);
  block(0.05, h, 0.05, x, wy, wz, trim);
  block(0.05, 0.05, w, x, wy, wz, trim);
  block(0.22, 0.04, w + 0.24, -X + 0.09, WINDOW.bottom - 0.02, wz, trim); // sill
}

// ── Furniture ──
const rug = block(3.0, 0.02, 2.0, -0.3, 0.01, -0.25, '#ffffff');
rug.material = rugMat;
rug.castShadow = false;

scene.add(place(sofa, -0.3, 0, -1.58));
scene.add(place(pillows, -1.15, 0.47, -1.5, 15));
scene.add(place(coffeeTable, -0.3, 0, -0.2, 90));
scene.add(place(vase, -0.65, 0.39, -0.2));
scene.add(place(armchair, 1.75, 0, -0.55, -80));
scene.add(place(sideTable, 1.5, 0, -1.72));
scene.add(place(plant, 1.5, 0.55, -1.72, 40));

// Two pictures above the sofa
scene.add(place(frame, -0.8, 1.35, -Z + 0.005));
scene.add(place(frame.clone(), -0.05, 1.35, -Z + 0.005));
scene.add(painting(-0.8, ['#f3c98b', '#e07a3f', '#7b3f61', '#2d3047']));
scene.add(painting(-0.05, ['#f6e7cb', '#d9a05b', '#4f7c82', '#1f3c4d']));

// A simple abstract painting (soft colour bands and a sun) to fill a picture frame.
function painting(x, [sky1, sky2, hill1, hill2]) {
  const c = document.createElement('canvas');
  c.width = 384; c.height = 576;
  const g = c.getContext('2d');
  const fade = g.createLinearGradient(0, 0, 0, c.height);
  fade.addColorStop(0, sky1); fade.addColorStop(0.6, sky2);
  g.fillStyle = fade; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff3d6'; g.beginPath(); g.arc(c.width * 0.62, c.height * 0.42, 46, 0, 7); g.fill();
  for (const [color, base, wave] of [[hill1, 0.6, 30], [hill2, 0.75, 22]]) {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, c.height);
    for (let px = 0; px <= c.width; px += 8) {
      g.lineTo(px, c.height * base + Math.sin(px / 60 + base * 9) * wave);
    }
    g.lineTo(c.width, c.height); g.fill();
  }
  const art = new THREE.CanvasTexture(c);
  art.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.47, 0.72),
    new THREE.MeshStandardMaterial({ map: art, roughness: 0.8 }));
  mesh.position.set(x, 1.35 + 0.42, -Z + 0.022);
  return mesh;
}

// A wall shelf with books
block(1.0, 0.035, 0.22, 1.5, 1.55, -Z + 0.11, '#7a5234', 0.5);
scene.add(place(books, 1.15, 1.5675, -Z + 0.2));

// Reading lamp beside the armchair
{
  const lamp = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.4, metalness: 0.8 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.03, 32), metal);
  base.position.y = 0.015;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 12), metal);
  pole.position.y = 0.75;
  base.castShadow = pole.castShadow = true;
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.22, 0.3, 40, 1, true),
    new THREE.MeshStandardMaterial({
      color: '#f1dcc0', roughness: 0.9, side: THREE.DoubleSide,
      emissive: SETTINGS.lampColor, emissiveIntensity: SETTINGS.lampOn ? 1.6 : 0,
    }));
  shade.position.y = 1.55;
  lamp.add(base, pole, shade);
  if (SETTINGS.lampOn) {
    const glow = new THREE.PointLight(SETTINGS.lampColor, SETTINGS.lampStrength, 7, 2);
    glow.position.y = 1.52;
    glow.castShadow = true;
    glow.shadow.mapSize.set(1024, 1024);
    glow.shadow.bias = -0.002;
    glow.shadow.normalBias = 0.03;
    lamp.add(glow);
  }
  lamp.position.set(2.15, 0, -1.2);
  scene.add(lamp);
}

start();
