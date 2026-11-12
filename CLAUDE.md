# Notes for Claude — three.js scene workshop

## Who I'm working with
The user is **not technical**. Explain everything in plain English: no jargon without a
one-line explanation, describe what changed and what it looks like rather than how the code works.

## House rules (from the user)
1. **Run things for them.** Set up and run three.js in the background; they should not have to type commands.
2. **Every scene is a saved script** in this folder, so we can change one thing and rebuild it.
3. **Look before showing.** After every build, take screenshots, look at them yourself, and fix
   anything that looks wrong *before* showing the user.
4. **If they must click something, say exactly where** (which screen, which button, what it says).
5. **Free assets only**: Poly Haven, ambientCG, free Fab assets. **Never buy anything or turn on a
   paid service without asking first.**
6. **Big builds: plan first.** Show a short plan and the first piece, get a yes, then build the rest.

## How this folder is organised
- `scenes/<number>-<name>/` — one folder per scene: `index.html` (the page) and `scene.js` (the scene).
  Each `scene.js` starts with a `SETTINGS` block — the "things you can change" (colours, sizes, speeds).
- `lib/stage.js` — shared setup (window, camera, mouse orbit controls, check-picture camera angles).
- `lib/assets.js` — loads Poly Haven models, surfaces and sky photos; `place()` sits an object on a surface.
- `tools/serve.mjs` — small local web server. `tools/shoot.mjs` — takes the check pictures.
- `tools/get-polyhaven.mjs` — downloads a free Poly Haven model / texture / sky into `assets/polyhaven/`.
- `tools/render-video.mjs` — renders a scene's animation to video: `node tools/render-video.mjs <scene>` (MP4)
  and `... <scene> transparent` (ProRes 4444 .mov + WebM with see-through background). 1920×1080, 30 fps, 4 s
  by default (`SECONDS`, `FPS`, `WIDTH`, `HEIGHT` to change). Frames and the big .mov are not saved to git.
- `tools/make-zip.sh` — packs the workshop into `three-scenes.zip` for the user to download.
- `renders/<scene>/` — check pictures: `main`, `front`, `side`, `top`.
- `assets/` — downloaded free assets. Record each one's source and licence in `assets/CREDITS.md`.
- `whale-of-dreams/` — an earlier, separate project. Leave it alone unless asked.

## How to build and check a scene
```bash
npm install                        # once per fresh session
node tools/serve.mjs               # run in the background; http://localhost:5173/
node tools/shoot.mjs 01-hello-shapes   # pictures -> renders/01-hello-shapes/, prints any errors
node tools/shoot.mjs 02-cozy-room-sunset window sofa   # extra angles a scene defines itself
NODE_USE_ENV_PROXY=1 node tools/get-polyhaven.mjs model sofa_03   # also: texture <name>, hdri <name> 2k
```
- New scene: copy `scenes/01-hello-shapes/`, rename with the next number, edit `scene.js`.
- `?view=front|side|top` picks a camera angle; `?time=2.5` freezes animation at that second.
- `shoot.mjs` exits with "PROBLEMS" if the page logged errors or a file failed to load — fix those too.

## Things learned the hard way
- Metal looking washed-out white: with `scene.environment`, `material.envMapIntensity` does nothing —
  use `scene.environmentIntensity`, and keep direct lights on metal dim (about 0.3).
- Logo scenes: `SVGLoader` + `ExtrudeGeometry`; set `bevelOffset = -bevelSize` so the bevel does not fatten
  thin letters. Animated scenes take time from `?time=` / `window.__renderAt(seconds)` so renders are repeatable.
- The user's logo: `assets/logos/tawassl/original.webp` (full colour, transparent background). Brand colours
  sampled from it: gold `#FDBD03`, charcoal `#272A2E`. Channel name: Tawassl.
  `python3 tools/logo-from-image.py <picture> <folder>` traces it into `layers.svg` (dark / gold / name parts)
  plus `color.png`, which the scene paints onto the metal (needs `pip install opencv-python-headless potracer`;
  potracer's `Bitmap` treats True as empty, so pass the inverted mask).
- Brand-coloured metal: use `trueColors: true` in `createStage` (neutral tone mapping) and keep reflections
  low (about 0.35), or yellow turns pale or peach. Charcoal parts need `darkPartsBrightness` to show on black.
- Sound: `python3 tools/make-intro-sound.py scenes/<scene>/sound.wav` generates original audio (no downloads);
  `render-video.mjs` adds a scene's `sound.wav` to every video automatically. Claude cannot listen to audio —
  say so, and check levels with ffmpeg `volumedetect` instead.
- Start the server as a background task with the longest timeout (2 hours). It is stopped when the
  limit runs out; if `shoot.mjs` times out on `page.goto`, the server has died — restart it.
- Indoor scenes: walls are one-sided (visible from inside only) so the camera can orbit outside;
  give them `shadowSide = DoubleSide` so they still block sunlight.
- A lamp's light casts big shadows from anything just above it (shelves) — keep lamps away from shelves.
- Some Poly Haven wall photos are dark; use `usePhotoColor: false` to keep the bumps but pick the colour.
- `loadSky()` finds the sun in the sky photo; scenes rotate the sky so it lines up with the sunlight.
- Node downloads need `NODE_USE_ENV_PROXY=1` to get through this environment's proxy.
- Playwright is pre-installed globally; load it with `createRequire` (a plain `import` fails). Do not reinstall it.
- Headless Chromium needs `--use-angle=swiftshader --enable-unsafe-swiftshader` for 3D to draw.
- Shadows: set `material.shadowSide = THREE.FrontSide` plus a small `normalBias`, otherwise a
  bright gap appears where an object touches the floor.
- Hide the floor's edge with a very wide floor plus fog in the sky colour.
- Network: this cloud environment only allows listed sites. Allowed so far: `api.polyhaven.com`,
  `dl.polyhaven.org`, `ambientcg.com`. If a download is blocked, ask the user to approve the new address.
- Fab needs a logged-in account, so the user has to download Fab files themselves and upload them here.
