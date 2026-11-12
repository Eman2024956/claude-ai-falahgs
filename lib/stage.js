// The "stage" every scene stands on: the window, the camera, mouse controls,
// and the camera angles used for automatic check pictures.
// Scenes call createStage() and then just add their own objects.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createStage({
  background = '#dfe7ee',
  cameraPosition = [6, 4, 8],
  lookAt = [0, 0.8, 0],
  fieldOfView = 40,
  exposure = 1,
  transparent = false, // true = no background, for videos that sit on top of other footage
  extraViews = {}, // more check-picture angles: { name: { position: [x,y,z], lookAt: [x,y,z] } }
} = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: transparent });
  if (transparent) renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = transparent ? null : new THREE.Color(background);

  const camera = new THREE.PerspectiveCamera(
    fieldOfView, window.innerWidth / window.innerHeight, 0.1, 500);
  const target = new THREE.Vector3(...lookAt);
  camera.position.set(...cameraPosition);
  camera.lookAt(target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.update();

  // Camera angles for check pictures: add ?view=front (or side / top) to the address.
  const distance = camera.position.distanceTo(target);
  const views = {
    front: [0, distance * 0.35, distance],
    side: [distance, distance * 0.35, 0],
    top: [0, distance * 1.2, 0.001],
  };
  const view = new URLSearchParams(location.search).get('view');
  if (views[view]) {
    const [x, y, z] = views[view];
    camera.position.set(target.x + x, target.y + y, target.z + z);
    controls.update();
  } else if (extraViews[view]) {
    camera.position.set(...extraViews[view].position);
    controls.target.set(...extraViews[view].lookAt);
    controls.update();
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // start(update) begins drawing. `update(seconds)` runs every frame for animation.
  // Adding ?time=2.5 freezes the scene at that moment, so check pictures are repeatable.
  function start(update = () => {}) {
    const frozen = new URLSearchParams(location.search).get('time');
    const clock = new THREE.Clock();
    let frames = 0;
    // Used by tools/render-video.mjs: draw the scene exactly as it looks at a given second.
    window.__renderAt = (seconds) => {
      update(seconds);
      controls.update();
      renderer.render(scene, camera);
      return renderer.domElement;
    };
    if (new URLSearchParams(location.search).has('capture')) {
      window.__renderAt(0);
      window.__sceneReady = true;
      return;
    }
    renderer.setAnimationLoop(() => {
      update(frozen !== null ? Number(frozen) : clock.getElapsedTime());
      controls.update();
      renderer.render(scene, camera);
      if (++frames === 5) window.__sceneReady = true;
    });
  }

  return { THREE, scene, camera, renderer, controls, start };
}
