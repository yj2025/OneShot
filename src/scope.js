// 소총 조준경: 고정 4배 망원 조준경의 형상, 광학 모형, 조준경 시점 렌더링
//
// 조준경 안의 상은 두 단계로 만든다.
// 1. 조준경 시점(대물렌즈 자리, 총열과 같은 방향, 실제 시야 약 6°)을 작은 렌더 타깃에 따로 그린다.
//    조준해서 카메라가 사출동공 가까이 있을 때만 그린다. 좁은 시야라 화면 밖 물체는 거의 다 걸러지고,
//    빛은 구워 둔 조도 볼륨을 그대로 읽으므로 그림자 맵을 다시 그릴 일도 없다. 후처리도 하지 않는다(본 화면의 후처리를 같이 거친다).
// 2. 접안렌즈 면의 셰이더가 화소마다 '카메라에서 이 렌즈 점을 지나는 광선'을 조준경 광학으로 되짚는다.
//    - 그 광선이 사출동공(지름 8 mm, 접안렌즈 뒤 9.2 cm)을 지나는가 → 지나지 않으면 검다(조준경 그림자, 터널 시야)
//    - 광선의 겉보기 각 ÷ 배율 = 바깥 세계의 방향 → 1단계 렌더 타깃에서 읽는다
//    - 시야 조리개(겉보기 시야 24°)의 날카로운 검은 원, 그 가장자리의 색수차와 주변 광량 저하
//    - 레티클은 둘째 초점면에 있어 겉보기 크기가 배율과 상관없이 일정하다(겉보기 각으로 그린다)
//    총은 마우스를 먼저 따라가고 카메라(몸)는 뒤따르므로, 카메라가 사출동공에서 어긋나는 만큼 그림자와 밀림이 저절로 생긴다.
//    카메라 렌즈와 같은 자리에 렌더 타깃을 붙여 고정해 둔 화면 속 화면(PIP)이 '조준이 뻣뻣하다'고 느껴지는 까닭이 이 어긋남이 없어서다.
import * as THREE from 'three';
import { bcMaterial, markEdges } from './materials.js';

// 총 좌표(원점 = 권총손잡이 윗부분, -z가 총구 방향, 단위 m)
export const SCOPE = {
  mag: 4,
  axisY: 0.152,        // 광축 높이(레일 윗면 0.12 위로 낮은 링 마운트)
  eyeZ: 0.188,         // 접안렌즈 면
  objZ: -0.066,        // 대물렌즈 면
  eyeR: 0.0205,        // 접안렌즈 유효 반지름
  objR: 0.0165,        // 대물렌즈 유효 반지름(대물 지름 32 mm ÷ 4배 = 사출동공 8 mm)
  relief: 0.092,       // 눈 거리(접안렌즈 → 사출동공)
  exitR: 0.004,        // 사출동공 반지름
  soft: 0.0016,        // 카메라 렌즈 구경(지름 약 3 mm)만큼 사출동공 가장자리가 무르다
  stopTan: Math.tan(12 * Math.PI / 180),   // 시야 조리개: 겉보기 시야 24°
  trans: 0.88,         // 투과율
  boreY: 0.072,        // 총열 축 높이(총구 위치, weapons.js)
  zero: 25,            // 영점 거리(m): 광축을 총열보다 아주 조금 아래로 기울여 이 거리에서 탄도와 만나게 한다
};
SCOPE.pupil = new THREE.Vector3(0, SCOPE.axisY, SCOPE.eyeZ + SCOPE.relief);   // 사출동공 중심(총 좌표)
// 조준경 시점 카메라의 시야: 실제 시야(겉보기 ÷ 배율)보다 6% 넓게 그려 시야 조리개 바깥까지 읽을 수 있게 한다
const SCOPE_TAN = SCOPE.stopTan / SCOPE.mag * 1.06;
const ZERO_ANGLE = Math.atan((SCOPE.axisY - SCOPE.boreY) / SCOPE.zero);

