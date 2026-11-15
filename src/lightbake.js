// 조도 볼륨: 빛이 실제 형상에 가려지는 것을 로딩 때 GPU로 한 번 계산해 레벨 전체가 같이 쓴다.
// - 하늘빛: 하늘을 여러 방향으로 나눠 방향마다 깊이 맵을 그리고, 격자점에서 그 방향이 트여 있는지를 모아
//   방향성 있는 조도(구면 조화 1차: w = 평균, xyz = 기울기)로 저장한다. 흐린 날의 그림자는 하늘이 가려진 만큼 넓게 어두워지는 것이다.
// - 형광등: 등마다 관을 따라 여러 점에서 본 가시도의 평균을 건물 격자에 저장한다(관이 길어서 반그림자가 생긴다).
// - 반사광: 격자점에서 사방으로 광선을 보내 처음 닿는 면이 받은 빛(하늘 + 형광등)을 되돌려 받는다. 두 번 반사까지 센다.
// 실행 중에는 재질 셰이더가 3D 텍스처를 읽기만 한다(materials.js).
import * as THREE from 'three';

// 주 격자: 마당과 건물 전체. 격자점이 바닥·천장 면과 겹치지 않게 높이를 5 cm 어긋나게 잡았다.
export const GRID = { min: new THREE.Vector3(-25, -0.25, -21), vox: 0.2, nx: 250, ny: 34, nz: 260 };
// 형광등 가시도 격자: 건물과 그 둘레 2 m
export const LGRID = { min: new THREE.Vector3(-14.1, 0.5, -18.1), vox: 0.15, nx: 188, ny: 35, nz: 138 };
const CO = 2;          // 반사광 격자는 주 격자의 1/2 해상도
export const MAXL = 11;   // 셰이더의 점광원 자리 수(형광등 8 + 총구 화염 2 + 화염의 되비침 1). materials.js의 배열 크기도 이 값을 쓴다
const SKY_GAIN = 6.0;  // 하늘 밝기 배율. 형광등 실내보다 흐린 날 바깥이 몇 배 밝은지를 정한다(바닥 조도가 마당 32, 사무실 1.7로 약 18배. main.js 하늘 셰이더도 같은 값을 쓴다).
                       // 2.5(12배)는 문 너머가 하늘일 때만 날아갔다. 반사율이 실제에 가까운 나무가 문을 채우면 화면 중간 회색에 놓인다(A/B 라운드 21)
export const skyGain = SKY_GAIN;

export const volUniforms = {
  uAmb: { value: null }, uSkyV: { value: null }, uVisA: { value: null }, uVisB: { value: null },
  uVolMin: { value: GRID.min.clone() }, uVolInv: { value: new THREE.Vector3(1 / (GRID.nx * GRID.vox), 1 / (GRID.ny * GRID.vox), 1 / (GRID.nz * GRID.vox)) }, uVolOff: { value: GRID.vox },
  uVisMin: { value: LGRID.min.clone() }, uVisInv: { value: new THREE.Vector3(1 / (LGRID.nx * LGRID.vox), 1 / (LGRID.ny * LGRID.vox), 1 / (LGRID.nz * LGRID.vox)) }, uVisOff: { value: LGRID.vox },
  uVolOn: { value: 0 }, uLmOn: { value: 0 },
  uClay: { value: 0 },   // 살펴보기용: 모든 면을 같은 회색으로 칠해 빛만 본다(?clay=1)
  uLmA: { value: Array.from({ length: MAXL }, () => new THREE.Vector4()) },
  uLmB: { value: Array.from({ length: MAXL }, () => new THREE.Vector4()) },
  uLm1: { value: new Array(MAXL).fill(1) },
  // 광원 반지름(m): 정반사를 이 크기만큼 넓힌다(materials.js bcLightRough). 자리 순서는 장면에 놓인 순서 = 형광등, 총구 화염 둘, 화염의 되비침
  uLmR: { value: new Array(MAXL).fill(0.29) },
  // 형광등 관의 방향 × 반 길이(월드 좌표, m). 정반사를 관 위의 대표점에서 받아 관 방향으로 늘어난 띠로 맺는다(materials.js bcDirectPoint). 관이 아닌 광원은 0
  uLmT: { value: Array.from({ length: MAXL }, () => new THREE.Vector3()) },
  uSkyU: { value: new THREE.Vector4(0, 1, 0, 1) },   // 가려지지 않은 하늘의 조도(xyz 기울기, w 평균): 볼륨 밖과 굽기 실패 때 쓴다
  uGndE: { value: 1 },                                // 가려지지 않은 땅이 되돌려 보내는 조도
  uSkyTint: { value: new THREE.Color(1, 1, 1) }, uBncTint: { value: new THREE.Color(1, 1, 1) },
};

