// 공용 재질: 조도 볼륨(하늘빛·반사광·형광등 가시도), 월드 좌표 얼룩, 바닥 접합부 때를 셰이더에 주입한다
import * as THREE from 'three';
import { volUniforms, MAXL } from './lightbake.js';

// 입은 사람의 몸(셰이더 uBodyS). 0 가슴, 1 배, 2·3 어깨, 4 헬멧 쓴 머리, 5·6 오른 위팔, 7·8 왼 위팔.
// 머리는 가슴 카메라 바로 위(목이 곧다)이고 헬멧까지 반지름 14 cm다. 2026-11-15 실내 세션 전에는 머리를 카메라 15 cm 뒤에 두고 위팔이 없어,
// 머리 위 형광등이 총과 장갑을 그대로 비추고 옆과 뒤에서 오는 방의 빛이 덜 가려졌다
const BODY_STATIC = [[0, -0.08, 0.19, 0.17], [0, -0.42, 0.17, 0.16], [-0.2, 0.05, 0.14, 0.11], [0.2, 0.05, 0.14, 0.11], [0, 0.33, 0.04, 0.14]];
const SHOULDER = [new THREE.Vector3(0.21, 0.0, 0.1), new THREE.Vector3(-0.21, 0.0, 0.1)];
export const bodyUniforms = { uBodyS: { value: [...BODY_STATIC.map((a) => new THREE.Vector4(...a)), ...Array.from({ length: 4 }, () => new THREE.Vector4(0, -0.3, 0.1, 0.065))] },
  // 1이면 뷰모델의 환경맵이 총 자리에서 그린 반사 프로브(localprobe.js)다. 그 반사를 그대로 쓴다
  uLocEnv: { value: 0 } };
// 위팔: 어깨에서 그 프레임의 팔꿈치(월드 좌표)까지 1/3, 2/3 자리에 반지름 6.5 cm 구
const _e = new THREE.Vector3();
export function setBodyArms(camera, elbows) {
  camera.updateMatrixWorld();
  const S = bodyUniforms.uBodyS.value;
  elbows.forEach((e, k) => {
    _e.copy(e).applyMatrix4(camera.matrixWorldInverse);
    for (let j = 0; j < 2; j++) { const f = j ? 0.7 : 0.33; S[5 + k * 2 + j].set(SHOULDER[k].x + (_e.x - SHOULDER[k].x) * f, SHOULDER[k].y + (_e.y - SHOULDER[k].y) * f, SHOULDER[k].z + (_e.z - SHOULDER[k].z) * f, 0.065); }
  });
}
export const envUniforms = {
  uBldg: { value: new THREE.Vector4(-12, -16, 12, 0) },
  uRoofY: { value: 5.7 },
  uFL: { value: 0.7 },
  // 바깥벽 꼭대기: 창고 홀(xz 범위 uHall)은 uRoofY, 나머지는 uEave. 빗물 줄이 시작하는 높이다(level.js의 extWallZ/X 높이와 맞춘다)
  uHall: { value: new THREE.Vector4(-12.2, -16.2, 4.7, -6.55) },
  uEave: { value: 3.9 },
};

const VERT_HEAD = `
varying vec3 vBcW;
attribute float aWear;
varying float vBcWear;
attribute vec4 aBox; varying vec4 vBcBox; varying vec3 vBcObj;
attribute float aGloss; varying float vBcGloss;
attribute float aSelfOcc; varying float vBcSO;
`;
const VERT_BODY = `
  {
    vec4 bcw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      bcw = instanceMatrix * bcw;
    #endif
    vBcW = (modelMatrix * bcw).xyz;
    vBcWear = aWear;
    vBcBox = aBox; vBcObj = transformed; vBcGloss = aGloss; vBcSO = aSelfOcc;
  }
`;

// 모서리 표시(markEdges): 부품 형상의 물체 좌표 크기를 정점마다 붙인다. 셰이더가 화소마다 모서리까지의 거리를 구해
// 닳은 모서리(드러난 금속, 손에 닳아 반들거리는 자리)를 그린다. 상자는 두 면에 함께 가까운 곳, 원기둥은 끝 테두리가 모서리다.
// w: 둥근 상자는 모서리 반지름(>0), 각진 상자는 0, 원기둥은 -1 - 축 번호(x 0, y 1, z 2)
export function markEdges(geo, bevel = 0, cylAxis = -1) {
  geo.computeBoundingBox();
  const b = geo.boundingBox, h = [(b.max.x - b.min.x) / 2, (b.max.y - b.min.y) / 2, (b.max.z - b.min.z) / 2];
  const w = cylAxis >= 0 ? -1 - cylAxis : bevel, n = geo.attributes.position.count, a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a.set([h[0], h[1], h[2], w], i * 4);
  geo.setAttribute('aBox', new THREE.BufferAttribute(a, 4));
  return geo;
}

