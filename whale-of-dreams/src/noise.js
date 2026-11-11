// Tileable 3D noise volume for the volumetric clouds.
//   R: Perlin-Worley "billow" shape noise (low frequency, rounded cauliflower heaps)
//   G: Worley fBm detail noise (used to erode / wisp the edges)
import * as THREE from 'three';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWorley(cells, rnd) {
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  return function (x, y, z) {
    // x,y,z in [0,1)
    const fx = x * cells, fy = y * cells, fz = z * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    let md = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells, wz = ((cz % cells) + cells) % cells;
      const k = ((wz * cells + wy) * cells + wx) * 3;
      const px = cx + pts[k] - fx, py = cy + pts[k + 1] - fy, pz = cz + pts[k + 2] - fz;
      const d = px * px + py * py + pz * pz;
      if (d < md) md = d;
    }
    return Math.min(1, Math.sqrt(md));
  };
}

function makeValue(period, rnd) {
  const n = period;
  const lat = new Float32Array(n * n * n);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const at = (x, y, z) => lat[(((z % n) + n) % n * n + (((y % n) + n) % n)) * n + (((x % n) + n) % n)];
  const s = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return function (x, y, z) {
    const fx = x * n, fy = y * n, fz = z * n;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const u = s(fx - ix), v = s(fy - iy), w = s(fz - iz);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(at(ix, iy, iz), at(ix + 1, iy, iz), u), l(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), u), v),
      l(l(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), u), l(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), u), v),
      w);
  };
}

export function createCloudNoise(size = 64) {
  const rnd = mulberry32(1337);
  const w4 = makeWorley(4, rnd), w8 = makeWorley(8, rnd), w16 = makeWorley(16, rnd), w32 = makeWorley(32, rnd);
  const v4 = makeValue(4, rnd), v8 = makeValue(8, rnd), v16 = makeValue(16, rnd);
  const data = new Uint8Array(size * size * size * 2);
  let i = 0;
  for (let z = 0; z < size; z++) {
    const pz = (z + 0.5) / size;
    for (let y = 0; y < size; y++) {
      const py = (y + 0.5) / size;
      for (let x = 0; x < size; x++) {
        const px = (x + 0.5) / size;
        const perlin = v4(px, py, pz) * 0.55 + v8(px, py, pz) * 0.3 + v16(px, py, pz) * 0.15;
        const wl = 1 - (w4(px, py, pz) * 0.62 + w8(px, py, pz) * 0.38);
        // Perlin-Worley: remap perlin by worley -> rounded billows
        let pw = (perlin - (1 - wl)) / (1 - (1 - wl) + 1e-4);
        pw = Math.max(0, Math.min(1, pw * 0.65 + wl * 0.5));
        const det = 1 - (w8(px, py, pz) * 0.5 + w16(px, py, pz) * 0.33 + w32(px, py, pz) * 0.17);
        data[i++] = Math.round(pw * 255);
        data[i++] = Math.round(Math.max(0, Math.min(1, det)) * 255);
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// soft, irregular puff sprite for the pink smoke that clings to the whale
export function createPuffTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const rnd = mulberry32(7);
  const v = [makeValue(4, rnd), makeValue(8, rnd), makeValue(16, rnd)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, w = y / size;
    const dx = u - 0.5, dy = w - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy) * 2;
    const n = v[0](u, w, 0.3) * 0.5 + v[1](u, w, 0.6) * 0.32 + v[2](u, w, 0.1) * 0.18;
    let a = Math.max(0, 1 - r * (0.9 + 0.55 * (1 - n)));
    a = Math.pow(a, 1.6) * (0.55 + 0.6 * n);
    const k = (y * size + x) * 4;
    const shade = Math.round(255 * (0.75 + 0.25 * n));
    img.data[k] = shade; img.data[k + 1] = shade; img.data[k + 2] = shade;
    img.data[k + 3] = Math.round(Math.min(1, a) * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
