// 1인칭 총과 팔: 절차 모델, 반동·흔들림·재장전 애니메이션 (매번 조금씩 다르게)
import * as THREE from 'three';
import { bcMaterial } from './materials.js';
import { noise1 } from './rng.js';
import { buildScope, SCOPE } from './scope.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createHand, makeSkeleton, fitGrasp, rbox as gripBox, setPose, lerpPose } from './hands.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

const _rbCache = new Map();
function rbox(sx, sy, sz) {
  const k = `${sx},${sy},${sz}`;
  if (!_rbCache.has(k)) { const r = Math.min(sx, sy, sz) * 0.22; _rbCache.set(k, new RoundedBoxGeometry(sx, sy, sz, 2, r)); }
  return _rbCache.get(k);
}
function part(group, mat, size, pos, rot = [0, 0, 0]) {
  const m = new THREE.Mesh(rbox(...size), mat);
  m.position.set(...pos); m.rotation.set(...rot);
  group.add(m); return m;
}
function cylPart(group, mat, r, len, pos, axis = 'z', seg = 12, r2) {
  const g = new THREE.CylinderGeometry(r2 ?? r, r, len, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat); m.position.set(...pos); group.add(m); return m;
}

// 소매(팔뚝): 팔꿈치(y 0)에서 손목(y 1)까지. 반지름은 실제 치수(m)이고 길이만 placeLimb가 늘린다.
// 팔뚝 단면은 납작한 타원(가로가 넓다)이고 팔꿈치 쪽 3분의 1이 근육으로 부푼다. 손목 쪽은 장갑 소맷부리 위로 소매가 밀려 올라가
// 1~1.5 cm 깊이로 겹겹이 접힌다(골이 날카롭고 마루가 둥글다). 팔 전체에 팔꿈치에서 비틀려 내려오는 큰 주름, 팔꿈치 쪽 끝에도 접힘.
// 접힌 골은 정점 색으로 어둡게 칠한다(천이 겹친 그늘). 소맷부리는 조금 벌어지고 끝이 고르지 않다
function sleeveGeo(rElbow, rWrist, seed) {
  const g = new THREE.CylinderGeometry(1, 1, 1, 40, 72, true); g.translate(0, 0.5, 0);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    let r = rElbow + (rWrist - rElbow) * Math.pow(y, 0.8);
    r *= 1 + 0.07 * Math.exp(-Math.pow((y - 0.22) / 0.18, 2));
    const wW = sm(0.45, 0.9, y), wE = 1 - sm(0.0, 0.3, y);
    // 손목 쪽 겹친 주름: 고리가 비스듬하고 고르지 않다
    const ph = y * 30 + Math.sin(a * 2 + seed) * 1.3 + Math.sin(a * 3 - seed * 1.7) * 0.7 + seed;
    const fold = Math.pow(Math.abs(Math.sin(ph)), 0.4) - 0.66;
    // 팔꿈치에서 비틀려 내려오는 큰 주름
    const tw = Math.sin(a * 2 + y * 9 + seed * 2.1), tw2 = Math.sin(a * 5 - y * 17 + seed);
    const elb = Math.pow(Math.abs(Math.sin(y * 34 + a * 1.5 + seed * 0.3)), 0.5) - 0.62;
    r += fold * 0.013 * wW + tw * 0.0045 * (0.4 + 0.6 * (1 - wW)) + tw2 * 0.002 + elb * 0.009 * wE;
    r += Math.sin(a * 2 + seed * 0.7) * 0.0025;
    if (y > 0.965) r += (y - 0.965) * 0.22 + Math.sin(a * 4 + seed) * 0.0012;
    p.setXYZ(i, x * r * 1.06, y, z * r * 0.94);
    // 골의 그늘: 접힘이 깊을수록 어둡다
    const valley = Math.max(0, -fold) * wW * 1.25 + Math.max(0, -elb) * wE * 1.1 + Math.max(0, -tw) * 0.18;
    const c = Math.max(0.5, 1 - valley * 0.75);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
// 두 점 사이를 잇는 원기둥(팔)
function limb(mat, r0, r1, wrinkle = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, 16, wrinkle ? 14 : 1); g.translate(0, 0.5, 0);
  if (wrinkle) {
    // 소매 주름: 길이 방향으로 불규칙한 접힘과 비대칭
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
      const k = 1 + wrinkle * (0.2 * Math.sin(y * 31 + a * 2.0) * Math.sin(a * 3 + y * 7) + 0.13 * Math.sin(y * 57 + a * 5) + 0.07 * Math.sin(y * 113 + a * 9) + 0.12 * Math.cos(a - 0.6));
      p.setXYZ(i, x * k, y, z * k * 1.12);
    }
    g.computeVertexNormals();
  }
  return new THREE.Mesh(g, mat);
}
const _up = V(0, 1, 0), _d = V(0, 0, 0), _q = new THREE.Quaternion();
function placeLimb(m, a, b) {
  _d.subVectors(b, a); const L = _d.length();
  m.position.copy(a); _q.setFromUnitVectors(_up, _d.divideScalar(L)); m.quaternion.copy(_q); m.scale.set(1, L, 1);
}

// 총기 표면: 모서리 마모, 긁힘, 손때 (캔버스)
function wearTexture(base, seed) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, S, S);
  let a = seed * 9301 + 49297; const r = () => ((a = (a * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 2600; i++) { const v = Math.floor(r() * 40); x.fillStyle = `rgba(${v},${v},${v},0.05)`; x.fillRect(r() * S, r() * S, 2 + r() * 6, 2 + r() * 6); }
  x.strokeStyle = 'rgba(170,170,160,0.3)'; x.lineWidth = 0.7;
  for (let i = 0; i < 90; i++) { const px = r() * S, py = r() * S, l = 3 + r() * 20, an = r() * 6.28; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(an) * l, py + Math.sin(an) * l); x.stroke(); }
  x.fillStyle = 'rgba(200,195,180,0.10)';
  for (let i = 0; i < 40; i++) { x.beginPath(); x.arc(r() * S, r() * S, 4 + r() * 14, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(3, 3);
  return t;
}
function fabricTexture(base, seed) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'); x.fillStyle = base; x.fillRect(0, 0, S, S);
  let a = seed; const r = () => ((a = (a * 9301 + 49297) % 233280) / 233280);
  for (let y = 0; y < S; y += 2) { x.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.05})`; x.fillRect(0, y, S, 1); }
  for (let i = 0; i < 30; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,240'},0.06)`; x.fillRect(r() * S, r() * S, 10 + r() * 30, 2 + r() * 8); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(2, 6);
  return t;
}

