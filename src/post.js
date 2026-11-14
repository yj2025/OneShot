// 후처리: 실제 카메라 순서 — 렌즈(왜곡·색수차·번짐·테두리) → 센서(자동 노출·좁은 계조·노이즈·모션 블러) → 압축
import * as THREE from 'three';

// 장면은 화면보다 가로세로 OVERSCAN배 넓은 화각과 그만큼 큰 렌더 타깃에 그린다(화소 밀도는 그대로).
// 어안 왜곡은 화면 가장자리에서 화면 밖을 읽는다(좌우 끝 중간 높이에서 약 9%). 렌더 타깃이 화면과 같으면 맨 끝 화소 열이 가로로 늘어난 줄무늬가 된다.
// 바깥이 하늘과 안개일 때는 보이지 않았고, 화면 끝에 나무가 들어오면서 드러났다(A/B 라운드 29, 판정 3명 모두)
export const OVERSCAN = 1.1;

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function pass(fs, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
}

const LUM_FS = `
uniform sampler2D tScene; uniform sampler2D tPrev; uniform float uInit; uniform float uOver; varying vec2 vUv;
void main(){
  // 측광은 화면에 들어오는 범위만 본다(넓게 그린 가장자리는 빼고)
  vec2 sv = (vUv - 0.5) * uOver + 0.5;
  if (any(lessThan(sv, vec2(0.0))) || any(greaterThan(sv, vec2(1.0)))) { gl_FragColor = vec4(0.0); return; }
  // 중앙 가중 평균 로그 휘도 (r: w*log, g: w)
  vec3 c = texture2D(tScene, vUv).rgb;
  vec3 c2 = texture2D(tScene, vUv + vec2(0.006, 0.004)).rgb;
  // 0~1e4로 묶는다. 재질 셰이더에서 NaN이나 음수가 한 화소라도 나오면 평균 휘도와 번짐을 거쳐 화면 전체로 퍼진다
  float l = clamp(dot(mix(c, c2, 0.5), vec3(0.2126, 0.7152, 0.0722)), 0.0, 1e4);
  // 날아간 부분은 날아간 만큼만 센다. 센서는 포화된 화소가 얼마나 더 밝은지 모른다
  if (uInit < 0.5) l = min(l, texture2D(tPrev, vec2(0.5)).r * 6.0);
  vec2 d = (sv - 0.5) * vec2(1.6, 1.2);
  float w = mix(0.3, 1.0, exp(-dot(d, d) * 3.0)) * mix(1.0, 0.3, smoothstep(0.5, 0.7, sv.y));
  gl_FragColor = vec4(w * log(max(l, 1e-4)), w, 0.0, 1.0);
}`;
const ADAPT_FS = `
uniform sampler2D tLum; uniform sampler2D tPrev; uniform float uDt; uniform float uInit; varying vec2 vUv;
void main(){
  vec4 m = textureLod(tLum, vec2(0.5), 10.0);
  float avg = exp(m.r / max(m.g, 1e-4));
  float prev = texture2D(tPrev, vec2(0.5)).r;
  // 어두워질 때보다 밝아질 때 조금 빠르게, 그래도 느리게 따라온다
  float speed = avg > prev ? 2.2 : 0.9;
  float a = uInit > 0.5 ? 1.0 : 1.0 - exp(-uDt * speed);
  float v = clamp(exp(mix(log(max(prev, 1e-4)), log(max(avg, 1e-4)), a)), 1e-4, 1e4);
  gl_FragColor = vec4(v, avg, 0.0, 1.0);
}`;
const BRIGHT_FS = `
uniform sampler2D tScene; uniform sampler2D tAdapt; uniform float uKey; uniform float uKnee; uniform float uSlope; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  float ad = texture2D(tAdapt, vec2(0.5)).r;
  float ex = clamp(uKey / ad, 0.03, 7.0);
  vec3 c = vec3(0.0);
  c += texture2D(tScene, vUv + uTexel * vec2(-1.0, -1.0)).rgb; c += texture2D(tScene, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tScene, vUv + uTexel * vec2(-1.0, 1.0)).rgb; c += texture2D(tScene, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c = clamp(c * (0.25 * ex), 0.0, 1e4);   // NaN 화소 하나가 저해상도 번짐에서 네모난 검은 구역으로 퍼지지 않게 묶는다
  float l = dot(c, vec3(0.333));
  // 번짐의 세기는 1단계 ①에서 하늘 밝기 2.5배일 때 맞춘 값이다. 하늘을 6.0배로 밝힌 뒤(1단계 ④)에도 같은 번짐이 나오도록
  // 형광등 관(노출 뒤 약 4.7)보다 밝은 부분은 하늘을 밝힌 비율(2.5/6)만큼만 더 번지게 한다.
  // 그대로 두면 창(노출 뒤 약 20)이 창살과 나무줄기까지 흰 덩어리로 덮고(라운드 22), 위를 자르면 형광등과 창의 번짐이 기준선보다 작아진다(라운드 23)
  if (l > uKnee) c *= (uKnee + (l - uKnee) * uSlope) / l;
  gl_FragColor = vec4(c * smoothstep(0.75, 2.2, l), 1.0);
}`;
const BLUR_FS = `
uniform sampler2D tIn; uniform vec2 uDir; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tIn, vUv).rgb * 0.227;
  c += (texture2D(tIn, vUv + uDir * 1.385).rgb + texture2D(tIn, vUv - uDir * 1.385).rgb) * 0.316;
  c += (texture2D(tIn, vUv + uDir * 3.23).rgb + texture2D(tIn, vUv - uDir * 3.23).rgb) * 0.07;
  gl_FragColor = vec4(c, 1.0);
}`;