// 광원의 크기(정반사가 퍼지는 정도). 형광등은 길이 1.18 m(관 두 개, 등기구 1.25 m의 94%), 폭 0.22 m의 관이다:
// 관 방향은 uLmT의 띠로, 폭은 반지름 0.11 m로 넓힌다. 총구 화염은 불꽃 덩어리, 되비침은 화염이 비춘 둘레의 벽과 바닥 전체를 대신하므로 넓은 면이다.
// 2026-11-15 실내 세션 전에는 형광등을 넓이가 같은 원판(0.29 m)으로 모든 방향에 넓혀, 반사가 띠가 아니라 총 윗면 전체에 깔린 회색 막이 됐다
const LAMP_W = 0.11, LAMP_HALF = 0.59, FLASH_R = 0.08, BOUNCE_R = 1.2;
// 형광등 가시도를 셰이더의 점광원 자리에 연결한다. slots: 점광원이 장면에 놓인 순서대로 가시도 채널 번호(없으면 -1),
// along: 같은 순서로 관의 방향('x' 또는 'z')
export function setLightSlots(slots, along = []) {
  const U = volUniforms;
  for (let i = 0; i < MAXL; i++) {
    const ch = i < slots.length ? slots[i] : -1;
    U.uLmA.value[i].set(ch === 0 ? 1 : 0, ch === 1 ? 1 : 0, ch === 2 ? 1 : 0, ch === 3 ? 1 : 0);
    U.uLmB.value[i].set(ch === 4 ? 1 : 0, ch === 5 ? 1 : 0, ch === 6 ? 1 : 0, ch === 7 ? 1 : 0);
    U.uLm1.value[i] = ch < 0 ? 1 : 0;
    U.uLmR.value[i] = i < slots.length ? LAMP_W : i < slots.length + 2 ? FLASH_R : BOUNCE_R;
    U.uLmT.value[i].set(i < slots.length && along[i] === 'x' ? LAMP_HALF : 0, 0, i < slots.length && along[i] === 'z' ? LAMP_HALF : 0);
  }
}

// main.js의 하늘 셰이더와 같은 식(구름 무늬는 평균값)
const SUN = new THREE.Vector3(-0.6, 0.25, 0.75).normalize();
export function skyRadiance(d) {
  const up = Math.min(1, Math.max(-0.2, d.y));
  let s = Math.min(1, Math.max(0, up / 0.7)); s = s * s * (3 - 2 * s);
  const g = Math.pow(Math.max(0, d.dot(SUN)), 6) * 1.2;
  return [(2.5 + (1.75 - 2.5) * s) * 0.97 + g, (2.55 + (1.82 - 2.55) * s) * 0.97 + 0.95 * g, (2.6 + (1.95 - 2.6) * s) * 0.97 + 0.85 * g].map(v => v * SKY_GAIN);
}
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// 가려지지 않은 하늘의 조도와 색: 굽기 전에도(또는 굽기에 실패해도) 화면이 나오도록 먼저 채워 둔다
const SKY_DIRS = (() => {
  const N = 160, out = [];
  for (let i = 0; i < N; i++) {
    const y = (i + 0.5) / N, r = Math.sqrt(1 - y * y), a = i * 2.39996323;
    const d = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    out.push({ d, rgb: skyRadiance(d), w: 2 * Math.PI / N });
  }
  return out;
})();
{
  let a0 = 0; const a1 = new THREE.Vector3(), rgb = [0, 0, 0];
  for (const s of SKY_DIRS) { const L = lum(s.rgb) * s.w; a0 += L; a1.addScaledVector(s.d, L); for (let k = 0; k < 3; k++) rgb[k] += s.rgb[k] * s.w; }
  volUniforms.uSkyU.value.set(a1.x * 0.5, a1.y * 0.5, a1.z * 0.5, a0 * 0.25);
  const eUp = a0 * 0.25 + a1.y * 0.5;
  volUniforms.uGndE.value = 0.22 * eUp;
  const l = lum(rgb);
  volUniforms.uSkyTint.value.setRGB(rgb[0] / l, rgb[1] / l, rgb[2] / l);
  volUniforms.uBncTint.value.setRGB(1.06, 1.0, 0.9);   // 되돌아온 빛은 바닥과 벽의 색을 조금 띤다
}