const FRAG_HEAD = `
varying vec3 vBcW;
varying float vBcWear;
varying vec4 vBcBox; varying vec3 vBcObj; varying float vBcGloss; varying float vBcSO;
uniform float uFinish; uniform vec4 uBare; uniform float uPolish; uniform float uGlossOn;
uniform float uBody; uniform float uLocEnv;
// 입은 사람의 몸: 가슴에 단 카메라 바로 뒤의 가슴, 배, 두 어깨, 헬멧 쓴 머리, 두 위팔(구 두 개씩)
// (카메라 좌표 = 셰이더의 시점 좌표, m. xyz 중심, w 반지름). 위팔은 그 프레임의 팔꿈치를 따라 JS가 채운다(setBodyArms). 뷰모델(총, 장갑, 소매)만 쓴다(uBody)
#define BC_NB 9
uniform vec4 uBodyS[BC_NB];
// 구 하나가 점 p(법선 n)의 하늘을 가리는 코사인 가중 입체각(지평선에 걸친 경우까지 맞는 식, Quilez)
float bcSphOcc(vec3 p, vec3 n, vec4 s) {
  vec3 di = s.xyz - p; float l = length(di);
  float h = max(l / s.w, 1.02), h2 = h * h, nl = dot(n, di / l), k2 = 1.0 - h2 * nl * nl;
  float res = max(0.0, nl) / h2;
  if (k2 > 0.001) {
    res = nl * acos(clamp(-nl * sqrt((h2 - 1.0) / (1.0 - nl * nl)), -1.0, 1.0)) - sqrt(k2 * (h2 - 1.0));
    res = (res / h2 + atan(sqrt(k2 / (h2 - 1.0)))) / 3.141593;
  }
  return clamp(res, 0.0, 1.0);
}
float bcBodyOcc(vec3 p, vec3 n) { float o = 0.0; for (int i = 0; i < BC_NB; i++) o += bcSphOcc(p, n, uBodyS[i]); return min(o, 0.9); }
// 거울 방향 r이 몸에 닿는 정도(0~1). 반사가 퍼지는 만큼(거칠기) 경계가 무르다
float bcBodyRefl(vec3 p, vec3 r, float rough) {
  float o = 0.0, w = 0.12 + rough * rough * 1.1;
  for (int i = 0; i < BC_NB; i++) {
    vec3 di = uBodyS[i].xyz - p; float l = length(di);
    float ang = acos(clamp(dot(r, di / l), -1.0, 1.0)), rad = asin(clamp(uBodyS[i].w / l, 0.0, 1.0));
    o = max(o, 1.0 - smoothstep(rad - w, rad + w, ang));
  }
  return o;
}
// 점광원까지의 선분을 몸이 가리지 않는 비율(형광등 관의 크기만큼 그림자 가장자리가 무르다)
float bcBodyVis(vec3 p, vec3 lp) {
  vec3 d = lp - p; float L = length(d), v = 1.0; d /= L;
  for (int i = 0; i < BC_NB; i++) {
    vec3 c = uBodyS[i].xyz - p; float t = clamp(dot(c, d), 0.0, L);
    v *= smoothstep(uBodyS[i].w * 0.6, uBodyS[i].w * 1.5, length(c - d * t));
  }
  return v;
}
float bcEdge; float bcBare; float bcDust;
// 모서리까지의 거리(m). 둥근 상자는 모서리 꼭대기(반지름의 0.29만큼 안쪽)부터 잰다
float bcEdgeDist() {
  vec3 a = abs(vBcObj), h = vBcBox.xyz;
  if (vBcBox.w < -0.5) {
    float ax = -vBcBox.w - 1.0;
    float along = ax < 0.5 ? a.x : ax < 1.5 ? a.y : a.z, hl = ax < 0.5 ? h.x : ax < 1.5 ? h.y : h.z;
    vec2 rd = ax < 0.5 ? vBcObj.yz : ax < 1.5 ? vBcObj.xz : vBcObj.xy;
    float r = ax < 0.5 ? h.y : h.x;
    return max(r - length(rd), hl - along);
  }
  vec3 d = h - a;
  float s1 = min(d.x, min(d.y, d.z)), s3 = max(d.x, max(d.y, d.z));
  return max(d.x + d.y + d.z - s1 - s3 - vBcBox.w * 0.29, 0.0);
}
uniform vec4 uBldg;
uniform float uRoofY;
uniform float uFL;
uniform vec4 uHall;
uniform float uEave;
uniform float uGrime;
uniform float uAO;
uniform float uDamp;
uniform float uWeather;
uniform highp sampler3D uAmb; uniform highp sampler3D uSkyV; uniform highp sampler3D uVisA; uniform highp sampler3D uVisB;
uniform vec3 uVolMin; uniform vec3 uVolInv; uniform float uVolOff; uniform vec3 uVisMin; uniform vec3 uVisInv; uniform float uVisOff;
uniform float uVolOn; uniform float uLmOn; uniform float uClay; uniform vec4 uLmA[${MAXL}]; uniform vec4 uLmB[${MAXL}]; uniform float uLm1[${MAXL}]; uniform float uLmS[${MAXL}]; uniform float uLmR[${MAXL}]; uniform vec3 uLmT[${MAXL}];
uniform vec4 uSkyU; uniform float uGndE; uniform vec3 uSkyTint; uniform vec3 uBncTint;
vec3 bcWN; vec4 bcVa; vec4 bcVb; float bcR0;
// 광원의 크기: 점광원으로 그리는 형광등(1.25 m 관 두 개가 든 0.22 m 폭 등기구)과 총구 화염은 실제로는 면이다.
// 면광원의 정반사는 광원이 보이는 각도만큼 퍼진다. 반벡터의 퍼짐(α = 거칠기²)에 광원 반지름 / (2 × 거리)를 더한다.
// GGX 분포는 정규화되어 있어 넓혀도 반사되는 빛의 총량은 같고 봉우리만 낮아진다. 크기 없는 점으로 두면 렌즈 앞 총과 장갑에
// 작고 센 반사점이 맺혀, 그것을 막으려고 모든 반사를 실제의 몇 분의 일로 줄여 왔다(총과 장갑 표면 세션의 원인 분석)
// 형광등은 관이라 모든 방향으로 넓히지 않고, 관 위의 대표점에서 받아 관 방향으로 늘어난 띠로 맺는다(bcDirectPoint, 실내 세션).
// 넓이가 같은 원판으로 모든 방향에 넓혔을 때는 반사가 총 윗면 전체에 깔린 회색 막이 됐다(A/B 43, critic 31의 '석고')

float bcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bcNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bcHash(i), bcHash(i + vec2(1.0, 0.0)), f.x), mix(bcHash(i + vec2(0.0, 1.0)), bcHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float bcFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * bcNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
float bcInside(vec3 p) {
  vec2 lo = smoothstep(uBldg.xy - 0.05, uBldg.xy + 0.45, p.xz);
  vec2 hi = 1.0 - smoothstep(uBldg.zw - 0.45, uBldg.zw + 0.05, p.xz);
  float under = 1.0 - smoothstep(uRoofY - 0.1, uRoofY + 0.3, p.y);
  return lo.x * lo.y * hi.x * hi.y * under;
}
// 볼륨에 저장된 방향성 조도(w 평균, xyz 기울기)를 면의 방향 n으로 읽는다.
// 고르게 퍼진 빛(트인 하늘)은 1차식 그대로가 정확하고, 한쪽에서 오는 빛(창)은 그쪽을 향한 면에 모아야 맞는다.
float bcIrr(vec4 sh, vec3 n) {
  float c0 = max(sh.w, 1e-5), l1 = length(sh.xyz);
  float lin = max(c0 + dot(sh.xyz, n), 0.0);
  float r = clamp(l1 / (2.0 * c0), 0.0, 1.0);
  // 0~1로 묶는다. 면이 빛의 정반대를 향하면 반올림 오차로 음수가 되고, 음수의 거듭제곱은 NaN이다.
  // NaN 화소 하나는 번짐 단계에서 네모난 검은 구역으로 퍼진다(1단계 ① 끝 평가에서 걷기 연속 프레임에 찍혔다)
  float q = clamp(0.5 * (1.0 + dot(sh.xyz / max(l1, 1e-5), n)), 0.0, 1.0);
  float p = 1.0 + 2.0 * r, a = (1.0 - r) / (1.0 + r);
  float geo = c0 * (a + (1.0 - a) * (p + 1.0) * pow(q, p));
  return mix(lin, geo, smoothstep(0.55, 0.9, r));
}
// 형광등 하나의 가시도: 그 점광원 자리에 연결된 채널을 고른다
float bcPV(vec4 ma, vec4 mb, float m1) { return clamp(dot(bcVa, ma) + dot(bcVb, mb) + m1, 0.0, 1.0); }
`;