// 화면 공간 차폐: 조도 볼륨의 격자(0.2 m)보다 작은 것만 맡는다. 넓은 그늘은 볼륨이 계산한다.
// 두 단계로 본다. 반경 0.45 m는 물체 둘레의 부드러운 어둠, 반경 0.13 m는 물체와 바닥이 닿은 선과 좁은 틈이다.
const AO_FS = `
uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uInvProj; uniform vec2 uRes; uniform float uFrame; varying vec2 vUv;
vec3 vpos(vec2 uv){ float d = texture2D(tDepth, uv).r; vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 P = vpos(vUv);
  float dist = -P.z;
  if (dist > 70.0 || dist < 0.7) { gl_FragColor = vec4(1.0); return; }
  vec2 t = 1.0 / uRes;
  vec3 px1 = vpos(vUv + vec2(t.x, 0.0)), px2 = vpos(vUv - vec2(t.x, 0.0));
  vec3 py1 = vpos(vUv + vec2(0.0, t.y)), py2 = vpos(vUv - vec2(0.0, t.y));
  vec3 dx = abs(px1.z - P.z) < abs(px2.z - P.z) ? px1 - P : P - px2;
  vec3 dy = abs(py1.z - P.z) < abs(py2.z - P.z) ? py1 - P : P - py2;
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, -P) < 0.0) N = -N;
  vec3 T = normalize(abs(N.y) < 0.99 ? cross(N, vec3(0.0, 1.0, 0.0)) : cross(N, vec3(1.0, 0.0, 0.0)));
  vec3 Bt = cross(N, T);
  float rnd = hh(vUv * uRes + uFrame * 0.37) * 6.2831;
  float rad = 0.45 * clamp(dist / 7.0, 1.0, 3.0);
  float occ = 0.0;
  for (int i = 0; i < 10; i++) {
    float fi = float(i) + 0.5;
    float z = 1.0 - fi / 10.0, r = sqrt(1.0 - z * z), a = fi * 2.39996 + rnd;
    vec3 h = vec3(cos(a) * r, sin(a) * r, z * 0.9 + 0.1);
    float sc = mix(0.2, 1.0, (fi / 10.0) * (fi / 10.0));
    vec3 S = P + (T * h.x + Bt * h.y + N * h.z) * rad * sc;
    vec4 cs = uProj * vec4(S, 1.0);
    float sz = vpos(cs.xy / cs.w * 0.5 + 0.5).z;
    occ += (sz >= S.z + 0.025 ? 1.0 : 0.0) * smoothstep(0.0, 1.0, rad / max(abs(P.z - sz), 1e-3));
  }
  float aoWide = 1.0 - occ / 10.0;
  // 접촉부: 반경이 거리와 상관없이 13 cm라 멀어지면 한 화소보다 작아진다. 그때는 뺀다
  float radC = 0.13, occC = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i) + 0.5;
    float z = 1.0 - fi / 8.0, r = sqrt(1.0 - z * z), a = fi * 2.39996 + rnd * 1.7;
    vec3 h = vec3(cos(a) * r, sin(a) * r, z * 0.85 + 0.15);
    vec3 S = P + (T * h.x + Bt * h.y + N * h.z) * radC * mix(0.35, 1.0, fi / 8.0);
    vec4 cs = uProj * vec4(S, 1.0);
    float sz = vpos(cs.xy / cs.w * 0.5 + 0.5).z;
    occC += (sz >= S.z + 0.012 ? 1.0 : 0.0) * smoothstep(0.0, 1.0, radC * 2.0 / max(abs(P.z - sz), 1e-3));
  }
  float aoC = mix(1.0 - occC / 8.0, 1.0, smoothstep(9.0, 18.0, dist));
  gl_FragColor = vec4(vec3(pow(aoWide, 1.7) * pow(aoC, 1.5)), 1.0);
}`;
// 차폐 흐림: 깊이가 다른 화소는 섞지 않는다. 그래야 접촉부의 가는 선이 남고 물체 윤곽 밖으로 번지지 않는다
const AOBLUR_FS = `
uniform sampler2D tIn; uniform sampler2D tDepth; uniform mat4 uInvProj; uniform vec2 uDir; varying vec2 vUv;
float vz(vec2 uv){ float d = texture2D(tDepth, uv).r; vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return -p.z / p.w; }
void main(){
  float z0 = vz(vUv), acc = texture2D(tIn, vUv).r * 0.227, w = 0.227;
  for (int i = 0; i < 4; i++) {
    float o = (i < 2 ? 1.385 : 3.23) * (mod(float(i), 2.0) < 0.5 ? 1.0 : -1.0);
    vec2 uv = vUv + uDir * o;
    float k = (i < 2 ? 0.316 : 0.07) * exp(-abs(vz(uv) - z0) / (0.03 + z0 * 0.015));
    acc += texture2D(tIn, uv).r * k; w += k;
  }
  gl_FragColor = vec4(vec3(acc / w), 1.0);
}`;

