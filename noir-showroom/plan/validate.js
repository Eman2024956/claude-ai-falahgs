// Validates a ScenePlan against scene-plan.schema.json, then runs the checks a
// schema cannot express. Pure and dependency-free: the planner (Node) and the
// runtime (browser) both call it, so a plan that reaches the renderer has
// already been proven to contain nothing but known, bounded data.

const typeOf = (v) =>
  Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v;

function check(node, schema, root, path, errors) {
  if (schema.$ref) {
    const name = schema.$ref.replace('#/$defs/', '');
    return check(node, root.$defs[name], root, path, errors);
  }
  if ('const' in schema && node !== schema.const) {
    return errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(node)) {
    return errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  }
  if (schema.type) {
    const t = typeOf(node);
    const ok = t === schema.type || (schema.type === 'number' && t === 'integer');
    if (!ok) return errors.push(`${path}: expected ${schema.type}, got ${t}`);
  }
  if (typeof node === 'number') {
    if (!Number.isFinite(node)) errors.push(`${path}: must be finite`);
    if (schema.minimum !== undefined && node < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && node > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (typeof node === 'string') {
    if (schema.maxLength !== undefined && node.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(node)) errors.push(`${path}: "${node}" is not allowed here`);
  }
  if (Array.isArray(node)) {
    if (schema.minItems !== undefined && node.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && node.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) node.forEach((item, i) => check(item, schema.items, root, `${path}[${i}]`, errors));
  }
  if (typeOf(node) === 'object' && schema.properties) {
    for (const key of schema.required || []) {
      if (!(key in node)) errors.push(`${path}.${key}: missing`);
    }
    for (const key of Object.keys(node)) {
      const child = schema.properties[key];
      if (child) check(node[key], child, root, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unknown property`);
    }
  }
}

function checkMeaning(plan, errors) {
  const lightIds = new Set();
  plan.scene.lights.forEach((light, i) => {
    const at = `plan.scene.lights[${i}]`;
    if (lightIds.has(light.id)) errors.push(`${at}.id: "${light.id}" is used twice`);
    lightIds.add(light.id);
    if (light.type !== 'ambient' && !light.position) errors.push(`${at}: a ${light.type} needs a position`);
    if (light.type === 'softbox' && !light.size) errors.push(`${at}: a softbox needs a size`);
    if (light.type === 'spot' && !light.angle) errors.push(`${at}: a spot needs an angle`);
  });

  const seenTargets = new Set();
  plan.timeline.tracks.forEach((track, i) => {
    const at = `plan.timeline.tracks[${i}]`;
    if (seenTargets.has(track.target)) errors.push(`${at}.target: "${track.target}" has two tracks`);
    seenTargets.add(track.target);
    const light = /^lights\.(.+)\.intensity$/.exec(track.target);
    if (light && !lightIds.has(light[1])) errors.push(`${at}.target: no light called "${light[1]}"`);
    if (track.target === 'particles.opacity' && !plan.scene.particles) errors.push(`${at}.target: the scene has no particles`);
    for (let k = 1; k < track.keys.length; k++) {
      if (track.keys[k].at <= track.keys[k - 1].at) errors.push(`${at}.keys[${k}].at: keys must be in ascending order`);
    }
  });

  const sectionIds = new Set();
  plan.content.sections.forEach((section, i) => {
    const at = `plan.content.sections[${i}]`;
    if (sectionIds.has(section.id)) errors.push(`${at}.id: "${section.id}" is used twice`);
    sectionIds.add(section.id);
    if (section.range[0] >= section.range[1]) errors.push(`${at}.range: must go from a lower to a higher value`);
  });
  plan.content.sections.forEach((section, i) => {
    (section.actions || []).forEach((action, k) => {
      const anchor = action.href.startsWith('#') ? action.href.slice(1) : null;
      if (anchor && !sectionIds.has(anchor)) {
        errors.push(`plan.content.sections[${i}].actions[${k}].href: no section called "${anchor}"`);
      }
    });
  });
}

export function validatePlan(plan, schema) {
  const errors = [];
  check(plan, schema, schema, 'plan', errors);
  if (errors.length === 0) checkMeaning(plan, errors);
  return errors;
}
