// Loads a ScenePlan, validates it and hands it to the runtime.
// Nothing in the plan is executed: it is checked against the schema first, and
// a plan that fails is refused with the list of problems.
import { validatePlan } from '../plan/validate.js';
import { mount } from './runtime/index.js';

const params = new URLSearchParams(location.search);

// ?plan=name loads plan/name.json, so plans can be swapped without touching code.
const name = /^[a-z0-9-]+$/.test(params.get('plan') || '') ? params.get('plan') : 'scene-plan';

// Debug flags for stills: ?p=0.5 pins the scroll progress, ?t=3 pins the clock.
const debug = {};
if (params.has('p')) debug.progress = Math.min(Math.max(Number(params.get('p')) || 0, 0), 1);
if (params.has('t')) debug.time = Number(params.get('t')) || 0;

async function boot() {
  const [plan, schema] = await Promise.all(
    [`plan/${name}.json`, 'plan/scene-plan.schema.json'].map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
      return res.json();
    }),
  );
  const errors = validatePlan(plan, schema);
  if (errors.length) throw new Error(`The scene plan is invalid:\n${errors.join('\n')}`);

  mount(plan, {
    canvas: document.getElementById('scene'),
    ui: document.getElementById('ui'),
    spacer: document.getElementById('scroll'),
    debug,
  });
}

boot().catch((error) => {
  console.error(error);
  const box = document.getElementById('error');
  box.textContent = error.message;
  box.hidden = false;
});
