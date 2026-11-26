#!/usr/bin/env node
// Turn an exported story HTML into a 1080x1920 MP4 with its narration.
// Needs: Node 18+, `npm i playwright` (plus `npx playwright install chromium`), and ffmpeg on PATH.
// Usage: node render-mp4.js story.html story.mp4 [fps]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const [, , inHtml, outMp4 = 'story.mp4', fpsArg = '30'] = process.argv;
if (!inHtml) { console.error('usage: node render-mp4.js story.html story.mp4 [fps]'); process.exit(1); }
const FPS = +fpsArg, WORKERS = Math.max(1, Math.min(4, os.cpus().length));

(async () => {
  const html = fs.readFileSync(inHtml, 'utf8');
  const m = html.match(/"audio":"data:(audio\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)"/);
  if (!m) throw new Error('No embedded audio found. Was this file exported by Voice to Whiteboard Story?');
  const ext = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/ogg': 'ogg' }[m[1]] || 'mp3';
  const audioPath = path.join(os.tmpdir(), `story-audio-${process.pid}.${ext}`);
  fs.writeFileSync(audioPath, Buffer.from(m[2], 'base64'));

  const browser = await chromium.launch();
  const url = 'file://' + path.resolve(inHtml) + '?render=1';
  const pages = await Promise.all(Array.from({ length: WORKERS }, async () => {
    const p = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
    await p.goto(url);
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
    return p;
  }));
  const END = await pages[0].evaluate(() => window.__END);
  const N = Math.ceil(END * FPS);

  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-i', audioPath,
    '-filter_complex', '[1:a]apad[a]', '-map', '0:v', '-map', '[a]', '-t', END.toFixed(2),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outMp4],
    { stdio: ['pipe', 'inherit', 'inherit'] });

  // render in parallel, write to ffmpeg in frame order
  const ready = new Map(); let next = 0, written = 0;
  const flush = async () => {
    while (ready.has(written)) {
      const buf = ready.get(written); ready.delete(written);
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (++written % 150 === 0) console.log(`frame ${written}/${N}`);
    }
  };
  await Promise.all(pages.map(async p => {
    while (true) {
      const f = next++; if (f >= N) break;
      while (f - written > 120) await new Promise(r => setTimeout(r, 20)); // keep memory bounded
      await p.evaluate(t => window.__seek(t), f / FPS);
      ready.set(f, await p.screenshot({ type: 'jpeg', quality: 93 }));
      await flush();
    }
  }));
  await flush();
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  fs.unlinkSync(audioPath);
  console.log(`done: ${outMp4} (${N} frames, ${END.toFixed(1)} s)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
