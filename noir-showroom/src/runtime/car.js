// Asset "coupe": a grand tourer built from maths, so the site ships no model
// file. The body is one lofted surface; lamps and grille are patches cut from
// the same surface function so they sit flush.
//
// Car space: +x is forward, +y is up, wheels rest on y = 0. Units are metres.
import * as THREE from 'three';

const HALF_LENGTH = 2.4;
const WHEEL_RADIUS = 0.355;
const AXLES = [1.42, -1.38];
const TRACK = 0.795;
const ARCH_RADIUS = 0.425;
const WELL_Z = 0.56;

// Smooth curve through [x, y] control points (Catmull-Rom).
function curve(points) {
  return (x) => {
    let i = 0;
    while (i < points.length - 2 && x > points[i + 1][0]) i++;
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const y0 = points[Math.max(i - 1, 0)][1];
    const y3 = points[Math.min(i + 2, points.length - 1)][1];
    const t = THREE.MathUtils.clamp((x - x1) / (x2 - x1), 0, 1);
    return 0.5 * (2 * y1 + (y2 - y0) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t * t + (3 * y1 - y0 - 3 * y2 + y3) * t * t * t);
  };
}

const UPPER = 0.42;
const LOWER = 0.28;
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

// --- lower body ---------------------------------------------------------
const deckLine = curve([[-2.4, 0.79], [-2.15, 0.9], [-1.5, 0.95], [-0.4, 0.94], [0.7, 0.92], [1.35, 0.84], [2.0, 0.71], [2.4, 0.5]]);
const sillLine = (x) => 0.17 + 0.2 * Math.pow(Math.abs(x) / HALF_LENGTH, 6);
const planWidth = (x) => 0.985 * Math.pow(Math.max(1 - Math.pow(Math.abs(x) / HALF_LENGTH, 6.5), 0), 0.4);

function bodyPoint(x, theta, out) {
  const top = deckLine(x);
  const bottom = sillLine(x);
  const s = Math.sin(theta);
  const e = s < 0 ? LOWER : UPPER; // squarer below the waist, rounder above
  const v = spow(s, e);
  let z = planWidth(x) * spow(Math.cos(theta), e);
  z *= 1 - 0.1 * Math.max(v, 0) ** 2; // shoulders lean in
  const y = (top + bottom) / 2 + ((top - bottom) / 2) * v;

  // Wheel wells: push the flank inwards inside each arch.
  for (const ax of AXLES) {
    const d = Math.hypot(x - ax, y - WHEEL_RADIUS);
    const k = 1 - THREE.MathUtils.smoothstep(d, ARCH_RADIUS - 0.05, ARCH_RADIUS + 0.005);
    if (k > 0 && Math.abs(z) > WELL_Z) z = Math.sign(z) * THREE.MathUtils.lerp(Math.abs(z), WELL_Z, k);
  }
  return out.set(x, y, z);
}

// --- glasshouse ---------------------------------------------------------
const CABIN = [-1.95, 1.08];
const roofLine = curve([[-1.95, 0.9], [-1.3, 1.1], [-0.5, 1.245], [0.05, 1.27], [0.55, 1.16], [1.08, 0.88]]);

function cabinPoint(x, theta, out) {
  const mid = (CABIN[0] + CABIN[1]) / 2;
  const t = (x - mid) / ((CABIN[1] - CABIN[0]) / 2);
  const base = deckLine(x) - 0.07;
  const top = Math.max(roofLine(x), base + 0.001);
  const s = Math.sin(theta);
  const v = spow(s, 0.5);
  const width = 0.87 * Math.pow(Math.max(1 - Math.pow(Math.abs(t), 3.2), 0), 0.45);
  const lean = 1 - 0.3 * (0.5 + 0.5 * v); // narrower at the roof
  return out.set(x, (top + base) / 2 + ((top - base) / 2) * v, width * lean * spow(Math.cos(theta), 0.5));
}

