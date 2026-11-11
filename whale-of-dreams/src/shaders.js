// GLSL for the sky, volumetric clouds, whale-bound smoke puffs and the final composite.

export const fullscreenVert = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// ---------------------------------------------------------------------------
// shared sky colour (used by sky dome + cloud aerial perspective)
// ---------------------------------------------------------------------------
export const skyChunk = /* glsl */ `
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyLow;
uniform vec3 uSunDir;
vec3 skyColor(vec3 rd) {
  float y = rd.y;
  vec3 c = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.65, y));
  c = mix(c, uSkyLow, smoothstep(0.0, -0.45, y));
  float s = max(dot(rd, uSunDir), 0.0);
  c += vec3(1.0, 0.86, 0.9) * (pow(s, 6.0) * 0.18 + pow(s, 40.0) * 0.25);
  return c;
}`;

export const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}`;

export const skyFrag = /* glsl */ `
${skyChunk}
varying vec3 vDir;
void main() {
  gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0);
}`;

// ---------------------------------------------------------------------------
// volumetric clouds — raymarched density field, split into a "near" segment
// (in front of the headline plane) and a "far" segment (behind it)
// ---------------------------------------------------------------------------
export const cloudFrag = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec2 vUv;
layout(location = 0) out vec4 outNear;
layout(location = 1) out vec4 outFar;

uniform sampler2D uDepth;
uniform sampler3D uNoise;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uWind;
uniform float uSplit;
uniform float uMaxDist;
uniform float uSteps;
uniform vec3 uSunCol;
uniform vec3 uAmbHigh;
uniform vec3 uAmbLow;
uniform vec3 uWhalePos;
uniform vec3 uWhaleRad;
uniform vec2 uValley;
${skyChunk}

float sat(float x) { return clamp(x, 0.0, 1.0); }

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

float heightField(vec3 q, vec3 p) {
  float n1 = texture(uNoise, vec3(q.x * 0.0042, 0.37, q.z * 0.0042)).r;
  float n2 = texture(uNoise, vec3(q.x * 0.0105, 0.71, q.z * 0.0105)).r;
  float r = length(p.xz - uValley);
  // rolling sea of cloud below, and towering banks further away
  float sea = -9.0 + 8.0 * n1 + 7.0 * n2;
  float bank = -12.0 + 56.0 * smoothstep(0.28, 0.75, n1 * 0.6 + n2 * 0.4) * smoothstep(20.0, 62.0, r);
  float h = max(sea, bank);
  // open valley so the whale (and the camera) swim through clear air
  h -= 6.0 * (1.0 - smoothstep(10.0, 28.0, r));
  return h;
}

// returns density, writes height fraction (0 = at the billowing top, 1 = deep)
float density(vec3 p, out float hf) {
  vec3 q = p + vec3(uTime * uWind, 0.0, 0.0);
  float H = heightField(q, p);
  float dy = H - p.y;
  hf = 0.0;
  float wd = 0.0;
  // ---- foreground mist / wisps: thin, drifting, allowed close to the whale ----
  float m2 = texture(uNoise, q * vec3(0.010, 0.018, 0.010) + vec3(0.31, 0.12, uTime * 0.0009)).r;
  if (m2 > 0.5) {
    float m = texture(uNoise, q * 0.034 + vec3(0.0, uTime * 0.0022, 0.0)).g;
    float band = exp(-pow((p.y - uWhalePos.y) / 6.5, 2.0));
    wd = smoothstep(0.5, 0.86, m2) * smoothstep(0.42, 0.82, m) * band * 0.16;
  }
  if (dy < -5.0) return wd;
  // ---- main cumulus mass ----
  float shape = texture(uNoise, q * 0.042 + vec3(0.0, uTime * 0.0016, 0.0)).r;
  float d = shape * 1.3 + dy / 3.6 - 0.66;
  if (d <= 0.0) return wd;
  float det = texture(uNoise, q * 0.13 + vec3(uTime * 0.004, 0.0, 0.0)).g;
  d = sat(d - (1.0 - det) * 0.42 * (1.0 - sat(d * 1.6)));
  hf = sat(dy / 6.0);
  vec3 wq = (p - uWhalePos) / uWhaleRad;
  float clear = smoothstep(0.9, 1.7, length(wq));
  return max(d * clear, wd);
}

float densityCheap(vec3 p) {
  vec3 q = p + vec3(uTime * uWind, 0.0, 0.0);
  float H = heightField(q, p);
  float dy = H - p.y;
  if (dy < -5.0) return 0.0;
  float shape = texture(uNoise, q * 0.042 + vec3(0.0, uTime * 0.0016, 0.0)).r;
  return sat(shape * 1.3 + dy / 3.6 - 0.66);
}

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 vd = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 dirV = normalize(vd.xyz / vd.w);
  vec3 rd = normalize(mat3(uCamWorld) * dirV);
  vec3 ro = uCamPos;

  float depth = texture(uDepth, vUv).r;
  vec4 pv = uInvProj * vec4(ndc, depth * 2.0 - 1.0, 1.0);
  pv.xyz /= pv.w;
  float sceneDist = depth >= 0.99999 ? 1e6 : length(pv.xyz);
  float tEnd = min(sceneDist, uMaxDist);

  float cosS = dot(rd, uSunDir);
  float phase = mix(hg(cosS, 0.35), hg(cosS, -0.15), 0.4) * 9.0 + 0.45;

  vec3 acc = vec3(0.0);
  float T = 1.0;
  vec3 nearC = vec3(0.0);
  float nearT = 1.0;
  bool split = false;

  float t = 0.4 + ign(gl_FragCoord.xy) * 0.6;
  for (int i = 0; i < 160; i++) {
    if (float(i) >= uSteps || t > tEnd) break;
    if (!split && t > uSplit) { nearC = acc; nearT = T; acc = vec3(0.0); T = 1.0; split = true; }
    float dt = clamp(t * 0.034, 0.3, 7.0);
    vec3 p = ro + rd * t;
    if (p.y > 48.0 && rd.y > 0.0) break;
    float hf;
    float d = density(p, hf);
    if (d > 0.003) {
      float l1 = densityCheap(p + uSunDir * 2.2);
      float l2 = densityCheap(p + uSunDir * 6.5);
      float shadow = exp(-(l1 * 1.2 + l2 * 0.9) * 2.3);
      float powder = 1.0 - exp(-d * 5.0);
      vec3 amb = mix(uAmbHigh, uAmbLow, pow(hf, 0.55));
      vec3 col = uSunCol * shadow * phase * (0.55 + 0.45 * powder) + amb;
      // aerial perspective
      float fog = 1.0 - exp(-t * 0.0062);
      col = mix(col, skyColor(rd), fog * 0.7);
      float a = 1.0 - exp(-d * 2.4 * dt);
      acc += T * a * col;
      T *= 1.0 - a;
      if (T < 0.015) break;
    } else if (d <= 0.0) {
      dt *= 1.6;
    }
    t += dt;
  }
  if (!split) { nearC = acc; nearT = T; acc = vec3(0.0); T = 1.0; }
  outNear = vec4(nearC, nearT);
  outFar = vec4(acc, T);
}`;

