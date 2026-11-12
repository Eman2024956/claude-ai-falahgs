// Downloads free (CC0) assets from Poly Haven into assets/polyhaven/<name>/.
// Run:  node tools/get-polyhaven.mjs model sofa_03
//       node tools/get-polyhaven.mjs texture herringbone_parquet
//       node tools/get-polyhaven.mjs hdri belfast_sunset 2k
// Already-downloaded files are skipped, so it is safe to run again.
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [kind, id, res = '1k'] = process.argv.slice(2);
if (!['model', 'texture', 'hdri'].includes(kind) || !id) {
  console.error('Usage: node tools/get-polyhaven.mjs <model|texture|hdri> <asset-name> [1k|2k|4k]');
  process.exit(1);
}
const outDir = path.join(root, 'assets', 'polyhaven', id);

async function save(url, relPath) {
  const file = path.join(outDir, relPath);
  if (!file.startsWith(outDir)) throw new Error('unsafe path ' + relPath);
  try { await access(file); return; } catch {}
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await r.arrayBuffer()));
  console.log('downloaded', path.relative(root, file));
}

const r = await fetch(`https://api.polyhaven.com/files/${id}`);
if (!r.ok) throw new Error(`Poly Haven does not know "${id}" (${r.status})`);
const files = await r.json();

if (kind === 'model') {
  const g = files.gltf[res].gltf;
  await save(g.url, `${id}.gltf`);
  for (const [rel, f] of Object.entries(g.include || {})) await save(f.url, rel);
} else if (kind === 'texture') {
  // colour, bumps (normal), and a packed map of shading/roughness/metal
  const wanted = { Diffuse: 'diff', nor_gl: 'nor', arm: 'arm' };
  for (const [key, short] of Object.entries(wanted)) {
    const f = files[key]?.[res]?.jpg;
    if (f) await save(f.url, `${short}.jpg`);
  }
} else {
  await save(files.hdri[res].hdr.url, `${id}_${res}.hdr`);
}
console.log('done:', id);
