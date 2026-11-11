#!/usr/bin/env bash
# Rebuild the whale: Blender (bpy) -> raw GLB -> meshopt/webp optimised GLB for the web.
set -euo pipefail
cd "$(dirname "$0")"
if command -v blender >/dev/null; then blender -b -P blender/build_whale.py; else python3 blender/build_whale.py; fi
npx -y @gltf-transform/cli@4.5.1 optimize blender/whale_raw.glb assets/whale.glb \
  --compress meshopt --texture-compress webp \
  --prune-attributes false --palette false --resample false --flatten false --join false --instance false