// ---------------- 굽기 도구 ----------------
const VS = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor };
function pass(fs, uniforms, additive = false) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...(additive ? ADD : {}) });
}
function rt3d(nx, nz, ny, type, format = THREE.RGBAFormat) {
  const rt = new THREE.WebGL3DRenderTarget(nx, nz, ny, { depthBuffer: false });
  const t = rt.texture;
  t.format = format; t.type = type; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.NoColorSpace;
  return rt;
}
const tick = () => new Promise(r => setTimeout(r, 0));

// 격자점 좌표: 텍스처의 가로는 x, 세로는 z, 층은 y
const HEAD = `
uniform vec3 uMin; uniform float uVox; uniform float uLayer;
vec3 cell(){ return uMin + vec3(gl_FragCoord.x, uLayer + 0.5, gl_FragCoord.y) * uVox; }
`;

const SKY_FS = HEAD + `
uniform sampler2D tDepth; uniform mat4 uVP; uniform vec3 uDir; uniform float uW; uniform float uBias; uniform float uTexel;
void main(){
  vec3 p = cell();
  vec4 c = uVP * vec4(p, 1.0);
  vec3 s = c.xyz / c.w * 0.5 + 0.5;
  float vis = 0.0;
  for (int j = 0; j < 4; j++) {
    vec2 o = (vec2(float(j & 1), float(j >> 1)) - 0.5) * uTexel;
    vis += step(s.z - uBias, textureLod(tDepth, s.xy + o, 0.0).r);
  }
  gl_FragColor = vec4(uDir * 0.5, 0.25) * (uW * vis * 0.25);
}`;

const DIST_VS = 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
const DIST_FS = 'varying vec3 vW; uniform vec3 uLP; void main(){ gl_FragColor = vec4(length(vW - uLP), 0.0, 0.0, 1.0); }';

const FACE_FN = `
uniform sampler2D tAtlas; uniform mat4 uFaceVP[6]; uniform vec3 uLP; uniform float uFaceRes;
float lightVis(vec3 p){
  vec3 v = p - uLP; vec3 a = abs(v);
  int f = (a.x >= a.y && a.x >= a.z) ? (v.x > 0.0 ? 0 : 1) : (a.y >= a.z ? (v.y > 0.0 ? 2 : 3) : (v.z > 0.0 ? 4 : 5));
  vec4 c = uFaceVP[f] * vec4(p, 1.0);
  vec2 uv = clamp(c.xy / c.w * 0.5 + 0.5, vec2(0.5 / uFaceRes), vec2(1.0 - 0.5 / uFaceRes));
  vec2 at = (uv + vec2(float(f % 3), float(f / 3))) / vec2(3.0, 2.0);
  float ref = textureLod(tAtlas, at, 0.0).r;
  return (ref <= 0.0 || length(v) - 0.04 <= ref) ? 1.0 : 0.0;
}`;
const VIS_FS = HEAD + FACE_FN + `
uniform vec4 uMask; uniform float uW;
void main(){ gl_FragColor = uMask * (uW * lightVis(cell())); }`;

const SKYV_FS = `
uniform highp sampler3D tSky; uniform float uLayerI; uniform float uInv;
void main(){ float v = texelFetch(tSky, ivec3(gl_FragCoord.xy, int(uLayerI)), 0).w * uInv; gl_FragColor = vec4(clamp(v, 0.0, 1.0)); }`;

