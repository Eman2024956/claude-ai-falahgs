// Baghdad Street Football (15 s): Ali and Zaid pass in an old Baghdad alley, Ali dribbles and scores past the keeper.
// WORLD runs on global time t, CAMERAS on shot-local time.
import { THREE, toon, mesh, sunlight, skyGradient, makeCharacter, keys, seg, ease, lerp, clamp, wobble, title, rng,
  baghdadHouse, palm, mosque, footballBall, hangLine } from './kit.js';

const V = (x, z) => [x, z];
const angLerp = (a, b, k) => { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * k; };
const yawTo = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);

// a point moving through keyed [x,z] positions, with precomputed distance travelled (so feet don't slide)
function mover(list, D) {
  const pos = t => keys(t, list);
  const N = Math.ceil(D * 240) + 2, dist = new Float32Array(N); let prev = pos(0);
  for (let i = 1; i < N; i++) { const p = pos(i / 240); dist[i] = dist[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; }
  const d = t => { const f = clamp(t, 0, D) * 240, i = Math.floor(f); return lerp(dist[i], dist[Math.min(i + 1, N - 1)], f - i); };
  const vel = t => { const a = pos(t - 0.04), b = pos(t + 0.04); return [(b[0] - a[0]) / 0.08, (b[1] - a[1]) / 0.08]; };
  return { pos, dist: d, vel, speed: t => Math.hypot(...vel(t)) };
}
// right-leg kick layered on top of pose()
function kickLeg(c, t, tk, big = 1) {
  if (Math.abs(t - tk) > 0.5) return 0;
  c.leg.R.hp.rotation.x = keys(t, [[tk - 0.3, 0], [tk - 0.06, 0.8 * big], [tk + 0.08, -1.0 * big, 'out'], [tk + 0.45, 0]]);
  c.leg.R.kn.rotation.x = keys(t, [[tk - 0.3, 0], [tk - 0.06, 1.3], [tk + 0.08, 0.15], [tk + 0.45, 0]]);
  c.arm.L.sh.rotation.x = -0.6 * ease.arc(seg(t, tk - 0.3, tk + 0.45)); c.arm.L.sh.rotation.z = 0.12 + 0.5 * ease.arc(seg(t, tk - 0.3, tk + 0.45));
  return 1;
}

export function buildStory(stage, B) {
  const cue = B.cues, D = B.duration;

  // ------------------------------------------------ set: the alley (street runs along z, goal at z = -8)
  const scene = new THREE.Scene();
  skyGradient(scene, [[0, '#6fa8dc'], [0.5, '#bfe0ee'], [1, '#f7dcae']]);
  scene.fog = new THREE.Fog('#f0dcb4', 26, 75);
  sunlight(scene, { sun: '#ffe6bf', sky: '#cfe3ff', ground: '#b8925e', intensity: 3.0, ambient: 1.45, dir: [5, 10, 5], area: 16 });
  scene.add(mesh(new THREE.PlaneGeometry(120, 120), toon('#d4bd92', 3), { rot: [-Math.PI / 2, 0, 0] }));
  scene.add(mesh(new THREE.PlaneGeometry(3.2, 34), toon('#b9a684', 3), { pos: [0, 0.004, -3], rot: [-Math.PI / 2, 0, 0] }));
  for (const s of [-1, 1]) scene.add(mesh(new THREE.BoxGeometry(0.6, 0.08, 34), toon('#e0cba2', 3), { pos: [s * 1.9, 0.04, -3] }));
  // houses on both sides, plus a row closing each end
  const r = rng(11), pals = [];
  for (const s of [-1, 1]) for (let z = 11, i = 0; z > -17; z -= 3, i++) {
    const h = baghdadHouse(r, { w: 3, d: 3 }); h.position.set(s * 3.7, 0, z); h.rotation.y = -s * Math.PI / 2; scene.add(h);
  }
  for (const x of [-3, 0, 3]) { const h = baghdadHouse(r, { w: 3, d: 3, h: lerp(2.6, 3.2, r()) }); h.position.set(x, 0, -17.6); scene.add(h); }
  for (const x of [-3, 0, 3]) { const h = baghdadHouse(r, { w: 3, d: 3 }); h.position.set(x, 0, 14); h.rotation.y = Math.PI; scene.add(h); }
  const m = mosque(); m.position.set(3, 0, -32); m.rotation.y = -0.3; scene.add(m);
  for (const [x, z, hh] of [[-5.6, 6, 5.8], [5.8, 2, 6.2], [-6.0, -5, 6.6], [5.6, -10, 5.6], [-2.5, -21, 7], [6.5, -22, 6.4], [-6, 13, 6], [4, 16, 6.5]]) {
    const p = palm(r, { h: hh }); p.position.set(x, 0, z); scene.add(p); pals.push(p);
  }
  // pots by doors, wires and a clothesline across the alley
  for (let i = 0; i < 7; i++) {
    const s = i % 2 ? 1 : -1, z = 9 - i * 3.7;
    scene.add(mesh(new THREE.CylinderGeometry(0.16, 0.11, 0.26, 10), toon('#b5562f', 3), { pos: [s * 2.0, 0.21, z] }));
    scene.add(mesh(new THREE.IcosahedronGeometry(0.2, 1), toon('#4f8f3e', 3), { pos: [s * 2.0, 0.45, z] }));
  }
  const lines = [hangLine([-2.0, 2.65, -1.8], [2.0, 2.75, -2.2], { cloths: true, seed: 3, sag: 0.35, color: '#d8d0c0', thick: 0.01 }),
    hangLine([-2.1, 3.1, 5], [2.1, 3.0, 4.2], { sag: 0.5 }), hangLine([-2.1, 3.15, -6], [2.1, 3.1, -5.2], { sag: 0.45 }),
    hangLine([-2.1, 3.05, -11.5], [2.1, 3.2, -12.4], { sag: 0.5 }), hangLine([-2.1, 2.7, -9.5], [2.0, 2.65, -9.0], { cloths: true, seed: 8, sag: 0.3, color: '#d8d0c0', thick: 0.01 })];
  lines.forEach(l => scene.add(l));
  // the goal: two stacks of bricks
  const brickM = toon('#b5653a', 3);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++)
    scene.add(mesh(new THREE.BoxGeometry(0.34, 0.14, 0.22), brickM, { pos: [s * 0.95, 0.07 + k * 0.145, -8.3], rot: [0, k * 0.25 - 0.2, 0] }));

  // ------------------------------------------------ cast
  const cast = {
    ali: () => makeCharacter({ skin: '#c98f62', shirt: '#1f9a55', pants: '#f4f1e8', hair: '#1d1410', shoe: '#e4572e', height: 1.3 }),
    zaid: () => makeCharacter({ skin: '#dba67c', shirt: '#e4572e', pants: '#35508a', hair: '#2e1d14', shoe: '#2b2a33', height: 1.25 }),
    keeper: () => makeCharacter({ skin: '#b98055', shirt: '#ffd23f', pants: '#3a3a44', hair: '#151012', shoe: '#ffffff', height: 1.35 }),
    ball: () => footballBall(0.11),
  };
  const ali = cast.ali(), zaid = cast.zaid(), keeper = cast.keeper(), ball = cast.ball();
  scene.add(ali.root, zaid.root, keeper.root, ball);
  const SC = { ali: 1.3 / 1.55, zaid: 1.25 / 1.55 };

  // ------------------------------------------------ choreography
  const A0 = V(-0.6, 3.0), Z0 = V(0.9, 0.6), R = V(-0.4, 1.6), K = V(0.0, -5.2), K1 = [lerp(R[0], K[0], 0.86), lerp(R[1], K[1], 0.86)], C = V(-0.15, -6.3);
  const AL = mover([[0, A0], [cue['run-start'], A0], [cue.receive, R, 'in'], [8.05, K1, 'linear'], [8.6, K, 'out'], [cue.kick + 0.15, K], [9.6, [-0.08, -5.7], 'in'], [10.4, C, 'out']], D);
  const ZD = mover([[0, Z0], [5.4, Z0], [6.2, V(1.1, -0.4), 'in'], [8.8, V(1.2, -3.6), 'linear'], [10.9, V(0.85, -5.9), 'out']], D);
  const faceAZ = yawTo(A0, Z0), faceZA = yawTo(Z0, A0);
  const foot = (p, yaw, sc, ahead = 0.28) => [p[0] + Math.sin(yaw) * ahead - Math.cos(yaw) * 0.1 * sc, p[1] + Math.cos(yaw) * ahead + Math.sin(yaw) * 0.1 * sc];
  const pA = foot(A0, faceAZ, SC.ali), pZ = foot(Z0, faceZA, SC.zaid);
  const runDir = yawTo(R, K);
  const passes = [[cue.pass1, pA, pZ], [cue.pass2, pZ, pA], [cue.pass3, pA, pZ]];
  const recv = foot(R, runDir, SC.ali, 0.32);
  const kickFrom = foot(K, runDir, SC.ali, 0.3), G = [0.45, 0.42, -8.3], stopAt = [0.75, -10.4];
  const dribbleStart = AL.dist(cue.receive);
  function ballAt(t) {
    for (const [tk, a, b] of passes) {
      if (t < tk) return [a[0], 0.11, a[1]];
      if (t < tk + 0.7) { const p = ease.out(seg(t, tk, tk + 0.7)); return [lerp(a[0], b[0], p), 0.11, lerp(a[1], b[1], p)]; }
    }
    if (t < cue.pass4) return [pZ[0], 0.11, pZ[1]];
    if (t < cue.receive) { const p = ease.out(seg(t, cue.pass4, cue.receive)); return [lerp(pZ[0], recv[0], p), 0.11, lerp(pZ[1], recv[1], p)]; }
    if (t < cue.kick) { // dribble: little touches ahead of Ali
      const p = AL.pos(t), dd = AL.dist(t) - dribbleStart, touch = Math.pow(Math.sin(dd * Math.PI / 1.4), 2) * (1 - seg(t, 8.3, 8.6));
      return [...(() => { const f = foot(p, runDir, SC.ali, 0.32 + 0.22 * touch - 0.02 * seg(t, 8.3, 8.6)); return [f[0], 0.11, f[1]]; })()].map((v, i) => v);
    }
    const k0 = ballAtKick;
    if (t < cue.goal) { const p = seg(t, cue.kick, cue.goal); return [lerp(k0[0], G[0], p), lerp(0.11, G[1], p) + Math.sin(Math.PI * p) * 0.25, lerp(k0[2], G[2], p)]; }
    if (t < cue['ball-bounce']) { const p = seg(t, cue.goal, cue['ball-bounce']); return [lerp(G[0], 0.65, p), lerp(G[1], 0.11, p * p), lerp(G[2], -9.9, p)]; }
    const p = ease.out(seg(t, cue['ball-bounce'], 11.2));
    return [lerp(0.65, stopAt[0], p), 0.11 + Math.abs(Math.sin(p * Math.PI * 2)) * 0.18 * (1 - p), lerp(-9.9, stopAt[1], p)];
  }
  let ballAtKick = [0, 0.11, 0]; ballAtKick = ballAt(cue.kick - 1e-4);
  const BN = Math.ceil(D * 240) + 2, bDist = new Float32Array(BN); { let pv = ballAt(0); for (let i = 1; i < BN; i++) { const q = ballAt(i / 240); bDist[i] = bDist[i - 1] + Math.hypot(q[0] - pv[0], q[2] - pv[2]); pv = q; } }

  function poseKid(c, M, t, sc, faceYaw, extra = {}) {
    const p = M.pos(t), v = M.vel(t), sp = Math.hypot(...v);
    const walk = clamp(sp / 1.6);
    const yaw = sp > 0.15 ? angLerp(faceYaw, Math.atan2(v[0], v[1]), clamp(sp / 0.6)) : faceYaw;
    c.root.position.set(p[0], 0, p[1]);
    c.pose({ walk, phase: M.dist(t) / (1.05 * sc), yaw, blinkT: t + (extra.blinkOff || 0), headYaw: extra.headYaw || 0, armsUp: extra.armsUp || 0, bounce: extra.bounce || 0, smile: 1 });
    c.hips.rotation.x = 0.16 * walk;
    return yaw;
  }
  function world(t) {
    pals.forEach(p => p.sway(t)); lines.forEach(l => l.sway(t));
    // Ali
    const aliFace = t < cue['run-start'] - 0.3 ? faceAZ : t < cue.kick + 0.2 ? runDir : Math.PI;
    const jumpA = seg(t, cue.cheer, cue.cheer + 0.3), bA = jumpA * Math.abs(Math.sin((t - cue.cheer) * Math.PI * 1.9)) * 0.28;
    poseKid(ali, AL, t, SC.ali, aliFace, { armsUp: ease.out(jumpA), bounce: bA, headYaw: t > 2.2 && t < 4.4 ? 0 : 0 });
    for (const [tk] of passes) if (passes[1][0] !== tk) kickLeg(ali, t, tk);
    kickLeg(ali, t, cue.kick, 1.3);
    // Zaid
    const zFace = t < 5.4 ? faceZA : t < 10.9 ? yawTo(ZD.pos(t), AL.pos(t)) * 0 + Math.PI : angLerp(Math.PI, Math.PI - 0.5, seg(t, 10.9, 11.4));
    const jumpZ = seg(t, 10.9, 11.2), bZ = jumpZ * Math.abs(Math.sin((t - 10.9) * Math.PI * 2.1 + 0.6)) * 0.24;
    poseKid(zaid, ZD, t, SC.zaid, zFace, { armsUp: ease.out(jumpZ), bounce: bZ, blinkOff: 1.3, headYaw: t < 5.4 ? 0 : 0 });
    kickLeg(zaid, t, cue.pass2); kickLeg(zaid, t, cue.pass4);
    // keeper: shuffles, dives the wrong way, then gets up holding his head
    const kx = t < cue.dive ? 0.25 * Math.sin(t * 2.6) : lerp(0.25 * Math.sin(cue.dive * 2.6), -0.4, ease.out(seg(t, cue.dive, cue.dive + 0.4)));
    const dive = ease.out(seg(t, cue.dive, cue.dive + 0.4));
    keeper.root.position.set(kx - 0.0, 0.22 * ease.arc(seg(t, cue.dive, cue.dive + 0.4)), -9.0);
    keeper.pose({ walk: t < cue.dive ? 0.35 : 0, phase: t * 1.3, yaw: 0, blinkT: t + 2.1, armsUp: dive, bounce: 0, smile: t > 9.6 ? 0.4 : 1 });
    keeper.root.rotation.z = 1.25 * dive; keeper.hips.rotation.x = t < cue.dive ? 0.2 : 0;
    // ball
    const b = ballAt(t), i = clamp(t, 0, D) * 240, dd = lerp(bDist[Math.floor(i)], bDist[Math.min(Math.floor(i) + 1, BN - 1)], i - Math.floor(i));
    ball.position.set(...b);
    const dir = t < cue.kick ? (t < cue['run-start'] ? faceAZ : runDir) : Math.atan2(0.3, -1);
    ball.rotation.set(0, 0, 0); ball.rotateOnWorldAxis(new THREE.Vector3(Math.cos(dir), 0, -Math.sin(dir)), dd / 0.11);
  }
  const sets = { alley: { scene, update: t => world(t), grade: 'saturate(1.08) contrast(1.04) sepia(0.06)' } };

  // ------------------------------------------------ shots
  const hh = (l, a = 0.04, s = 0) => [wobble(l * 0.7, 1 + s) * a, wobble(l * 0.6, 2 + s) * a, 0];
  const shots = [
    { set: 'alley', dur: 4.5, cam: (l, p) => { const h = hh(l); const e = ease.io(p);
      return { pos: [lerp(1.4, 0.9, e) + h[0], lerp(4.0, 2.8, e) + h[1], lerp(9.8, 7.6, e)], look: [lerp(-0.2, 0.1, e), lerp(0.9, 0.8, e), -1.5], fov: 40 }; } },
    { set: 'alley', dur: 4.1, in: { type: 'dissolve', dur: 0.5 }, cam: (l, p) => { const h = hh(l, 0.035, 3); const a = AL.pos(4.5 + l * 0.98 + 0.05);
      return { pos: [lerp(-1.25, -1.0, p) + h[0], 1.05 + h[1], a[1] - 2.5], look: [a[0] + 0.35, 0.62, a[1] + 0.2], fov: 40 }; } },
    { set: 'alley', dur: 2.4, in: { type: 'whip', dur: 0.3, dir: 1 }, cam: (l, p) => { const h = hh(l, 0.03, 5);
      return { pos: [lerp(1.5, 1.35, p) + h[0], 1.0 + h[1], lerp(-11.6, -11.2, p)], look: [-0.1, 0.6, -6.6], fov: 40 }; } },
    { set: 'alley', dur: 4, in: { type: 'dissolve', dur: 0.5 }, cam: (l, p) => { const h = hh(l, 0.03, 7); const e = ease.io(p);
      return { pos: [lerp(0.35, 0.2, e) + h[0], lerp(0.55, 0.65, e) + h[1], lerp(-10.0, -9.6, e)], look: [0.3, 0.95, -6.0], fov: 40 }; } },
  ];

  const ink = '#4a2210';
  function overlay(g, t) {
    title(g, t, 'طوبة الدربونة', { at: cue.title, dur: 3.6, y: 0.2, size: 170, color: '#fff3d6', stroke: ink, strokeWidth: 18, dir: 'rtl', weight: 400 });
    title(g, t, 'بغداد', { at: cue.title + 0.5, dur: 3.1, y: 0.35, size: 115, color: '#ffd23f', stroke: ink, strokeWidth: 14, dir: 'rtl', weight: 400 });
    title(g, t, 'گووول!', { at: cue['goal-text'], dur: 2.0, y: 0.26, size: 260, color: '#ffd23f', stroke: '#7a1f12', strokeWidth: 22, dir: 'rtl', pop: true, in: 0.35, weight: 400 });
    title(g, t, 'يلّه نلعب!', { at: cue['end-text'], dur: D - cue['end-text'] + 1, y: 0.2, size: 170, color: '#fff3d6', stroke: ink, strokeWidth: 18, dir: 'rtl', weight: 400 });
  }
  const design = [
    { name: 'Ali', note: 'Striker. Green tee, white trousers, red shoes.', make: () => cast.ali().root },
    { name: 'Zaid', note: 'His friend. Red tee, denim.', make: () => cast.zaid().root },
    { name: 'Keeper', note: 'Yellow tee, guards the brick goal.', make: () => cast.keeper().root },
    { name: 'Ball', note: 'White football with dark patches.', make: () => cast.ball(), float: true, zoom: 0.5 },
  ];
  return { sets, shots, overlay, design, designTitle: B.title, finish: { grain: 0.05, vignette: 0.32, fadeIn: 0.4, fadeOut: 0.7 } };
}