// 렌즈 + 센서
const CAM_FS = `
uniform sampler2D tScene; uniform sampler2D tBloomA; uniform sampler2D tBloomB; uniform sampler2D tBloomC;
uniform sampler2D tAdapt; uniform sampler2D tPrev; uniform sampler2D tDepth; uniform sampler2D tAO; uniform float uAOAmt; uniform float uNear; uniform float uFar;
uniform float uOver; uniform float uAspect; uniform float uK; uniform float uCA; uniform vec2 uBlur; uniform float uBlurAmt; uniform float uZoomBlur;
uniform float uTime; uniform float uKey; uniform float uFlash; uniform vec2 uRimShift; uniform float uGhost; uniform float uNoise;
uniform float uSat; uniform float uHit; uniform float uFrame; uniform float uDead;
varying vec2 vUv;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 distort(vec2 uv, float k){
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float r2 = dot(p, p);
  float rmax2 = 0.25 * (uAspect * uAspect + 1.0);
  vec2 q = p * (1.0 + k * r2) / (1.0 + k * rmax2 * 0.62);
  return q / vec2(uAspect, 1.0) / uOver + 0.5;
}
float linDepth(vec2 uv){ float d = texture2D(tDepth, uv).r; return uNear * uFar / (uFar - d * (uFar - uNear)); }
vec3 defocus(vec2 uv, vec3 base){
  float z = linDepth(uv);
  // 렌즈 바로 앞(손과 총)은 초점이 나간다. 0.7 m 안에서 흐려지기 시작해 0.2 m에서 가장 흐리다
  float coc = smoothstep(0.7, 0.2, z) * 0.017;
  if (coc < 0.0006) return base;
  vec3 acc = base; float n = 1.0;
  for (int i = 0; i < 10; i++) {
    float a = float(i) * 2.39996, r = sqrt((float(i) + 0.5) / 10.0);
    vec2 o = vec2(cos(a), sin(a)) * r * coc * vec2(1.0 / uAspect, 1.0) / uOver;
    float zz = linDepth(uv + o);
    // 먼 배경이 가까운 물체 위로 번지지 않도록
    // 깊이가 비슷한 것끼리만 섞는다(가까운 밝은 벽이 손과 총 위로 번져 총이 하얗게 보였다)
    if (zz < 1.2 && abs(zz - z) < 0.12 + z * 0.4) { acc += texture2D(tScene, uv + o).rgb; n += 1.0; }
  }
  return acc / n;
}
vec3 sampleBlur(vec2 uv){
  // 카메라 회전 방향 + 전진 방향(가장자리 방사형)으로 셔터 시간 동안 번짐
  vec2 rad = (uv - 0.5) * uZoomBlur;
  vec2 dir = uBlur * uBlurAmt / uOver + rad;
  float len = length(dir * vec2(uAspect, 1.0));
  if (len < 0.0008) return texture2D(tScene, uv).rgb;
  vec3 acc = vec3(0.0); float wsum = 0.0;
  for (int i = 0; i < 9; i++) {
    float t = float(i) / 8.0 - 0.5;
    float w = 1.0 - abs(t) * 0.8;
    acc += texture2D(tScene, uv + dir * t).rgb * w; wsum += w;
  }
  return acc / wsum;
}
void main(){
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p);
  // --- 렌즈: 어안 왜곡과 색수차 (가장자리에서 커짐)
  vec2 uvG = distort(vUv, uK);
  vec2 uvR = distort(vUv, uK * (1.0 + uCA));
  vec2 uvB = distort(vUv, uK * (1.0 - uCA));
  vec3 col = defocus(uvG, sampleBlur(uvG));
  float rr = texture2D(tScene, uvR).r, bb = texture2D(tScene, uvB).b, gg = texture2D(tScene, uvG).g;
  col.r += (rr - gg) * 0.9; col.b += (bb - gg) * 0.9;
  col = max(col, 0.0);
  col *= mix(1.0, texture2D(tAO, uvG).r, uAOAmt);
  // 하이라이트 번짐(렌즈 산란)
  vec3 bloom = texture2D(tBloomA, uvG).rgb * 0.45 + texture2D(tBloomB, uvG).rgb * 0.55 + texture2D(tBloomC, uvG).rgb * 0.75;
  // --- 센서: 자동 노출
  float ad = texture2D(tAdapt, vec2(0.5)).r;
  float ex = clamp(uKey / ad, 0.03, 7.0);
  col = col * ex + bloom * 0.32 + uFlash * vec3(1.0, 0.85, 0.6) * 0.02;
  // 렌즈 주변부 광량 저하
  col *= mix(1.0, 0.55, smoothstep(0.35, 1.0, r));
  // 좁은 계조: 빠르게 하얗게 날아가는 어깨, 뭉개지는 그늘
  // 렌즈 안에서 흩어진 빛이 가장 어두운 곳을 조금 띄운다
  vec3 x = col + 0.002;
  // 센서 포화: 평균보다 3~4스톱 밝으면 하얗게 날아간다
  x = 1.0 - exp(-x * 0.85);
  // 화면 인코딩. 지수 0.7은 표준 감마(1/2.2)에 카메라의 대비 보정을 곱한 값이다.
  // 이전 곡선은 감마 없이 S자 곡선만 써서 어두운 쪽이 입력의 제곱으로 뭉개졌다(평균보다 1스톱 어두우면 8/255).
  // 지금은 평균이 76/255, 2스톱 아래가 27/255, 4스톱 아래가 6/255쯤에 놓인다. 레퍼런스 프레임의 밝기 분포에 맞춘 값이다(scripts/tones.mjs)
  x = pow(x, vec3(0.7));
  // 검정 기준점: 가장 깊은 그늘은 뭉개진다(레퍼런스의 하위 2% 밝기가 11/255쯤이다)
  x = max((x - 0.03) / 0.97, 0.0);
  // 채도 낮춤 + 약한 녹/청 캐스트
  float l = dot(x, vec3(0.2126, 0.7152, 0.0722));
  x = mix(vec3(l), x, uSat);
  x *= vec3(0.97, 1.0, 1.01);
  // 노이즈: 노출을 끌어올릴수록(어두울수록) 커지고, 어두운 부분에 더 보인다
  float gain = clamp((ex - 0.8) / 5.0, 0.0, 1.0);
  vec2 px = floor(vUv * vec2(1920.0, 1080.0) * 0.5);
  float n1 = h12(px + uFrame * 17.31) - 0.5, n2 = h12(px.yx + uFrame * 9.17) - 0.5;
  float namp = (0.018 + gain * 0.09) * uNoise * (1.0 - l * 0.6);
  x += vec3(n1 + n2 * 0.3, n1, n1 - n2 * 0.4) * namp;
  // 센서 잔상 (롤링 셔터/노출 겹침)
  vec3 prev = texture2D(tPrev, vUv).rgb;
  x = mix(x, prev, uGhost);
  // 피격 순간의 노출 흔들림과 사망 후 어두워짐
  x *= 1.0 - uHit * 0.25;
  x *= 1.0 - uDead * 0.85;
  // 둥근 렌즈 테두리 (흔들림을 조금 따라 움직이고, 주변이 밝으면 테두리 안쪽이 번진다)
  vec2 pr = p - uRimShift;
  float rim = length(pr * vec2(0.93, 1.0));
  float edge = 0.915 + 0.012 * sin(atan(pr.y, pr.x) * 3.0);
  float m = smoothstep(edge, edge - 0.08, rim);
  vec3 rimGlow = bloom * 0.25 * smoothstep(edge - 0.2, edge, rim);
  x = x * m + rimGlow * m;
  gl_FragColor = vec4(clamp(x, 0.0, 1.0), 1.0);
}`;