export function buildMaterials() {
  // 금속 부품은 어두운 회색, 핸드가드와 개머리판과 탄창은 탄색이다. 부품마다 색이 달라야 판정 시트 크기에서 총으로 읽힌다(검은 단색으로 바꿨을 때 "형태가 읽히지 않는 덩어리"로 보였다). 회색 금속이 떠 보이던 것은 반사 탓이라 반사만 줄인다
  const blk = wearTexture('#1e1f1e', 3), tan = wearTexture('#55524a', 7), stl = wearTexture('#2c2e30', 11);
  return {
    polymer: bcMaterial({ map: blk, roughness: 0.6, metalness: 0.0, envMapIntensity: 0.15, specularIntensity: 0.45 }, { grime: 0, physical: true }),
    // 검게 처리한 금속(아노다이징, 파커라이징)은 무광에 가깝다. 금속성을 낮게 두고 정반사 세기도 줄인다
    steel: bcMaterial({ map: stl, roughness: 0.46, metalness: 0.25, envMapIntensity: 0.25, specularIntensity: 0.5 }, { grime: 0, physical: true }),
    // 조준경 몸통: 무광 검정 아노다이징 알루미늄. 총의 강철보다 조금 더 검고, 반사는 넓고 흐리다.
    // 거칠기 0.4에서는 원통 윗면에 총구 화염과 창이 작고 밝은 반사점으로 맺혔고, 렌즈 앞 초점 흐림이
    // 그것을 둥근 원판으로 퍼뜨려 '빛나는 구슬'로 읽혔다(A/B 라운드 35 사격 쌍). '광택이 강하다'는 지적도 같은 원인이다
    scopeBody: bcMaterial({ map: wearTexture('#191b1c', 17), roughness: 0.62, metalness: 0.15, envMapIntensity: 0.3, specularIntensity: 0.5 }, { grime: 0, physical: true }),
    worn: bcMaterial({ color: 0x4c4e50, roughness: 0.32, metalness: 0.65, envMapIntensity: 0.6 }, { grime: 0 }),
    tan: bcMaterial({ map: tan, roughness: 0.72, metalness: 0.0, envMapIntensity: 0.25, specularIntensity: 0.45 }, { grime: 0, physical: true }),
    glove: bcMaterial({ map: fabricTexture('#363530', 5), roughness: 0.85, envMapIntensity: 0.2, specularIntensity: 0.3 }, { grime: 0, physical: true }),
    gloveKnuckle: bcMaterial({ color: 0x1a1a18, roughness: 0.5, envMapIntensity: 0.3 }, { grime: 0 }),
    sleeve: bcMaterial({ map: fabricTexture('#3f413a', 9), roughness: 1.0, envMapIntensity: 0.2, specularIntensity: 0.15 }, { grime: 0, physical: true }),
    cuff: bcMaterial({ map: fabricTexture('#3a3c31', 13), roughness: 1.0, envMapIntensity: 0.2, specularIntensity: 0.15 }, { grime: 0, physical: true }),
  };
}

