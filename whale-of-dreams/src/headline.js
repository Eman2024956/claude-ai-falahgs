// "DREAM BIG" — drawn into a canvas texture so it can live *inside* the 3D composite
// (behind the whale, in front of the far clouds). Handles responsive layout and the
// masked, per-letter reveal with a gentle settle.
import * as THREE from 'three';

const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeOutBack = (t, s = 1.1) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

export class Headline {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.premultiplyAlpha = false;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.progress = 0;     // 0..1 reveal
    this.layout = null;
  }

  resize(cssW, cssH, dpr) {
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    this.computeLayout();
    this.draw(this.progress);
  }

  computeLayout() {
    const { ctx } = this;
    const W = this.canvas.width, H = this.canvas.height, dpr = this.dpr;
    const portrait = this.cssW / this.cssH < 0.82;
    const lines = portrait ? ['DREAM', 'BIG'] : ['DREAM BIG'];
    const top = Math.max(66 * dpr, Math.min(0.105 * H, 120 * dpr));
    const tracking = -0.004;
    // measure at 100px, then scale to fit width / height budgets
    ctx.font = `400 100px Anton, Impact, "Arial Narrow Bold", sans-serif`;
    const measure = (s) => {
      let w = 0;
      const px = parseFloat(ctx.font.match(/(\d+(?:\.\d+)?)px/)[1]);
      for (const ch of s) w += ctx.measureText(ch).width + tracking * px;
      return w - tracking * px;
    };
    const widest = Math.max(...lines.map(measure));
    const targetW = portrait ? 0.9 * W : Math.min(0.86 * W, 1700 * dpr);
    const lineH = 0.9;
    const maxBlockH = portrait ? 0.34 * H : 0.34 * H;
    let size = (targetW / widest) * 100;
    size = Math.min(size, maxBlockH / (lines.length * lineH + 0.1 * (lines.length - 1)));
    const glyphs = [];
    let y = top + size * 0.95; // baseline of first line (Anton cap height ≈ 0.95em at this metric)
    ctx.font = `400 ${size}px Anton, Impact, "Arial Narrow Bold", sans-serif`;
    let gi = 0;
    for (const line of lines) {
      const lw = measure(line) * 1; // font is already set to the final size here
      let x = (W - lw) / 2;
      for (const ch of line) {
        const cw = ctx.measureText(ch).width;
        if (ch !== ' ') glyphs.push({ ch, x, y, w: cw, i: gi++ });
        x += cw + tracking * size;
      }
      y += size * lineH;
    }
    const bottom = y - size * lineH + size * 0.06;
    this.layout = { size, glyphs, top, bottom, portrait, depth: Math.max(2, size * 0.022) };
  }

  /** bottom edge of the lettering in CSS px — used to frame the whale */
  get bottomCss() {
    return this.layout ? this.layout.bottom / this.dpr : 0;
  }

  draw(progress) {
    this.progress = progress;
    const { ctx, layout } = this;
    if (!layout) return;
    const W = this.canvas.width, H = this.canvas.height;
    const { size, glyphs, depth } = layout;
    ctx.clearRect(0, 0, W, H);
    ctx.font = `400 ${size}px Anton, Impact, "Arial Narrow Bold", sans-serif`;
    ctx.textBaseline = 'alphabetic';
    const capTop = size * 0.96;
    const n = glyphs.length;

    const states = glyphs.map((g) => {
      // staggered masked reveal: each letter rises inside its own mask, then settles
      const delay = (g.i / Math.max(1, n - 1)) * 0.38;
      const lt = Math.min(1, Math.max(0, (progress - delay) / 0.62));
      const rise = (1 - easeOutExpo(lt)) * size * 1.02;
      const settle = lt < 1 ? 1 + (1 - easeOutBack(Math.min(1, lt * 1.15), 1.4)) * 0.06 : 1;
      return { g, lt, rise, settle };
    });
    const begin = ({ g, rise, settle }) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(g.x - size * 0.3, g.y - capTop - size * 0.3, g.w + size * 0.6, capTop + size * 0.3 + depth + size * 0.06);
      ctx.clip();
      ctx.translate(g.x + g.w / 2, g.y + rise);
      ctx.scale(1, settle);
      ctx.translate(-g.w / 2, 0);
    };
    // pass 1: soft pink bloom + dimensional extrusion for every letter
    for (const st of states) {
      if (st.lt <= 0) continue;
      begin(st);
      const { g } = st;
      ctx.globalAlpha = Math.min(1, st.lt * 1.6);
      ctx.shadowColor = 'rgba(255, 112, 176, 0.38)';
      ctx.shadowBlur = size * 0.3;
      ctx.fillStyle = 'rgba(255, 190, 220, 0.5)';
      ctx.fillText(g.ch, 0, 0);
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      const steps = Math.ceil(depth);
      for (let s = steps; s >= 1; s--) {
        const k = s / steps;
        ctx.fillStyle = `rgb(${Math.round(244 - 30 * k)}, ${Math.round(178 - 44 * k)}, ${Math.round(206 - 30 * k)})`;
        ctx.fillText(g.ch, s * 0.25, s);
      }
      ctx.restore();
    }
    // pass 2: warm-white faces with a delicate pink light on the lower edge
    for (const st of states) {
      if (st.lt <= 0) continue;
      begin(st);
      const { g } = st;
      ctx.shadowColor = 'rgba(150, 40, 95, 0.22)';
      ctx.shadowBlur = size * 0.05;
      ctx.shadowOffsetY = depth * 0.8;
      const gr = ctx.createLinearGradient(0, -capTop, 0, 0);
      gr.addColorStop(0, '#fffcf7');
      gr.addColorStop(0.6, '#fff5ef');
      gr.addColorStop(1, '#ffe6ec');
      ctx.fillStyle = gr;
      ctx.fillText(g.ch, 0, 0);
      ctx.restore();
    }
    // a soft pink glint sweeping across the headline once it has settled
    this.texture.needsUpdate = true;
  }
}