// 반사광 모으기: 사방 64방향으로 광선을 보내 처음 닿는 면이 받은 빛을 그 면의 반사율만큼 되돌려 받는다
const GATHER_FS = HEAD + `
uniform highp sampler3D tOcc; uniform highp sampler3D tSky; uniform highp sampler3D tSrc; uniform highp sampler3D tVisA; uniform highp sampler3D tVisB;
uniform int uMode; uniform vec3 uDirs[64]; uniform vec3 uGMin; uniform vec3 uGInv; uniform vec3 uLMin; uniform vec3 uLInv;
uniform vec3 uLPos[8]; uniform float uLInt[8]; uniform vec4 uLMa[8]; uniform vec4 uLMb[8];
float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(){
  vec3 p = cell();
  float ang = hash3(p) * 6.2831853; float ca = cos(ang), sa = sin(ang);
  vec3 a1 = vec3(0.0); float a0 = 0.0;
  for (int k = 0; k < 64; k++) {
    vec3 d = uDirs[k]; d = vec3(d.x * ca - d.z * sa, d.y, d.x * sa + d.z * ca);
    vec3 prev = p; float t = 0.12; bool hit = false;
    for (int s = 0; s < 66; s++) {
      vec3 q = p + d * t;
      vec3 u = (q - uGMin) * uGInv;
      if (any(lessThan(u, vec3(0.0))) || any(greaterThan(u, vec3(1.0)))) break;
      if (textureLod(tOcc, u.xzy, 0.0).r > 0.25) { hit = true; break; }
      prev = q; t += 0.18;
    }
    if (!hit) continue;
    vec3 n = -d; float E;
    vec3 gu = ((prev - uGMin) * uGInv).xzy;
    if (uMode == 1) {
      vec4 sh = textureLod(tSky, gu, 0.0);
      E = max(sh.w + dot(sh.xyz, n), 0.0);
      vec3 lu = (prev - uLMin) * uLInv;
      if (all(greaterThan(lu, vec3(0.0))) && all(lessThan(lu, vec3(1.0)))) {
        vec4 va = textureLod(tVisA, lu.xzy, 0.0), vb = textureLod(tVisB, lu.xzy, 0.0);
        for (int i = 0; i < 8; i++) {
          vec3 l = uLPos[i] - prev; float dist = max(length(l), 0.05);
          float c = clamp(1.0 - pow(dist / 9.5, 4.0), 0.0, 1.0);
          float att = c * c / max(pow(dist, 1.6), 0.01);
          E += uLInt[i] * att * (dot(va, uLMa[i]) + dot(vb, uLMb[i])) * max(dot(n, l / dist), 0.0);
        }
      }
    } else {
      vec4 sh = textureLod(tSrc, gu, 0.0);
      E = max(sh.w + dot(sh.xyz, n), 0.0);
    }
    // 반사율: 때가 낀 실내 면(회벽 위쪽 0.6, 아래 녹색 띠 0.3, 바닥 0.3~0.45, 천장 0.2~0.6)의 평균은 0.42쯤, 바깥(자갈, 아스팔트)은 0.22쯤이다
    bool ins = prev.x > -12.0 && prev.x < 12.0 && prev.z > -16.0 && prev.z < 0.0 && prev.y < 5.7;
    float L = (ins ? 0.42 : 0.22) * E * 0.3183099;
    a0 += L; a1 += L * d;
  }
  float w = 12.566371 / 64.0;
  gl_FragColor = vec4(a1 * (w * 0.5), a0 * (w * 0.25));
}`;

// 반사광(거친 격자)을 주 격자로 옮기고 하늘빛과 합친다. 벽 너머의 값이 섞이지 않도록 격자점 사이가 막혀 있으면 그 값을 빼고 보간한다
const COMPOSE_FS = HEAD + `
uniform highp sampler3D tOcc; uniform highp sampler3D tSky; uniform highp sampler3D tB1; uniform highp sampler3D tB2;
uniform vec3 uGInv; uniform vec3 uNC; uniform float uVoxC; uniform float uTail;
float occ(vec3 q){ return textureLod(tOcc, ((q - uMin) * uGInv).xzy, 0.0).r; }
void main(){
  vec3 p = cell();
  vec4 sky = texelFetch(tSky, ivec3(gl_FragCoord.xy, int(uLayer)), 0);
  vec3 g = (p - uMin) / uVoxC - 0.5; vec3 g0 = floor(g); vec3 f = g - g0;
  vec4 acc = vec4(0.0), plain = vec4(0.0); float ws = 0.0;
  for (int j = 0; j < 8; j++) {
    vec3 o = vec3(float(j & 1), float((j >> 1) & 1), float((j >> 2) & 1));
    vec3 c = clamp(g0 + o, vec3(0.0), uNC - 1.0);
    vec3 cp = uMin + (c + 0.5) * uVoxC;
    vec3 w3 = mix(1.0 - f, f, o); float w = w3.x * w3.y * w3.z;
    ivec3 ci = ivec3(int(c.x), int(c.z), int(c.y));
    vec4 b = texelFetch(tB1, ci, 0) + texelFetch(tB2, ci, 0) * uTail;
    plain += b * w;
    float v = 1.0;
    for (int s = 1; s <= 3; s++) { if (occ(mix(p, cp, float(s) / 3.0)) > 0.25) { v = 0.0; break; } }
    acc += b * (w * v); ws += w * v;
  }
  vec4 bounce = ws > 1e-3 ? acc / ws : plain;
  if (occ(p) > 0.75) bounce = vec4(0.0);
  gl_FragColor = sky + bounce;
}`;

