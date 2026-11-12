// Renders a scene's animation to video files, frame by frame.
// Run:  node tools/render-video.mjs 03-tawassl-logo-reveal            (normal video, MP4)
//       node tools/render-video.mjs 03-tawassl-logo-reveal transparent (see-through background)
// Options (environment variables): SECONDS=4 FPS=30 WIDTH=1920 HEIGHT=1080
// Output goes to renders/<scene>/video/. The server (node tools/serve.mjs) must be running.
import { createRequire } from 'node:module';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
const transparent = process.argv[3] === 'transparent';
if (!name) { console.error('Usage: node tools/render-video.mjs <scene> [transparent]'); process.exit(1); }
const seconds = Number(process.env.SECONDS || 4), fps = Number(process.env.FPS || 30);
const width = Number(process.env.WIDTH || 1920), height = Number(process.env.HEIGHT || 1080);
const port = Number(process.env.PORT || 5173);
const outDir = path.join(root, 'renders', name, 'video');
const frameDir = path.join(outDir, transparent ? 'frames-transparent' : 'frames');
await rm(frameDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 2; });
await page.goto(`http://localhost:${port}/scenes/${name}/?capture${transparent ? '&transparent' : ''}`);
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });

const total = Math.round(seconds * fps);
for (let i = 0; i < total; i++) {
  const png = await page.evaluate(({ t, transparent }) => {
    const gl = window.__renderAt(t);
    if (!transparent) return gl.toDataURL('image/png');
    // See-through version: fade the picture in rather than starting as a black silhouette.
    const c = (window.__copy ||= document.createElement('canvas'));
    c.width = gl.width; c.height = gl.height;
    const g = c.getContext('2d');
    g.globalAlpha = window.__fade ?? 1;
    g.drawImage(gl, 0, 0);
    return c.toDataURL('image/png');
  }, { t: i / fps, transparent });
  await writeFile(path.join(frameDir, `${String(i).padStart(4, '0')}.png`), Buffer.from(png.split(',')[1], 'base64'));
  if (i % 30 === 0) console.log(`frame ${i}/${total}`);
}
await browser.close();

const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps),
  '-i', path.join(frameDir, '%04d.png'), ...args]);
if (transparent) {
  // ProRes 4444 .mov: the see-through format video editors (Premiere, Final Cut, DaVinci, CapCut) accept.
  ff(['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-r', String(fps), path.join(outDir, `${name}-transparent.mov`)]);
  // WebM with transparency: small file, for web and some editors.
  ff(['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24', '-r', String(fps), path.join(outDir, `${name}-transparent.webm`)]);
} else {
  ff(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', '-preset', 'slow', '-r', String(fps), '-movflags', '+faststart', path.join(outDir, `${name}.mp4`)]);
}
console.log('done ->', path.relative(root, outDir));