const IMAGE_VS = `
varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const IMAGE_FS = `
uniform sampler2D tScope;
uniform vec3 uEye; uniform vec3 uAX; uniform vec3 uAY; uniform vec3 uAF;
uniform float uOn; uniform float uExitR; uniform float uSoft; uniform float uMag; uniform float uStopTan; uniform float uScopeTan; uniform float uTrans; uniform float uDot;
varying vec3 vW;
// 선 하나: 거리 d가 반폭 w 안이면 1 (화소 크기만큼 부드럽게)
float bar(float d, float w, float aa){ return 1.0 - smoothstep(w - aa, w + aa, d); }
void main(){
  vec3 v = normalize(vW - cameraPosition);          // 카메라가 이 렌즈 점을 보는 방향
  float vf = dot(v, uAF);
  if (uOn < 0.5 || vf < 0.2) { gl_FragColor = vec4(0.0); return; }
  vec2 a = vec2(dot(v, uAX), dot(v, uAY)) / vf;     // 겉보기 각(탄젠트, 조준경 축 기준)
  // 사출동공: 이 광선이 동공 면을 지나는 자리가 동공 안이어야 상이 카메라에 닿는다
  float s = dot(vW - uEye, uAF) / vf;
  vec3 h = vW - v * s - uEye;
  float d = length(h - uAF * dot(h, uAF));
  float pupil = smoothstep(uExitR + uSoft, uExitR - uSoft, d);
  float ra = length(a);
  // 화소 크기(미분)는 화소마다 갈라지는 return보다 먼저 구한다. 갈라진 뒤의 미분은 GPU마다 값이 다를 수 있다
  float aa = max(fwidth(ra), 1e-5);
  float aq = max(fwidth(a.x), 1e-5) * 0.8;
  float stopMask = 1.0 - smoothstep(uStopTan - aa, uStopTan + aa, ra);
  float vis = pupil * stopMask;
  if (vis < 0.002) { gl_FragColor = vec4(0.0); return; }
  // 바깥 세계의 방향 = 겉보기 각 ÷ 배율 → 조준경 시점 렌더 타깃의 좌표
  vec2 t = a / (uMag * uScopeTan);
  float e = ra / uStopTan;
  float ca = 0.010 * e * e;
  vec3 img;
  img.r = texture2D(tScope, 0.5 + 0.5 * t * (1.0 + ca)).r;
  img.g = texture2D(tScope, 0.5 + 0.5 * t).g;
  img.b = texture2D(tScope, 0.5 + 0.5 * t * (1.0 - ca)).b;
  img *= uTrans * (1.0 - 0.28 * e * e * e);
  // 레티클(둘째 초점면): 가는 십자, 바깥쪽 굵은 기둥, 아래쪽 거리 눈금 두 개, 가운데 조명 점
  vec2 q = abs(a);
  float thin = max(bar(q.x, 0.0012, aq) * step(q.y, 0.075), bar(q.y, 0.0012, aq) * step(q.x, 0.075));
  float post = max(bar(q.x, 0.0055, aq) * step(0.07, q.y), bar(q.y, 0.0055, aq) * step(0.07, q.x));
  float ticks = 0.0;
  for (int i = 1; i <= 2; i++) { float y = -0.022 * float(i); ticks = max(ticks, bar(abs(a.y - y), 0.0011, aq) * step(q.x, 0.007 + 0.002 * float(i))); }
  float ret = clamp(max(max(thin, post), ticks), 0.0, 1.0);
  float dotm = bar(ra, 0.0026, aa);
  img *= 1.0 - ret * 0.97;
  img = mix(img, vec3(1.0, 0.07, 0.03) * uDot, dotm);
  // 알파 0 = 무한대 초점: 후처리가 이 화소에 근거리 초점 흐림과 차폐를 걸지 않는다(post.js)
  gl_FragColor = vec4(img * vis, step(0.05, vis));
}`;

function lathe(points, seg = 36) {
  const g = new THREE.LatheGeometry(points.map(([r, z]) => new THREE.Vector2(r, z)), seg);
  g.rotateX(Math.PI / 2);   // 회전축 +y → +z
  return g;
}

// 조준경 형상. 반환: { group, imageMat }
export function buildScope(M) {
  const S = SCOPE, g = new THREE.Group();
  const body = M.scopeBody || M.steel;
  // 몸통: 대물 벨(앞) → 30 mm 튜브 → 접안부(뒤). 앞뒤 끝은 렌즈 쪽으로 오목하게 들어간다
  const prof = [
    [S.objR + 0.0005, S.objZ - 0.002], [0.0204, S.objZ - 0.004], [0.0209, S.objZ], [0.0209, -0.030], [0.0192, -0.020], [0.0153, -0.006],
    [0.0150, 0.0], [0.0150, 0.098], [0.0157, 0.105], [0.0198, 0.121], [0.0226, 0.134], [0.0228, 0.165],
    [0.0236, 0.167], [0.0236, 0.181], [0.0229, 0.183], [0.0229, S.eyeZ + 0.004], [S.eyeR + 0.0007, S.eyeZ + 0.004], [S.eyeR + 0.0005, S.eyeZ],
  ];
  // 닳은 모서리와 먼지(materials.js markEdges)는 형상이 물체 원점에 가운데가 맞아야 해서, 형상을 가운데로 옮기고 그만큼 메시를 옮긴다
  const tubeGeo = lathe(prof.map(([r, z]) => [r, z]));
  tubeGeo.computeBoundingBox(); const tc = tubeGeo.boundingBox.getCenter(new THREE.Vector3());
  tubeGeo.translate(-tc.x, -tc.y, -tc.z); markEdges(tubeGeo, 0, 2);
  const tube = new THREE.Mesh(tubeGeo, body);
  tube.position.set(tc.x, S.axisY + tc.y, tc.z); g.add(tube);
  // 시력 조절 링의 홈
  for (let i = 0; i < 9; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.0237, 0.0007, 4, 32), body);
    rib.position.set(0, S.axisY, 0.1685 + i * 0.0015); g.add(rib);
  }
  // 조정부: 위 고저 다이얼, 오른쪽 좌우 다이얼, 왼쪽 조명 다이얼
  const box = (sz, p, mat = body) => { const m = new THREE.Mesh(markEdges(new THREE.BoxGeometry(...sz)), mat); m.position.set(...p); g.add(m); return m; };
  const cyl = (r, h, p, axis, mat = body, seg = 20) => {
    const geo = new THREE.CylinderGeometry(r, r, h, seg);
    if (axis === 'x') geo.rotateZ(Math.PI / 2); else if (axis === 'z') geo.rotateX(Math.PI / 2);
    markEdges(geo, 0, axis === 'x' ? 0 : axis === 'z' ? 2 : 1);
    const m = new THREE.Mesh(geo, mat); m.position.set(...p); g.add(m); return m;
  };
  box([0.030, 0.030, 0.046], [0, S.axisY, 0.048]);
  cyl(0.0125, 0.017, [0, S.axisY + 0.023, 0.048], 'y');
  cyl(0.0105, 0.004, [0, S.axisY + 0.0335, 0.048], 'y', M.worn);
  cyl(0.0125, 0.017, [0.023, S.axisY, 0.048], 'x');
  cyl(0.0095, 0.012, [-0.021, S.axisY, 0.048], 'x');
  // 링 두 개와 레일 클램프(레일 윗면 y 0.12)
  for (const z of [0.074, -0.004]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0158, 0.0026, 8, 28), body); ring.position.set(0, S.axisY, z); g.add(ring);
    cyl(0.0172, 0.011, [0, S.axisY, z], 'z');
    box([0.034, 0.024, 0.014], [0, 0.130, z]);
    box([0.006, 0.010, 0.012], [0.019, 0.126, z], M.worn);   // 클램프 볼트
  }
  // 렌즈: 어두운 유리(반사만 보인다)와 그 위에 더하는 조준경 상
  // 접안렌즈는 반사 방지 코팅이 되어 있고, 조준할 때 비치는 것은 어두운 얼굴과 카메라뿐이다. 반사를 약하게 둬야 위에 더하는 상이 뿌옇게 뜨지 않는다
  const glass = bcMaterial({ color: 0x050608, roughness: 0.05, metalness: 0.0, envMapIntensity: 0.5, specularIntensity: 0.3 }, { grime: 0, physical: true, body: true });
  const coat = bcMaterial({ color: 0x07060a, roughness: 0.04, metalness: 0.0, envMapIntensity: 1.2, specularIntensity: 1.0, sheen: 1, sheenColor: new THREE.Color(0x3a2a55), sheenRoughness: 0.3 }, { grime: 0, physical: true, body: true });
  const eyeGlass = new THREE.Mesh(new THREE.CircleGeometry(S.eyeR + 0.0005, 40), glass);
  eyeGlass.position.set(0, S.axisY, S.eyeZ); g.add(eyeGlass);
  const objGlass = new THREE.Mesh(new THREE.CircleGeometry(S.objR + 0.0005, 40), coat);
  objGlass.position.set(0, S.axisY, S.objZ); objGlass.rotation.y = Math.PI; g.add(objGlass);
  const imageMat = new THREE.ShaderMaterial({
    vertexShader: IMAGE_VS, fragmentShader: IMAGE_FS,
    uniforms: {
      tScope: { value: null }, uOn: { value: 0 },
      uEye: { value: new THREE.Vector3() }, uAX: { value: new THREE.Vector3(1, 0, 0) }, uAY: { value: new THREE.Vector3(0, 1, 0) }, uAF: { value: new THREE.Vector3(0, 0, -1) },
      uExitR: { value: S.exitR }, uSoft: { value: S.soft }, uMag: { value: S.mag }, uStopTan: { value: S.stopTan }, uScopeTan: { value: SCOPE_TAN },
      uTrans: { value: S.trans }, uDot: { value: 0.9 },
    },
    transparent: true, depthWrite: false,
    // 색은 유리 위에 더하고, 알파는 상이 보이는 곳에서 0으로 지운다(무한대 초점 표시)
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const image = new THREE.Mesh(new THREE.CircleGeometry(S.eyeR, 48), imageMat);
  image.position.set(0, S.axisY, S.eyeZ + 0.0004); image.renderOrder = 10; image.frustumCulled = false;
  g.add(image);
  return { group: g, imageMat };
}

// 조준경 시점 렌더링과 접안렌즈 셰이더의 매 프레임 값
export class ScopeView {
  // 진단 전용: 조준경 시점 절두체에 걸리는 물체의 삼각형 수를 묶음별로 센다(무엇이 비용을 내는지 보려고)
  diag(scene, names = new Map()) {
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse));
    const out = {}; let total = 0, n = 0;
    scene.traverseVisible((o) => {
      if (!o.isMesh) return;
      if (o.frustumCulled && !fr.intersectsObject(o)) return;
      const g = o.geometry, c = g.index ? g.index.count : g.attributes.position.count;
      const tris = Math.round(c / 3) * (o.isInstancedMesh ? o.count : 1);
      let top = o; while (top.parent && top.parent !== scene) top = top.parent;
      const key = (names.get(top) || top.name || top.type) + (o.frustumCulled ? '' : ' (컬링 안 함)') + '/' + (o.name || o.type);
      out[key] = (out[key] || [0, 0]); out[key][0] += tris; out[key][1]++; total += tris; n++;
    });
    return { total, meshes: n, top: Object.entries(out).sort((a, b) => b[1][0] - a[1][0]).slice(0, 30) };
  }
  constructor(renderer) {
    this.r = renderer;
    this.size = 512;
    this.rt = new THREE.WebGLRenderTarget(this.size, this.size, { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 });
    this.cam = new THREE.PerspectiveCamera(2 * Math.atan(SCOPE_TAN) * 180 / Math.PI, 1, 0.05, 420);
    this.on = false; this.frames = 0; this.pupilOffset = 1; this.axialOffset = 0;
    this.skip = false;            // 측정 전용: 조준경 시점 렌더링만 건너뛴다(npm run perf가 이 렌더링 하나의 비용을 잰다)
    this.calls = 0; this.tris = 0; // 마지막 조준경 시점 렌더링의 그리기 호출 수와 삼각형 수
    this.cpu = { matrices: 0, render: 0 }; // 조준경 패스의 CPU 시간(ms, 지수 평균): 장면 행렬 갱신, 렌더 호출(컬링과 그리기 명령 제출)
    this._zq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -ZERO_ANGLE);
    this._P = new THREE.Vector3(); this._O = new THREE.Vector3(); this._off = new THREE.Vector3();
  }
  // 낮은 품질에서는 조준경 상을 작게 그린다(접안렌즈는 1080p에서 지름 약 350화소)
  setQuality(q) {
    const s = q === 'low' ? 256 : q === 'medium' ? 384 : 512;
    if (s !== this.size) { this.size = s; this.rt.setSize(s, s); }
  }
  // 본 장면을 그리기 직전에 부른다. hide: 조준경 시점에서 빼야 할 물체(총, 손, 팔)
  update(scene, camera, vm, hide, cull = (cam, fn) => fn()) {
    this.rendered = false;
    const mdl = vm.models.rifle, sc = mdl.scope;
    if (!sc) return;
    const U = sc.imageMat.uniforms;
    const g = mdl.group;
    g.updateWorldMatrix(true, false);
    const m = g.matrixWorld;
    const P = this._P.copy(SCOPE.pupil).applyMatrix4(m);
    U.uEye.value.copy(P);
    // 광축은 총 좌표의 -z에서 영점 각(약 0.18°)만큼 아래로 기울어 있다. 25 m보다 가까우면 탄이 레티클 가운데보다 조금 아래(최대 8 cm), 멀면 조금 위에 맞는다
    const zt = ZERO_ANGLE, cz = Math.cos(zt), sz = Math.sin(zt);
    U.uAX.value.set(1, 0, 0).transformDirection(m); U.uAY.value.set(0, cz, -sz).transformDirection(m); U.uAF.value.set(0, -sz, -cz).transformDirection(m);
    // 카메라가 사출동공 가까이 있을 때만 그린다. 멀면 접안렌즈는 어두운 유리로만 보인다
    const off = this._off.copy(camera.position).sub(P);
    const ax = off.dot(U.uAF.value);
    off.addScaledVector(U.uAF.value, -ax);
    this.pupilOffset = off.length(); this.axialOffset = ax;
    const active = vm.current === 'rifle' && g.visible && vm.ads > 0.02;
    this.on = active && this.pupilOffset < SCOPE.exitR + SCOPE.soft + Math.abs(ax) * SCOPE.stopTan + 0.002;
    U.uOn.value = this.on ? 1 : 0;
    U.tScope.value = this.rt.texture;
    if (!this.on || this.skip) return;
    this._O.set(0, SCOPE.axisY, SCOPE.objZ).applyMatrix4(m);
    this.cam.position.copy(this._O);
    g.getWorldQuaternion(this.cam.quaternion).multiply(this._zq);
    this.cam.updateMatrixWorld();
    const was = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    const prev = this.r.getRenderTarget();
    this.r.setRenderTarget(this.rt);
    // 장면 행렬은 여기서 한 번 갱신한다. 본 화면 패스는 같은 프레임에 다시 갱신하지 않는다(main.js)
    const t0 = performance.now();
    scene.updateMatrixWorld();
    const t1 = performance.now();
    const auto = scene.matrixWorldAutoUpdate; scene.matrixWorldAutoUpdate = false;
    cull(this.cam, () => this.r.render(scene, this.cam));
    scene.matrixWorldAutoUpdate = auto;
    const t2 = performance.now();
    this.cpu.matrices += (t1 - t0 - this.cpu.matrices) * 0.05; this.cpu.render += (t2 - t1 - this.cpu.render) * 0.05;
    this.rendered = true;
    this.calls = this.r.info.render.calls; this.tris = this.r.info.render.triangles;
    this.r.setRenderTarget(prev);
    hide.forEach((o, i) => { o.visible = was[i]; });
    this.frames++;
  }
}