// 큰 형상이 차지한 칸(반사광 광선을 막는 용도). 255: 형상 안, 128: 얇은 판을 한 칸 두께로 부풀린 껍질
function buildOccupancy(list) {
  const { nx, ny, nz, vox, min } = GRID;
  const data = new Uint8Array(nx * ny * nz);
  const H = vox * 0.5, P = new THREE.Vector3(), inv = new THREE.Matrix4();
  for (const o of list) {
    let c, h, ext;
    if (o.m) {
      const e = o.m.elements; h = o.h; c = [e[12], e[13], e[14]];
      const hi = h.map(v => Math.max(v, H));
      ext = [0, 1, 2].map(a => Math.abs(e[a]) * hi[0] + Math.abs(e[4 + a]) * hi[1] + Math.abs(e[8 + a]) * hi[2]);
      inv.copy(o.m).invert();
    } else {
      c = [0, 1, 2].map(a => (o.min[a] + o.max[a]) / 2); h = [0, 1, 2].map(a => (o.max[a] - o.min[a]) / 2);
      ext = h.map(v => Math.max(v, H));
    }
    if (h.filter(v => v * 2 >= 0.45).length < 2) continue;
    const hi = h.map(v => Math.max(v, H));
    const lo = [0, 1, 2].map(a => Math.max(0, Math.floor((c[a] - ext[a] - min.getComponent(a)) / vox)));
    const up = [0, 1, 2].map((a, k) => Math.min([nx, ny, nz][k] - 1, Math.ceil((c[a] + ext[a] - min.getComponent(a)) / vox)));
    for (let iy = lo[1]; iy <= up[1]; iy++) for (let iz = lo[2]; iz <= up[2]; iz++) for (let ix = lo[0]; ix <= up[0]; ix++) {
      P.set(min.x + (ix + 0.5) * vox, min.y + (iy + 0.5) * vox, min.z + (iz + 0.5) * vox);
      if (o.m) P.applyMatrix4(inv); else P.set(P.x - c[0], P.y - c[1], P.z - c[2]);
      const ax = Math.abs(P.x), ay = Math.abs(P.y), az = Math.abs(P.z);
      if (ax > hi[0] || ay > hi[1] || az > hi[2]) continue;
      const v = (ax <= h[0] && ay <= h[1] && az <= h[2]) ? 255 : 128;
      const i = ix + nx * (iz + nz * iy);
      if (data[i] < v) data[i] = v;
    }
  }
  const t = new THREE.Data3DTexture(data, nx, nz, ny);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.NearestFilter; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

// casters: 하늘을 가리는 메시들, nearCasters: 형광등을 가리는 메시들(건물 안팎), occ: 큰 형상 목록,
// lights: [{ pos: Vector3, along: 'x'|'z', intensity, chan }]
export async function bakeLight(renderer, { casters, nearCasters, occ, lights, onProgress = () => {} }) {
  const t0 = performance.now();
  const R = renderer;
  const saved = { target: R.getRenderTarget(), autoClear: R.autoClear, color: R.getClearColor(new THREE.Color()), alpha: R.getClearAlpha() };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false;
  const qScene = new THREE.Scene(); qScene.add(quad);
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const temps = [];
  const U = volUniforms;
  try {
    // 부동소수 렌더 타깃을 못 쓰는 기기에서는 굽지 않는다(그대로 두면 볼륨이 비어 화면이 검게 나온다)
    if (!R.extensions.has('EXT_color_buffer_float') && !R.extensions.has('EXT_color_buffer_half_float')) throw new Error('부동소수 렌더 타깃을 쓸 수 없다');
    R.autoClear = false; R.setClearColor(0x000000, 0);
    const clear3d = (rt, n) => { for (let l = 0; l < n; l++) { R.setRenderTarget(rt, l); R.clear(true, false, false); } };
    const layers = (rt, n, material, layerUniform) => { quad.material = material; for (let l = 0; l < n; l++) { layerUniform.value = l; R.setRenderTarget(rt, l); R.render(qScene, qCam); } };
    const G = GRID, LG = LGRID;
    const gSize = new THREE.Vector3(G.nx * G.vox, G.ny * G.vox, G.nz * G.vox);
    const gInv = new THREE.Vector3(1 / gSize.x, 1 / gSize.y, 1 / gSize.z);

    // ---- 1. 하늘빛 가시도 ----
    const casterScene = new THREE.Scene();
    const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    for (const m of casters) { const c = new THREE.Mesh(m.geometry, depthMat); c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); c.frustumCulled = false; casterScene.add(c); }
    const SM = 2048;
    const rtDepth = new THREE.WebGLRenderTarget(SM, SM, { depthBuffer: true }); temps.push(rtDepth);
    rtDepth.depthTexture = new THREE.DepthTexture(SM, SM); rtDepth.depthTexture.type = THREE.UnsignedIntType;
    rtDepth.depthTexture.minFilter = rtDepth.depthTexture.magFilter = THREE.NearestFilter;
    const rtSky = rt3d(G.nx, G.nz, G.ny, THREE.HalfFloatType); temps.push(rtSky);
    clear3d(rtSky, G.ny);
    const center = G.min.clone().addScaledVector(gSize, 0.5), rad = gSize.length() * 0.5 + 1, back = 160;
    const oc = new THREE.OrthographicCamera(-rad, rad, rad, -rad, 1, back + rad * 2 + 1);
    const skyMat = pass(SKY_FS, { uMin: { value: G.min }, uVox: { value: G.vox }, uLayer: { value: 0 }, tDepth: { value: rtDepth.depthTexture }, uVP: { value: new THREE.Matrix4() }, uDir: { value: new THREE.Vector3() }, uW: { value: 0 }, uBias: { value: 0.05 / (back + rad * 2) }, uTexel: { value: 1 / SM } }, true);
    let a0u = 0;
    for (let i = 0; i < SKY_DIRS.length; i++) {
      const s = SKY_DIRS[i];
      oc.position.copy(center).addScaledVector(s.d, back + rad);
      oc.up.set(0, 1, 0); if (Math.abs(s.d.y) > 0.99) oc.up.set(0, 0, 1);
      oc.lookAt(center); oc.updateMatrixWorld(true);
      R.setRenderTarget(rtDepth); R.clear(true, true, false); R.render(casterScene, oc);
      const w = lum(s.rgb) * s.w; a0u += w;
      skyMat.uniforms.uVP.value.multiplyMatrices(oc.projectionMatrix, oc.matrixWorldInverse);
      skyMat.uniforms.uDir.value.copy(s.d); skyMat.uniforms.uW.value = w;
      layers(rtSky, G.ny, skyMat, skyMat.uniforms.uLayer);
      if (i % 20 === 19) { onProgress(0.45 * (i + 1) / SKY_DIRS.length, '하늘빛'); await tick(); }
    }
    // 하늘이 보이는 비율(반사 가림과 빛 색에 쓴다)
    const rtSkyV = rt3d(G.nx, G.nz, G.ny, THREE.UnsignedByteType, THREE.RedFormat);
    const skyVMat = pass(SKYV_FS, { tSky: { value: rtSky.texture }, uLayerI: { value: 0 }, uInv: { value: 1 / (a0u * 0.25) } });
    layers(rtSkyV, G.ny, skyVMat, skyVMat.uniforms.uLayerI);

    // ---- 2. 형광등 가시도 ----
    const nearScene = new THREE.Scene();
    const distMat = new THREE.ShaderMaterial({ vertexShader: DIST_VS, fragmentShader: DIST_FS, uniforms: { uLP: { value: new THREE.Vector3() } }, side: THREE.DoubleSide });
    for (const m of nearCasters) { const c = new THREE.Mesh(m.geometry, distMat); c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); c.frustumCulled = false; nearScene.add(c); }
    const FS = 512;
    const atlas = new THREE.WebGLRenderTarget(FS * 3, FS * 2, { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }); temps.push(atlas);
    atlas.scissorTest = true;
    const rtVis = [rt3d(LG.nx, LG.nz, LG.ny, THREE.UnsignedByteType), rt3d(LG.nx, LG.nz, LG.ny, THREE.UnsignedByteType)];
    clear3d(rtVis[0], LG.ny); clear3d(rtVis[1], LG.ny);
    const fc = new THREE.PerspectiveCamera(90, 1, 0.03, 16);
    const FD = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const faceVP = FD.map(() => new THREE.Matrix4());
    const visMat = pass(VIS_FS, { uMin: { value: LG.min }, uVox: { value: LG.vox }, uLayer: { value: 0 }, tAtlas: { value: atlas.texture }, uFaceVP: { value: faceVP }, uLP: { value: new THREE.Vector3() }, uFaceRes: { value: FS }, uMask: { value: new THREE.Vector4() }, uW: { value: 0 } }, true);
    const NS = 8, tmp = new THREE.Vector3();
    for (let li = 0; li < lights.length; li++) {
      const L = lights[li];
      for (let s = 0; s < NS; s++) {
        const off = ((s + 0.5) / NS - 0.5) * 1.15;
        const lp = L.pos.clone(); if (L.along === 'x') lp.x += off; else lp.z += off;
        distMat.uniforms.uLP.value.copy(lp);
        fc.position.copy(lp);
        for (let f = 0; f < 6; f++) {
          fc.up.set(0, 1, 0); if (FD[f][1] !== 0) fc.up.set(0, 0, 1);
          fc.lookAt(tmp.set(lp.x + FD[f][0], lp.y + FD[f][1], lp.z + FD[f][2])); fc.updateMatrixWorld(true);
          faceVP[f].multiplyMatrices(fc.projectionMatrix, fc.matrixWorldInverse);
          atlas.viewport.set((f % 3) * FS, Math.floor(f / 3) * FS, FS, FS); atlas.scissor.copy(atlas.viewport);
          R.setRenderTarget(atlas); R.clear(true, true, false); R.render(nearScene, fc);
        }
        visMat.uniforms.uLP.value.copy(lp); visMat.uniforms.uW.value = 1 / NS;
        visMat.uniforms.uMask.value.set(0, 0, 0, 0).setComponent(L.chan % 4, 1);
        layers(rtVis[L.chan < 4 ? 0 : 1], LG.ny, visMat, visMat.uniforms.uLayer);
      }
      onProgress(0.45 + 0.35 * (li + 1) / lights.length, '형광등 그림자'); await tick();
    }

    // ---- 3. 반사광 ----
    const occTex = buildOccupancy(occ); temps.push(occTex);
    const cn = [Math.ceil(G.nx / CO), Math.ceil(G.ny / CO), Math.ceil(G.nz / CO)], cv = G.vox * CO;
    const rtB1 = rt3d(cn[0], cn[2], cn[1], THREE.HalfFloatType), rtB2 = rt3d(cn[0], cn[2], cn[1], THREE.HalfFloatType); temps.push(rtB1, rtB2);
    const dirs = []; for (let i = 0; i < 64; i++) { const y = 1 - 2 * (i + 0.5) / 64, r = Math.sqrt(1 - y * y), a = i * 2.39996323; dirs.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
    const lp8 = Array.from({ length: 8 }, () => new THREE.Vector3(0, -100, 0)), li8 = new Array(8).fill(0);
    const ma = Array.from({ length: 8 }, () => new THREE.Vector4()), mb = Array.from({ length: 8 }, () => new THREE.Vector4());
    lights.slice(0, 8).forEach((L, i) => { lp8[i].copy(L.pos); li8[i] = L.intensity; (L.chan < 4 ? ma : mb)[i].setComponent(L.chan % 4, 1); });
    const lgInv = new THREE.Vector3(1 / (LG.nx * LG.vox), 1 / (LG.ny * LG.vox), 1 / (LG.nz * LG.vox));
    const gather = pass(GATHER_FS, {
      uMin: { value: G.min }, uVox: { value: cv }, uLayer: { value: 0 }, tOcc: { value: occTex }, tSky: { value: rtSky.texture }, tSrc: { value: rtB2.texture },
      tVisA: { value: rtVis[0].texture }, tVisB: { value: rtVis[1].texture }, uMode: { value: 1 }, uDirs: { value: dirs }, uGMin: { value: G.min }, uGInv: { value: gInv },
      uLMin: { value: LG.min }, uLInv: { value: lgInv }, uLPos: { value: lp8 }, uLInt: { value: li8 }, uLMa: { value: ma }, uLMb: { value: mb },
    });
    layers(rtB1, cn[1], gather, gather.uniforms.uLayer);
    onProgress(0.9, '반사광'); await tick();
    gather.uniforms.uMode.value = 2; gather.uniforms.tSrc.value = rtB1.texture;
    layers(rtB2, cn[1], gather, gather.uniforms.uLayer);

    // ---- 4. 합치기 ----
    const rtAmb = rt3d(G.nx, G.nz, G.ny, THREE.HalfFloatType);
    const compose = pass(COMPOSE_FS, { uMin: { value: G.min }, uVox: { value: G.vox }, uLayer: { value: 0 }, tOcc: { value: occTex }, tSky: { value: rtSky.texture }, tB1: { value: rtB1.texture }, tB2: { value: rtB2.texture }, uGInv: { value: gInv }, uNC: { value: new THREE.Vector3(cn[0], cn[1], cn[2]) }, uVoxC: { value: cv }, uTail: { value: 1.35 } });
    layers(rtAmb, G.ny, compose, compose.uniforms.uLayer);

    U.uAmb.value = rtAmb.texture; U.uSkyV.value = rtSkyV.texture; U.uVisA.value = rtVis[0].texture; U.uVisB.value = rtVis[1].texture;
    U.uVolOn.value = 1; U.uLmOn.value = 1;
    for (const m of [skyMat, skyVMat, visMat, gather, compose, depthMat, distMat]) m.dispose();
    // 구워진 값이 말이 되는지 한 점에서 확인한다: 격자 꼭대기(지붕 위)는 하늘이 대부분 보여야 한다
    R.setRenderTarget(saved.target);
    const top = probeLight(R, G.min.x + gSize.x * 0.5, G.min.y + gSize.y - 0.3, G.min.z + gSize.z * 0.75);
    if (!top || !(top.sky > 0.5) || !(top.amb[3] > 0.1)) throw new Error('구운 값이 비어 있다');
    quad.geometry.dispose();
    onProgress(1, '반사광');
    return { ok: true, ms: performance.now() - t0, skyDirs: SKY_DIRS.length, lights: lights.length };
  } catch (e) {
    console.warn('빛 굽기를 건너뜀(가려지지 않은 하늘빛으로 대신한다):', e);
    U.uVolOn.value = 0; U.uLmOn.value = 0;
    return { ok: false, ms: performance.now() - t0, error: String(e) };
  } finally {
    for (const t of temps) t.dispose();
    R.setRenderTarget(saved.target); R.autoClear = saved.autoClear; R.setClearColor(saved.color, saved.alpha);
  }
}

