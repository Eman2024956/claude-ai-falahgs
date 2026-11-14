// The planner's concepts. Each rule is one thing a brief can ask for: `apply`
// edits the plan from a small set of arguments, and can only write data the
// schema allows. `pattern` and `args` are the English front end; the Arabic
// front end (arabic.mjs + lexicon.ar.json) produces the same arguments from a
// dictionary. A request outside this vocabulary is not guessed at: it is
// listed in plan.meta.unresolved.

const PAINTS = {
  black: '#050507', white: '#e9e7e2', silver: '#9a9da3', grey: '#3a3d42', gray: '#3a3d42',
  red: '#5c0a0f', blue: '#0a1a3d', green: '#0c2a1d',
};

const SPEEDS = { slow: 4, fast: 14 };
const SPEED_WORDS = { slowly: 'slow', slow: 'slow', gently: 'slow', quickly: 'fast', fast: 'fast' };

export const rules = [
  {
    intent: 'subject',
    pattern: /\b(?:luxury[- ]?|sports[- ]?)?(?:car|coupe|coupé)\b/i,
    sets: ['scene.subject.asset'],
    apply(plan) {
      plan.scene.subject.asset = 'coupe';
    },
  },
  {
    intent: 'paint',
    pattern: /\b(black|white|silver|gr[ae]y|red|blue|green)\b(?=[^.]*\bcar\b)/i,
    sets: ['scene.subject.paint.color'],
    args: (match) => ({ color: match[1].toLowerCase() }),
    apply(plan, { color }) {
      plan.scene.subject.paint.color = PAINTS[color];
    },
  },
  {
    intent: 'tone',
    pattern: /\b(premium|luxury|luxurious|high[- ]end)\b/i,
    sets: ['theme.accent', 'scene.subject.paint', 'scene.floor.accentColor', 'scene.floor.ring'],
    apply(plan) {
      plan.theme.accent = '#c8a46a';
      Object.assign(plan.scene.subject.paint, { metalness: 0.9, roughness: 0.22, clearcoat: 1 });
      plan.scene.floor.accentColor = '#c8a46a';
      plan.scene.floor.ring = { radius: 3.7, color: '#f0d9b0', intensity: 1.6 };
    },
  },
  {
    intent: 'environment',
    pattern: /\b(?:dark\s+)?(?:cinematic\s+)?showroom\b/i,
    sets: ['scene.environment', 'theme.background', 'theme.text', 'theme.muted'],
    args: (match) => ({ dark: /dark|cinematic/i.test(match[0]) }),
    apply(plan, { dark }) {
      Object.assign(plan.scene.environment, {
        type: 'showroom',
        radius: 24,
        height: 7.5,
        wallColor: dark ? '#060608' : '#2a2a2e',
        fogColor: dark ? '#030304' : '#1c1c20',
        fogDensity: dark ? 0.034 : 0.02,
        exposure: dark ? 1 : 1.3,
        slats: { count: 44, color: '#ffe9cf', intensity: dark ? 1.5 : 2.4 },
      });
      if (dark) Object.assign(plan.theme, { background: '#030304', text: '#f3efe8', muted: '#9c968c' });
    },
  },
  {
    intent: 'floor',
    pattern: /\b(?:(black|white|dark|light)\s+)?marble(?:\s+floor(?:ing)?)?\b/i,
    sets: ['scene.floor'],
    args: (match) => ({ light: /white|light/i.test(match[1] || '') }),
    apply(plan, { light }) {
      Object.assign(plan.scene.floor, {
        material: 'marble',
        baseColor: light ? '#cfcac2' : '#0a0a0c',
        veinColor: light ? '#6e6a66' : '#8d877e',
        veinScale: 2.6,
        tileSize: 2.4,
        reflectivity: light ? 0.35 : 0.62,
        roughness: 0.22,
      });
    },
  },
  {
    intent: 'lighting',
    pattern: /\b(?:soft\s+)?volumetric(?:[- ]looking)?\s+light(?:ing|s)?\b/i,
    sets: ['scene.lights'],
    args: (match) => ({ soft: /soft/i.test(match[0]) }),
    apply(plan, { soft }) {
      const beam = { opacity: soft ? 0.34 : 0.6 };
      plan.scene.lights = [
        { id: 'fill', type: 'ambient', color: '#b9c4d6', intensity: 0.12 },
        // Long softboxes: these draw the highlight lines along the bodywork.
        { id: 'box-centre', type: 'softbox', color: '#fff3e2', intensity: 9, position: [0, 5.6, 0], size: [8.5, 1.1] },
        { id: 'box-left', type: 'softbox', color: '#ffe8cf', intensity: 6, position: [0, 5.1, 3.4], size: [9.5, 0.55] },
        { id: 'box-right', type: 'softbox', color: '#ffe8cf', intensity: 6, position: [0, 5.1, -3.4], size: [9.5, 0.55] },
        // Spots with visible shafts: the "volumetric" part.
        { id: 'key', type: 'spot', color: '#ffe6c4', intensity: 26, position: [2.6, 7, 2.2], target: [0.6, 0, 0], angle: soft ? 17 : 13, beam },
        { id: 'rim', type: 'spot', color: '#cfe0ff', intensity: 18, position: [-3.4, 7, -2.4], target: [-0.8, 0, 0], angle: soft ? 15 : 12, beam },
        { id: 'kicker', type: 'spot', color: '#ffe6c4', intensity: 12, position: [-0.5, 7, 4.2], target: [0, 0, 1.2], angle: soft ? 12 : 10, beam },
      ];
    },
  },
  {
    intent: 'particles',
    pattern: /\b(?:floating\s+)?(?:particles|dust|motes)\b/i,
    sets: ['scene.particles'],
    apply(plan) {
      plan.scene.particles = { count: 1400, color: '#ffe9cc', size: 0.03, opacity: 0.75, bounds: [16, 6, 16], drift: 0.12 };
    },
  },
  {
    intent: 'camera',
    pattern: /\bcamera\b[^.]*?\b(?:(slowly|slow|gently|quickly|fast)\s+)?(?:moves?|orbits?|circles?|rotates?|travels?)\s+around\b/i,
    sets: ['camera.orbit'],
    args: (match) => ({ speed: SPEED_WORDS[(match[1] || '').toLowerCase()] }),
    apply(plan, { speed }) {
      plan.camera.orbit.speed = SPEEDS[speed] ?? 8;
    },
  },
  {
    intent: 'scroll-driver',
    pattern: /\bscroll(?:s|ing)?\b/i,
    sets: ['timeline.driver', 'timeline.scrollPages'],
    apply(plan) {
      plan.timeline.driver = 'scroll';
      plan.timeline.scrollPages = 6.5;
      plan.timeline.smoothing = 0.22;
    },
  },
  {
    intent: 'specifications',
    pattern: /\b(?:transition\b[^.]*?)?(?:product\s+)?spec(?:ification)?s\b/i,
    sets: ['timeline.tracks', 'content.sections'],
    apply(plan, args, content) {
      plan.content.sections = content.sections;
      plan.timeline.tracks = showroomToSpecs();
    },
  },
];