function buildRifle(M) {
  const g = new THREE.Group();
  // 원점 = 권총손잡이 윗부분(오른손 위치). -z가 총구 방향
  part(g, M.steel, [0.05, 0.06, 0.28], [0, 0.034, -0.07]);              // 하부 리시버
  part(g, M.steel, [0.054, 0.052, 0.34], [0, 0.086, -0.09]);            // 상부 리시버
  part(g, M.worn, [0.004, 0.026, 0.07], [0.028, 0.088, -0.06]);         // 배출구 덮개
  cylPart(g, M.steel, 0.012, 0.03, [0.03, 0.09, 0.0], 'x', 10);         // 노리쇠 전진기
  part(g, M.polymer, [0.024, 0.06, 0.03], [0, 0.03, -0.13]);            // 탄창 삽입구 앞
  part(g, M.tan, [0.064, 0.07, 0.31], [0, 0.072, -0.385]);              // 핸드가드
  for (let i = 0; i < 7; i++) part(g, M.polymer, [0.012, 0.016, 0.024], [-0.033, 0.072, -0.27 - i * 0.04]); // 구멍 (왼쪽)
  for (let i = 0; i < 7; i++) part(g, M.polymer, [0.012, 0.016, 0.024], [0.033, 0.072, -0.27 - i * 0.04]);
  // 윗면 레일은 상부 리시버 끝(z 0.07)까지 이어진다. 조준경 링 두 개가 그 뒤쪽에 물린다
  for (let i = 0; i < 19; i++) part(g, M.steel, [0.022, 0.008, 0.012], [0, 0.116, 0.066 - i * 0.022]); // 레일 이
  part(g, M.steel, [0.024, 0.006, 0.44], [0, 0.11, -0.14]);
  cylPart(g, M.steel, 0.0095, 0.25, [0, 0.072, -0.66]);                 // 총열
  cylPart(g, M.steel, 0.0135, 0.055, [0, 0.072, -0.805], 'z', 8);      // 소염기
  // 가늠쇠와 가늠자는 뗐다(조준경의 아래 시야를 가린다). 가스 블록은 핸드가드 안에 있다
  part(g, M.steel, [0.036, 0.012, 0.045], [0, 0.114, 0.095]);          // 장전 손잡이
  const scope = buildScope(M);                                          // 고정 4배 조준경 (scope.js)
  g.add(scope.group);
  part(g, M.tan, [0.032, 0.105, 0.046], [0, -0.035, 0.035], [-0.32, 0, 0]); // 권총손잡이(아래가 뒤로 누웠다. 이전에는 앞으로 누워 있었다)
  part(g, M.polymer, [0.012, 0.008, 0.06], [0, -0.008, -0.03]);         // 방아쇠울
  part(g, M.steel, [0.004, 0.022, 0.006], [0, 0.002, -0.022], [0.3, 0, 0]); // 방아쇠
  part(g, M.worn, [0.006, 0.012, 0.02], [0.027, 0.04, -0.005]);         // 조정간
  const mag = new THREE.Group();
  // 탄창은 아래로 갈수록 앞(총구 쪽)으로 휜다(이전에는 뒤로 휘어 있었다)
  part(mag, M.tan, [0.027, 0.11, 0.068], [0, -0.05, 0], [0.12, 0, 0]);
  part(mag, M.tan, [0.027, 0.09, 0.064], [0, -0.135, -0.018], [0.32, 0, 0]);
  for (let i = 0; i < 4; i++) part(mag, M.polymer, [0.029, 0.006, 0.05], [0, -0.03 - i * 0.03, -0.002 - i * 0.005], [0.15 + i * 0.05, 0, 0]);
  part(mag, M.polymer, [0.03, 0.014, 0.075], [0, -0.182, -0.035], [0.32, 0, 0]);
  mag.position.set(0, 0.0, -0.13);
  g.add(mag);
  cylPart(g, M.steel, 0.016, 0.22, [0, 0.072, 0.17]);                   // 완충관
  part(g, M.tan, [0.044, 0.088, 0.15], [0, 0.044, 0.27]);              // 개머리판
  part(g, M.polymer, [0.046, 0.094, 0.02], [0, 0.044, 0.35]);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.072, -0.83); g.add(muzzle);
  const ejection = new THREE.Object3D(); ejection.position.set(0.03, 0.088, -0.05); g.add(ejection);
  return { group: g, mag, muzzle, ejection, scope, eyePoint: SCOPE.pupil.clone(),
    // 쥐는 자리(총 기준). 손등 방향, 손가락 방향, 손바닥 가운데가 닿는 점을 정하고 손가락은 닿을 때까지 오므린다(fitGrips)
    //  오른손: 권총손잡이를 오른쪽에서 감싼다. 손등은 바깥(오른쪽 조금 위), 손가락은 손잡이 앞면을 감아 왼쪽으로, 검지는 방아쇠, 엄지는 손잡이 윗부분 왼쪽
    //  왼손: 핸드가드 윗면 왼쪽을 위에서 덮어 쥔다. 손등은 위(조금 왼쪽)를 보고, 손가락은 윗면을 넘어 오른쪽 옆을 감아 내려간다.
    //  가슴 카메라에서 손등과 손가락 마디가 핸드가드 위에 보인다. 왼쪽 아래 모서리를 감싸 쥐었을 때는 손이 소매 끝과 핸드가드에 가려
    //  판정자들이 '소매가 둥근 마개로 끝난다'고 봤다(A/B 라운드 38). 탄창을 쥘 때는 손등이 바깥 아래를 보는 방향(reload)으로 돌린다
    grip: (() => {
      const pg = gripBox([0, -0.035, 0.035], [0.032, 0.105, 0.046], [-0.32, 0, 0], 0.007);
      const lower = gripBox([0, 0.034, -0.07], [0.05, 0.06, 0.28], [0, 0, 0], 0.004);
      const trig = gripBox([0, 0.0, -0.026], [0.06, 0.03, 0.012], [0.3, 0, 0], 0.003);
      const hg = gripBox([0, 0.072, -0.385], [0.064, 0.07, 0.31], [0, 0, 0], 0.012);
      return {
        R: { back: V(1, 0.3, 0.12), dir: V(0, -0.315, -0.949), palm: V(0.0178, -0.0075, 0.026), boxes: [pg],
          start: { f: [[0.1, -0.05, 0.1, 0.05], [0.1, 0, 0.1, 0.05], [0.1, 0.03, 0.1, 0.05], [0.1, 0.08, 0.1, 0.05]], t: [0.0, 0.25, 0.5, 0.1, 0.1] },
          per: { 0: { boxes: [trig], max: [0.95, 1.3, 0.9] }, 4: { boxes: [pg, lower] } } },
        L: { back: V(-0.5, 0.85, 0.12), dir: V(0.75, -0.25, -0.6), palm: V(-0.012, 0.112, -0.31), boxes: [hg], reload: { back: V(-0.85, -0.38, 0.05), dir: V(0.62, -0.32, -0.6) },
          start: { f: [[0.05, -0.08, 0.05, 0.03], [0.05, -0.02, 0.05, 0.03], [0.05, 0.04, 0.05, 0.03], [0.05, 0.1, 0.05, 0.03]], t: [0.0, 0.55, 0.3, 0.05, 0.05] } },
      };
    })(),
    magPos: mag.position.clone() };
}

function buildPistol(M) {
  const g = new THREE.Group();
  const slide = part(g, M.steel, [0.03, 0.032, 0.19], [0, 0.058, -0.06]);   // 슬라이드
  for (let i = 0; i < 6; i++) part(slide, M.polymer, [0.031, 0.024, 0.003], [0, 0, 0.07 + i * 0.006]); // 톱니
  part(g, M.polymer, [0.028, 0.025, 0.16], [0, 0.03, -0.05]); // 프레임
  part(g, M.polymer, [0.031, 0.11, 0.05], [0, -0.03, 0.02], [-0.26, 0, 0]); // 손잡이(아래가 뒤로 누웠다)
  part(g, M.polymer, [0.01, 0.008, 0.045], [0, 0.005, -0.03]);
  part(g, M.steel, [0.006, 0.01, 0.006], [0, 0.079, -0.145]);
  part(g, M.steel, [0.022, 0.01, 0.008], [0, 0.079, 0.025]);
  const mag = new THREE.Group(); part(mag, M.steel, [0.024, 0.02, 0.04], [0, 0, 0]); mag.position.set(0, -0.085, 0.035); g.add(mag);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.058, -0.16); g.add(muzzle);
  const ejection = new THREE.Object3D(); ejection.position.set(0.02, 0.07, -0.03); g.add(ejection);
  return { group: g, mag, muzzle, ejection, slide, sightY: 0.08,
    // 오른손은 손잡이를 감싸고, 왼손은 손잡이 왼쪽 빈자리를 손바닥으로 메우며 오른손 손가락 위를 감싼다(두 엄지는 앞으로)
    grip: (() => {
      const pg = gripBox([0, -0.03, 0.02], [0.031, 0.11, 0.05], [-0.26, 0, 0], 0.008);
      const trig = gripBox([0, 0.012, -0.018], [0.05, 0.026, 0.008], [0.2, 0, 0], 0.003);
      const fist = gripBox([0, -0.04, -0.016], [0.058, 0.075, 0.026], [-0.26, 0, 0], 0.009);
      const frame = gripBox([0, 0.03, -0.05], [0.028, 0.025, 0.16], [0, 0, 0], 0.004);
      return {
        R: { back: V(1, 0.3, 0.1), dir: V(0, -0.257, -0.966), palm: V(0.017, -0.001, 0.0125), boxes: [pg],
          start: { f: [[0.1, -0.05, 0.1, 0.05], [0.1, 0, 0.1, 0.05], [0.1, 0.03, 0.1, 0.05], [0.1, 0.08, 0.1, 0.05]], t: [0.0, 0.3, 0.45, 0.05, 0.05] },
          per: { 0: { boxes: [trig], max: [0.95, 1.3, 0.9] }, 4: { boxes: [pg, frame] } } },
        L: { back: V(-1, 0.15, 0.05), dir: V(0.3, -0.6, -0.75), palm: V(-0.0215, -0.03, 0.012), boxes: [pg, fist],
          start: { f: [[0.1, -0.03, 0.1, 0.05], [0.1, 0, 0.1, 0.05], [0.1, 0.02, 0.1, 0.05], [0.1, 0.05, 0.1, 0.05]], t: [0.0, 0.2, 0.3, 0.05, 0.05] },
          per: { 4: { boxes: [pg, frame] } } },
      };
    })(),
    magPos: mag.position.clone() };
}

