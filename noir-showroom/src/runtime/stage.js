// Builds the room described by plan.scene: walls, lights, light shafts, the
// reflective marble floor and the dust. Every function takes plan data in and
// returns objects plus a few setters the timeline is allowed to drive.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

const NOISE = /* glsl */ `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.1; a *= 0.5; }
    return s;
  }
`;

export function buildRoom(env) {
  const group = new THREE.Group();
  // Walls are washed with light from the floor up, so the car keeps a silhouette.
  const wallGeo = new THREE.CylinderGeometry(env.radius, env.radius, env.height, 96, 12, true);
  const wash = new THREE.Color(env.slats ? env.slats.color : '#ffffff').multiplyScalar(0.05);
  const base = new THREE.Color(env.wallColor);
  const colors = [];
  const c = new THREE.Color();
  for (let i = 0; i < wallGeo.attributes.position.count; i++) {
    const y = wallGeo.attributes.position.getY(i) + env.height / 2;
    const k = Math.exp(-y / 1.6);
    c.copy(base).multiplyScalar(0.35);
    colors.push(c.r + wash.r * k, c.g + wash.g * k, c.b + wash.b * k);
  }
  wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
  wall.position.y = env.height / 2;
  const ceiling = new THREE.Mesh(
    new THREE.CircleGeometry(env.radius, 96),
    new THREE.MeshBasicMaterial({ color: '#000000' }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = env.height;
  group.add(wall, ceiling);

  if (env.slats && env.slats.count > 0) {
    const color = new THREE.Color(env.slats.color).multiplyScalar(env.slats.intensity);
    const slat = new THREE.BoxGeometry(0.11, env.height * 0.8, 0.04);
    const mesh = new THREE.InstancedMesh(slat, new THREE.MeshBasicMaterial({ color, fog: true }), env.slats.count);
    const m = new THREE.Matrix4();
    const r = env.radius - 0.4;
    for (let i = 0; i < env.slats.count; i++) {
      const a = (i / env.slats.count) * Math.PI * 2;
      m.makeRotationY(-a);
      m.setPosition(Math.cos(a) * r, env.height * 0.42, Math.sin(a) * r);
      mesh.setMatrixAt(i, m);
    }
    group.add(mesh);
  }
  return group;
}

// Lights come in three kinds. Softboxes are visible panels and also the main
// source of reflections on the paint (they are baked into the environment map).
export function buildLights(lights, renderer) {
  const group = new THREE.Group();
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#020203');
  const spots = [];
  const beams = [];
  const byId = {};

  for (const light of lights) {
    const color = new THREE.Color(light.color);
    if (light.type === 'ambient') {
      const l = new THREE.HemisphereLight(color, '#000000', light.intensity * 3);
      group.add(l);
      byId[light.id] = { set: (k) => (l.intensity = light.intensity * 3 * k) };
    }

    if (light.type === 'softbox') {
      const geo = new THREE.PlaneGeometry(light.size[0], light.size[1]);
      const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(light.intensity * 0.35), fog: false });
      const panel = new THREE.Mesh(geo, mat);
      panel.position.fromArray(light.position);
      panel.rotation.x = Math.PI / 2;
      panel.layers.set(1); // the floor mirrors the car, not the ceiling
      group.add(panel);
      const baked = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(light.intensity), side: THREE.DoubleSide }));
      baked.position.copy(panel.position);
      baked.rotation.copy(panel.rotation);
      envScene.add(baked);
      const base = mat.color.clone();
      byId[light.id] = { set: (k) => mat.color.copy(base).multiplyScalar(k) };
    }

    if (light.type === 'spot') {
      const from = new THREE.Vector3().fromArray(light.position);
      const to = new THREE.Vector3().fromArray(light.target || [0, 0, 0]);
      const angle = THREE.MathUtils.degToRad(light.angle);
      const l = new THREE.SpotLight(color, light.intensity * 7, 0, angle, 0.7, 1.4);
      l.position.copy(from);
      l.target.position.copy(to);
      group.add(l, l.target);
      spots.push({ from, to, angle, color, intensity: light.intensity });
      byId[light.id] = { set: (k) => (l.intensity = light.intensity * 7 * k) };

      if (light.beam && light.beam.opacity > 0) {
        const length = from.distanceTo(to) * 1.02;
        const geo = new THREE.CylinderGeometry(0.06, Math.tan(angle) * length, length, 48, 1, true);
        geo.translate(0, -length / 2, 0);
        const mat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          uniforms: {
            uColor: { value: color },
            uOpacity: { value: light.beam.opacity },
            uLevel: { value: 1 },
            uLength: { value: length },
            uTime: { value: 0 },
          },
          vertexShader: /* glsl */ `
            varying vec3 vNormalV; varying vec3 vViewPos; varying float vAlong; varying vec3 vWorld;
            uniform float uLength;
            void main() {
              vAlong = -position.y / uLength;
              vec4 world = modelMatrix * vec4(position, 1.0);
              vWorld = world.xyz;
              vec4 mv = viewMatrix * world;
              vViewPos = mv.xyz;
              vNormalV = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * mv;
            }`,
          fragmentShader: /* glsl */ `
            uniform vec3 uColor; uniform float uOpacity, uLevel, uTime;
            varying vec3 vNormalV; varying vec3 vViewPos; varying float vAlong; varying vec3 vWorld;
            ${NOISE}
            void main() {
              // Fade at the silhouette so the cone reads as a soft volume, not a shell.
              float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
              float edge = pow(facing, 2.2);
              float fall = pow(1.0 - vAlong, 1.1) * smoothstep(1.0, 0.82, vAlong) * smoothstep(0.0, 0.03, vAlong);
              float haze = 0.72 + 0.28 * fbm(vWorld.xz * 1.3 + vec2(uTime * 0.05, vWorld.y * 0.6 - uTime * 0.03));
              gl_FragColor = vec4(uColor * edge * fall * haze * uOpacity * uLevel * 1.5, 1.0);
            }`,
        });
        const cone = new THREE.Mesh(geo, mat);
        cone.position.copy(from);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
        cone.renderOrder = 3;
        cone.layers.set(1); // not drawn into the floor reflection
        group.add(cone);
        beams.push(mat);
      }
    }
  }

  // Dim shell so the paint never reflects pure black, then bake.
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 16),
    new THREE.MeshBasicMaterial({ color: '#07080a', side: THREE.BackSide }),
  );
  envScene.add(shell);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(envScene, 0.015).texture;
  pmrem.dispose();

  return {
    object: group,
    environment,
    spots,
    setLight(id, k) {
      byId[id]?.set(k);
    },
    setBeams(level, time) {
      for (const mat of beams) {
        mat.uniforms.uLevel.value = level;
        mat.uniforms.uTime.value = time;
      }
    },
  };
}