const FRAG_GRIME = `
#include <map_fragment>
{
  vec3 bcNg = normalize(cross(dFdx(vBcW), dFdy(vBcW)));
  float g = bcFbm(vBcW.xz * 0.33 + vBcW.y * 0.21 + 3.7);
  float g2 = bcFbm(vBcW.xz * 2.3 + vBcW.yx * 1.7);
  float ins = bcInside(vBcW);
  float hF = vBcW.y - mix(0.0, uFL, ins);
  float wall = 1.0 - abs(bcNg.y);
  // 얼룩의 깊이: 계조 곡선을 바로잡은 뒤로 같은 반사율 차이가 화면에서 더 옅게 보인다. 이전만큼 읽히도록 깊이를 키웠다(평균 밝기는 같다)
  // 드러난 속(aWear > 1.2): 떨어져 나간 회벽 밑의 블록. 줄눈 있는 회색 블록을 월드 좌표로 그린다(벽면이면 벽을 따라, 수평면이면 바닥 좌표로)
  float bcCore = smoothstep(1.2, 5.5, vBcWear);
  if (bcCore > 0.0) {
    bool vert = abs(bcNg.y) < 0.7;
    vec2 tw = vert ? normalize(vec2(-bcNg.z, bcNg.x) + 1e-5) : vec2(1.0, 0.0);
    float bu = dot(vBcW.xz, tw), bv = vert ? vBcW.y : vBcW.z;
    float row = floor(bv / 0.2), bu2 = bu / 0.4 + 0.5 * mod(row, 2.0);
    vec2 bf = vec2(fract(bu2) * 0.4, fract(bv / 0.2) * 0.2);
    float mortar = 1.0 - step(0.01, min(min(bf.x, 0.4 - bf.x), min(bf.y, 0.2 - bf.y)));
    float bn = bcNoise(vec2(floor(bu2), row) * 3.7 + 1.3);
    // 줄눈은 블록보다 들어가 있어 어둡다(밝은 줄눈은 타일 격자처럼 보인다)
    vec3 blk = vec3(0.3, 0.295, 0.275) * (0.7 + 0.55 * bn) * (0.8 + 0.4 * bcNoise(vBcW.xz * 37.0 + vBcW.y * 31.0));
    vec3 mor = vec3(0.17, 0.165, 0.155) * (0.85 + 0.3 * bcNoise(vBcW.xz * 53.0 + vBcW.y * 47.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(blk, mor, mortar), bcCore);
  }
  // 노출: 그 자리에서 하늘이 보이는 정도(빛 굽기의 하늘 가시도, 마당 0.77, 차양 밑 0.23, 사무실 0.02).
  // 비, 햇빛, 바람에 실려 온 흙이 그 자리에 닿는 정도로 쓴다. 낡음은 원인이 닿는 자리에 생긴다
  vec3 bcEq = (vBcW + bcNg * uVolOff - uVolMin) * uVolInv;
  vec3 bcEd = min(bcEq, 1.0 - bcEq);
  float bcEIn = uVolOn * smoothstep(0.0, 0.015, min(bcEd.x, bcEd.z)) * smoothstep(0.0, 0.04, 1.0 - bcEq.y);
  float expo = mix(1.0 - ins, textureLod(uSkyV, bcEq.xzy, 0.0).r, bcEIn);
  float alongW = dot(vBcW.xz, vec2(0.71, 0.71)) + vBcW.x * 0.3;
  // 나무(합판, 팔레트)의 물 얼룩은 월드 좌표로 둔다. 텍스처에 그리면 1.22 m 낱장마다 같은 자리에 되풀이된다(A/B 라운드 18).
  // 젖은 바닥에 선 판은 아래에서 물을 빨아올려 밑동이 어둡고 경계에 물때가 남는다. 바깥에 둔 나무는 햇빛과 비에 바래 은회색이 되고 빗물 줄이 진다
  if (uWeather > 0.5) {
    float ex = smoothstep(0.12, 0.45, expo);
    float wl = dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1));
    float streak = smoothstep(0.5, 0.8, bcFbm(vec2(alongW * 7.0, vBcW.y * 0.4 + 2.0))) * wall;
    float blot = smoothstep(0.42, 0.7, bcFbm(vBcW.xz * 1.3 + vBcW.y * 1.1 + 4.0));
    float ws = bcFbm(vBcW.xz * 0.9 + vBcW.y * 0.8 + 6.0);
    float wst = smoothstep(0.5, 0.56, ws), wring = smoothstep(0.49, 0.52, ws) * (1.0 - smoothstep(0.52, 0.56, ws));
    diffuseColor.rgb *= 1.0 - wst * 0.16 - wring * 0.24;
    float wl2 = 0.06 + 0.32 * bcFbm(vec2(alongW * 1.8, 41.0));
    float wick = (1.0 - smoothstep(wl2 - 0.03, wl2, hF)) * wall;
    float wrim = smoothstep(wl2 - 0.04, wl2 - 0.01, hF) * (1.0 - smoothstep(wl2 - 0.01, wl2 + 0.01, hF)) * wall;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(wl) * vec3(0.8, 0.81, 0.83), ex * 0.7);
    diffuseColor.rgb *= 1.0 - blot * (0.25 + 0.1 * ex) - streak * ex * 0.3;
    diffuseColor.rgb *= 1.0 - wick * 0.3 - wrim * 0.25;
  }
  // 바깥벽: 빗물이 지붕 끝에서 흘러내린 줄. 줄마다 길이가 다르고 위에서 진하다(텍스처의 빗물 줄은 2 m마다 되풀이되어 약하게 줄였다)
  if (uDamp > 0.0 && wall > 0.5 && ins < 0.5) {
    float ex = smoothstep(0.15, 0.45, expo);
    bool hall = vBcW.x > uHall.x && vBcW.x < uHall.z && vBcW.z > uHall.y && vBcW.z < uHall.w;
    float hR = (hall ? uRoofY : uEave) - 0.05 - vBcW.y;
    float len = 0.5 + 2.4 * bcFbm(vec2(alongW * 2.3, 5.0));
    float st = smoothstep(0.42, 0.75, bcFbm(vec2(alongW * 5.5, 1.7))) * (1.0 - smoothstep(len * 0.35, len, hR)) * smoothstep(-0.05, 0.05, hR);
    diffuseColor.rgb *= 1.0 - st * ex * 0.4;
  }
  // 건물 안 바닥: 문과 창으로 들어온 흙. 하늘이 조금이라도 보이는 자리(출입구, 창 밑)에 몰린다
  if (uGrime > 0.5 && bcNg.y > 0.7 && ins > 0.5) {
    float tr = smoothstep(0.03, 0.16, expo) * smoothstep(0.35, 0.7, bcFbm(vBcW.xz * 0.9 + 13.0) + 0.2);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.17, 0.13) * (0.8 + 0.4 * bcNoise(vBcW.xz * 5.0)), tr * 0.45);
  }
  float dirt = mix(1.0, (0.6 + 0.64 * g) * (0.84 + 0.32 * g2), uGrime);
  float base = mix(1.0, mix(0.45, 1.0, smoothstep(0.0, 0.45 + g * 0.35, hF)), uGrime * wall);
  diffuseColor.rgb *= dirt * base;
  if (uGrime > 0.5 && bcNg.y > 0.7 && ins < 0.5) {
    vec2 q = vBcW.xz;
    float soil = smoothstep(0.52, 0.72, bcFbm(q * 0.11 + 3.1)) * (0.6 + 0.4 * bcNoise(q * 1.7));
    float wet = smoothstep(0.55, 0.65, bcFbm(q * 0.23 + 11.0));
    float moss = smoothstep(0.62, 0.78, bcFbm(q * 0.4 + 7.0)) * 0.5;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.165, 0.12) * (0.8 + 0.4 * bcNoise(q * 6.0)), soil * 0.55);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.9, 0.62), moss);
    // 넓은 얼룩(물기, 흙, 바퀴 자국)으로 땅 무늬의 반복을 깬다. 마당 바닥이 같은 크기의 자갈 무늬로 멀리까지 이어져 벽지처럼 보였다(A/B 라운드 16)
    diffuseColor.rgb *= 1.0 - wet * 0.45;
    diffuseColor.rgb *= 0.82 + 0.36 * bcFbm(q * 0.05 + 21.0);
    float track = smoothstep(0.035, 0.0, abs(fract(dot(q, vec2(0.27, 0.96)) * 0.31 + bcFbm(q * 0.09) * 0.6) - 0.5)) * smoothstep(0.45, 0.65, bcFbm(q * 0.07 + 5.0));
    diffuseColor.rgb *= 1.0 - track * 0.25;
  }
  // 천장에서 샌 물: 벽 위쪽에서 아래로 번진 누런 얼룩. 아래 경계에 진한 물때 테두리가 남는다. 벽을 따라 몇 군데(누수 자리)에만 있다
  if (uDamp > 0.9 && wall > 0.5 && ins > 0.5) {
    bool hallL = vBcW.x > uHall.x && vBcW.x < uHall.z && vBcW.z > uHall.y && vBcW.z < uHall.w;
    float hC = (hallL ? uRoofY - 0.4 - uFL : 2.8) - hF;
    float leak = smoothstep(0.52, 0.66, bcFbm(vec2(alongW * 0.45, 31.0)));
    float reach = leak * (0.3 + 1.1 * bcFbm(vec2(alongW * 2.2, 33.0)) + 0.08 * bcNoise(vec2(alongW * 14.0, 35.0)));
    float lk = (1.0 - smoothstep(reach - 0.06, reach, hC)) * step(-0.02, hC) * step(0.08, reach);
    float rim = smoothstep(reach - 0.07, reach - 0.015, hC) * (1.0 - smoothstep(reach - 0.015, reach + 0.005, hC)) * step(0.08, reach);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.82, 0.72, 0.52), lk * 0.8);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.58, 0.5, 0.38), rim * 0.7);
  }
  if (uDamp > 0.9 && wall > 0.5 && ins > 0.5) {
    float along2 = vBcW.x + vBcW.z;
    float lineY = 1.18 + 0.006 * sin(along2 * 3.0);
    float lower = 1.0 - smoothstep(lineY - 0.004, lineY + 0.004, hF);
    float stripe = smoothstep(lineY - 0.02, lineY, hF) * (1.0 - smoothstep(lineY, lineY + 0.02, hF));
    vec3 lowCol = diffuseColor.rgb * vec3(0.62, 0.7, 0.64);
    vec3 upCol = diffuseColor.rgb * vec3(1.08, 1.04, 0.96);
    diffuseColor.rgb = mix(upCol, lowCol, lower);
    diffuseColor.rgb *= 1.0 - stripe * 0.4;
  }
  if (uDamp > 0.0 && wall > 0.5) {
    float along = dot(vBcW.xz, vec2(0.71, 0.71)) + vBcW.x * 0.3;
    float line = 0.22 + 0.32 * bcFbm(vec2(along * 0.9, 1.3)) + 0.05 * bcNoise(vec2(along * 9.0, 4.0));
    float damp = 1.0 - smoothstep(line - 0.02, line + 0.01, hF);
    float tide = smoothstep(line - 0.05, line, hF) * (1.0 - smoothstep(line, line + 0.035, hF));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.66, 0.62, 0.52), damp * uDamp);
    diffuseColor.rgb *= 1.0 - tide * 0.35 * uDamp;
    float salt = step(0.82, bcNoise(vec2(along * 40.0, hF * 40.0))) * smoothstep(line + 0.12, line, hF) * (1.0 - damp);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.74, 0.7), salt * 0.25 * uDamp);
    float hand = smoothstep(0.85, 1.05, hF) * (1.0 - smoothstep(1.35, 1.6, hF)) * smoothstep(0.45, 0.75, bcFbm(vec2(along * 1.7, 7.0)));
    diffuseColor.rgb *= 1.0 - hand * 0.18 * uDamp;
  }
  // 닳은 자리(형상 도구가 꼭짓점에 표시한다): 양수는 밝게(깨진 콘크리트, 생나무), 음수는 어둡게(벗겨져 드러난 바탕, 녹)
  // 닳음 표시의 값은 -2~1이다. 드러난 속(6.5)과 이웃한 삼각형에서는 그 사이 값이 보간되므로 1.05보다 큰 값은 닳음으로 읽지 않는다(밝은 테두리가 생긴다)
  float bcWv = vBcWear > 1.05 ? 0.0 : vBcWear;
  if (abs(bcWv) > 0.01) {
    float w = clamp(abs(bcWv) * (0.55 + 0.9 * bcNoise(vBcW.xz * 21.0 + vBcW.y * 29.0)), 0.0, 1.0);
    w = smoothstep(0.18, 0.6, w);
    float wl = dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1));
    vec3 wc = bcWv > 0.0 ? mix(diffuseColor.rgb, vec3(wl) * 1.25 + 0.035, 0.8) : diffuseColor.rgb * vec3(0.4, 0.38, 0.36);
    diffuseColor.rgb = mix(diffuseColor.rgb, wc, w);
  }
  // 닳은 모서리(총처럼 손에 쥐고 부딪히는 물건, uFinish): 모서리 꼭대기에서 1~2 mm 안쪽까지, 조각조각 끊겨 닳는다.
  // 검은 피막(아노다이징, 인산염)이 벗겨져 금속이 드러나고(uBare), 폴리머는 긁혀 옅어진다. 둘 다 손에 닳아 반들거린다(uPolish)
  // 화소 하나보다 좁은 닳음은 그리지 않고 옅게 편다(fwidth로 화소 크기를 잰다). 그대로 두면 레일 이빨과 작은 부품이 화소 단위로 반짝였다
  // 금속은 가장 많이 닳은 자리에서만 드러난다(bare). 1~2 mm 금속 선이 문밖 하늘을 비추면 HDR 값이 커서 렌즈 흐림과 색수차를 거쳐
  // 색 점으로 부서졌다. 레일 이빨 같은 작은 부품(모서리 반지름 4 mm 미만)은 닳음 대신 원래 피막을 둔다
  bcEdge = 0.0; bcBare = 0.0; bcDust = 0.0;
  if (uFinish > 0.5 && vBcBox.x > 0.0) {
    float ed = bcEdgeDist(), px = max(fwidth(ed), 1e-6);
    float patchy = smoothstep(0.35, 0.7, bcFbm(vBcObj.xz * 120.0 + vBcObj.y * 95.0 + 5.3));
    float wid = 0.0016 * patchy;
    float big = vBcBox.w < -0.5 || vBcBox.w < 1e-5 ? 1.0 : smoothstep(0.0025, 0.004, vBcBox.w);
    float wear = (1.0 - smoothstep(wid - px, wid + px, ed)) * smoothstep(1.5, 4.0, wid / px) * big;
    bcBare = uBare.a * smoothstep(0.75, 0.95, patchy) * wear;              // 금속이 드러난 정도
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.6 + 0.01, wear);   // 닳아 옅어진 피막
    diffuseColor.rgb = mix(diffuseColor.rgb, uBare.rgb, bcBare);
    bcEdge = 0.5 * wear + 0.5 * bcBare;                                       // 피막이 남은 닳음은 반만 반들거린다
    // 먼지: 바깥 훈련장에서 쓰는 총의 위를 향한 면(부품 좌표의 위)에 앉은 마른 흙먼지. 얼룩지게 앉고 모서리의 닳은 자리는 닦여 있다
    vec3 bcOn = normalize(cross(dFdx(vBcObj), dFdy(vBcObj)));
    float dust = smoothstep(0.45, 0.9, bcOn.y) * smoothstep(0.38, 0.72, bcFbm(vBcObj.xz * 38.0 + vBcObj.y * 21.0 + 2.1)) * (1.0 - wear);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.27, 0.23), dust * 0.22);
    bcDust = dust;
  }
  if (uClay > 0.5) diffuseColor.rgb = vec3(0.45);
}
`;