// ---------------------------------------------------------------------------
// pink smoke puffs bound to the whale's bones (instanced billboards, soft-depth)
// ---------------------------------------------------------------------------
export const puffVert = /* glsl */ `
attribute vec3 aOffset;
attribute vec4 aParams; // size, rotation, phase, opacity
varying vec2 vUv;
varying float vAlpha;
varying float vViewZ;
varying float vLit;
uniform float uTime;
void main() {
  float size = aParams.x * (1.0 + 0.08 * sin(uTime * 0.35 + aParams.z * 6.28));
  float rot = aParams.y + uTime * 0.04 * (fract(aParams.z * 7.0) - 0.5);
  vec2 c = position.xy;
  vec2 r = vec2(c.x * cos(rot) - c.y * sin(rot), c.x * sin(rot) + c.y * cos(rot));
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  mv.xy += r * size;
  vUv = position.xy + 0.5;
  vAlpha = aParams.w;
  vViewZ = -mv.z;
  vLit = c.y + 0.5;
  gl_Position = projectionMatrix * mv;
}`;

export const puffFrag = /* glsl */ `
uniform sampler2D uTex;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform vec3 uLit;
uniform vec3 uShade;
varying vec2 vUv;
varying float vAlpha;
varying float vViewZ;
varying float vLit;
float linDepth(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
void main() {
  vec4 tx = texture2D(uTex, vUv);
  float sd = linDepth(texture2D(uDepth, gl_FragCoord.xy / uRes).r);
  float soft = clamp((sd - vViewZ) / 1.1, 0.0, 1.0);
  float a = tx.a * vAlpha * soft * smoothstep(1.5, 5.0, vViewZ);
  vec3 col = mix(uShade, uLit, clamp(vLit * 0.8 + tx.r * 0.5 - 0.2, 0.0, 1.0));
  gl_FragColor = vec4(col * a, a); // premultiplied
}`;

