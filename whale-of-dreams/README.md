# Whale of Dreams — hero

Cinematic hero section: a flower-covered humpback whale (modelled, textured, rigged and animated in **Blender**) swimming through a volumetric pink cloudscape, rendered with **Three.js**.

## Run

```bash
python3 -m http.server 8123
```
Open http://localhost:8123. Everything is local (Three.js r170 is vendored), except the Google Fonts.

## Structure
| Path | What it is |
| --- | --- |
| `blender/build_whale.py` | Builds the whole whale procedurally in Blender: closed body with ventral pleats, tubercles, eyes, scalloped pectoral fins, dorsal hump, serrated flukes, painted albedo + normal maps, ~260 3D flowers with foliage, an armature, and a seamless 12 s swim loop. |
| `build.sh` | Runs the Blender script (`blender -b -P` or `pip install bpy`), then compresses it with gltf-transform (meshopt + WebP) to `assets/whale.glb` (~2 MB). |
| `src/main.js` | Scene, lighting, render passes, camera framing, parallax, loading, fallback, reduced motion. |
| `src/shaders.js` | Sky, raymarched volumetric clouds (near/far split around the headline), soft-depth smoke puffs, composite. |
| `src/noise.js` | Tileable 3D Perlin-Worley noise volume for the clouds. |
| `src/headline.js` | "DREAM BIG" drawn into the composite so the whale can swim in front of it; masked per-letter reveal. |

## How it renders (each frame)
1. Whale and sky go into an HDR target with MSAA and depth.
2. Pink smoke puffs attached to the whale's bones, with soft edges where they meet the body (they fade against the scene depth).
3. Volumetric clouds raymarched at a lower resolution against the scene depth. They are written in two layers, nearer and farther than the headline plane.
4. Composite: far clouds → headline → whale → smoke → near mist, then Neutral tone mapping.

## Debug URL flags
`?orbit` free orbit camera (`&view=az,el,dist`), `?t=4` freeze time, `?cam=az,el,dist` fixed hero camera, `?still` reduced-motion mode, `?notext` hide headline, `?instant` skip the reveal.