// 점광원 루프 앞: 면의 월드 방향과 형광등 가시도를 한 번 읽어 둔다
const FRAG_PRE = `
// 정점에 '매끈한 면'(aGloss)이 표시된 자리: 천 재질 안의 합성 가죽 손바닥과 마디 보호대. 섬유의 결 반사 대신 유전체 정반사를 둔다.
// 재질 쪽 스위치(uGlossOn)로도 막는다: 속성이 없는 형상은 WebGL의 일반 속성 값을 읽는데, 다른 프로그램이 그 자리에 남긴 값일 수 있다
if (uGlossOn > 0.5 && vBcGloss > 0.01) {
  material.roughness = mix(material.roughness, 0.52, vBcGloss);
  material.specularColor = mix(material.specularColor, vec3(0.04), vBcGloss);
  material.specularF90 = mix(material.specularF90, 1.0, vBcGloss);
  #ifdef USE_SHEEN
    material.sheenColor *= 1.0 - vBcGloss;
  #endif
}
bcR0 = material.roughness;
{
  bcWN = normalize(inverseTransformDirection(normal, viewMatrix));
  bcVa = vec4(1.0); bcVb = vec4(1.0);
  if (uLmOn > 0.5) {
    vec3 lq = (vBcW + bcWN * uVisOff - uVisMin) * uVisInv;
    vec3 ld = min(lq, 1.0 - lq);
    float inL = smoothstep(0.0, 0.02, min(ld.x, ld.z)) * step(lq.y, 1.0);
    bcVa = textureLod(uVisA, lq.xzy, 0.0) * inL; bcVb = textureLod(uVisB, lq.xzy, 0.0) * inL;
  }
}
`;
// 점광원마다 가시도(형광등 그림자)와 몸 가림을 곱하고, 직접광은 광원의 모양과 크기를 넣은 bcDirectPoint로 받는다(아래 TUBE_DIRECT)
const LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getPointLightInfo( pointLight, geometryPosition, directLight );',
  'getPointLightInfo( pointLight, geometryPosition, directLight ); directLight.color *= bcPV( uLmA[ i ], uLmB[ i ], uLm1[ i ] ); if ( uBody < 0.5 ) directLight.color *= uLmS[ i ]; if ( uBody > 0.5 ) directLight.color *= bcBodyVis( geometryPosition, pointLight.position );')
  .replace('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )', 'material.roughness = bcR0;\n#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )')
  // 점광원 구간(첫 RE_Direct)만 형광등 관과 광원 크기를 넣은 bcDirectPoint로 바꾼다. 표준 재질이 아니면 그대로 둔다
  .replace('RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
    '\n#ifdef STANDARD\n bcDirectPoint( directLight, pointLight.position, ( viewMatrix * vec4( uLmT[ i ], 0.0 ) ).xyz, uLmR[ i ], geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n#else\n RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n#endif\n');