export function buildFloor(floor, env, spots, footprint, pixelRatio) {
  const MAX_SPOTS = 4;
  const pools = spots.slice(0, MAX_SPOTS).map((s) => {
    // Where the cone lands and how wide its pool is.
    const t = s.from.y / Math.max(s.from.y - s.to.y, 1e-3);
    const hit = s.from.clone().lerp(s.to, t);
    const radius = Math.tan(s.angle) * s.from.distanceTo(hit);
    return { v: new THREE.Vector4(hit.x, hit.z, radius, s.intensity / 26), c: s.color };
  });
  while (pools.length < MAX_SPOTS) pools.push({ v: new THREE.Vector4(0, 0, 1, 0), c: new THREE.Color(0) });

  const size = Math.min(1024, Math.round(640 * pixelRatio));
  const shader = {
    name: 'MarbleFloor',
    uniforms: {
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      uBase: { value: new THREE.Color(floor.baseColor) },
      uVein: { value: new THREE.Color(floor.veinColor) },
      uAccent: { value: new THREE.Color(floor.accentColor) },
      uFog: { value: new THREE.Color(env.fogColor) },
      uFogDensity: { value: env.fogDensity },
      uVeinScale: { value: floor.veinScale },
      uTile: { value: floor.tileSize },
      uReflect: { value: floor.reflectivity },
      uRough: { value: floor.roughness },
      uPools: { value: pools.map((p) => p.v) },
      uPoolColors: { value: pools.map((p) => p.c) },
      uRing: { value: new THREE.Vector2(floor.ring ? floor.ring.radius : 0, floor.ring ? floor.ring.intensity : 0) },
      uRingColor: { value: new THREE.Color(floor.ring ? floor.ring.color : '#000000') },
      uRingLevel: { value: 1 },
      uCar: { value: new THREE.Vector2(footprint.halfLength, footprint.halfWidth) },
    },
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec4 vUv; varying vec3 vWorld;
      void main() {
        vUv = textureMatrix * vec4(position, 1.0);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec3 uBase, uVein, uAccent, uFog, uRingColor;
      uniform float uFogDensity, uVeinScale, uTile, uReflect, uRough, uRingLevel;
      uniform vec4 uPools[${MAX_SPOTS}];
      uniform vec3 uPoolColors[${MAX_SPOTS}];
      uniform vec2 uRing, uCar;
      varying vec4 vUv; varying vec3 vWorld;
      ${NOISE}

      float veins(vec2 p, float sharp) {
        vec2 w = p + 1.6 * vec2(fbm(p * 0.55 + 3.1), fbm(p * 0.55 - 8.7));
        float n = fbm(w * 1.15);
        return pow(1.0 - abs(2.0 * n - 1.0), sharp);
      }

      void main() {
        vec2 p = vWorld.xz;
        vec3 toEye = cameraPosition - vWorld;
        float dist = length(toEye);
        float ndv = clamp(toEye.y / dist, 0.0, 1.0);

        // --- marble ---
        vec2 m = p / uVeinScale;
        float broad = veins(m, 9.0);
        float fine = veins(m * 2.7 + 11.0, 16.0);
        float cloud = fbm(m * 0.7 + 5.0);
        vec3 stone = uBase * (0.55 + 0.9 * cloud);
        stone = mix(stone, uVein, 0.75 * broad * (0.35 + 0.65 * cloud));
        stone = mix(stone, uAccent, 0.5 * fine * smoothstep(0.45, 0.8, cloud));
        float grout = 1.0;
        if (uTile > 0.0) {
          vec2 g = abs(fract(p / uTile + 0.5) - 0.5) * uTile;
          grout = smoothstep(0.0, 0.006 + 0.0015 * dist, min(g.x, g.y));
        }

        // --- light reaching the floor ---
        vec3 lit = vec3(0.05);
        for (int i = 0; i < ${MAX_SPOTS}; i++) {
          float d = length(p - uPools[i].xy) / uPools[i].z;
          lit += uPoolColors[i] * uPools[i].w * 0.9 * exp(-d * d * 1.4);
        }
        lit += vec3(0.3) * exp(-dot(p, p) / 70.0);

        // Contact shadow: rounded rectangle under the car.
        vec2 q = abs(p) - uCar + 0.5;
        float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.5;
        float shadow = mix(0.12, 1.0, smoothstep(-0.25, 0.75, sd));

        // --- reflection, blurred a little by roughness ---
        vec2 uv = vUv.xy / vUv.w;
        float blur = uRough * 0.02 * (0.4 + 6.0 / (dist + 2.0));
        vec3 refl = vec3(0.0);
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 2.399963;
          float r = sqrt((float(i) + 0.5) / 12.0);
          vec3 tap = texture2D(tDiffuse, uv + blur * r * vec2(cos(a), 1.6 * sin(a))).rgb;
          refl += min(tap, vec3(1.6));
        }
        refl /= 12.0;
        float fresnel = mix(0.1, 1.0, pow(1.0 - ndv, 2.0));

        vec3 col = stone * lit * shadow * mix(0.55, 1.0, grout);
        col += refl * uReflect * fresnel * mix(0.8, 1.0, grout);

        // Inlaid light ring.
        if (uRing.y > 0.0) {
          float r = length(p);
          float line = smoothstep(0.022, 0.0, abs(r - uRing.x));
          float halo = exp(-abs(r - uRing.x) * 5.0) * 0.12;
          col += uRingColor * uRing.y * uRingLevel * (line + halo);
        }

        float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFog, fog);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  };

  const mesh = new Reflector(new THREE.CircleGeometry(env.radius, 96), {
    textureWidth: size,
    textureHeight: size,
    clipBias: 0.003,
    shader,
  });
  mesh.rotation.x = -Math.PI / 2;
  const u = mesh.material.uniforms;
  return {
    object: mesh,
    setReflectivity: (v) => (u.uReflect.value = v),
    setRing: (v) => (u.uRingLevel.value = v),
  };
}

