// Samples the plan's keyframe tracks. A track names one property from a fixed
// list; the plan can move those properties and nothing else.

const EASE = {
  linear: (t) => t,
  inOutSine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
};

export function sampleTrack(keys, p) {
  if (p <= keys[0].at) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (p <= b.at) {
      const a = keys[i - 1];
      const t = (p - a.at) / (b.at - a.at);
      return a.value + (b.value - a.value) * EASE[b.ease || 'inOutCubic'](t);
    }
  }
  return keys[keys.length - 1].value;
}

// Starting values for every animatable property, taken from the plan's static
// description. Tracks then override them as the page scrolls.
export function initialState(plan) {
  const o = plan.camera.orbit;
  const state = {
    'camera.azimuth': o.azimuth,
    'camera.elevation': o.elevation,
    'camera.radius': o.radius,
    'camera.fov': plan.camera.fov,
    'camera.orbit': 1,
    'camera.frame': 0,
    'camera.target.x': o.target[0],
    'camera.target.y': o.target[1],
    'camera.target.z': o.target[2],
    'environment.exposure': plan.scene.environment.exposure,
    'environment.reflections': 1,
    'beams.opacity': 1,
    'particles.opacity': 1,
    'floor.reflectivity': plan.scene.floor.reflectivity,
    'floor.ring': 1,
    'subject.lamps': 1,
  };
  for (const light of plan.scene.lights) state[`lights.${light.id}.intensity`] = 1;
  return state;
}

export function createTimeline(plan) {
  const state = initialState(plan);
  const tracks = plan.timeline.tracks.filter((t) => t.target in state);
  return {
    state,
    evaluate(progress) {
      for (const track of tracks) state[track.target] = sampleTrack(track.keys, progress);
      return state;
    },
  };
}