if (!LIGHTS_BEGIN.includes('bcDirectPoint') || !LIGHTS_BEGIN.includes('material.roughness = bcR0;')) console.warn('점광원 루프를 찾지 못해 형광등 그림자와 광원 크기를 넣지 못했다');
const TUBE_DIRECT = `// 점광원의 직접광(표준 재질). 확산과 결 반사는 광원 가운데 방향으로, 정반사는 광원의 크기를 넣어 받는다.
// 형광등(T ≠ 0)은 관이라 정반사를 반사 광선에 가장 가까운 관 위의 점(대표점, Karis 2013)에서 받는다. 반사가 관 방향으로 늘어난 띠로 맺힌다.
// 띠는 한 방향으로만 넓어지므로 세기를 α/α'로 맞추고, 관 폭(반지름 rad)은 모든 방향에 α + rad/2d로 넓힌다(GGX는 정규화되어 반사되는 빛의 총량은 그대로다)
void bcDirectPoint(const in IncidentLight dl, const in vec3 lpos, const in vec3 T, const in float rad, const in vec3 p, const in vec3 n, const in vec3 v, const in vec3 ccn, in PhysicalMaterial m, inout ReflectedLight rl) {
  float dotNL = saturate(dot(n, dl.direction));
  vec3 irr = dotNL * dl.color;
  #ifdef USE_CLEARCOAT
    clearcoatSpecularDirect += saturate(dot(ccn, dl.direction)) * dl.color * BRDF_GGX_Clearcoat(dl.direction, v, ccn, m);
  #endif
  #ifdef USE_SHEEN
    sheenSpecularDirect += irr * BRDF_Sheen(dl.direction, v, n, m.sheenColor, m.sheenRoughness);
  #endif
  rl.directDiffuse += irr * BRDF_Lambert(m.diffuseColor);
  vec3 L0 = lpos - p;
  float d = max(length(L0), 0.05);
  float a = m.roughness * m.roughness;
  float aS = min(a + rad / (2.0 * d), 1.0);
  vec3 ls = dl.direction;
  float k = 1.0;
  float hl = length(T);
  if (hl > 1e-3) {
    vec3 r = reflect(-v, n);
    vec3 A = L0 - T, Ld = 2.0 * T;
    float rd = dot(r, Ld);
    float t = clamp((dot(r, A) * rd - dot(A, Ld)) / max(dot(Ld, Ld) - rd * rd, 1e-6), 0.0, 1.0);
    ls = normalize(A + Ld * t);
    k = aS / min(aS + hl / (2.0 * d), 1.0);
  }
  m.roughness = sqrt(aS);
  rl.directSpecular += saturate(dot(n, ls)) * dl.color * k * BRDF_GGX(ls, v, n, m);
}
`;

