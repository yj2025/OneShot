// 후처리: 실제 카메라 순서 — 렌즈(왜곡·색수차·번짐·테두리) → 센서(자동 노출·좁은 계조·노이즈·모션 블러) → 압축
import * as THREE from 'three';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function pass(fs, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
}

const LUM_FS = `
uniform sampler2D tScene; varying vec2 vUv;
void main(){
  // 중앙 가중 평균 로그 휘도 (r: w*log, g: w)
  vec3 c = texture2D(tScene, vUv).rgb;
  vec3 c2 = texture2D(tScene, vUv + vec2(0.006, 0.004)).rgb;
  float l = dot(mix(c, c2, 0.5), vec3(0.2126, 0.7152, 0.0722));
  vec2 d = (vUv - 0.5) * vec2(1.6, 1.2);
  float w = mix(0.3, 1.0, exp(-dot(d, d) * 3.0)) * (vUv.y > 0.6 ? 0.4 : 1.0);
  gl_FragColor = vec4(w * log(max(l, 1e-4)), w, 0.0, 1.0);
}`;
const ADAPT_FS = `
uniform sampler2D tLum; uniform sampler2D tPrev; uniform float uDt; uniform float uInit; varying vec2 vUv;
void main(){
  vec4 m = textureLod(tLum, vec2(0.5), 10.0);
  float avg = exp(m.r / max(m.g, 1e-4));
  float prev = texture2D(tPrev, vec2(0.5)).r;
  // 어두워질 때보다 밝아질 때 조금 빠르게, 그래도 느리게 따라온다
  float speed = avg > prev ? 1.15 : 0.6;
  float a = uInit > 0.5 ? 1.0 : 1.0 - exp(-uDt * speed);
  float v = exp(mix(log(max(prev, 1e-4)), log(avg), a));
  gl_FragColor = vec4(v, avg, 0.0, 1.0);
}`;
const BRIGHT_FS = `
uniform sampler2D tScene; uniform sampler2D tAdapt; uniform float uKey; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  float ad = texture2D(tAdapt, vec2(0.5)).r;
  float ex = clamp(uKey / ad, 0.35, 7.0);
  vec3 c = vec3(0.0);
  c += texture2D(tScene, vUv + uTexel * vec2(-1.0, -1.0)).rgb; c += texture2D(tScene, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tScene, vUv + uTexel * vec2(-1.0, 1.0)).rgb; c += texture2D(tScene, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25 * ex;
  float l = dot(c, vec3(0.333));
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

// 렌즈 + 센서
const CAM_FS = `
uniform sampler2D tScene; uniform sampler2D tBloomA; uniform sampler2D tBloomB; uniform sampler2D tBloomC;
uniform sampler2D tAdapt; uniform sampler2D tPrev;
uniform float uAspect; uniform float uK; uniform float uCA; uniform vec2 uBlur; uniform float uBlurAmt; uniform float uZoomBlur;
uniform float uTime; uniform float uKey; uniform float uFlash; uniform vec2 uRimShift; uniform float uGhost; uniform float uNoise;
uniform float uSat; uniform float uHit; uniform float uFrame; uniform float uDead;
varying vec2 vUv;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 distort(vec2 uv, float k){
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float r2 = dot(p, p);
  float rmax2 = 0.25 * (uAspect * uAspect + 1.0);
  vec2 q = p * (1.0 + k * r2) / (1.0 + k * rmax2 * 0.62);
  return q / vec2(uAspect, 1.0) + 0.5;
}
vec3 sampleBlur(vec2 uv){
  // 카메라 회전 방향 + 전진 방향(가장자리 방사형)으로 셔터 시간 동안 번짐
  vec2 rad = (uv - 0.5) * uZoomBlur;
  vec2 dir = uBlur * uBlurAmt + rad;
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
  vec3 col = sampleBlur(uvG);
  float rr = texture2D(tScene, uvR).r, bb = texture2D(tScene, uvB).b, gg = texture2D(tScene, uvG).g;
  col.r += (rr - gg) * 0.9; col.b += (bb - gg) * 0.9;
  col = max(col, 0.0);
  // 하이라이트 번짐(렌즈 산란)
  vec3 bloom = texture2D(tBloomA, uvG).rgb * 0.45 + texture2D(tBloomB, uvG).rgb * 0.55 + texture2D(tBloomC, uvG).rgb * 0.75;
  // --- 센서: 자동 노출
  float ad = texture2D(tAdapt, vec2(0.5)).r;
  float ex = clamp(uKey / ad, 0.35, 7.0);
  col = col * ex + bloom * 0.55 + uFlash * vec3(1.0, 0.85, 0.6) * 0.06;
  // 렌즈 주변부 광량 저하
  col *= mix(1.0, 0.55, smoothstep(0.35, 1.0, r));
  // 좁은 계조: 빠르게 하얗게 날아가는 어깨, 뭉개지는 그늘
  vec3 x = col;
  x = 1.0 - exp(-x * 1.25);
  x = smoothstep(0.035, 0.97, x);
  x = pow(x, vec3(1.08));
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
  float edge = 0.935 + 0.012 * sin(atan(pr.y, pr.x) * 3.0);
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
    this.rtLum = new THREE.WebGLRenderTarget(64, 64, { ...HF, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.rtAdapt = [new THREE.WebGLRenderTarget(1, 1, HF), new THREE.WebGLRenderTarget(1, 1, HF)];
    this.rtB = [0, 1, 2].map(() => [new THREE.WebGLRenderTarget(4, 4, HF), new THREE.WebGLRenderTarget(4, 4, HF)]);
    this.rtCam = [new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false }), new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false })];
    this.mLum = pass(LUM_FS, { tScene: { value: null } });
    this.mAdapt = pass(ADAPT_FS, { tLum: { value: null }, tPrev: { value: null }, uDt: { value: 0.016 }, uInit: { value: 1 } });
    this.mBright = pass(BRIGHT_FS, { tScene: { value: null }, tAdapt: { value: null }, uKey: { value: 0.2 }, uTexel: { value: new THREE.Vector2() } });
    this.mBlur = pass(BLUR_FS, { tIn: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mCam = pass(CAM_FS, {
      tScene: { value: null }, tBloomA: { value: null }, tBloomB: { value: null }, tBloomC: { value: null }, tAdapt: { value: null }, tPrev: { value: null },
      uAspect: { value: 1.78 }, uK: { value: 0.32 }, uCA: { value: 0.035 }, uBlur: { value: new THREE.Vector2() }, uBlurAmt: { value: 1 }, uZoomBlur: { value: 0 },
      uTime: { value: 0 }, uKey: { value: 0.2 }, uFlash: { value: 0 }, uRimShift: { value: new THREE.Vector2() }, uGhost: { value: 0.12 }, uNoise: { value: 1 },
      uSat: { value: 0.62 }, uHit: { value: 0 }, uFrame: { value: 0 }, uDead: { value: 0 },
    });
    this.mCodec = pass(CODEC_FS, { tIn: { value: null }, uRes: { value: new THREE.Vector2() }, uQ: { value: 0.2 }, uSharp: { value: 0.45 } });
    this.ping = 0; this.frame = 0; this.init = true;
    this.scale = 1;
    this.params = { key: 0.2, blur: 1, flash: 0, rim: new THREE.Vector2(), hit: 0, dead: 0, zoomBlur: 0, blurVec: new THREE.Vector2(), q: 0.2 };
  }

  setSize(w, h, scale) {
    this.w = w; this.h = h; this.scale = scale;
    const sw = Math.max(4, Math.floor(w * scale)), sh = Math.max(4, Math.floor(h * scale));
    this.rtScene.setSize(sw, sh);
    let bw = Math.floor(sw / 4), bh = Math.floor(sh / 4);
    for (const pair of this.rtB) { pair[0].setSize(bw, bh); pair[1].setSize(bw, bh); bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1); }
    this.rtCam.forEach(rt => rt.setSize(w, h));
    this.mCam.uniforms.uAspect.value = w / h;
    this.mCodec.uniforms.uRes.value.set(w, h);
  }

  run(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }

  render(scene, camera, dt) {
    const R = this.r, P = this.params;
    R.setRenderTarget(this.rtScene); R.render(scene, camera);
    // 노출 측정
    this.mLum.uniforms.tScene.value = this.rtScene.texture; this.run(this.mLum, this.rtLum);
    const a0 = this.rtAdapt[this.ping], a1 = this.rtAdapt[1 - this.ping];
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
    // 렌즈 + 센서
    const U = this.mCam.uniforms;
    const cur = this.rtCam[this.ping], prev = this.rtCam[1 - this.ping];
    U.tScene.value = this.rtScene.texture; U.tBloomA.value = this.rtB[0][0].texture; U.tBloomB.value = this.rtB[1][0].texture; U.tBloomC.value = this.rtB[2][0].texture;
    U.tAdapt.value = adapt; U.tPrev.value = prev.texture;
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
