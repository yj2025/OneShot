// 공용 재질: 조도 볼륨(하늘빛·반사광·형광등 가시도), 월드 좌표 얼룩, 바닥 접합부 때를 셰이더에 주입한다
import * as THREE from 'three';
import { volUniforms } from './lightbake.js';

export const envUniforms = {
  uBldg: { value: new THREE.Vector4(-12, -16, 12, 0) },
  uRoofY: { value: 5.7 },
  uFL: { value: 0.7 },
};

const VERT_HEAD = `
varying vec3 vBcW;
attribute float aWear;
varying float vBcWear;
`;
const VERT_BODY = `
  {
    vec4 bcw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      bcw = instanceMatrix * bcw;
    #endif
    vBcW = (modelMatrix * bcw).xyz;
    vBcWear = aWear;
  }
`;

const FRAG_HEAD = `
varying vec3 vBcW;
varying float vBcWear;
uniform vec4 uBldg;
uniform float uRoofY;
uniform float uFL;
uniform float uGrime;
uniform float uAO;
uniform float uDamp;
uniform highp sampler3D uAmb; uniform highp sampler3D uSkyV; uniform highp sampler3D uVisA; uniform highp sampler3D uVisB;
uniform vec3 uVolMin; uniform vec3 uVolInv; uniform float uVolOff; uniform vec3 uVisMin; uniform vec3 uVisInv; uniform float uVisOff;
uniform float uVolOn; uniform float uLmOn; uniform float uClay; uniform vec4 uLmA[10]; uniform vec4 uLmB[10]; uniform float uLm1[10];
uniform vec4 uSkyU; uniform float uGndE; uniform vec3 uSkyTint; uniform vec3 uBncTint;
vec3 bcWN; vec4 bcVa; vec4 bcVb;
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
  float dirt = mix(1.0, (0.6 + 0.64 * g) * (0.84 + 0.32 * g2), uGrime);
  float base = mix(1.0, mix(0.45, 1.0, smoothstep(0.0, 0.45 + g * 0.35, hF)), uGrime * wall);
  diffuseColor.rgb *= dirt * base;
  if (uGrime > 0.5 && bcNg.y > 0.7 && ins < 0.5) {
    vec2 q = vBcW.xz;
    float soil = smoothstep(0.52, 0.72, bcFbm(q * 0.11 + 3.1)) * (0.6 + 0.4 * bcNoise(q * 1.7));
    float wet = smoothstep(0.58, 0.66, bcFbm(q * 0.23 + 11.0));
    float moss = smoothstep(0.62, 0.78, bcFbm(q * 0.4 + 7.0)) * 0.5;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.165, 0.12) * (0.8 + 0.4 * bcNoise(q * 6.0)), soil * 0.55);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.9, 0.62), moss);
    diffuseColor.rgb *= 1.0 - wet * 0.35;
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
  if (uClay > 0.5) diffuseColor.rgb = vec3(0.45);
}
`;

// 점광원 루프 앞: 면의 월드 방향과 형광등 가시도를 한 번 읽어 둔다
const FRAG_PRE = `
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
const LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getPointLightInfo( pointLight, geometryPosition, directLight );',
  'getPointLightInfo( pointLight, geometryPosition, directLight ); directLight.color *= bcPV( uLmA[ i ], uLmB[ i ], uLm1[ i ] );');
if (LIGHTS_BEGIN === THREE.ShaderChunk.lights_fragment_begin) console.warn('점광원 루프를 찾지 못해 형광등 그림자를 넣지 못했다');

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
  irradiance += mix(eOpen, bcIrr(bcSh, bcWN), inV) * bcTint;
  #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
    iblIrradiance = vec3(0.0);
    // 반사: 하늘이 보이는 만큼은 하늘을, 나머지는 그 자리 둘레의 밝기를 비춘다
    vec3 bcRW = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
    float eR = mix(max(uSkyU.w + dot(uSkyU.xyz, bcRW), 0.0) + uGndE * (0.5 - 0.5 * bcRW.y), max(bcSh.w + dot(bcSh.xyz, bcRW), bcSh.w * 0.3), inV);
    radiance = mix(eR * RECIPROCAL_PI * bcTint * envMapIntensity, radiance, bcSkv * bcSkv);
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

export function bcMaterial(params = {}, { grime = 1, ao = 1, damp = 0, physical = false } = {}) {
  const m = physical ? new THREE.MeshPhysicalMaterial({ envMapIntensity: 0.5, ...params }) : new THREE.MeshStandardMaterial({ envMapIntensity: 0.5, ...params });
  const local = { uGrime: { value: grime }, uAO: { value: ao }, uDamp: { value: damp } };
  m.userData.bc = local;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, envUniforms, volUniforms, local);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <map_fragment>', FRAG_GRIME)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = clamp(roughnessFactor + (bcFbm(vBcW.xz * 1.3 + vBcW.y * 0.7) - 0.5) * 0.55 * uGrime - smoothstep(0.62, 0.7, bcFbm(vBcW.xz * 0.5 + 9.0)) * 0.35 * uGrime, 0.04, 1.0);\n' + BC_GLOSS)
      // 반들거리는 자리(젖은 바닥, 닳은 길)는 물과 광이 잔결을 메워 평평하다. 노멀 맵을 거칠기에 따라 줄인다.
      // 그대로 두면 먼 바닥의 젖은 자리에서 잔결마다 반사가 흰 점으로 반짝였다(A/B 라운드 15). 거리로 거칠기를 올리면 젖은 반사 자체가 사라져서 이 방법을 쓴다
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n#ifdef USE_NORMALMAP\n normal = normalize(mix(nonPerturbedNormal, normal, smoothstep(0.2, 0.7, roughnessFactor)));\n#endif')
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