// 간접광: 조도 볼륨이 반구광과 환경맵 확산광을 대신한다. 볼륨 밖(담장 너머, 지붕 위)은 가려지지 않은 하늘빛으로 잇는다
const FRAG_LIGHT = `
#if defined( RE_IndirectDiffuse )
{
  vec3 vq = (vBcW + bcWN * uVolOff - uVolMin) * uVolInv;
  vec3 vd = min(vq, 1.0 - vq);
  float inV = uVolOn * uAO * smoothstep(0.0, 0.015, min(vd.x, vd.z)) * smoothstep(0.0, 0.04, 1.0 - vq.y);
  vec4 bcSh = textureLod(uAmb, vq.xzy, 0.0);
  float bcSkv = mix(1.0, textureLod(uSkyV, vq.xzy, 0.0).r, inV);
  float eOpen = max(uSkyU.w + dot(uSkyU.xyz, bcWN), 0.0) + uGndE * (0.5 - 0.5 * bcWN.y);
  // 굽기에 실패한 기기: 볼륨이 없으므로 건물 안만 어림으로 어둡게 한다
  eOpen *= mix(1.0, 0.1, bcInside(vBcW) * (1.0 - uVolOn));
  vec3 bcTint = mix(uBncTint, uSkyTint, clamp(bcSkv * 1.5, 0.0, 1.0));
  vec3 bcE0 = mix(eOpen, bcIrr(bcSh, bcWN), inV) * bcTint;
  // 입은 사람의 몸이 가린 만큼 빛이 줄고(가슴 카메라가 보는 면은 대부분 몸 쪽을 향한다), 거울 방향이 몸에 닿으면 어두운 옷이 비친다
  float bcBO = 0.0, bcBR = 0.0;
  if (uBody > 0.5) { bcBO = bcBodyOcc(geometryPosition, geometryNormal); bcBR = bcBodyRefl(geometryPosition, reflect(-geometryViewDir, geometryNormal), bcR0); }
  // 총의 부품끼리 가린 만큼(selfocc.js, 다른 형상은 0)도 줄인다
  vec3 bcE = bcE0 * (1.0 - bcBO) * (1.0 - vBcSO);
  irradiance += bcE;
  // 천의 결 반사(sheen): 섬유가 비스듬한 빛을 되돌려 접힌 마루와 가장자리가 회색으로 빛난다. 환경맵 조도(iblIrradiance)는
  // 볼륨이 대신하므로 0으로 두는데, three.js는 그 값으로 결 반사의 간접광을 셈해 천이 하늘빛과 반사광을 받지 못했다. 볼륨 조도로 셈한다
  #ifdef USE_SHEEN
    sheenSpecularIndirect += bcE * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
  #endif
  #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
    iblIrradiance = vec3(0.0);
    // 반사: 하늘이 보이는 만큼은 하늘을, 나머지는 그 자리 둘레의 밝기를 비춘다
    vec3 bcRW = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
    float eR = mix(max(uSkyU.w + dot(uSkyU.xyz, bcRW), 0.0) + uGndE * (0.5 - 0.5 * bcRW.y), max(bcSh.w + dot(bcSh.xyz, bcRW), bcSh.w * 0.3), inV);
    // 뷰모델에 반사 프로브가 붙어 있으면(uLocEnv) 환경맵이 이미 그 자리에서 본 방이다. 하늘 대신 조도로 바꾸지 않는다
    if (uBody * uLocEnv < 0.5) radiance = mix(eR * RECIPROCAL_PI * bcTint * envMapIntensity, radiance, bcSkv * bcSkv);
    radiance = mix(radiance, bcE0 * (0.06 * RECIPROCAL_PI) * envMapIntensity, bcBR);
    // 반사의 자기 가림: 가림 비율을 반사 방향의 가림으로 바꾼다(Lagarde 2014). 매끈할수록, 비스듬히 볼수록 덜 가린다
    float bcAOv = 1.0 - vBcSO, bcNV = saturate(dot(geometryNormal, geometryViewDir));
    radiance *= saturate(pow(bcNV + bcAOv, exp2(-16.0 * material.roughness - 1.0)) - 1.0 + bcAOv);
  #endif
}
#endif
#include <lights_fragment_end>
`;