// 손바닥 가운데(손바닥 면 위의 점, 손 기준). 쥐는 자리와 짚는 자리를 이 점으로 맞춘다
const PALM = V(0, -0.019, -0.055);
// 손목 행렬(총 기준): 손등 방향 back, 손가락 방향 dir, 손바닥 가운데가 닿을 점 palm
function wristFrame(back, dir, palm) {
  const Y = back.clone().normalize(), Z = dir.clone().normalize().negate();
  Z.addScaledVector(Y, -Z.dot(Y)).normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z);
  const m = new THREE.Matrix4().makeBasis(X, Y, Z);
  return m.setPosition(palm.clone().sub(PALM.clone().applyMatrix4(m)));
}
// 무기마다 두 손의 자리와 쥔 자세를 처음 한 번 구한다(손가락을 손잡이 거리장에 닿을 때까지 오므린다)
function fitGrips(mdl) {
  const out = {};
  for (const side of ['R', 'L']) {
    const G = mdl.grip[side];
    const m = wristFrame(G.back, G.dir, G.palm);
    const pose = fitGrasp(makeSkeleton(side === 'R' ? 1 : -1), m, G.boxes, G.start, { fingers: G.per });
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    // 탄창을 쥐는 손(재장전)은 손등이 바깥 아래를 보게 따로 정할 수 있다. 위에서 덮어 쥐는 손 그대로 돌리면 탄창을 손등 쪽으로 든다
    const rq = G.reload ? new THREE.Quaternion().setFromRotationMatrix(wristFrame(G.reload.back, G.reload.dir, G.palm)) : q.clone();
    rq.premultiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.5));
    out[side] = { m, pose, q, rq, p: new THREE.Vector3().setFromMatrixPosition(m), palm: G.palm.clone() };
  }
  return out;
}
// 짚는 손(파쿠르)과 탄창을 쥐는 손
const PLANT = { f: [[0.1, -0.13, 0.12, 0.06], [0.08, -0.03, 0.12, 0.06], [0.08, 0.05, 0.12, 0.06], [0.12, 0.15, 0.14, 0.08]], t: [0.0, 0.55, 0.25, 0.1, 0.1] };
const GRAB = { f: [[0.75, -0.04, 1.0, 0.6], [0.8, 0, 1.05, 0.6], [0.8, 0.03, 1.05, 0.6], [0.75, 0.08, 1.0, 0.6]], t: [0.25, 0.35, 0.55, 0.35, 0.35] };

const WEAPONS = {
  rifle: { mag: 30, spareMags: 4, interval: 0.088, auto: true, reload: 2.35, recoil: 1.0, kind: 'rifle', damage: 1, spread: 0.0016,
    // 조준 자세: 카메라(눈)가 조준경의 사출동공에 오도록 총을 놓는다 → 광축 높이 0.152 아래, 사출동공(z 0.28) 앞
    hip: V(0.162, -0.232, -0.34), ads: V(0.0, -SCOPE.axisY, -(SCOPE.eyeZ + SCOPE.relief)), sprint: V(0.07, -0.28, -0.24), cant: 0.06 },
  pistol: { mag: 15, spareMags: 3, interval: 0.13, auto: false, reload: 1.75, recoil: 0.8, kind: 'pistol', damage: 0.85, spread: 0.003,
    hip: V(0.09, -0.21, -0.32), ads: V(0.0, -0.085, -0.36), sprint: V(0.06, -0.28, -0.2), cant: 0.06 },
};

// 조준 앞섬과 관성의 축(카메라 기준): 소총은 오른쪽 겨드랑이 밑에 낀 개머리판 끝, 권총은 두 어깨 사이 앞
const PIVOT = { rifle: V(0.17, -0.2, 0.02), pistol: V(0.06, -0.2, 0.0) };

class Spring {
  constructor(k = 120, d = 14) { this.k = k; this.d = d; this.x = V(0, 0, 0); this.v = V(0, 0, 0); }
  step(dt, target = V(0, 0, 0)) {
    const steps = Math.ceil(dt / 0.004), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const ax = (target.x - this.x.x) * this.k - this.v.x * this.d;
      const ay = (target.y - this.x.y) * this.k - this.v.y * this.d;
      const az = (target.z - this.x.z) * this.k - this.v.z * this.d;
      this.v.x += ax * h; this.v.y += ay * h; this.v.z += az * h;
      this.x.addScaledVector(this.v, h);
    }
    return this.x;
  }
  kick(v) { this.v.add(v); }
}

