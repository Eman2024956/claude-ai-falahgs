// Helpers for loading the free assets saved in assets/polyhaven/.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const base = '/assets/polyhaven';
const gltf = new GLTFLoader();
const tex = new THREE.TextureLoader();

// A 3D model (furniture, plants...). Returns an object you can position and add to the scene.
export async function loadModel(name) {
  const { scene: model } = await gltf.loadAsync(`${base}/${name}/${name}.gltf`);
  model.traverse((part) => {
    if (!part.isMesh) return;
    part.castShadow = true;
    part.receiveShadow = true;
    part.material.shadowSide = THREE.FrontSide;
  });
  return model;
}

// A surface material (floor boards, plaster, fabric). `tileSize` = metres one tile of the picture covers.
// usePhotoColor: false keeps the bumps and sheen of the photo but paints it in your own `color`.
export async function loadSurface(name, { tileSize = 1, color = '#ffffff', roughness = 1, usePhotoColor = true } = {}) {
  const load = async (file, isColor) => {
    const t = await tex.loadAsync(`${base}/${name}/${file}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / tileSize, 1 / tileSize);
    t.anisotropy = 8;
    if (isColor) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const [map, normalMap, arm] = await Promise.all([load('diff', true), load('nor'), load('arm')]);
  return new THREE.MeshStandardMaterial({
    map: usePhotoColor ? map : null, normalMap, roughnessMap: arm, aoMap: arm, color, roughness, metalness: 0,
  });
}

// A sky photo that wraps all around the scene. Also reports where its sun is.
export async function loadSky(name, size = '2k') {
  const sky = await new HDRLoader().loadAsync(`${base}/${name}/${name}_${size}.hdr`);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  // Find the brightest spot (the sun) so scenes can turn the sky to match their sunlight.
  const { data, width, height } = sky.image;
  const read = data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat : (v) => v;
  let best = -1, bestX = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4;
      const brightness = read(data[i]) + read(data[i + 1]) + read(data[i + 2]);
      if (brightness > best) { best = brightness; bestX = x; }
    }
  }
  sky.userData.sunAngle = (bestX / width - 0.5) * Math.PI * 2; // compass angle of the sun in the photo
  return sky;
}

// Sits an object on the floor (or on a surface at `y`) at x, z. `turn` is in degrees.
export function place(object, x, y, z, turn = 0) {
  object.rotation.y = THREE.MathUtils.degToRad(turn);
  object.position.set(0, 0, 0);
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  object.position.set(x, y - box.min.y, z);
  return object;
}
