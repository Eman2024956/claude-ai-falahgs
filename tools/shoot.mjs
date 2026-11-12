// Takes check pictures of a scene from several camera angles.
// Run:  npm run shoot -- 01-hello-shapes
// Pictures land in  renders/<scene-name>/  (main, front, side, top).
// The server (npm run serve) must be running.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright (the robot browser) is pre-installed on this machine, outside the project.
const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
if (!name) { console.error('Usage: npm run shoot -- <scene-folder-name>'); process.exit(1); }
const port = Number(process.env.PORT || 5173);
const time = process.env.TIME || '1';
const outDir = path.join(root, 'renders', name);
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(String(e)));
page.on('requestfailed', (r) => r.failure()?.errorText !== 'net::ERR_ABORTED' && problems.push(`could not load ${r.url()} (${r.failure()?.errorText})`));
page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });

// Extra angles can be listed after the scene name, e.g.  npm run shoot -- 02-cozy-room-sunset window sofa
for (const view of ['main', 'front', 'side', 'top', ...process.argv.slice(3)]) {
  await page.goto(`http://localhost:${port}/scenes/${name}/?view=${view}&time=${time}`);
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 });
  const file = path.join(outDir, `${view}.png`);
  await page.screenshot({ path: file });
  console.log('saved', path.relative(root, file));
}
await browser.close();
if (problems.length) { console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n')); process.exit(2); }
console.log('No errors.');