export class Viewmodel {
  constructor(scene, rng) {
    this.rng = rng;
    this.M = buildMaterials();
    this.root = new THREE.Group();
    scene.add(this.root);
    this.models = { rifle: buildRifle(this.M), pistol: buildPistol(this.M) };
    // root(카메라 = 몸) → leadPivot(어깨 쪽 축: 조준 앞섬과 관성) → gunHolder(총의 자세)
    this.leadPivot = new THREE.Group();
    this.root.add(this.leadPivot);
    this.gunHolder = new THREE.Group();
    this.leadPivot.add(this.gunHolder);
    for (const k in this.models) { this.gunHolder.add(this.models[k].group); this.models[k].group.visible = false; }
    // 손: 거리장으로 지은 스키닝 메시(hands.js). 쥔 자세는 무기마다 손잡이에 맞춰 구한다
    this.gloveMat = bcMaterial({ map: fabricTexture('#3b3a35', 5), roughness: 0.84, envMapIntensity: 0.2, specularIntensity: 0.3, vertexColors: true }, { grime: 0, physical: true });
    this.hR = createHand(this.gloveMat, false); this.hL = createHand(this.gloveMat, true);
    this.handR = this.hR.mesh; this.handL = this.hL.mesh;
    this.gunHolder.add(this.handR, this.handL);
    for (const k in this.models) this.models[k].grips = fitGrips(this.models[k]);
    const sleeveMat = bcMaterial({ map: fabricTexture('#33352f', 9), roughness: 1.0, envMapIntensity: 0.2, specularIntensity: 0.15, side: THREE.DoubleSide, vertexColors: true }, { grime: 0, physical: true });
    this.foreR = new THREE.Mesh(sleeveGeo(0.066, 0.05, 1.3), sleeveMat); this.foreL = new THREE.Mesh(sleeveGeo(0.066, 0.05, 4.1), sleeveMat);
    scene.add(this.foreR, this.foreL);
    for (const m of [this.foreR, this.foreL]) m.frustumCulled = false;
    this.plantW = 0; this.planted = false; this.handLWorld = null;
    this.heldMag = null;
    this.state = {
      rifle: { ammo: WEAPONS.rifle.mag, spare: WEAPONS.rifle.spareMags },
      pistol: { ammo: WEAPONS.pistol.mag, spare: WEAPONS.pistol.spareMags },
    };
    this.current = 'rifle';
    this.models.rifle.group.visible = true;
    this.recoilT = new Spring(150, 13);   // 위치 반동
    this.recoilR = new Spring(110, 11);   // 회전 반동
    this.leadSpring = new Spring(330, 31); // 조준 앞섬과 관성(고유 진동수 18 rad/s, 감쇠비 0.85)
    this.vSpring = new Spring(70, 9);     // 점프와 착지의 위아래 관성
    this.holdPhase = 0;   // 떠도는 자세의 위상. 생명마다 다르다(Game.reset이 정한다)
    this.ads = 0; this.sprint = 0; this.lower = 0; this.stow = 0; this.switchT = 0; this.switchTo = null;
    this.reload = null; this.cool = 0; this.triggerHeld = false; this.triggerWas = false;
    this.fatigue = 0; this.stress = 0;
    this.muzzleWorld = V(0, 0, 0); this.dirWorld = V(0, 0, -1);
    this.droppedMags = [];
    this.events = [];
  }
  get def() { return WEAPONS[this.current]; }
  get ammo() { return this.state[this.current].ammo; }
  get model() { return this.models[this.current]; }

  reset() {
    this.state.rifle = { ammo: WEAPONS.rifle.mag, spare: WEAPONS.rifle.spareMags };
    this.state.pistol = { ammo: WEAPONS.pistol.mag, spare: WEAPONS.pistol.spareMags };
    this.reload = null; this.switchTo = null; this.switchT = 0; this.setWeapon('rifle');
    for (const m of this.droppedMags) m.m.parent?.remove(m.m);
    this.droppedMags = [];
  }
  setWeapon(w) {
    this.current = w;
    for (const k in this.models) this.models[k].group.visible = k === w;
    const mdl = this.model; mdl.mag.visible = true; mdl.mag.position.copy(mdl.magPos); mdl.mag.rotation.set(0, 0, 0);
  }
  requestSwitch(w) { if (w !== this.current && !this.switchTo) { this.switchTo = w; this.switchT = 0; this.reload = null; this.restoreMag(); } }
  restoreMag() { const mdl = this.model; mdl.mag.visible = true; mdl.mag.position.copy(mdl.magPos); if (this.heldMag) { this.heldMag.parent?.remove(this.heldMag); this.heldMag = null; } }

  startReload() {
    const st = this.state[this.current];
    if (this.reload || this.switchTo || st.spare <= 0 || st.ammo >= this.def.mag + 1) return false;
    const r = this.rng;
    const base = this.def.reload * (0.9 + r() * 0.22 + this.stress * 0.15);
    this.reload = {
      t: 0, dur: base, empty: st.ammo === 0,
      tilt: (0.35 + r() * 0.3) * (r() < 0.5 ? 1 : 0.8), pitch: 0.25 + r() * 0.2, drop: 0.05 + r() * 0.05,
      out: 0.18 + r() * 0.08, reach: 0.42 + r() * 0.08, insert: 0.68 + r() * 0.06, slapped: false, outDone: false, charged: false, fumble: r() < 0.12 + this.stress * 0.15,
    };
    if (this.reload.empty) this.reload.dur += 0.35;
    this.events.push({ type: 'reloadStart', weapon: this.current });
    return true;
  }

  // 사격 시도. 발사되면 true
  tryFire(dt, canFire) {
    this.cool -= dt;
    const st = this.state[this.current];
    const pressed = this.triggerHeld && (!this.triggerWas || this.def.auto);
    this.triggerWas = this.triggerHeld;
    if (!pressed || !canFire || this.reload || this.switchTo || this.cool > 0 || this.sprint > 0.4 || this.stow > 0.3) return false;
    if (st.ammo <= 0) { if (!this.triggerWasDry) this.events.push({ type: 'dry' }); this.triggerWasDry = true; this.cool = 0.25; return false; }
    this.triggerWasDry = false;
    st.ammo--;
    this.cool = this.def.interval * (0.96 + this.rng() * 0.08);
    const r = this.rng, rc = this.def.recoil * (1 - this.ads * 0.35);
    this.recoilT.kick(V((r() - 0.5) * 0.25 * rc, (0.15 + r() * 0.2) * rc, (1.6 + r() * 0.9) * rc));
    this.recoilR.kick(V((2.2 + r() * 2.2) * rc, (r() - 0.5) * 2.6 * rc, (r() - 0.5) * 3.2 * rc));
    if (this.current === 'pistol') this.slideBack = 1;
    return true;
  }