// 살펴보기·검사용: 월드 좌표 한 점에서 볼륨 값을 읽는다. { amb: [기울기 xyz, 평균], sky: 하늘이 보이는 비율, vis: 형광등 8개의 가시도 }
const PROBE_FS = 'uniform highp sampler3D tV; uniform vec3 uP; void main(){ gl_FragColor = textureLod(tV, uP, 0.0); }';
export function probeLight(renderer, x, y, z) {
  const U = volUniforms; if (!U.uAmb.value) return null;
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
  const m = pass(PROBE_FS, { tV: { value: null }, uP: { value: new THREE.Vector3() } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); quad.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(quad); const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget(), buf = new Float32Array(4);
  const read = (tex, min, inv) => {
    m.uniforms.tV.value = tex; m.uniforms.uP.value.set((x - min.x) * inv.x, (z - min.z) * inv.z, (y - min.y) * inv.y);
    renderer.setRenderTarget(rt); renderer.render(sc, cam); renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, buf);
    return Array.from(buf).map(v => +v.toFixed(3));
  };
  const out = { amb: read(U.uAmb.value, U.uVolMin.value, U.uVolInv.value), sky: read(U.uSkyV.value, U.uVolMin.value, U.uVolInv.value)[0],
    vis: [...read(U.uVisA.value, U.uVisMin.value, U.uVisInv.value), ...read(U.uVisB.value, U.uVisMin.value, U.uVisInv.value)] };
  renderer.setRenderTarget(prev); rt.dispose(); m.dispose(); quad.geometry.dispose();
  return out;
}
