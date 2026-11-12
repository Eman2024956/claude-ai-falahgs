// The interpreter. It takes a validated ScenePlan and turns it into a running
// page: it builds what the plan lists, then each frame reads the scroll
// position, samples the timeline and applies the values.
import * as THREE from 'three';
import { buildCoupe } from './car.js';
import { buildRoom, buildLights, buildFloor, buildParticles } from './stage.js';
import { createTimeline } from './timeline.js';
import { buildContent } from './content.js';

// plan.scene.subject.asset -> builder. Add a model here to make it plannable.
const ASSETS = { coupe: buildCoupe };

const rad = THREE.MathUtils.degToRad;

export function mount(plan, { canvas, ui, spacer, debug = {} }) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pixelRatio = Math.min(devicePixelRatio || 1, 2);

  // --- page ---------------------------------------------------------------
  spacer.style.height = `${plan.timeline.scrollPages * 100}vh`;
  const maxScroll = () => Math.max(document.documentElement.scrollHeight - innerHeight, 1);
  const scrollToProgress = (p) => scrollTo({ top: p * maxScroll(), behavior: reducedMotion ? 'auto' : 'smooth' });
  const content = buildContent(plan, ui, scrollToProgress);
  const timeline = createTimeline(plan);

  // --- renderer -----------------------------------------------------------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    // No WebGL: the text still scrolls over the static backdrop.
    document.documentElement.classList.add('no-webgl');
    const tick = () => { content.update(scrollY / maxScroll()); requestAnimationFrame(tick); };
    tick();
    return;
  }
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const env = plan.scene.environment;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(env.fogColor);
  scene.fog = new THREE.FogExp2(env.fogColor, env.fogDensity);

  const camera = new THREE.PerspectiveCamera(plan.camera.fov, 1, 0.1, env.radius * 3);
  camera.layers.enable(1); // layer 1: shafts and dust, seen by this camera only

  const lights = buildLights(plan.scene.lights, renderer);
  scene.environment = lights.environment;
  const subject = ASSETS[plan.scene.subject.asset](plan.scene.subject, plan.theme);
  const floor = buildFloor(plan.scene.floor, env, lights.spots, subject.footprint, pixelRatio);
  const particles = plan.scene.particles ? buildParticles(plan.scene.particles, pixelRatio) : null;
  scene.add(buildRoom(env), lights.object, floor.object, subject.object);
  if (particles) scene.add(particles.object);

  // --- size ---------------------------------------------------------------
  let width = 1;
  let height = 1;
  function resize() {
    width = canvas.clientWidth || innerWidth;
    height = canvas.clientHeight || innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    particles?.resize(height, plan.camera.fov);
  }
  addEventListener('resize', resize);
  resize();

  // --- pointer parallax ---------------------------------------------------
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  if (!reducedMotion) {
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      pointer.x = (e.clientX / innerWidth) * 2 - 1;
      pointer.y = (e.clientY / innerHeight) * 2 - 1;
    });
  }

  // --- frame --------------------------------------------------------------
  const clock = new THREE.Clock();
  const target = new THREE.Vector3();
  const wanted = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  let progress = scrollY / maxScroll();
  let orbitAngle = 0;
  let time = debug.time ?? 0;
  let first = true;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (debug.time === undefined) time += dt;

    // Scroll -> eased progress -> property values.
    const raw = debug.progress ?? Math.min(Math.max(scrollY / maxScroll(), 0), 1);
    const smoothing = reducedMotion ? 0 : plan.timeline.smoothing;
    progress = first || smoothing === 0 ? raw : progress + (raw - progress) * (1 - Math.exp(-dt / smoothing));
    const s = timeline.evaluate(progress);
    content.update(progress);

    // Camera: the plan's shot, plus the idle orbit weighted by camera.orbit.
    const speed = reducedMotion ? 0 : plan.camera.orbit.speed;
    orbitAngle += speed * s['camera.orbit'] * dt;
    if (orbitAngle > 180) orbitAngle -= 360;
    if (orbitAngle < -180) orbitAngle += 360;
    if (debug.time !== undefined) orbitAngle = 0;

    // Narrow screens: pull back so the car still fits, and slide it up rather than sideways.
    const portrait = camera.aspect < 1;
    const fit = Math.min(Math.max(1, 1.05 / camera.aspect), 2.2, (env.radius - 2) / s['camera.radius']);
    pointer.sx += (pointer.x - pointer.sx) * Math.min(dt * 3, 1);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(dt * 3, 1);
    const az = rad(s['camera.azimuth'] + orbitAngle * s['camera.orbit'] + pointer.sx * 2.5);
    const elev = rad(Math.max(s['camera.elevation'] - pointer.sy * 1.2, 1.5));
    const radius = s['camera.radius'] * fit;
    target.set(s['camera.target.x'], s['camera.target.y'], s['camera.target.z']);
    wanted.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).multiplyScalar(radius).add(target);

    const settle = first || reducedMotion || plan.camera.damping === 0 ? 1 : 1 - Math.exp(-dt / plan.camera.damping);
    camera.position.lerp(wanted, settle);
    lookAt.lerp(target, settle);
    camera.lookAt(lookAt);
    camera.fov = s['camera.fov'];
    const shiftX = portrait ? 0 : s['camera.frame'];
    const shiftY = portrait ? -0.16 : 0;
    camera.setViewOffset(width, height, -shiftX * width, -shiftY * height, width, height);

    // Everything else the timeline may drive.
    renderer.toneMappingExposure = s['environment.exposure'];
    scene.environmentIntensity = s['environment.reflections'];
    lights.setBeams(s['beams.opacity'], time);
    for (const light of plan.scene.lights) lights.setLight(light.id, s[`lights.${light.id}.intensity`]);
    floor.setReflectivity(s['floor.reflectivity']);
    floor.setRing(s['floor.ring']);
    subject.setLamps(s['subject.lamps']);
    particles?.update(time, s['particles.opacity']);

    renderer.render(scene, camera);
    if (first) {
      first = false;
      document.documentElement.classList.add('is-ready');
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