  // 매 프레임: aimQuat은 총이 향하는 월드 회전, anchor는 몸 기준점(카메라 위치), camQuat은 카메라 회전
  update(dt, t, p) {
    const r = this.rng;
    const def = this.def;
    this.ads += ((p.ads && !this.reload && !this.switchTo && p.sprint < 0.5 ? 1 : 0) - this.ads) * (1 - Math.exp(-dt * 11));
    this.sprint += ((p.sprint > 0.5 ? 1 : 0) - this.sprint) * (1 - Math.exp(-dt * 7));
    this.lower += ((p.wallDist < 0.8 ? 1 - Math.max(0, p.wallDist - 0.25) / 0.55 : 0) - this.lower) * (1 - Math.exp(-dt * 9));
    this.stress = Math.max(0, this.stress - dt * 0.08);
    // 파쿠르: 두 손으로 짚어야 하니 총을 무기 교체 때처럼 화면 아래로 내렸다가 끝나면 다시 든다
    this.stow += ((p.stow ? 1 : 0) - this.stow) * (1 - Math.exp(-dt * 10));

    // 무기 교체: 내리고(0.25 s) 바꾸고 올림
    let switchDrop = 0;
    if (this.switchTo) {
      this.switchT += dt;
      const half = 0.28;
      if (this.switchT < half) switchDrop = this.switchT / half;
      else { if (this.current !== this.switchTo) { this.setWeapon(this.switchTo); this.events.push({ type: 'switch' }); } switchDrop = Math.max(0, 1 - (this.switchT - half) / 0.32); if (this.switchT > half + 0.32) this.switchTo = null; }
    }

    // 재장전 진행
    let rl = { tilt: 0, pitch: 0, drop: 0, handL: null };
    const mdl = this.model;
    if (this.reload) {
      const R = this.reload; R.t += dt; const u = R.t / R.dur;
      const env = Math.sin(Math.min(1, u * 1.15) * Math.PI) ** 0.6;
      rl.tilt = R.tilt * env; rl.pitch = R.pitch * env; rl.drop = R.drop * env;
      if (!R.outDone && u > R.out) {
        R.outDone = true; mdl.mag.visible = false; this.events.push({ type: 'magOut', weapon: this.current });
        this.dropMag(mdl);
      }
      const lh = mdl.grips.L.palm.clone();
      const pouch = V(-0.12, -0.32, 0.1);
      const magWell = mdl.magPos.clone().add(V(0, -0.1, 0)), seated = magWell.clone().add(V(0, 0.06, 0));
      const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
      rl.handW = 1;
      if (u > R.out - 0.08 && u < R.reach) {
        const k = (u - (R.out - 0.08)) / (R.reach - R.out + 0.08), e = Math.sin(k * Math.PI * 0.5);
        rl.handL = lh.clone().lerp(pouch, e); rl.handW = e;
      } else if (u >= R.reach && u < R.insert) {
        const k = (u - R.reach) / (R.insert - R.reach);
        rl.handL = pouch.clone().lerp(magWell, k * k * (3 - 2 * k));
        if (R.fumble && k > 0.6 && k < 0.8) rl.handL.x += Math.sin(k * 40) * 0.01;
        this.showHeldMag(mdl, true);
      } else if (u >= R.insert && u < R.insert + 0.1) {
        rl.handL = magWell.clone().add(V(0, 0.06 * Math.min(1, (u - R.insert) / 0.04), 0));
        if (!R.slapped) { R.slapped = true; mdl.mag.visible = true; this.showHeldMag(mdl, false); this.events.push({ type: 'magIn', weapon: this.current }); this.recoilT.kick(V(0, 0.5, 0)); this.recoilR.kick(V(-0.8, 0, 1.2)); }
      } else if (u >= R.insert + 0.1 && R.empty && u < 0.93) {
        const k = (u - R.insert - 0.1) / (0.93 - R.insert - 0.1);
        const charge = this.current === 'rifle' ? V(0, 0.11, 0.12) : V(0, 0.06, -0.05);
        // 탄창을 밀어 넣은 자리에서 장전 손잡이로 갔다가 쥔 자리로 돌아온다
        if (k < 0.5) rl.handL = seated.clone().lerp(charge, Math.sin(k * Math.PI));
        else if (k < 0.7) rl.handL = charge.clone();
        else { const e = smooth((k - 0.7) / 0.3); rl.handL = charge.clone().lerp(lh, e); rl.handW = 1 - e; }
        if (!R.charged && k > 0.55) { R.charged = true; this.events.push({ type: 'charge', weapon: this.current }); this.recoilT.kick(V(0, 0, 0.6)); }
      } else if (u >= R.insert + 0.1 && !R.empty) {
        const span = Math.min(0.18, 0.98 - R.insert - 0.1), e = smooth((u - R.insert - 0.1) / span);
        if (e < 1) { rl.handL = seated.clone().lerp(lh, e); rl.handW = 1 - e; }
      }
      if (u >= 1) {
        const st = this.state[this.current];
        st.ammo = R.empty ? def.mag : def.mag + 1; st.spare--;
        this.reload = null; this.showHeldMag(mdl, false); mdl.mag.visible = true;
      }
    }

    // 총은 몸(가슴 카메라)에 붙은 두 팔이 든다. root는 카메라를 따르고, 총은 그 안에서
    //  - 조준 앞섬: 마우스가 먼저 움직인 만큼(몸이 따라오며 줄어든다) 어깨 쪽(개머리판 끝)을 축으로 앞서 돈다
    //  - 관성: 몸이 도는 속도가 바뀌면 팔에 든 총이 한 박자 늦는다(감쇠비 0.85라 멈출 때 크게 넘치지 않는다)
    //  - 카메라의 흔들림(걸음 충격, 피격)은 75%만 따르고, 카메라 반동은 따르지 않는다(총의 반동은 따로 있다)
    // 이전에는 총이 마우스 방향(aimQuat)에 붙고 카메라가 최대 10° 늦게 따라왔으며, 흔들림 스프링이 같은 쪽으로 13 cm를 더 밀어
    // 돌 때 총이 화면 폭의 4분의 1쯤 미끄러졌다(2026-11-15 사용자 지적, PROGRESS.md)
    const ld = 1 - this.ads * 0.85;
    const dYv = (p.camYawVel || 0) - (this.lastYawVel ?? (p.camYawVel || 0)), dPv = (p.camPitchVel || 0) - (this.lastPitchVel ?? (p.camPitchVel || 0));
    this.lastYawVel = p.camYawVel || 0; this.lastPitchVel = p.camPitchVel || 0;
    if (Math.abs(dYv) < 20 && Math.abs(dPv) < 20) this.leadSpring.kick(V(-dPv * 0.3 * ld, -dYv * 0.3 * ld, 0));
    const lead = this.leadSpring.step(dt, V(p.aimPitchOff || 0, (p.aimYawOff || 0) * ld, 0));
    const breath = (1 - this.ads * 0.6) * (0.003 + p.exertion * 0.006);
    const by = Math.sin(t * (1.6 + p.exertion * 1.8)) * breath, bx = noise1(t * 0.6, 3) * breath * 1.2;
    const stepAmp = p.moving * (0.036 + this.sprint * 0.03) * (1 - this.ads * 0.5);
    // 떠도는 자세: 손은 총을 같은 자리에 붙들고 있지 않다. 몇 초 단위로 높이, 좌우, 기울기가 바뀐다(조준할수록 줄어든다)
    const hp = t + this.holdPhase, hold = 1 - this.ads * 0.8;
    const dX = noise1(hp * 0.21, 31) * 0.035 * hold, dY = noise1(hp * 0.17, 32) * 0.03 * hold, dRoll = noise1(hp * 0.19, 33) * 0.16 * hold, dPitch = noise1(hp * 0.23, 34) * 0.02 * hold;
    const sx = Math.sin(p.stepPhase * Math.PI) * stepAmp * 0.8, sy = -Math.abs(Math.sin(p.stepPhase * Math.PI)) * stepAmp;

    const rt = this.recoilT.step(dt), rr = this.recoilR.step(dt);
    const base = def.hip.clone().lerp(def.ads, this.ads).lerp(def.sprint, this.sprint);
    const drop = switchDrop, sw = this.stow * this.stow * (3 - 2 * this.stow);
    const pos = base.add(V(bx + sx + dX + sw * 0.09, by + sy + dY - rl.drop - this.lower * 0.06 - drop * 0.25 - sw * 0.14, rt.z * 0.045 + this.lower * 0.06 + Math.abs(sy) * 0.4));
    pos.x += rt.x * 0.02; pos.y += rt.y * 0.02;
    const sh = p.shake || [0, 0, 0], rc = p.camRecoil || [0, 0, 0];

    // 총 회전(총 기준): 반동, 달리기 자세, 벽 앞에서 내림, 재장전 기울임
    // 걸음마다 총끝이 흔들린다: 몸은 가슴 카메라와 함께 움직이지만 두 팔에 든 총은 한 박자 늦게 끄덕이고 좌우로 돈다(조준할수록 줄어든다)
    const walkK = p.moving * (1 - this.ads * 0.7) * (1 + this.sprint * 0.6);
    const wPitch = Math.sin(p.stepPhase * Math.PI * 2 + 0.9) * 0.03 * walkK, wYaw = Math.sin(p.stepPhase * Math.PI + 0.5) * 0.035 * walkK;
    const rotX = rr.x * 0.05 - this.sprint * 0.55 - this.lower * 0.75 - drop * 0.9 - sw * 1.0 + rl.pitch + dPitch + wPitch - sh[0] * 0.25 - rc[0];
    const rotY = rr.y * 0.035 + this.sprint * 0.55 + wYaw - sh[1] * 0.25 - rc[1] - sw * 0.5;
    // 비스듬히 기울여 든다(cant). 조준하면 바로 세운다. 카메라가 걸음에 따라 기울면 총은 그 25%만큼 늦는다
    const rotZ = rr.z * 0.035 + sx * 4 + this.sprint * 0.45 + rl.tilt - sh[2] * 0.25 - rc[2] + (def.cant || 0) * (1 - this.ads) + dRoll + sw * 0.5;

    // 뛰고 내릴 때의 관성: 몸이 위로 가속하면 두 팔에 든 총은 한 박자 늦게 처지고, 공중에서는 살짝 뜨고, 착지하면 다시 처진다
    const vy = p.vy || 0, dvy = vy - (this.lastVy ?? vy); this.lastVy = vy;
    this.vSpring.kick(V(0, -dvy * 0.03, 0));
    pos.y += this.vSpring.step(dt).y;
    // 볼 받침: 조준경을 들여다보면 뺨이 개머리판에 붙어 눈(카메라)이 사출동공 가까이 머문다.
    // 흔들림, 걸음, 반동이 총을 밀어도 눈과 사출동공의 어긋남은 일부(조준 끝에서 12%)만 남는다. 남은 만큼 조준경 그림자가 생긴다
    const piv = this.current === 'rifle' ? PIVOT.rifle : PIVOT.pistol;
    const qLead = new THREE.Quaternion().setFromEuler(new THREE.Euler(lead.x, lead.y, 0, 'YXZ'));
    if (mdl.eyePoint && this.ads > 0.001) {
      // 눈점을 카메라(root) 기준으로 구해(어깨 축의 회전까지) 그만큼 총을 되민다
      const e = mdl.eyePoint.clone().applyEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')).add(pos).sub(piv).applyQuaternion(qLead).add(piv);
      pos.addScaledVector(e.applyQuaternion(qLead.clone().invert()), -this.ads * this.ads * 0.88);
    }

    // root = 카메라(몸). leadPivot = 어깨 쪽 축에서 조준 앞섬과 관성만큼 돈다. gunHolder = 총의 자세
    this.root.position.copy(p.anchor);
    this.root.quaternion.copy(p.camQuat || p.aimQuat);
    this.leadPivot.position.copy(piv);
    this.leadPivot.quaternion.copy(qLead);
    this.gunHolder.position.copy(pos).sub(piv);
    this.gunHolder.rotation.set(rotX, rotY, rotZ, 'YXZ');

    if (this.current === 'pistol' && this.models.pistol.slide) {
      this.slideBack = Math.max(0, (this.slideBack || 0) - dt * 22);
      this.models.pistol.slide.position.z = -0.06 + this.slideBack * 0.03 + (this.state.pistol.ammo === 0 ? 0.03 : 0);
    }

    // 손과 팔. 오른손은 늘 권총손잡이를 쥔다
    this.root.updateMatrixWorld(true);
    const gr = mdl.grips;
    this.handR.position.copy(gr.R.p); this.handR.quaternion.copy(gr.R.q);
    setPose(this.hR.sk, gr.R.pose);
    // 왼손: 쥔 자리 → (재장전) 탄창을 쥔 손바닥이 rl.handL로 간다 → (파쿠르) 장애물 윗면 모서리를 짚는다(월드에 고정)
    let lp = gr.L.p.clone(), lq = gr.L.q.clone(), lpose = gr.L.pose;
    if (rl.handL) {
      const w = rl.handW ?? 1;
      lq.slerp(gr.L.rq, w);
      lp = rl.handL.clone().sub(PALM.clone().applyQuaternion(lq));
      lpose = lerpPose(gr.L.pose, GRAB, w);
    }
    const pk = p.plant;
    this.plantW = pk ? pk.w : Math.max(0, this.plantW - dt * 8);
    if (pk && pk.w > 0) {
      // 손바닥이 윗면에 닿고, 손등은 위, 손가락은 넘는 쪽으로 뻗되 조금 안쪽(오른쪽)으로 돈다. 손은 월드에 머물고 몸이 그 위를 지나간다
      const fwd = V(pk.fx, 0, pk.fz), right = V(-pk.fz, 0, pk.fx);
      const mw = wristFrame(V(0, 1, 0), fwd.multiplyScalar(0.94).addScaledVector(right, 0.34), pk.pos.clone().add(V(0, 0.003, 0)));
      const ml = new THREE.Matrix4().copy(this.gunHolder.matrixWorld).invert().multiply(mw);
      const pp = V(0, 0, 0), pq = new THREE.Quaternion(), ps = V(1, 1, 1); ml.decompose(pp, pq, ps);
      const w = pk.w * pk.w * (3 - 2 * pk.w);
      lp.lerp(pp, w); lq.slerp(pq, w); lpose = lerpPose(lpose, PLANT, w);
    }
    this.handL.position.copy(lp); this.handL.quaternion.copy(lq);
    setPose(this.hL.sk, lpose);
    this.root.updateMatrixWorld(true);
    this.handLWorld = this.handL.localToWorld(PALM.clone());
    this.planted = !!(pk && pk.w > 0.9);
    const rootQ = this.root.quaternion;
    // 팔꿈치는 화면 밖 왼쪽 아래와 오른쪽 아래에 있다. 왼팔은 화면 왼쪽 아래에서 비스듬히 건너와 핸드가드를 받친다.
    // 짚을 때 왼팔은 곧게 뻗으므로 소매가 어깨(카메라 왼쪽 위 뒤)에서 손목까지 이어진다
    const elbowR = V(0.24, -0.36, 0.14).applyQuaternion(rootQ).add(this.root.position);
    const elbowL = (this.current === 'rifle' ? V(-0.18, -0.32, -0.21) : V(-0.24, -0.38, 0.06)).applyQuaternion(rootQ).add(this.root.position);
    if (this.plantW > 0) { const k = this.plantW * this.plantW * (3 - 2 * this.plantW); elbowL.lerp(V(-0.2, 0.02, 0.1).applyQuaternion(rootQ).add(this.root.position), k); }
    // 소매 끝은 장갑 소맷부리의 뒤쪽 절반을 덮는다
    const wristR = this.handR.localToWorld(V(0, 0, 0.042));
    const wristL = this.handL.localToWorld(V(0, 0, 0.042));
    placeLimb(this.foreR, elbowR, wristR); placeLimb(this.foreL, elbowL, wristL);

    mdl.muzzle.getWorldPosition(this.muzzleWorld);
    this.dirWorld.set(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(mdl.muzzle.matrixWorld)).normalize();

    for (const m of this.droppedMags) {
      if (m.rest) continue;
      m.v.y -= 9.8 * dt; m.m.position.addScaledVector(m.v, dt); m.m.rotation.x += m.spin * dt;
      const gh = p.level.groundHeight(m.m.position.x, m.m.position.z, m.m.position.y + 0.05, 0, 0.1);
      if (m.m.position.y < gh + 0.02) { m.m.position.y = gh + 0.02; if (!m.landed) { m.landed = true; this.events.push({ type: 'magDrop', pos: m.m.position.clone(), mat: p.level.floorMaterial(m.m.position.x, gh, m.m.position.z) }); } m.v.multiplyScalar(0.25); m.v.y = Math.abs(m.v.y) * 0.2; m.spin *= 0.3; if (m.v.length() < 0.2) m.rest = true; }
    }
  }

