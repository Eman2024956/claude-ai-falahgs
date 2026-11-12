// Scene 01 — Hello Shapes
// A first test scene: three simple shapes on a floor with sunlight and shadows.
import { createStage } from '/lib/stage.js';

// ───────── THINGS YOU CAN CHANGE ─────────
const SETTINGS = {
  skyColor: '#dfe7ee',
  floorColor: '#f4f1ea',
  cubeColor: '#e4572e',
  ballColor: '#2e86ab',
  ringColor: '#f2b134',
  sunBrightness: 3.0,
  spinSpeed: 0.6, // 0 = the ring stands still
};
// ─────────────────────────────────────────

const { THREE, scene, start } = createStage({
  background: SETTINGS.skyColor,
  cameraPosition: [6, 4, 8],
  lookAt: [0, 0.8, 0],
});

// Light: a soft sky glow plus one sun that casts shadows.
scene.add(new THREE.HemisphereLight('#ffffff', '#b9a98f', 1.1));
const sun = new THREE.DirectionalLight('#fff4e0', SETTINGS.sunBrightness);
sun.position.set(5, 9, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -8;
sun.shadow.camera.right = sun.shadow.camera.top = 8;
sun.shadow.bias = -0.0001;
sun.shadow.normalBias = 0.03;
scene.add(sun);

// Floor (very wide, and fading into the sky colour far away so no hard edge shows)
scene.fog = new THREE.Fog(SETTINGS.skyColor, 18, 60);
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(80, 64),
  new THREE.MeshStandardMaterial({ color: SETTINGS.floorColor, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

function shape(geometry, color, x, y, z, roughness = 0.45) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness }));
  mesh.material.shadowSide = THREE.FrontSide; // keeps shadows solid where a shape touches the floor
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

const cube = shape(new THREE.BoxGeometry(1.6, 1.6, 1.6), SETTINGS.cubeColor, -2.8, 0.8, 0);
cube.rotation.y = 0.5;
shape(new THREE.SphereGeometry(1, 48, 32), SETTINGS.ballColor, 0, 1, 0, 0.25);
const ring = shape(new THREE.TorusGeometry(0.8, 0.28, 24, 64), SETTINGS.ringColor, 2.7, 1.08, 0);

start((seconds) => {
  ring.rotation.y = seconds * SETTINGS.spinSpeed;
});
