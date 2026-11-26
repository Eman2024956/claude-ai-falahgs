# Voice → Whiteboard Story

Turn any voice narration (MP3, WAV, M4A, OGG) into a 9:16 whiteboard-style story animation for YouTube Shorts, Reels and TikTok. Each sentence becomes a scene, each phrase appears exactly when it is spoken, and line drawings draw themselves on. Arabic (right-to-left) and English both work.

حوّل أي تسجيل صوتي إلى قصة متحركة بأسلوب السبورة البيضاء: كل جملة مشهد، وكل عبارة تظهر لحظة نطقها، مع رسومات خطية تُرسم أمامك.

## Use it

1. Open `index.html` in Chrome, Edge or Firefox. You can double-click the file or host it on any static host such as GitHub Pages.
2. **Upload** the voice file. The app finds the pauses between spoken phrases.
3. **Text:** paste the exact narration, one sentence per line. Or press **Auto-transcribe** to have Whisper write it for you in the browser, then fix any mistakes.
4. **Generate.** Check the preview and change any drawing in the scenes table.
5. **Download HTML.** You get one self-contained file with the audio inside. Open it and press play. Tap to pause, or press Space.

### Make an MP4 (optional)

```bash
npm i playwright && npx playwright install chromium
node render-mp4.js story.html story.mp4
```

This needs ffmpeg installed. It renders every frame at 1080×1920 and 30 fps in sync with the narration.

## How the text is used

| You write | You get |
|---|---|
| a sentence ending in `.` `!` `?` `؟` or a new line | a new scene |
| `،` `,` `:` `;` inside a sentence | a new phrase, shown when that pause comes in the audio |
| text in `«…»` or `"…"` | an orange speech card |
| `<breath>` or other tags | ignored (they count as a sentence break) |

The first phrase of a scene is the small line. The rest appear as big words, one by one.

## How it works

- **Timing:** the audio is decoded in the browser (Web Audio API) and measured every 10 ms. Quiet stretches longer than the shortest-pause setting count as pauses. Phrase boundaries are then lined up with those pauses by dynamic programming, so cuts fall in silences, never mid-word. If you have more phrases than pauses, the extra boundaries are placed in proportion to the text length.
- **Drawings:** about 45 original line icons, such as sun, moon, tree, bird, boy, girl, grandma, house, window, food, water, heart, clock and globe. Each one is matched to Arabic and English keywords. The matching ignores diacritics and prefixes such as و ف ب ل ال, so «والعصفور» finds the bird.
- **Animation:** the downloaded file builds its scenes from embedded data and moves every CSS animation to the audio's current time on each frame. That keeps it in sync even if the audio stutters, and lets `render-mp4.js` capture exact frames (`?render=1` exposes `window.__seek(t)`).
- **Auto-transcribe:** [Transformers.js](https://github.com/huggingface/transformers.js) runs Whisper in the browser. The model downloads from Hugging Face the first time (Tiny about 40 MB, Base about 80 MB, Small about 250 MB) and is cached after that. Small is the most accurate for Arabic.

## Customise

- **Add an icon:** add an entry to `ICONS` in `index.html`:
  `name:{k:'arabic words|english words', idle:'bob', p:['a|<svg path>', 't|<svg path>']}`.
  Paths use a 200×200 box. Part codes: `s` stroke, `t` thin stroke, `a` accent fill and stroke, `w` white fill and stroke, `g` grey fill, `i` ink fill, `c` soft cheek fill.
- **Colours, fonts and sizes:** edit `PLAYER_CSS` (Cairo for Arabic, Roboto for English).
- **Watermark:** set it in the app, or add `?handle=@name` to the downloaded file's link.

## Notes

- The audio and text stay in your browser. Nothing is uploaded, except the one-time model download if you use Auto-transcribe.
- The downloaded HTML loads the Cairo and Roboto fonts from Google Fonts. Offline, it falls back to system fonts.