// Closed loft: `stations` rings of `ring` points, denser towards both ends.
function loft(pointAt, from, to, stations, ring) {
  const positions = new Float32Array(stations * ring * 3);
  const p = new THREE.Vector3();
  const mid = (from + to) / 2;
  const half = (to - from) / 2;
  for (let i = 0; i < stations; i++) {
    const x = mid + half * Math.sin((Math.PI / 2) * (-1 + (2 * i) / (stations - 1)));
    for (let j = 0; j < ring; j++) {
      pointAt(x, -Math.PI / 2 + (2 * Math.PI * j) / ring, p).toArray(positions, (i * ring + j) * 3);
    }
  }
  const index = [];
  for (let i = 0; i < stations - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j;
      const b = i * ring + ((j + 1) % ring);
      const c = a + ring;
      const d = b + ring;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

// A band on the body's flank between two heights, wrapping round the nose or
// tail from one side of the car to the other. `end` is +1 (nose) or -1 (tail).
function wrapBand(end, reach, yLow, yHigh, lift = 0.006) {
  const cols = 72;
  const rows = 4;
  const positions = [];
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const n = new THREE.Vector3();
  const thetaFor = (x, y) => {
    const top = deckLine(x);
    const bottom = sillLine(x);
    const v = THREE.MathUtils.clamp((y - (top + bottom) / 2) / ((top - bottom) / 2), -0.98, 0.98);
    return Math.asin(spow(v, 1 / (v < 0 ? LOWER : UPPER)));
  };
  for (let i = 0; i <= cols; i++) {
    const u = -1 + (2 * i) / cols; // -1 one side, 0 the tip, +1 the other side
    const x = end * (HALF_LENGTH - reach * Math.pow(Math.abs(u), 1.8) - 0.0005);
    for (let j = 0; j <= rows; j++) {
      const y = THREE.MathUtils.lerp(yLow, yHigh, j / rows);
      let theta = thetaFor(x, y);
      if (u < 0) theta = Math.PI - theta;
      bodyPoint(x, theta, p);
      // Lift along the surface normal so the patch does not z-fight the body.
      bodyPoint(x - end * 0.004, theta, q);
      n.subVectors(p, q);
      bodyPoint(x, theta + 0.02, q).sub(p);
      n.cross(q).normalize();
      if (n.dot(p.clone().setY(0)) < 0) n.negate();
      positions.push(p.x + n.x * lift, p.y + n.y * lift, p.z + n.z * lift);
    }
  }
  const index = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      const b = a + rows + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

function buildWheel(materials) {
  const wheel = new THREE.Group();
  const R = WHEEL_RADIUS;
  const W = 0.25;

  const profile = [];
  const rim = R * 0.7;
  const corner = 0.045;
  profile.push(new THREE.Vector2(rim, -W / 2));
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    profile.push(new THREE.Vector2(R - corner + Math.sin(a) * corner, -W / 2 + corner - Math.cos(a) * corner));
  }
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    profile.push(new THREE.Vector2(R - corner + Math.cos(a) * corner, W / 2 - corner + Math.sin(a) * corner));
  }
  profile.push(new THREE.Vector2(rim, W / 2));
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(profile, 56), materials.rubber);
  tyre.rotation.x = Math.PI / 2;
  wheel.add(tyre);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rim, rim, W * 0.9, 48, 1, true), materials.rimDark);
  barrel.rotation.x = Math.PI / 2;
  wheel.add(barrel);

  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rim * 0.8, rim * 0.8, 0.02, 48), materials.disc);
  disc.rotation.x = Math.PI / 2;
  disc.position.z = 0.03;
  wheel.add(disc);

  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.06), materials.accent);
  caliper.position.set(-rim * 0.5, rim * 0.5, 0.05);
  caliper.rotation.z = Math.PI / 4;
  wheel.add(caliper);

  const face = W / 2 - 0.035;
  const spoke = new THREE.BoxGeometry(rim * 0.98, 0.028, 0.022);
  spoke.translate(rim * 0.5, 0, 0);
  for (let i = 0; i < 10; i++) {
    const pair = Math.floor(i / 2);
    const mesh = new THREE.Mesh(spoke, materials.rim);
    mesh.rotation.z = (pair / 5) * Math.PI * 2 + (i % 2 ? 0.13 : -0.13);
    mesh.position.z = face;
    wheel.add(mesh);
  }
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rim - 0.008, 0.012, 10, 64), materials.rim);
  lip.position.z = face + 0.008;
  wheel.add(lip);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.035, 24), materials.rim);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = face + 0.005;
  wheel.add(hub);
  return wheel;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export function buildCoupe(subject, theme) {
  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({
    color: subject.paint.color,
    metalness: subject.paint.metalness,
    roughness: subject.paint.roughness,
    clearcoat: subject.paint.clearcoat,
    clearcoatRoughness: 0.04,
  });
  const glass = new THREE.MeshPhysicalMaterial({ color: subject.glassColor, metalness: 1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0 });
  const materials = {
    rubber: new THREE.MeshStandardMaterial({ color: '#020202', roughness: 0.95 }),
    rimDark: new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.6, metalness: 0.6, side: THREE.BackSide }),
    rim: new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.28, metalness: 1 }),
    disc: new THREE.MeshStandardMaterial({ color: '#2b2b2e', roughness: 0.4, metalness: 1 }),
    accent: new THREE.MeshStandardMaterial({ color: theme.accent, roughness: 0.35, metalness: 0.8 }),
    trim: new THREE.MeshStandardMaterial({ color: '#030303', roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }),
  };

  car.add(new THREE.Mesh(loft(bodyPoint, -HALF_LENGTH, HALF_LENGTH, 280, 80), paint));
  car.add(new THREE.Mesh(loft(cabinPoint, CABIN[0], CABIN[1], 120, 56), glass));

  // Lamps are emissive patches; their brightness is driven by the timeline.
  const headMat = new THREE.MeshBasicMaterial({ color: subject.headlightColor, toneMapped: false, side: THREE.DoubleSide });
  const tailMat = new THREE.MeshBasicMaterial({ color: subject.taillightColor, toneMapped: false, side: THREE.DoubleSide });
  const head = new THREE.Mesh(wrapBand(1, 0.55, 0.585, 0.612), headMat);
  const tail = new THREE.Mesh(wrapBand(-1, 0.5, 0.715, 0.738), tailMat);
  car.add(head, tail);
  // The centre of the nose stays dark: two blades, not one bar.
  car.add(new THREE.Mesh(wrapBand(1, 0.012, 0.575, 0.622, 0.009), materials.trim));
  car.add(new THREE.Mesh(wrapBand(1, 0.2, 0.31, 0.45, 0.004), materials.trim)); // intake
  car.add(new THREE.Mesh(wrapBand(-1, 0.16, 0.33, 0.45, 0.004), materials.trim)); // diffuser

  const wheelWells = new THREE.MeshBasicMaterial({ color: '#000000' });
  for (const ax of AXLES) {
    for (const side of [1, -1]) {
      const wheel = buildWheel(materials);
      wheel.position.set(ax, WHEEL_RADIUS, side * TRACK);
      if (side < 0) wheel.rotation.y = Math.PI;
      car.add(wheel);
      const well = new THREE.Mesh(new THREE.CircleGeometry(ARCH_RADIUS, 40), wheelWells);
      well.position.set(ax, WHEEL_RADIUS, side * (WELL_Z + 0.01));
      if (side < 0) well.rotation.y = Math.PI;
      car.add(well);
      // Arch lip: a clean edge where the flank turns into the well.
      const lip = new THREE.Mesh(new THREE.TorusGeometry(ARCH_RADIUS, 0.017, 10, 64, Math.PI * 1.16), materials.trim);
      lip.rotation.z = -Math.PI * 0.08;
      lip.scale.z = 1.6;
      lip.position.set(ax, WHEEL_RADIUS, side * 0.94);
      car.add(lip);
    }
  }

  for (const side of [1, -1]) {
    const mirror = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), paint);
    mirror.scale.set(1.5, 0.75, 0.9);
    mirror.position.set(0.86, 0.98, side * 0.93);
    car.add(mirror);
  }

  // Soft glows stand in for bloom on the lamps.
  const sprite = glowTexture();
  const glows = [];
  const addGlow = (color, x, y, z, size) => {
    const mat = new THREE.SpriteMaterial({ map: sprite, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    const s = new THREE.Sprite(mat);
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.userData.base = 0.32;
    car.add(s);
    glows.push(s);
  };
  for (const side of [1, -1]) {
    addGlow(subject.headlightColor, 2.2, 0.6, side * 0.62, 1.1);
    addGlow(subject.taillightColor, -2.3, 0.73, side * 0.55, 0.7);
  }

  const headColor = new THREE.Color(subject.headlightColor);
  const tailColor = new THREE.Color(subject.taillightColor);
  car.rotation.y = THREE.MathUtils.degToRad(subject.rotationY);

  return {
    object: car,
    footprint: { halfLength: HALF_LENGTH, halfWidth: 0.98 },
    setLamps(level) {
      headMat.color.copy(headColor).multiplyScalar(0.04 + 2.2 * level);
      tailMat.color.copy(tailColor).multiplyScalar(0.06 + 1.8 * level);
      for (const g of glows) g.material.opacity = g.userData.base * level;
    },
  };
}
