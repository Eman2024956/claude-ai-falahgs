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
- `tools/serve.mjs` — small local web server. `tools/shoot.mjs` — takes the check pictures.
- `renders/<scene>/` — check pictures: `main`, `front`, `side`, `top`.
- `assets/` — downloaded free assets (create when first needed). Record each one's source and
  licence in `assets/CREDITS.md`.
- `whale-of-dreams/` — an earlier, separate project. Leave it alone unless asked.

## How to build and check a scene
```bash
npm install                        # once per fresh session
node tools/serve.mjs               # run in the background; http://localhost:5173/
node tools/shoot.mjs 01-hello-shapes   # pictures -> renders/01-hello-shapes/, prints any errors
```
- New scene: copy `scenes/01-hello-shapes/`, rename with the next number, edit `scene.js`.
- `?view=front|side|top` picks a camera angle; `?time=2.5` freezes animation at that second.
- `shoot.mjs` exits with "PROBLEMS" if the page logged errors or a file failed to load — fix those too.

## Things learned the hard way
- Playwright is pre-installed globally; load it with `createRequire` (a plain `import` fails). Do not reinstall it.
- Headless Chromium needs `--use-angle=swiftshader --enable-unsafe-swiftshader` for 3D to draw.
- Shadows: set `material.shadowSide = THREE.FrontSide` plus a small `normalBias`, otherwise a
  bright gap appears where an object touches the floor.
- Hide the floor's edge with a very wide floor plus fog in the sky colour.
- Network: this cloud environment only allows listed sites. Allowed so far: `api.polyhaven.com`,
  `dl.polyhaven.org`, `ambientcg.com`. If a download is blocked, ask the user to approve the new address.
- Fab needs a logged-in account, so the user has to download Fab files themselves and upload them here.