// ---------------------------------------------------------------------------
// composite: scene + puffs + clouds (near/far) + headline, then tone-map
// ---------------------------------------------------------------------------
export const compositeVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const compositeFrag = /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform sampler2D uNear;
uniform sampler2D uFar;
uniform sampler2D uPuff;
uniform sampler2D uText;
uniform mat4 uInvProj;
uniform float uSplit;
uniform vec2 uTexel;
uniform vec2 uCloudTexel;
uniform float uTextOn;
uniform float uGrain;
uniform float uTime;
varying vec2 vUv;

float sceneDist(vec2 uv) {
  float d = texture2D(uDepth, uv).r;
  if (d >= 0.99999) return 1e6;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return length(p.xyz / p.w);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 scene = texture2D(uScene, vUv).rgb;
  // small tent blur hides the half-res raymarch dither
  vec2 o = uCloudTexel * 0.75;
  vec4 nearC = (texture2D(uNear, vUv + vec2(o.x, o.y)) + texture2D(uNear, vUv + vec2(-o.x, o.y)) +
                texture2D(uNear, vUv + vec2(o.x, -o.y)) + texture2D(uNear, vUv + vec2(-o.x, -o.y))) * 0.25;
  vec4 farC = (texture2D(uFar, vUv + vec2(o.x, o.y)) + texture2D(uFar, vUv + vec2(-o.x, o.y)) +
               texture2D(uFar, vUv + vec2(o.x, -o.y)) + texture2D(uFar, vUv + vec2(-o.x, -o.y))) * 0.25;
  vec4 puff = texture2D(uPuff, vUv);

  // fractional "behind the headline" coverage for an anti-aliased whale/letter edge
  float behind = 0.0;
  behind += step(uSplit, sceneDist(vUv + uTexel * vec2(-0.5, -0.5)));
  behind += step(uSplit, sceneDist(vUv + uTexel * vec2( 0.5, -0.5)));
  behind += step(uSplit, sceneDist(vUv + uTexel * vec2(-0.5,  0.5)));
  behind += step(uSplit, sceneDist(vUv + uTexel * vec2( 0.5,  0.5)));
  behind *= 0.25;

  vec3 far = farC.rgb + farC.a * scene;          // what lies beyond the headline plane
  vec4 txt = texture2D(uText, vUv);
  vec3 withText = mix(far, txt.rgb * 1.22, txt.a * uTextOn);
  vec3 base = mix(scene, withText, behind);
  base = puff.rgb + (1.0 - puff.a) * base;       // pink smoke clinging to the whale
  vec3 col = nearC.rgb + nearC.a * base;          // foreground mist

  // gentle vignette + film grain (breaks up banding in the soft pinks)
  vec2 d = vUv - 0.5;
  col *= 1.0 - dot(d, d) * 0.22;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += (hash(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5) * uGrain;
}`;