  dropMag(mdl) {
    const m = mdl.mag.clone(true); m.visible = true;
    mdl.mag.getWorldPosition(m.position); mdl.mag.getWorldQuaternion(m.quaternion);
    this.root.parent.add(m);
    const v = V(0, -1.2, 0).add(V((this.rng() - 0.5) * 0.6, 0, (this.rng() - 0.5) * 0.6));
    this.droppedMags.push({ m, v, spin: (this.rng() - 0.5) * 12, rest: false });
    if (this.droppedMags.length > 8) { const o = this.droppedMags.shift(); o.m.parent?.remove(o.m); }
  }
  showHeldMag(mdl, on) {
    // 쥔 손가락 안에 탄창 몸통이 있고 윗부분(급탄구)이 엄지 쪽으로 나온다
    if (on && !this.heldMag) { this.heldMag = mdl.mag.clone(true); this.heldMag.visible = true; this.handL.add(this.heldMag); this.heldMag.position.set(0.012, -0.04, -0.072); this.heldMag.rotation.set(0, 0, -Math.PI / 2); }
    if (!on && this.heldMag) { this.handL.remove(this.heldMag); this.heldMag = null; }
  }

  ejectCasing(fx, bodyVel) {
    const mdl = this.model;
    const p = new THREE.Vector3(); mdl.ejection.getWorldPosition(p);
    const q = new THREE.Quaternion(); mdl.ejection.getWorldQuaternion(q);
    const v = V(1.6 + this.rng() * 1.2, 1.0 + this.rng() * 0.9, 0.3 + this.rng() * 0.5).applyQuaternion(q).add(bodyVel);
    fx.casing(p, v, this.current === 'rifle' ? 'rifle' : 'pistol');
  }
}

export { WEAPONS };
