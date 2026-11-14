# Noir Showroom

A black luxury-car site: a car in a dark showroom with a reflective marble floor, light shafts, drifting dust and a slowly orbiting camera. Scrolling travels from the showroom to the specifications.

The page is not hand-written for this scene. A plain-language brief is compiled into a **scene plan** (JSON), and a fixed runtime renders whatever the plan says.

```
plan/brief.txt ──► planner ──► plan/scene-plan.json ──► validate ──► runtime ──► page
 (the request)    (rules)      (scene + animation)      (schema)    (Three.js)
```

## Run

```bash
python3 -m http.server 8124
```

Open http://localhost:8124. Three.js r170 is vendored; only the fonts load from the network.

## Change the site

Edit `plan/brief.txt`, then:

```bash
npm run plan
```

This prints which phrase set which part of the plan, and rewrites `plan/scene-plan.json`. `npm run check` fails if the committed plan is invalid or no longer matches the brief.

An Arabic brief works too: edit `plan/brief.ar.txt`, run `npm run plan:ar`, and open `?plan=scene-plan-ar`. Arabic is read with a dictionary (`planner/lexicon.ar.json`) and audited for unknown words, negation and conflicts; see `GUIDE-AR.md`.

You can also edit the plan by hand, or save another one as `plan/<name>.json` and open `?plan=<name>`.

## What is in the plan

| Part | Describes |
| --- | --- |
| `meta` | The brief, the phrase-to-plan mapping (`intents`), and any clause no rule understood (`unresolved`) |
| `theme` | Page colours |
| `scene` | Room, floor, subject, lights (softbox, spot with a visible shaft, ambient), particles |
| `camera` | Lens and the idle orbit |
| `timeline` | Keyframe tracks driven by scroll progress from 0 to 1 |
| `content` | Brand, sections, figures, links |

A timeline track names one property and lists keyframes:

```json
{ "target": "camera.azimuth", "keys": [{ "at": 0.28, "value": 66 }, { "at": 0.52, "value": 0, "ease": "inOutCubic" }] }
```

Animatable properties are a fixed list: `camera.azimuth`, `camera.elevation`, `camera.radius`, `camera.fov`, `camera.orbit`, `camera.frame`, `camera.target.x|y|z`, `environment.exposure`, `environment.reflections`, `beams.opacity`, `particles.opacity`, `floor.reflectivity`, `floor.ring`, `subject.lamps`, `lights.<id>.intensity`.

## Why a plan and not generated code

- The plan is data. The runtime never evaluates anything from it, and `plan/validate.js` refuses unknown properties, out-of-range numbers, unknown animation targets and links other than in-page anchors and `mailto:`.
- The same validator runs in the planner and again in the browser before anything is built.
- Every value traces back to a phrase in the brief through `meta.intents`.

## Limits

- The planner is rule-based (`planner/rules.mjs`). It understands the vocabulary of this kind of brief: subject, paint colour, tone, showroom, marble, volumetric lighting, particles, camera orbit and speed, scroll, specifications. Anything else is listed in `meta.unresolved` and left out. A language model could replace the planner, as long as its output passes the same schema.
- One environment (`showroom`), one floor (`marble`) and one model (`coupe`) exist. New ones are added to the runtime and to the schema's enums.
- The car is generated from maths in `src/runtime/car.js`, so it is a stylised shape and not a real model. To use a real one, register a loader in `ASSETS` in `src/runtime/index.js`.
- Brand, model name and figures in `planner/content.mjs` are placeholders for a fictional car.

## Files

| Path | What it is |
| --- | --- |
| `plan/scene-plan.schema.json` | The plan's schema (JSON Schema) |
| `plan/validate.js` | Schema check plus cross-checks (light ids, key order, link targets) |
| `planner/` | `compile.mjs` (CLI), `rules.mjs` (phrase rules and the scroll choreography), `content.mjs` (copy) |
| `src/runtime/index.js` | Builds the scene from the plan and runs the frame loop |
| `src/runtime/stage.js` | Room, lights and shafts, marble floor with reflection, particles |
| `src/runtime/car.js` | The procedural coupe |
| `src/runtime/timeline.js` | Keyframe sampling |
| `src/runtime/content.js` | Header, sections and figures from `plan.content` |

Debug flags for stills: `?p=0.52` pins scroll progress, `?t=2` pins the clock.