// physical: 유전체의 정반사 세기(specularIntensity)를 낮출 수 있는 재질로 만든다. 렌즈 바로 앞의 천과 무광 폴리머가 머리 위 형광등을 비스듬히 받아 하얗게 번들거리던 것을 막는다
// 실내 벽 아래쪽 띠(회벽의 초록 칠)는 유성 페인트라 반들거린다. 복도와 방에서 형광등이 그 띠에 길게 비친다
const BC_GLOSS = `
if (uDamp > 0.9) {
  float bcHf = vBcW.y - mix(0.0, uFL, bcInside(vBcW));
  vec3 bcNg2 = normalize(cross(dFdx(vBcW), dFdy(vBcW)));
  float bcLow = 1.0 - smoothstep(1.16, 1.2, bcHf);
  roughnessFactor = mix(roughnessFactor, max(0.18, roughnessFactor * 0.42), bcLow * (1.0 - abs(bcNg2.y)));
}
`;

// weather: 1이면 바깥에 놓였을 때 바래는 나무(노출에 따라 은회색과 빗물 얼룩)
// finish: 닳는 모서리 { bare: 드러나는 금속 색(선형, 없으면 null = 폴리머), polish: 닳은 자리의 거칠기 }. 형상에 markEdges가 있어야 보인다
// gloss: 형상의 aGloss 속성이 표시한 자리를 매끈한 유전체로 그린다(장갑의 합성 가죽과 보호대)
// body: 입은 사람의 몸(가슴 카메라 뒤의 몸통과 머리)이 빛과 반사를 가린다. 뷰모델(총, 장갑, 소매)만 켠다
export function bcMaterial(params = {}, { grime = 1, ao = 1, damp = 0, physical = false, weather = 0, finish = null, gloss = false, body = false } = {}) {
  const m = physical ? new THREE.MeshPhysicalMaterial({ envMapIntensity: 0.5, ...params }) : new THREE.MeshStandardMaterial({ envMapIntensity: 0.5, ...params });
  const bare = finish && finish.bare ? new THREE.Vector4(finish.bare[0], finish.bare[1], finish.bare[2], 1) : new THREE.Vector4(0, 0, 0, 0);
  const local = { uGrime: { value: grime }, uAO: { value: ao }, uDamp: { value: damp }, uWeather: { value: weather },
    uFinish: { value: finish ? 1 : 0 }, uBare: { value: bare }, uPolish: { value: finish ? finish.polish : 0.5 }, uGlossOn: { value: gloss ? 1 : 0 }, uBody: { value: body ? 1 : 0 } };
  m.userData.bc = local;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, envUniforms, volUniforms, bodyUniforms, local);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <map_fragment>', FRAG_GRIME)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = clamp(roughnessFactor + (bcFbm(vBcW.xz * 1.3 + vBcW.y * 0.7) - 0.5) * 0.55 * uGrime - smoothstep(0.62, 0.7, bcFbm(vBcW.xz * 0.5 + 9.0)) * 0.35 * uGrime, 0.04, 1.0);\n roughnessFactor = mix(mix(roughnessFactor, uPolish, bcEdge), 0.92, bcDust * 0.5);\n' + BC_GLOSS)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = mix(metalnessFactor, 1.0, bcBare);')
      // 반들거리는 자리(젖은 바닥, 닳은 길)는 물과 광이 잔결을 메워 평평하다. 노멀 맵을 거칠기에 따라 줄인다.
      // 그대로 두면 먼 바닥의 젖은 자리에서 잔결마다 반사가 흰 점으로 반짝였다(A/B 라운드 15). 거리로 거칠기를 올리면 젖은 반사 자체가 사라져서 이 방법을 쓴다
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n#ifdef USE_NORMALMAP\n normal = normalize(mix(nonPerturbedNormal, normal, smoothstep(0.2, 0.7, roughnessFactor)));\n#endif')
      .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + TUBE_DIRECT)
      .replace('#include <lights_fragment_begin>', FRAG_PRE + LIGHTS_BEGIN)
      .replace('#include <lights_fragment_end>', FRAG_LIGHT);
  };
  m.customProgramCacheKey = () => 'bc3';
  return m;
}