export function buildParticles(spec, pixelRatio) {
  const positions = new Float32Array(spec.count * 3);
  const seeds = new Float32Array(spec.count * 3);
  const [bx, by, bz] = spec.bounds;
  for (let i = 0; i < spec.count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * bx;
    positions[i * 3 + 1] = Math.random() * by;
    positions[i * 3 + 2] = (Math.random() - 0.5) * bz;
    seeds[i * 3] = Math.random();
    seeds[i * 3 + 1] = Math.random();
    seeds[i * 3 + 2] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(spec.color) },
      uSize: { value: spec.size },
      uOpacity: { value: spec.opacity },
      uLevel: { value: 1 },
      uDrift: { value: spec.drift },
      uHeight: { value: by },
      uScale: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSeed;
      uniform float uTime, uSize, uDrift, uHeight, uScale;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float t = uTime * uDrift;
        p.y = mod(p.y + t * (0.25 + aSeed.x * 0.5), uHeight);
        p.x += sin(t * (0.6 + aSeed.y) + aSeed.z * 6.283) * 0.5;
        p.z += cos(t * (0.5 + aSeed.z) + aSeed.x * 6.283) * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float twinkle = 0.55 + 0.45 * sin(uTime * (0.4 + aSeed.y * 1.2) + aSeed.x * 40.0);
        // Dust is brightest in the light near the middle of the room and fades at floor and ceiling.
        float inLight = exp(-dot(p.xz, p.xz) / 40.0);
        float band = smoothstep(0.0, 0.6, p.y) * smoothstep(uHeight, uHeight - 1.5, p.y);
        vAlpha = twinkle * band * (0.25 + 0.75 * inLight) * smoothstep(0.6, 2.0, -mv.z);
        gl_PointSize = uSize * (0.5 + aSeed.z) * uScale / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity, uLevel;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d);
        gl_FragColor = vec4(uColor * a * vAlpha * uOpacity * uLevel, 1.0);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 4;
  points.layers.set(1); // not drawn into the floor reflection
  return {
    object: points,
    resize: (height, fovDeg) => (material.uniforms.uScale.value = (height * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2))),
    update(time, level) {
      material.uniforms.uTime.value = time;
      material.uniforms.uLevel.value = level;
    },
  };
}
