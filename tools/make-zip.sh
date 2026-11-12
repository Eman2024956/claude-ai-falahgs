#!/bin/bash
# Packs the scene workshop into three-scenes.zip (includes three.js so only Node.js is needed to run it).
set -e
cd "$(dirname "$0")/.."
rm -f three-scenes.zip
zip -rq three-scenes.zip README.md CLAUDE.md package.json package-lock.json lib tools scenes assets renders \
  node_modules/three/package.json node_modules/three/LICENSE node_modules/three/build/three.module.js \
  node_modules/three/build/three.core.js node_modules/three/examples/jsm/controls \
  node_modules/three/examples/jsm/loaders node_modules/three/examples/jsm/utils
ls -lh three-scenes.zip