// 압축 열화: 8×8 블록 크로마, 움직일수록 커지는 블록 양자화, 과한 샤프닝
const CODEC_FS = `
uniform sampler2D tIn; uniform vec2 uRes; uniform float uQ; uniform float uSharp; varying vec2 vUv;
vec3 rgb2ycc(vec3 c){ return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(-0.1687, -0.3313, 0.5)), dot(c, vec3(0.5, -0.4187, -0.0813))); }
vec3 ycc2rgb(vec3 y){ return vec3(y.x + 1.402 * y.z, y.x - 0.34414 * y.y - 0.71414 * y.z, y.x + 1.772 * y.y); }
void main(){
  vec2 px = vUv * uRes;
  vec2 blk = floor(px / 8.0) * 8.0;
  vec2 bc = (blk + 4.0) / uRes;
  vec2 o = 2.5 / uRes;
  // 블록 평균 (4탭)
  vec3 avg = (texture2D(tIn, bc + vec2(-o.x, -o.y)).rgb + texture2D(tIn, bc + vec2(o.x, -o.y)).rgb + texture2D(tIn, bc + vec2(-o.x, o.y)).rgb + texture2D(tIn, bc + vec2(o.x, o.y)).rgb) * 0.25;
  vec3 c = texture2D(tIn, vUv).rgb;
  vec2 t = 1.0 / uRes;
  vec3 nb = (texture2D(tIn, vUv + vec2(t.x, 0.0)).rgb + texture2D(tIn, vUv - vec2(t.x, 0.0)).rgb + texture2D(tIn, vUv + vec2(0.0, t.y)).rgb + texture2D(tIn, vUv - vec2(0.0, t.y)).rgb) * 0.25;
  // 카메라 내장 샤프닝 (테두리 헤일로)
  c = c + (c - nb) * uSharp;
  vec3 y = rgb2ycc(c), ya = rgb2ycc(avg);
  // 크로마는 블록 단위 (4:2:0 + 블록 경계)
  y.yz = mix(y.yz, ya.yz, 0.75);
  // 디테일 양자화: 블록 평균에서의 차이를 거칠게
  float step = 0.012 + uQ * 0.06;
  float dl = y.x - ya.x;
  dl = floor(dl / step + 0.5) * step;
  y.x = mix(y.x, ya.x + dl, clamp(uQ * 1.5 + 0.25, 0.0, 1.0));
  gl_FragColor = vec4(clamp(ycc2rgb(y), 0.0, 1.0), 1.0);
}`;

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    const HF = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 0 });
    this.rtScene.depthTexture = new THREE.DepthTexture(4, 4); this.rtScene.depthTexture.type = THREE.UnsignedIntType;
    this.rtLum = new THREE.WebGLRenderTarget(64, 64, { ...HF, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.rtAdapt = [new THREE.WebGLRenderTarget(1, 1, HF), new THREE.WebGLRenderTarget(1, 1, HF)];
    this.rtB = [0, 1, 2].map(() => [new THREE.WebGLRenderTarget(4, 4, HF), new THREE.WebGLRenderTarget(4, 4, HF)]);
    this.rtCam = [new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false }), new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false })];
    this.mLum = pass(LUM_FS, { tScene: { value: null }, tPrev: { value: null }, uInit: { value: 1 }, uOver: { value: OVERSCAN } });
    this.mAdapt = pass(ADAPT_FS, { tLum: { value: null }, tPrev: { value: null }, uDt: { value: 0.016 }, uInit: { value: 1 } });
    this.mBright = pass(BRIGHT_FS, { tScene: { value: null }, tAdapt: { value: null }, uKey: { value: 0.2 }, uKnee: { value: 5.0 }, uSlope: { value: 2.5 / 6.0 }, uTexel: { value: new THREE.Vector2() } });
    this.mBlur = pass(BLUR_FS, { tIn: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mCam = pass(CAM_FS, {
      tScene: { value: null }, tBloomA: { value: null }, tBloomB: { value: null }, tBloomC: { value: null }, tAdapt: { value: null }, tPrev: { value: null },
      uOver: { value: OVERSCAN }, uAspect: { value: 1.78 }, uK: { value: 0.32 }, uCA: { value: 0.035 }, uBlur: { value: new THREE.Vector2() }, uBlurAmt: { value: 1 }, uZoomBlur: { value: 0 },
      uTime: { value: 0 }, uKey: { value: 0.2 }, uFlash: { value: 0 }, uRimShift: { value: new THREE.Vector2() }, uGhost: { value: 0.12 }, uNoise: { value: 1 },
      uSat: { value: 0.62 }, uHit: { value: 0 }, uFrame: { value: 0 }, uDead: { value: 0 }, tDepth: { value: null }, uNear: { value: 0.04 }, uFar: { value: 420 }, tAO: { value: null }, uAOAmt: { value: 0.9 },
    });
    this.mAO = pass(AO_FS, { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() }, uFrame: { value: 0 } });
    this.rtAO = [new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false }), new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false })];
    this.mAOBlur = pass(AOBLUR_FS, { tIn: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uDir: { value: new THREE.Vector2() } });
    this.aoEnabled = true;
    this.mCodec = pass(CODEC_FS, { tIn: { value: null }, uRes: { value: new THREE.Vector2() }, uQ: { value: 0.2 }, uSharp: { value: 0.45 } });
    this.ping = 0; this.frame = 0; this.init = true;
    this.scale = 1;
    this.params = { key: 0.2, blur: 1, flash: 0, rim: new THREE.Vector2(), hit: 0, dead: 0, zoomBlur: 0, blurVec: new THREE.Vector2(), q: 0.2 };
  }

  setSize(w, h, scale) {
    this.w = w; this.h = h; this.scale = scale;
    const sw = Math.max(4, Math.floor(w * scale * OVERSCAN)), sh = Math.max(4, Math.floor(h * scale * OVERSCAN));
    this.rtScene.setSize(sw, sh);
    let bw = Math.floor(sw / 4), bh = Math.floor(sh / 4);
    for (const pair of this.rtB) { pair[0].setSize(bw, bh); pair[1].setSize(bw, bh); bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1); }
    this.rtCam.forEach(rt => rt.setSize(w, h));
    this.rtAO.forEach(rt => rt.setSize(Math.max(2, sw >> 1), Math.max(2, sh >> 1)));
    this.mCam.uniforms.uAspect.value = w / h;
    this.mCodec.uniforms.uRes.value.set(w, h);
  }

  run(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }

  render(scene, camera, dt) {
    const R = this.r, P = this.params;
    R.setRenderTarget(this.rtScene); R.render(scene, camera);
    // 노출 측정
    const a0 = this.rtAdapt[this.ping], a1 = this.rtAdapt[1 - this.ping];
    this.mLum.uniforms.tScene.value = this.rtScene.texture; this.mLum.uniforms.tPrev.value = a0.texture; this.mLum.uniforms.uInit.value = this.init ? 1 : 0; this.run(this.mLum, this.rtLum);
    this.mAdapt.uniforms.tLum.value = this.rtLum.texture; this.mAdapt.uniforms.tPrev.value = a0.texture; this.mAdapt.uniforms.uDt.value = dt; this.mAdapt.uniforms.uInit.value = this.init ? 1 : 0;
    this.run(this.mAdapt, a1); this.init = false;
    const adapt = a1.texture;
    // 번짐
    this.mBright.uniforms.tScene.value = this.rtScene.texture; this.mBright.uniforms.tAdapt.value = adapt; this.mBright.uniforms.uKey.value = P.key;
    this.mBright.uniforms.uTexel.value.set(1 / this.rtScene.width, 1 / this.rtScene.height);
    this.run(this.mBright, this.rtB[0][0]);
    for (let i = 0; i < 3; i++) {
      const [A, B] = this.rtB[i];
      if (i > 0) { this.mBlur.uniforms.tIn.value = this.rtB[i - 1][0].texture; this.mBlur.uniforms.uDir.value.set(0, 0); this.run(this.mBlur, A); }
      this.mBlur.uniforms.tIn.value = A.texture; this.mBlur.uniforms.uDir.value.set(1 / A.width, 0); this.run(this.mBlur, B);
      this.mBlur.uniforms.tIn.value = B.texture; this.mBlur.uniforms.uDir.value.set(0, 1 / A.height); this.run(this.mBlur, A);
    }
    // 차폐
    if (this.aoEnabled) {
      const A = this.mAO.uniforms; A.tDepth.value = this.rtScene.depthTexture; A.uProj.value.copy(camera.projectionMatrix); A.uInvProj.value.copy(camera.projectionMatrixInverse);
      A.uRes.value.set(this.rtAO[0].width, this.rtAO[0].height); A.uFrame.value = this.frame % 64;
      this.run(this.mAO, this.rtAO[0]);
      const B = this.mAOBlur.uniforms; B.tDepth.value = this.rtScene.depthTexture; B.uInvProj.value.copy(camera.projectionMatrixInverse);
      B.tIn.value = this.rtAO[0].texture; B.uDir.value.set(1 / this.rtAO[0].width, 0); this.run(this.mAOBlur, this.rtAO[1]);
      B.tIn.value = this.rtAO[1].texture; B.uDir.value.set(0, 1 / this.rtAO[0].height); this.run(this.mAOBlur, this.rtAO[0]);
    }
    // 렌즈 + 센서
    const U = this.mCam.uniforms;
    U.tAO.value = this.rtAO[0].texture; U.uAOAmt.value = this.aoEnabled ? 1.0 : 0.0;
    const cur = this.rtCam[this.ping], prev = this.rtCam[1 - this.ping];
    U.tScene.value = this.rtScene.texture; U.tBloomA.value = this.rtB[0][0].texture; U.tBloomB.value = this.rtB[1][0].texture; U.tBloomC.value = this.rtB[2][0].texture;
    U.tAdapt.value = adapt; U.tPrev.value = prev.texture; U.tDepth.value = this.rtScene.depthTexture; U.uNear.value = camera.near; U.uFar.value = camera.far;
    U.uBlur.value.copy(P.blurVec); U.uBlurAmt.value = P.blur; U.uZoomBlur.value = P.zoomBlur * P.blur;
    U.uKey.value = P.key; U.uFlash.value = P.flash; U.uRimShift.value.copy(P.rim); U.uHit.value = P.hit; U.uDead.value = P.dead;
    U.uFrame.value = (this.frame++ % 997); U.uTime.value += dt;
    U.uGhost.value = Math.min(0.3, 0.06 + P.blurVec.length() * 3.5 * P.blur);
    this.run(this.mCam, cur);
    // 압축
    this.mCodec.uniforms.tIn.value = cur.texture; this.mCodec.uniforms.uQ.value = P.q;
    this.run(this.mCodec, null);
    this.ping = 1 - this.ping;
  }

  resetExposure() { this.init = true; }
}