// Scroll choreography: hold the showroom, then travel to one shot per section
// while the room's atmosphere recedes so the numbers can be read.
// Times line up with the section ranges in content.mjs.
function showroomToSpecs() {
  const key = (at, value, ease = 'inOutCubic') => ({ at, value, ease });
  return [
    { target: 'camera.orbit', keys: [key(0, 1), key(0.07, 1), key(0.24, 0), key(0.86, 0), key(1, 1, 'inOutSine')] },
    { target: 'camera.azimuth', keys: [key(0, 52), key(0.07, 52), key(0.28, 66), key(0.52, 0), key(0.755, -52), key(0.96, -74)] },
    { target: 'camera.elevation', keys: [key(0, 9), key(0.07, 9), key(0.28, 5), key(0.52, 6), key(0.755, 33), key(0.96, 9)] },
    { target: 'camera.radius', keys: [key(0, 9.4), key(0.07, 9.4), key(0.28, 5.6), key(0.52, 9.3), key(0.755, 9.6), key(0.96, 9.6)] },
    { target: 'camera.target.x', keys: [key(0.07, 0), key(0.28, 1.1), key(0.52, 0)] },
    { target: 'camera.target.y', keys: [key(0.07, 0.75), key(0.28, 0.62), key(0.52, 0.7), key(0.755, 0.5), key(0.96, -0.35)] },
    // Slides the picture sideways (fraction of the viewport) to make room for text.
    { target: 'camera.frame', keys: [key(0, 0.13), key(0.07, 0.13), key(0.28, 0.16), key(0.4, 0), key(0.52, -0.19), key(0.64, 0), key(0.755, 0.2), key(0.88, 0)] },
    { target: 'beams.opacity', keys: [key(0.07, 1), key(0.28, 0.45), key(0.52, 0.12), key(0.755, 0.2), key(0.96, 0.8)] },
    { target: 'particles.opacity', keys: [key(0.07, 1), key(0.28, 0.6), key(0.52, 0.15), key(0.755, 0.2), key(0.96, 0.9)] },
    { target: 'environment.exposure', keys: [key(0.24, 1), key(0.52, 0.82), key(0.755, 0.9), key(0.96, 1)] },
    { target: 'floor.ring', keys: [key(0.07, 1), key(0.28, 0.35), key(0.52, 0.6), key(0.96, 1)] },
    { target: 'subject.lamps', keys: [key(0.24, 1), key(0.52, 0.4), key(0.755, 0.7), key(0.9, 1)] },
  ];
}
