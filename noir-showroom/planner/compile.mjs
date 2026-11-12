#!/usr/bin/env node
// brief (plain language) -> ScenePlan (JSON).
//
//   node planner/compile.mjs                 writes plan/scene-plan.json from plan/brief.txt
//   node planner/compile.mjs --check         fails if the committed plan is stale or invalid
//   node planner/compile.mjs my-brief.txt out.json
//
// The planner is deterministic and rule-based (see rules.mjs). Its only output
// is data, and that data is validated before it is written.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rules } from './rules.mjs';
import { content } from './content.mjs';
import { validatePlan } from '../plan/validate.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// What you get when the brief says nothing: a plain, evenly lit studio.
function basePlan(brief) {
  return {
    version: 1,
    meta: { title: content.title, description: content.description, brief, intents: [], unresolved: [] },
    theme: { background: '#101012', text: '#f2f2f2', muted: '#9a9a9a', accent: '#d0d0d0' },
    scene: {
      environment: { type: 'showroom', radius: 24, height: 7.5, wallColor: '#2a2a2e', fogColor: '#1c1c20', fogDensity: 0.02, exposure: 1.2 },
      floor: { material: 'marble', baseColor: '#2a2a2c', veinColor: '#2a2a2c', accentColor: '#2a2a2c', veinScale: 2.6, tileSize: 0, reflectivity: 0.15, roughness: 0.6 },
      subject: {
        asset: 'coupe',
        paint: { color: '#3a3d42', metalness: 0.6, roughness: 0.4, clearcoat: 0.6 },
        glassColor: '#07080a',
        headlightColor: '#eaf2ff',
        taillightColor: '#ff1a22',
        rotationY: 0,
      },
      lights: [
        { id: 'fill', type: 'ambient', color: '#ffffff', intensity: 0.4 },
        { id: 'box-centre', type: 'softbox', color: '#ffffff', intensity: 8, position: [0, 5.6, 0], size: [8.5, 2.5] },
      ],
    },
    camera: { fov: 32, damping: 0.5, orbit: { target: [0, 0.75, 0], radius: 9.4, elevation: 9, azimuth: 52, speed: 0 } },
    timeline: { driver: 'scroll', scrollPages: 1, smoothing: 0.2, tracks: [] },
    content: { brand: content.brand, sections: [content.sections[0]] },
  };
}

export function compile(brief) {
  const plan = basePlan(brief.trim());
  const covered = [];
  for (const rule of rules) {
    const match = rule.pattern.exec(brief);
    if (!match) continue;
    rule.apply(plan, match, content);
    plan.meta.intents.push({ intent: rule.intent, phrase: match[0].replace(/\s+/g, ' '), sets: rule.sets });
    covered.push([match.index, match.index + match[0].length]);
  }

  // Any clause that no rule touched is reported back instead of being invented.
  const clause = /[^.,;!?\n]+/g;
  let m;
  while ((m = clause.exec(brief))) {
    const from = m.index;
    const to = from + m[0].length;
    const words = m[0].trim().split(/\s+/).length;
    const hit = covered.some(([a, b]) => a < to && b > from);
    if (!hit && words >= 3) plan.meta.unresolved.push(m[0].trim());
  }
  return plan;
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const [briefPath = resolve(root, 'plan/brief.txt'), outPath = resolve(root, 'plan/scene-plan.json')] = args.filter((a) => !a.startsWith('--'));
  const schema = JSON.parse(readFileSync(resolve(root, 'plan/scene-plan.schema.json'), 'utf8'));

  const plan = compile(readFileSync(briefPath, 'utf8'));
  const errors = validatePlan(plan, schema);
  if (errors.length) {
    console.error(`The plan is invalid:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  const json = JSON.stringify(plan, null, 2) + '\n';

  if (checkOnly) {
    const committed = readFileSync(outPath, 'utf8');
    if (committed !== json) {
      console.error(`${outPath} is out of date. Run: npm run plan`);
      process.exit(1);
    }
    console.log(`ok: plan is valid and matches the brief (${plan.meta.intents.length} intents, ${plan.meta.unresolved.length} unresolved)`);
    return;
  }

  writeFileSync(outPath, json);
  console.log(`wrote ${outPath}`);
  for (const i of plan.meta.intents) console.log(`  ${i.intent.padEnd(15)} "${i.phrase}" -> ${i.sets.join(', ')}`);
  for (const u of plan.meta.unresolved) console.log(`  unresolved      "${u}"`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
