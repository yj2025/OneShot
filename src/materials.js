// 공용 재질: 하늘 가시도(실내 간접광 감쇠), 월드 좌표 얼룩, 바닥 접합부 때를 셰이더에 주입한다
import * as THREE from 'three';

export const envUniforms = {
  uBldg: { value: new THREE.Vector4(-12, -16, 12, 0) },
  uRoofY: { value: 5.7 },
  uFL: { value: 0.7 },
  uOpen: { value: Array.from({ length: 24 }, () => new THREE.Vector4(0, -100, 0, 0)) },
  uOpenN: { value: 0 },
};

const VERT_HEAD = `
varying vec3 vBcW;
`;
const VERT_BODY = `
  {
    vec4 bcw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      bcw = instanceMatrix * bcw;
    #endif
    vBcW = (modelMatrix * bcw).xyz;
  }
`;

const FRAG_HEAD = `
varying vec3 vBcW;
uniform vec4 uBldg;
uniform float uRoofY;
uniform float uFL;
uniform vec4 uOpen[24];
uniform int uOpenN;
uniform float uGrime;
uniform float uAO;
uniform float uDamp;
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
float bcSkyVis(vec3 p, vec3 n, out float ins) {
  ins = bcInside(p);
  float v = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i >= uOpenN) break;
    vec4 o = uOpen[i];
    vec3 d = o.xyz - p; float dist = length(d);
    float f = o.w * o.w / (o.w * o.w + dist * dist * 1.6);
    float facing = clamp(dot(n, d / max(dist, 1e-3)) * 0.7 + 0.45, 0.12, 1.0);
    v += f * facing;
  }
  float hF = p.y - mix(0.0, uFL, ins);
  // 바닥과 벽이 만나는 곳, 바깥 벽 밑동은 어둡게
  float edgeAO = mix(0.55, 1.0, smoothstep(0.0, 0.7, hF + abs(n.y) * 0.6));
  float dEdge = max(max(uBldg.x - p.x, p.x - uBldg.z), max(uBldg.y - p.z, p.z - uBldg.w));
  float outAO = mix(0.62, 1.0, smoothstep(0.0, 2.2, dEdge + max(p.y, 0.0) * 0.6));
  float inside = 0.035 + min(v, 1.3) * 0.8;
  return mix(1.0, mix(outAO, inside, ins), uAO) * mix(1.0, edgeAO, uAO);
}
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
  float dirt = mix(1.0, (0.74 + 0.36 * g) * (0.9 + 0.2 * g2), uGrime);
  float base = mix(1.0, mix(0.58, 1.0, smoothstep(0.0, 0.45 + g * 0.35, hF)), uGrime * wall);
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
}
`;

const FRAG_LIGHT = `
#if defined( RE_IndirectDiffuse )
{
  float bcIns;
  vec3 bcWN = normalize(inverseTransformDirection(normal, viewMatrix));
  float sv = bcSkyVis(vBcW, bcWN, bcIns);
  irradiance *= sv;
  #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
    iblIrradiance *= sv;
    radiance *= sv * sv;
  #endif
}
#endif
#include <lights_fragment_end>
`;

export function bcMaterial(params = {}, { grime = 1, ao = 1, damp = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ envMapIntensity: 0.5, ...params });
  const local = { uGrime: { value: grime }, uAO: { value: ao }, uDamp: { value: damp } };
  m.userData.bc = local;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, envUniforms, local);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <map_fragment>', FRAG_GRIME)
      .replace('#include <lights_fragment_end>', FRAG_LIGHT);
  };
  m.customProgramCacheKey = () => 'bc1';
  return m;
}

export function setOpenings(list) {
  const arr = envUniforms.uOpen.value;
  const n = Math.min(list.length, arr.length);
  for (let i = 0; i < n; i++) arr[i].set(list[i][0], list[i][1], list[i][2], list[i][3]);
  envUniforms.uOpenN.value = n;
}
