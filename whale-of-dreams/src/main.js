import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createCloudNoise, createPuffTexture } from './noise.js';
import {
  fullscreenVert, cloudFrag, skyVert, skyFrag, puffVert, puffFrag, compositeVert, compositeFrag,
} from './shaders.js';
import { Headline } from './headline.js';

const hero = document.getElementById('hero');
const canvas = document.getElementById('scene');
const loaderBar = document.getElementById('loaderBar');
const loaderLabel = document.getElementById('loaderLabel');
const params = new URLSearchParams(location.search);
const reduceMotionMQ = matchMedia('(prefers-reduced-motion: reduce)');
let reduceMotion = reduceMotionMQ.matches || params.has('still');
reduceMotionMQ.addEventListener?.('change', (e) => { reduceMotion = e.matches; });

const fail = (why) => {
  console.warn('[whale] falling back to still image:', why);
  hero.classList.remove('is-loading', 'has-webgl');
  hero.classList.add('no-webgl');
};

// ---------------------------------------------------------------------------
// renderer
// ---------------------------------------------------------------------------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 unavailable');
} catch (e) {
  fail(e);
}

if (renderer) start().catch((e) => { console.error(e); fail(e); });

async function start() {
  hero.classList.add('has-webgl');
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const lowPower = isTouch || (navigator.hardwareConcurrency || 8) <= 4;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xf3a9d4, 1);
  renderer.autoClear = true;

  // ---------------------------------------------------------------- palette
  const C = (hex) => new THREE.Color(hex); // sRGB hex -> linear working colour
  const palette = {
    skyTop: C('#ee93c6'), skyHorizon: C('#f7b7d9'), skyLow: C('#f2a9d0'),
    sun: new THREE.Color(1.0, 0.88, 0.93).multiplyScalar(1.3),
    ambHigh: C('#fdd9e9'), ambLow: C('#b65a8b'),
  };
  const sunDir = new THREE.Vector3(0.5, 0.72, 0.42).normalize();     // clouds: back/side light for shaped billows
  const keyDir = new THREE.Vector3(-0.35, 0.78, -0.52).normalize();  // whale key light from the camera side

  // ---------------------------------------------------------------- scene
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C('#f5b0d6'), 45, 260);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.3, 900);

  const skyUniforms = {
    uSkyTop: { value: palette.skyTop }, uSkyHorizon: { value: palette.skyHorizon }, uSkyLow: { value: palette.skyLow },
    uSunDir: { value: sunDir },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 48, 24),
    new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  // environment for broad, soft reflections on the wet skin
  const pmrem = new THREE.PMREMGenerator(renderer);
  {
    const env = new THREE.Scene();
    env.add(sky.clone());
    const soft = (color, intensity, pos, s) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
      m.position.copy(pos); m.lookAt(0, 0, 0); env.add(m);
    };
    soft('#fff3f6', 3.2, keyDir.clone().multiplyScalar(80), 90);
    soft('#ffb7d8', 1.6, new THREE.Vector3(60, 10, 70), 110);
    soft('#f9a7cf', 0.9, new THREE.Vector3(0, -80, 0), 200);
    scene.environment = pmrem.fromScene(env, 0.035).texture;
  }

  scene.add(new THREE.HemisphereLight(C('#ffe6f1'), C('#b86890'), 0.8));
  const key = new THREE.DirectionalLight(C('#fff5f5'), 2.9);
  key.position.copy(keyDir).multiplyScalar(30);
  scene.add(key);
  const rim = new THREE.DirectionalLight(C('#ff9fcf'), 3.2);
  rim.position.set(8, 9, 26);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(C('#ffc7e0'), 0.65);
  fill.position.set(10, -12, -14);
  scene.add(fill);

  // ---------------------------------------------------------------- whale
  setProgress(0.05, 'Gathering clouds…');
  const noiseTex = createCloudNoise(lowPower ? 48 : 64);
  setProgress(0.15, 'Waking the whale…');

  const gltfLoader = new GLTFLoader();
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise((res, rej) => gltfLoader.load('assets/whale.glb', res,
    (e) => setProgress(0.15 + 0.7 * (e.total ? e.loaded / e.total : Math.min(1, e.loaded / 2.4e6)), 'Waking the whale…'), rej));

  const whale = gltf.scene;
  const whaleRoot = new THREE.Group();
  whaleRoot.add(whale);
  scene.add(whaleRoot);
  whaleRoot.position.set(0, 0, 0);

  const flowerUniforms = { uTime: { value: 0 } };
  let bodyMesh = null, finMesh = null;
  whale.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const m = o.material;
    if (m.name === 'WhaleSkin' || m.name === 'WhaleFin') {
      const phys = new THREE.MeshPhysicalMaterial({
        map: m.map, normalMap: m.normalMap || null,
        roughness: 0.46, metalness: 0.0,
        clearcoat: 0.32, clearcoatRoughness: 0.42,
        sheen: 0.18, sheenColor: C('#ffc2dc'), sheenRoughness: 0.6,
        envMapIntensity: 0.6,
      });
      if (phys.normalMap) phys.normalScale.set(1.0, 1.0);
      o.material = phys;
      if (m.name === 'WhaleSkin') bodyMesh = o; else finMesh = o;
    } else if (m.name === 'Flora') {
      const fm = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.55,
      });
      fm.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = flowerUniforms.uTime;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            // restrained secondary motion: petals & leaves sway a touch around their stems
            float swayAmt = uv.x * 0.022;
            float ph = uv.y * 6.2831;
            transformed += vec3(sin(uTime * 1.0472 + ph), 0.35 * sin(uTime * 1.5708 + ph * 1.7), cos(uTime * 1.0472 + ph * 1.3)) * swayAmt; // periods divide the 12 s swim loop`);
        // subtle translucency: light leaking through thin petals from behind
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.08;');
      };
      o.material = fm;
    }
  });

  // swim cycle
  const mixer = new THREE.AnimationMixer(whale);
  const clip = gltf.animations.find((a) => /swim/i.test(a.name)) || gltf.animations[0];
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.play();

  // ---------------------------------------------------------------- whale-bound pink smoke
  whale.updateMatrixWorld(true);
  const puffAnchors = [];
  const bones = [];
  whale.traverse((o) => { if (o.isBone) bones.push(o); });
  function samplePuffs(mesh, count, filter, sizeRange, alphaRange, lift) {
    if (!mesh) return;
    const g = mesh.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const skel = mesh.skeleton;
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    let tries = 0, made = 0;
    while (made < count && tries++ < 20000) {
      const i = Math.floor(Math.random() * pos.count);
      v.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nor, i).normalize();
      if (!filter(v, n)) continue;
      // dominant bone for this vertex
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      const bone = skel.bones[best];
      const world = v.clone().addScaledVector(n, lift * (0.6 + Math.random() * 0.6)).applyMatrix4(mesh.matrixWorld);
      const anchor = new THREE.Object3D();
      bone.add(anchor);
      bone.updateMatrixWorld(true);
      anchor.position.copy(bone.worldToLocal(world));
      anchor.userData = {
        size: THREE.MathUtils.lerp(sizeRange[0], sizeRange[1], Math.random()),
        alpha: THREE.MathUtils.lerp(alphaRange[0], alphaRange[1], Math.random()),
      };
      puffAnchors.push(anchor);
      made++;
    }
  }
  // rear body (flower-smoke trailing along the back and flanks), flukes, fin roots
  samplePuffs(bodyMesh, 38, (v, n) => v.x < -1.2 && v.x > -5.3 && n.y > 0.05, [0.7, 1.7], [0.45, 0.8], 0.4);
  samplePuffs(bodyMesh, 8, (v, n) => v.x < -1.5 && v.x > -4.8 && n.y < -0.3, [0.9, 1.6], [0.25, 0.45], 0.3);
  samplePuffs(finMesh, 16, (v, n) => v.x < -5.2 && n.y > -0.2, [0.7, 1.4], [0.45, 0.8], 0.2);

  const puffCount = puffAnchors.length;
  const puffGeo = new THREE.InstancedBufferGeometry();
  puffGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  puffGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const offsets = new Float32Array(puffCount * 3);
  const pparams = new Float32Array(puffCount * 4);
  puffAnchors.forEach((a, i) => {
    pparams.set([a.userData.size, Math.random() * 6.28, Math.random(), a.userData.alpha], i * 4);
  });
  const offsetAttr = new THREE.InstancedBufferAttribute(offsets, 3).setUsage(THREE.DynamicDrawUsage);
  puffGeo.setAttribute('aOffset', offsetAttr);
  puffGeo.setAttribute('aParams', new THREE.InstancedBufferAttribute(pparams, 4));
  puffGeo.instanceCount = puffCount;
  const puffMat = new THREE.ShaderMaterial({
    vertexShader: puffVert, fragmentShader: puffFrag,
    uniforms: {
      uTex: { value: createPuffTexture() }, uDepth: { value: null }, uRes: { value: new THREE.Vector2() },
      uNear: { value: camera.near }, uFar: { value: camera.far }, uTime: { value: 0 },
      uLit: { value: C('#ffd4e6').multiplyScalar(1.08) }, uShade: { value: C('#e489b5') },
    },
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const puffMesh = new THREE.Mesh(puffGeo, puffMat);
  puffMesh.frustumCulled = false;
  const puffScene = new THREE.Scene();
  puffScene.add(puffMesh);
  const tmpV = new THREE.Vector3();
  function updatePuffs() {
    for (let i = 0; i < puffCount; i++) {
      puffAnchors[i].getWorldPosition(tmpV);
      offsets[i * 3] = tmpV.x; offsets[i * 3 + 1] = tmpV.y; offsets[i * 3 + 2] = tmpV.z;
    }
    offsetAttr.needsUpdate = true;
  }

  // ---------------------------------------------------------------- render targets & passes
  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const msaa = lowPower ? 0 : 4;
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: msaa, depthBuffer: true });
  sceneRT.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const puffRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const cloudRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, count: 2 });
  cloudRT.textures.forEach((t) => { t.minFilter = t.magFilter = THREE.LinearFilter; });

  const whaleRadius = new THREE.Vector3(10.5, 6.2, 7.0);
  const valley = new THREE.Vector2(0, -6);
  const cloudMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: fullscreenVert, fragmentShader: cloudFrag,
    uniforms: {
      uDepth: { value: sceneRT.depthTexture }, uNoise: { value: noiseTex },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uWind: { value: 2.4 }, uSplit: { value: 30 }, uMaxDist: { value: 330 },
      uSteps: { value: lowPower ? 56 : 96 },
      uSunCol: { value: palette.sun }, uAmbHigh: { value: palette.ambHigh }, uAmbLow: { value: palette.ambLow },
      uWhalePos: { value: new THREE.Vector3(0, 0.3, 0) }, uWhaleRad: { value: whaleRadius }, uValley: { value: valley },
      ...skyUniforms,
    },
    depthTest: false, depthWrite: false,
  });
  const cloudQuad = new THREE.Mesh(quadGeo, cloudMat);
  cloudQuad.frustumCulled = false;
  const cloudScene = new THREE.Scene();
  cloudScene.add(cloudQuad);

  const headline = new Headline();
  const compMat = new THREE.ShaderMaterial({
    vertexShader: compositeVert, fragmentShader: compositeFrag,
    uniforms: {
      uScene: { value: sceneRT.texture }, uDepth: { value: sceneRT.depthTexture },
      uNear: { value: cloudRT.textures[0] }, uFar: { value: cloudRT.textures[1] }, uPuff: { value: puffRT.texture },
      uText: { value: headline.texture }, uInvProj: { value: new THREE.Matrix4() }, uSplit: { value: 30 },
      uTexel: { value: new THREE.Vector2() }, uCloudTexel: { value: new THREE.Vector2() }, uTextOn: { value: 1 }, uGrain: { value: 0.012 }, uTime: { value: 0 },
    },
    depthTest: false, depthWrite: false,
  });
  const compQuad = new THREE.Mesh(quadGeo, compMat);
  compQuad.frustumCulled = false;
  const compScene = new THREE.Scene();
  compScene.add(compQuad);

  // ---------------------------------------------------------------- layout / framing
  let cloudScale = lowPower ? 0.38 : 0.5;
  const frame = { az: 0, el: 0, dist: 20, target: new THREE.Vector3(), yaw: 0.35, pitch: 0.2, roll: -0.3 };
  let W = 1, H = 1, dpr = 1;

  function resize() {
    W = Math.max(1, hero.clientWidth);
    H = Math.max(1, hero.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    sceneRT.setSize(bw, bh);
    puffRT.setSize(Math.round(bw * 0.5), Math.round(bh * 0.5));
    resizeClouds();
    headline.resize(W, H, dpr);
    compMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);
    puffMat.uniforms.uRes.value.set(bw, bh);

    // camera framing adapts to the aspect ratio
    const aspect = W / H;
    const m = THREE.MathUtils.clamp((1.25 - aspect) / 0.8, 0, 1); // 0 desktop .. 1 tall phone
    camera.fov = THREE.MathUtils.lerp(32, 44, m);
    camera.aspect = aspect;
    frame.yaw = THREE.MathUtils.lerp(0.42, 0.78, m);   // turn the whale toward camera on narrow screens
    frame.pitch = THREE.MathUtils.lerp(0.2, 0.26, m);
    frame.az = THREE.MathUtils.lerp(0.2, 0.12, m);
    frame.el = THREE.MathUtils.lerp(0.03, 0.05, m);
    const projW = 13.2 * Math.cos(frame.yaw) + 4.5 * Math.sin(frame.yaw);
    const visW = (f) => 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect * f;
    const visH = (f) => 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * f;
    const wantW = THREE.MathUtils.lerp(0.84, 1.12, m);
    let dist = projW / visW(wantW);
    // keep the whale's height comfortably inside the frame below the header
    dist = Math.max(dist, 8.0 / visH(THREE.MathUtils.lerp(0.66, 0.5, m)));
    frame.dist = dist;
    // shift the target so the whale sits under the headline, overlapping its lower edge
    const headBottom = headline.bottomCss / H;           // 0..1 from top
    const desiredCentre = THREE.MathUtils.lerp(headBottom + 0.13, headBottom + 0.15, m); // whale centre in screen
    const offsetY = (desiredCentre - 0.5) * visH(dist);  // world units
    frame.target.set(THREE.MathUtils.lerp(-0.6, -0.5, m), offsetY + 0.3, 0);
    camera.updateProjectionMatrix();
  }

  function resizeClouds() {
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    const cw = Math.max(1, Math.round(bw * cloudScale)), ch = Math.max(1, Math.round(bh * cloudScale));
    cloudRT.setSize(cw, ch);
    compMat.uniforms.uCloudTexel.value.set(1 / cw, 1 / ch);
  }

  // ---------------------------------------------------------------- input (parallax + gentle drag-orbit)
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const drag = { active: false, lx: 0, ly: 0, az: 0, el: 0, saz: 0, sel: 0, last: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    if (drag.active) {
      drag.az -= (e.clientX - drag.lx) * 0.004;
      drag.el += (e.clientY - drag.ly) * 0.003;
      drag.az = THREE.MathUtils.clamp(drag.az, -1.1, 1.1);
      drag.el = THREE.MathUtils.clamp(drag.el, -0.22, 0.6);
      drag.lx = e.clientX; drag.ly = e.clientY; drag.last = performance.now();
    }
  }, { passive: true });
  canvas.parentElement.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a,button')) return;
    if (e.pointerType === 'touch') return; // keep page scrolling natural on touch
    drag.active = true; drag.lx = e.clientX; drag.ly = e.clientY;
  });
  window.addEventListener('pointerup', () => { drag.active = false; drag.last = performance.now(); });
  window.addEventListener('pointerleave', () => { pointer.x = pointer.y = 0; });

  // debug inspection: ?orbit → free OrbitControls; ?t=12 freezes time; ?cam=az,el,dist
  let orbit = null;
  if (params.has('orbit')) {
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    orbit = new OrbitControls(camera, canvas);
    orbit.target.set(0, 0, 0);
    const v = params.get('view')?.split(',').map(Number) || [0.2, 0.05, 25];
    camera.position.set(v[2] * Math.sin(v[0]) * Math.cos(v[1]), v[2] * Math.sin(v[1]), -v[2] * Math.cos(v[0]) * Math.cos(v[1]));
  }
  const freezeT = params.has('t') ? parseFloat(params.get('t')) : null;
  const camOverride = params.get('cam')?.split(',').map(Number);

  resize();
  window.addEventListener('resize', resize);
  document.fonts?.load('400 100px Anton').then(() => { headline.computeLayout(); headline.draw(headline.progress); resize(); });

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let simT = freezeT ?? 0;
  let running = true;
  let visible = true;
  const perf = { acc: 0, n: 0, cooldown: 0 };
  let revealStart = -1;

  function updateCamera(t, dt) {
    if (orbit) { orbit.update(); return; }
    const motion = reduceMotion ? 0 : 1;
    // smooth cursor parallax
    const k = 1 - Math.exp(-dt * 2.2);
    pointer.sx += (pointer.x * motion - pointer.sx) * k;
    pointer.sy += (pointer.y * motion - pointer.sy) * k;
    // drag springs back to the composed view after a few idle seconds
    if (!drag.active && performance.now() - drag.last > 2500) {
      const kb = 1 - Math.exp(-dt * 0.9);
      drag.az += (0 - drag.az) * kb; drag.el += (0 - drag.el) * kb;
    }
    const ks = 1 - Math.exp(-dt * 5);
    drag.saz += (drag.az - drag.saz) * ks; drag.sel += (drag.el - drag.sel) * ks;
    // slow "travelling alongside" drift (independent of the swim animation)
    const drift = motion;
    let az = frame.az + drift * 0.05 * Math.sin(t * 0.071) + pointer.sx * 0.07 + drag.saz;
    let el = frame.el + drift * 0.025 * Math.sin(t * 0.053 + 1.3) - pointer.sy * 0.045 + drag.sel;
    let dist = frame.dist * (1 + drift * 0.025 * Math.sin(t * 0.061 + 0.7));
    if (camOverride && camOverride.length >= 3) { [az, el, dist] = camOverride; }
    const tgt = frame.target;
    camera.position.set(
      tgt.x + dist * Math.sin(az) * Math.cos(el),
      tgt.y + dist * Math.sin(el),
      tgt.z - dist * Math.cos(az) * Math.cos(el),
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(tgt.x + pointer.sx * 0.25, tgt.y - pointer.sy * 0.15, tgt.z);
  }

  const eYaw = new THREE.Euler(), ePR = new THREE.Euler(), qTmp = new THREE.Quaternion();
  function render(dt) {
    const t = simT;
    const speed = reduceMotion ? 0.45 : 1;
    // whale pose in the world: nose lifted, three-quarter turn toward camera
    whaleRoot.quaternion.setFromEuler(eYaw.set(0, frame.yaw, 0)).multiply(qTmp.setFromEuler(ePR.set(frame.roll, 0, frame.pitch, 'ZXY')));
    mixer.setTime((t * speed) % clip.duration);
    flowerUniforms.uTime.value = t * speed;
    whale.updateMatrixWorld(true);
    updatePuffs();
    updateCamera(t, dt);
    camera.updateMatrixWorld();

    // split plane for the headline: just behind the whale
    const split = camera.position.distanceTo(whaleRoot.position) + 7.5;

    // 1) scene (whale + sky)
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);
    // 2) smoke puffs (soft depth against the whale)
    puffMat.uniforms.uDepth.value = sceneRT.depthTexture;
    puffMat.uniforms.uTime.value = t;
    renderer.setRenderTarget(puffRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(puffScene, camera);
    renderer.setClearColor(0xf3a9d4, 1);
    // 3) volumetric clouds
    const cu = cloudMat.uniforms;
    cu.uInvProj.value.copy(camera.projectionMatrixInverse);
    cu.uCamWorld.value.copy(camera.matrixWorld);
    cu.uCamPos.value.copy(camera.position);
    cu.uTime.value = t * (reduceMotion ? 0.4 : 1);
    cu.uSplit.value = split;
    renderer.setRenderTarget(cloudRT);
    renderer.render(cloudScene, quadCam);
    // 4) composite + tone-map
    compMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    compMat.uniforms.uSplit.value = split;
    compMat.uniforms.uTime.value = t;
    renderer.setRenderTarget(null);
    renderer.render(compScene, quadCam);
  }

  function adaptQuality(dt) {
    if (freezeT !== null) return;
    perf.acc += dt; perf.n++;
    if (perf.n < 45) return;
    const avg = perf.acc / perf.n;
    perf.acc = 0; perf.n = 0;
    if (perf.cooldown-- > 0) return;
    if (avg > 0.026 && cloudScale > 0.26) { cloudScale = Math.max(0.26, cloudScale - 0.08); resizeClouds(); perf.cooldown = 2; }
    else if (avg > 0.026 && cloudMat.uniforms.uSteps.value > 48) { cloudMat.uniforms.uSteps.value -= 12; perf.cooldown = 2; }
    else if (avg < 0.0135 && cloudScale < 0.5) { cloudScale = Math.min(0.5, cloudScale + 0.06); resizeClouds(); perf.cooldown = 4; }
  }

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!visible) return;
    if (freezeT === null) simT += dt;
    // headline reveal
    if (revealStart >= 0 && headline.progress < 1) {
      const p = reduceMotion ? 1 : Math.min(1, (performance.now() - revealStart) / 1500);
      headline.draw(p);
    }
    render(dt);
    adaptQuality(dt);
    if (params.has('shot') && ++shotFrames >= 3) { running = false; window.__shotReady = true; }
  }
  let shotFrames = 0;

  // pause when the hero is off-screen or the tab is hidden
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; clock.getDelta(); });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; }).observe(hero);

  // warm up shaders before revealing
  setProgress(0.9, 'Painting the sky…');
  headline.draw(0);
  if (params.has('notext')) compMat.uniforms.uTextOn.value = 0;
  try { await renderer.compileAsync(scene, camera); } catch { /* optional */ }
  render(0.016);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  setProgress(1, 'Ready');
  hero.classList.remove('is-loading');
  hero.classList.add('is-ready');
  clock.getDelta();
  setTimeout(() => { revealStart = performance.now(); }, reduceMotion ? 0 : 450);
  if (params.has('instant')) { headline.draw(1); }
  tick();

  // small hook for automated inspection
  window.__whale = { camera, frame, render, setTime: (t) => { simT = t; }, headline };
}

function setProgress(p, label) {
  if (loaderBar) loaderBar.style.width = `${Math.round(p * 100)}%`;
  if (label && loaderLabel) loaderLabel.textContent = label;
}