// 사람이 바닥에 드리우는 그림자: 몸통을 캡슐 하나로 보고, 그 캡슐이 가린 빛의 비율만큼 바닥을 어둡게 한다.
// 하늘빛과 반사광은 캡슐이 가린 하늘의 넓이만큼(발밑이 가장 어둡다), 형광등은 등에서 바닥까지의 선이 캡슐에 막힌 만큼 줄인다.
// 밝기는 조도 볼륨에서 읽으므로 그늘 속에서는 그림자가 옅고 등 바로 아래에서는 또렷하다.
const SHADOW_VS = 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
const SHADOW_FS = `
varying vec3 vW;
uniform highp sampler3D uAmb; uniform highp sampler3D uVisA; uniform highp sampler3D uVisB;
uniform vec3 uVolMin; uniform vec3 uVolInv; uniform float uVolOff; uniform vec3 uVisMin; uniform vec3 uVisInv; uniform float uVisOff;
uniform float uVolOn; uniform float uLmOn; uniform vec4 uSkyU; uniform float uGndE;
uniform vec3 uCA; uniform vec3 uCB; uniform float uCR; uniform vec3 uLP[8]; uniform float uLI[8];
float irr(vec4 sh, vec3 n) { return max(sh.w + dot(sh.xyz, n), sh.w * 0.2); }
// 선분 p1-q1과 p2-q2 사이의 가장 짧은 거리, 그리고 두 번째 선분 위 가장 가까운 점의 위치(0~1)
float segDist(vec3 p1, vec3 q1, vec3 p2, vec3 q2, out float t) {
  vec3 d1 = q1 - p1, d2 = q2 - p2, r = p1 - p2;
  float a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2);
  float den = a * e - b * b;
  float s = den > 1e-6 ? clamp((b * f - c * e) / den, 0.0, 1.0) : 0.0;
  t = clamp((b * s + f) / max(e, 1e-6), 0.0, 1.0);
  s = clamp((b * t - c) / max(a, 1e-6), 0.0, 1.0);
  return length(p1 + d1 * s - (p2 + d2 * t));
}
void main(){
  vec3 P = vW; vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 vq = (P + n * uVolOff - uVolMin) * uVolInv;
  vec3 vd = min(vq, 1.0 - vq);
  float inV = uVolOn * step(0.0, min(vd.x, min(vd.y, vd.z)));
  float amb = mix(max(uSkyU.w + uSkyU.y, 0.0), irr(textureLod(uAmb, vq.xzy, 0.0), n), inV);
  // 캡슐이 가린 하늘(코사인 가중 입체각)
  float occ = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 d = mix(uCA, uCB, (float(i) + 0.5) / 6.0) - P; float dl = max(length(d), 0.08);
    occ += uCR * uCR / (dl * dl) * max(d.y / dl, 0.0);
  }
  occ = min(occ * 0.9, 0.7);
  float lit = amb * (1.0 - occ), tot = amb;
  if (uLmOn > 0.5) {
    vec3 lq = (P + n * uVisOff - uVisMin) * uVisInv; vec3 ld = min(lq, 1.0 - lq);
    if (min(ld.x, ld.z) > 0.0 && lq.y < 1.0) {
      vec4 va = textureLod(uVisA, lq.xzy, 0.0), vb = textureLod(uVisB, lq.xzy, 0.0);
      for (int i = 0; i < 8; i++) {
        vec3 l = uLP[i] - P; float dist = length(l);
        float c = clamp(1.0 - pow(dist / 9.5, 4.0), 0.0, 1.0);
        float e = uLI[i] * c * c / max(pow(dist, 1.6), 0.01) * max(l.y / dist, 0.0) * (i < 4 ? va[i] : vb[i - 4]);
        if (e < 1e-4) continue;
        float t; float d = segDist(P, uLP[i], uCA, uCB, t);
        // 관이 길어서 반그림자는 가리는 곳이 바닥에서 높을수록 넓다
        float hc = mix(uCA.y, uCB.y, t) - P.y;
        float pen = 0.05 + 0.55 * max(hc, 0.0) / max(uLP[i].y - P.y - hc, 0.4);
        float sh = 1.0 - smoothstep(uCR - pen * 0.4, uCR + pen, d);
        lit += e * (1.0 - sh); tot += e;
      }
    }
  }
  float a = 1.0 - lit / max(tot, 1e-4);
  vec2 mid = 0.5 * (uCA.xz + uCB.xz);
  a *= 1.0 - smoothstep(1.3, 1.7, length(P.xz - mid));
  gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(a, 0.0, 0.85));
}`;
export function shadowMaterial() {
  const local = { uCA: { value: new THREE.Vector3() }, uCB: { value: new THREE.Vector3(0, 1.7, 0) }, uCR: { value: 0.2 }, uLP: { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, -100, 0)) }, uLI: { value: new Array(8).fill(0) } };
  const m = new THREE.ShaderMaterial({ vertexShader: SHADOW_VS, fragmentShader: SHADOW_FS, uniforms: { ...volUniforms, ...local }, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  m.userData.local = local;
  return m;
}
