// 1인칭 총과 팔: 절차 모델, 반동·흔들림·재장전 애니메이션 (매번 조금씩 다르게)
import * as THREE from 'three';
import { bcMaterial } from './materials.js';
import { noise1 } from './rng.js';
import { buildScope, SCOPE } from './scope.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

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
    // 조준경 몸통: 무광 검정 아노다이징 알루미늄. 총의 강철보다 조금 더 검고 매끈하다
    scopeBody: bcMaterial({ map: wearTexture('#191b1c', 17), roughness: 0.4, metalness: 0.3, envMapIntensity: 0.3, specularIntensity: 0.55 }, { grime: 0, physical: true }),
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
  part(g, M.tan, [0.032, 0.105, 0.046], [0, -0.035, 0.035], [0.32, 0, 0]); // 권총손잡이
  part(g, M.polymer, [0.012, 0.008, 0.06], [0, -0.008, -0.03]);         // 방아쇠울
  part(g, M.steel, [0.004, 0.022, 0.006], [0, 0.002, -0.022], [0.3, 0, 0]); // 방아쇠
  part(g, M.worn, [0.006, 0.012, 0.02], [0.027, 0.04, -0.005]);         // 조정간
  const mag = new THREE.Group();
  part(mag, M.tan, [0.027, 0.11, 0.068], [0, -0.05, 0], [-0.12, 0, 0]);
  part(mag, M.tan, [0.027, 0.09, 0.064], [0, -0.135, 0.018], [-0.32, 0, 0]);
  for (let i = 0; i < 4; i++) part(mag, M.polymer, [0.029, 0.006, 0.05], [0, -0.03 - i * 0.03, 0.002 + i * 0.005], [-0.15 - i * 0.05, 0, 0]);
  part(mag, M.polymer, [0.03, 0.014, 0.075], [0, -0.182, 0.035], [-0.32, 0, 0]);
  mag.position.set(0, 0.0, -0.13);
  g.add(mag);
  cylPart(g, M.steel, 0.016, 0.22, [0, 0.072, 0.17]);                   // 완충관
  part(g, M.tan, [0.044, 0.088, 0.15], [0, 0.044, 0.27]);              // 개머리판
  part(g, M.polymer, [0.046, 0.094, 0.02], [0, 0.044, 0.35]);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.072, -0.83); g.add(muzzle);
  const ejection = new THREE.Object3D(); ejection.position.set(0.03, 0.088, -0.05); g.add(ejection);
  return { group: g, mag, muzzle, ejection, scope, eyePoint: SCOPE.pupil.clone(),
    // 손 위치·회전(총 기준)
    rightHand: V(0.034, -0.03, 0.055), rightQ: new THREE.Euler(0.32, 0, -Math.PI / 2, 'ZYX'),
    // 왼손은 핸드가드 밑을 받친다: 손등이 아래, 손가락이 오른쪽으로 뻗어 핸드가드 오른쪽 옆을 감아 올라간다
    leftHand: V(-0.02, 0.022, -0.37), leftQ: new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, -1), V(0, -1, 0), V(-1, 0, 0))),
    rightCurl: [0.15, 1.25, 1.35, 1.4], leftCurl: [1.25, 1.3, 1.3, 1.25],
    magPos: mag.position.clone() };
}

function buildPistol(M) {
  const g = new THREE.Group();
  const slide = part(g, M.steel, [0.03, 0.032, 0.19], [0, 0.058, -0.06]);   // 슬라이드
  for (let i = 0; i < 6; i++) part(slide, M.polymer, [0.031, 0.024, 0.003], [0, 0, 0.07 + i * 0.006]); // 톱니
  part(g, M.polymer, [0.028, 0.025, 0.16], [0, 0.03, -0.05]); // 프레임
  part(g, M.polymer, [0.031, 0.11, 0.05], [0, -0.03, 0.02], [0.26, 0, 0]); // 손잡이
  part(g, M.polymer, [0.01, 0.008, 0.045], [0, 0.005, -0.03]);
  part(g, M.steel, [0.006, 0.01, 0.006], [0, 0.079, -0.145]);
  part(g, M.steel, [0.022, 0.01, 0.008], [0, 0.079, 0.025]);
  const mag = new THREE.Group(); part(mag, M.steel, [0.024, 0.02, 0.04], [0, 0, 0]); mag.position.set(0, -0.085, 0.035); g.add(mag);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.058, -0.16); g.add(muzzle);
  const ejection = new THREE.Object3D(); ejection.position.set(0.02, 0.07, -0.03); g.add(ejection);
  return { group: g, mag, muzzle, ejection, slide, sightY: 0.08,
    rightHand: V(0.03, -0.025, 0.04), rightQ: new THREE.Euler(0.26, 0, -Math.PI / 2, 'ZYX'),
    leftHand: V(-0.032, -0.03, 0.035), leftQ: new THREE.Euler(0.26, 0, Math.PI / 2, 'ZYX'),
    rightCurl: [0.2, 1.3, 1.4, 1.45], leftCurl: [1.2, 1.25, 1.3, 1.3],
    magPos: mag.position.clone() };
}

// 장갑 낀 손: 손바닥(손등 +y, 손가락 -z) + 마디 세 개짜리 손가락 넷 + 엄지
function buildHand(M, mirror = false) {
  const h = new THREE.Group();
  part(h, M.glove, [0.084, 0.03, 0.09], [0, 0, 0]);
  part(h, M.gloveKnuckle, [0.08, 0.012, 0.03], [0, 0.017, -0.03]);           // 손등 보호대
  part(h, M.cuff, [0.074, 0.04, 0.04], [0, 0.002, 0.058]);                  // 손목 조임
  h.userData.fingers = [];
  for (let i = 0; i < 4; i++) {
    const root = new THREE.Group(); root.position.set(-0.03 + i * 0.02, -0.002, -0.045); h.add(root);
    const lens = [0.042 - Math.abs(i - 1.3) * 0.004, 0.028, 0.022];
    let parent = root; const segs = [];
    for (let k = 0; k < 3; k++) {
      const seg = new THREE.Group(); parent.add(seg); if (k > 0) seg.position.z = -lens[k - 1];
      part(seg, M.glove, [0.019, 0.02, lens[k] + 0.004], [0, 0, -lens[k] / 2]);
      segs.push(seg); parent = seg;
    }
    h.userData.fingers.push(segs);
  }
  const th = new THREE.Group(); th.position.set(0.04, -0.008, 0.01); th.rotation.set(-0.3, -0.7, -0.5); h.add(th);
  part(th, M.glove, [0.022, 0.021, 0.04], [0, 0, -0.02]);
  const th2 = new THREE.Group(); th2.position.z = -0.04; th2.rotation.x = -0.5; th.add(th2);
  part(th2, M.glove, [0.02, 0.02, 0.03], [0, 0, -0.015]);
  h.userData.thumb = th;
  if (mirror) h.scale.x = -1;
  return h;
}
function curlHand(h, curls) {
  h.userData.fingers.forEach((segs, i) => { const c = curls[i]; segs[0].rotation.x = -c * 0.55; segs[1].rotation.x = -c * 0.75; segs[2].rotation.x = -c * 0.6; });
}

const WEAPONS = {
  rifle: { mag: 30, spareMags: 4, interval: 0.088, auto: true, reload: 2.35, recoil: 1.0, kind: 'rifle', damage: 1, spread: 0.0016,
    // 조준 자세: 카메라(눈)가 조준경의 사출동공에 오도록 총을 놓는다 → 광축 높이 0.152 아래, 사출동공(z 0.28) 앞
    hip: V(0.162, -0.232, -0.34), ads: V(0.0, -SCOPE.axisY, -(SCOPE.eyeZ + SCOPE.relief)), sprint: V(0.07, -0.28, -0.24), cant: 0.06 },
  pistol: { mag: 15, spareMags: 3, interval: 0.13, auto: false, reload: 1.75, recoil: 0.8, kind: 'pistol', damage: 0.85, spread: 0.003,
    hip: V(0.09, -0.21, -0.32), ads: V(0.0, -0.085, -0.36), sprint: V(0.06, -0.28, -0.2), cant: 0.06 },
};

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
    this.gunHolder = new THREE.Group();
    this.root.add(this.gunHolder);
    for (const k in this.models) { this.gunHolder.add(this.models[k].group); this.models[k].group.visible = false; }
    this.handR = buildHand(this.M); this.handL = buildHand(this.M, true);
    this.gunHolder.add(this.handR, this.handL);
    this.foreR = limb(this.M.sleeve, 0.042, 0.06, 1); this.foreL = limb(this.M.sleeve, 0.042, 0.06, 1);
    this.cuffR = limb(this.M.cuff, 0.041, 0.041); this.cuffL = limb(this.M.cuff, 0.041, 0.041);
    scene.add(this.foreR, this.foreL, this.cuffR, this.cuffL);
    for (const m of [this.foreR, this.foreL, this.cuffR, this.cuffL]) m.frustumCulled = false;
    this.heldMag = null;
    this.state = {
      rifle: { ammo: WEAPONS.rifle.mag, spare: WEAPONS.rifle.spareMags },
      pistol: { ammo: WEAPONS.pistol.mag, spare: WEAPONS.pistol.spareMags },
    };
    this.current = 'rifle';
    this.models.rifle.group.visible = true;
    this.recoilT = new Spring(150, 13);   // 위치 반동
    this.recoilR = new Spring(110, 11);   // 회전 반동
    this.swaySpring = new Spring(48, 8.5);
    this.vSpring = new Spring(70, 9);     // 점프와 착지의 위아래 관성
    this.holdPhase = 0;   // 떠도는 자세의 위상. 생명마다 다르다(Game.reset이 정한다)
    this.ads = 0; this.sprint = 0; this.lower = 0; this.switchT = 0; this.switchTo = null;
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
    if (!pressed || !canFire || this.reload || this.switchTo || this.cool > 0 || this.sprint > 0.4) return false;
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
      const lh = mdl.leftHand.clone();
      const pouch = V(-0.12, -0.32, 0.1);
      const magWell = mdl.magPos.clone().add(V(0, -0.1, 0));
      if (u > R.out - 0.08 && u < R.reach) {
        const k = (u - (R.out - 0.08)) / (R.reach - R.out + 0.08);
        rl.handL = lh.lerp(pouch, Math.sin(k * Math.PI * 0.5));
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
        rl.handL = mdl.leftHand.clone().lerp(charge, Math.sin(Math.min(1, k * 2) * Math.PI * 0.5) * (1 - Math.max(0, k - 0.7) / 0.3));
        if (!R.charged && k > 0.55) { R.charged = true; this.events.push({ type: 'charge', weapon: this.current }); this.recoilT.kick(V(0, 0, 0.6)); }
      }
      if (u >= 1) {
        const st = this.state[this.current];
        st.ammo = R.empty ? def.mag : def.mag + 1; st.spare--;
        this.reload = null; this.showHeldMag(mdl, false); mdl.mag.visible = true;
      }
    }

    // 흔들림: 카메라 회전 속도에 반대로 끌리는 관성 + 호흡 + 걸음
    const swayTarget = V(-p.camYawVel * 0.032, p.camPitchVel * 0.024, 0);
    swayTarget.x = Math.max(-0.13, Math.min(0.13, swayTarget.x)); swayTarget.y = Math.max(-0.09, Math.min(0.09, swayTarget.y));
    const sway = this.swaySpring.step(dt, swayTarget);
    const breath = (1 - this.ads * 0.6) * (0.003 + p.exertion * 0.006);
    const by = Math.sin(t * (1.6 + p.exertion * 1.8)) * breath, bx = noise1(t * 0.6, 3) * breath * 1.2;
    const stepAmp = p.moving * (0.036 + this.sprint * 0.03) * (1 - this.ads * 0.5);
    // 떠도는 자세: 손은 총을 같은 자리에 붙들고 있지 않다. 몇 초 단위로 높이, 좌우, 기울기가 바뀐다(조준할수록 줄어든다)
    const hp = t + this.holdPhase, hold = 1 - this.ads * 0.8;
    const dX = noise1(hp * 0.21, 31) * 0.035 * hold, dY = noise1(hp * 0.17, 32) * 0.03 * hold, dRoll = noise1(hp * 0.19, 33) * 0.16 * hold, dPitch = noise1(hp * 0.23, 34) * 0.02 * hold;
    const sx = Math.sin(p.stepPhase * Math.PI) * stepAmp * 0.8, sy = -Math.abs(Math.sin(p.stepPhase * Math.PI)) * stepAmp;

    const rt = this.recoilT.step(dt), rr = this.recoilR.step(dt);
    const base = def.hip.clone().lerp(def.ads, this.ads).lerp(def.sprint, this.sprint);
    const pos = base.add(V(sway.x + bx + sx + dX, sway.y + by + sy + dY - rl.drop - this.lower * 0.06 - switchDrop * 0.25, rt.z * 0.045 + this.lower * 0.06 + Math.abs(sy) * 0.4));
    pos.x += rt.x * 0.02; pos.y += rt.y * 0.02;

    // 총 회전(총 기준): 반동, 달리기 자세, 벽 앞에서 내림, 재장전 기울임
    // 걸음마다 총끝이 흔들린다: 몸은 가슴 카메라와 함께 움직이지만 두 팔에 든 총은 한 박자 늦게 끄덕이고 좌우로 돈다(조준할수록 줄어든다)
    const walkK = p.moving * (1 - this.ads * 0.7) * (1 + this.sprint * 0.6);
    const wPitch = Math.sin(p.stepPhase * Math.PI * 2 + 0.9) * 0.03 * walkK, wYaw = Math.sin(p.stepPhase * Math.PI + 0.5) * 0.035 * walkK;
    const rotX = rr.x * 0.05 - this.sprint * 0.55 - this.lower * 0.75 - switchDrop * 0.9 + rl.pitch + sway.y * 1.5 + dPitch + wPitch;
    const rotY = rr.y * 0.035 + this.sprint * 0.55 + sway.x * -2.0 + wYaw;
    // 비스듬히 기울여 든다(cant). 조준하면 바로 세운다
    const rotZ = rr.z * 0.035 + sx * 4 + this.sprint * 0.45 + rl.tilt + p.roll * 0.4 + (def.cant || 0) * (1 - this.ads) + dRoll;

    // 뛰고 내릴 때의 관성: 몸이 위로 가속하면 두 팔에 든 총은 한 박자 늦게 처지고, 공중에서는 살짝 뜨고, 착지하면 다시 처진다
    const vy = p.vy || 0, dvy = vy - (this.lastVy ?? vy); this.lastVy = vy;
    this.vSpring.kick(V(0, -dvy * 0.03, 0));
    pos.y += this.vSpring.step(dt).y;
    // 볼 받침: 조준경을 들여다보면 뺨이 개머리판에 붙어 눈(카메라)이 사출동공 가까이 머문다.
    // 흔들림, 걸음, 반동이 총을 밀어도 눈과 사출동공의 어긋남은 일부(조준 끝에서 12%)만 남는다. 남은 만큼 조준경 그림자가 생긴다
    if (mdl.eyePoint && this.ads > 0.001) {
      const e = mdl.eyePoint.clone().applyEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')).add(pos);
      pos.addScaledVector(e, -this.ads * this.ads * 0.88);
    }

    // root = 총 조준 방향 (aimQuat), anchor에서 pos만큼 떨어짐
    this.root.position.copy(p.anchor);
    this.root.quaternion.copy(p.aimQuat);
    this.gunHolder.position.copy(pos);
    this.gunHolder.rotation.set(rotX, rotY, rotZ, 'YXZ');

    if (this.current === 'pistol' && this.models.pistol.slide) {
      this.slideBack = Math.max(0, (this.slideBack || 0) - dt * 22);
      this.models.pistol.slide.position.z = -0.06 + this.slideBack * 0.03 + (this.state.pistol.ammo === 0 ? 0.03 : 0);
    }

    // 손과 팔
    this.root.updateMatrixWorld(true);
    const lhLocal = rl.handL || mdl.leftHand;
    this.handR.position.copy(mdl.rightHand); this.handR.rotation.copy(mdl.rightQ);
    this.handL.position.copy(lhLocal); this.handL.rotation.copy(mdl.leftQ);
    if (rl.handL) { this.handL.rotation.x += 0.5; }
    curlHand(this.handR, mdl.rightCurl); curlHand(this.handL, rl.handL ? [0.9, 0.9, 0.9, 0.9] : mdl.leftCurl);
    this.root.updateMatrixWorld(true);
    const rootQ = this.root.quaternion;
    // 팔꿈치는 화면 밖 왼쪽 아래와 오른쪽 아래에 있다. 왼팔은 화면 왼쪽 아래에서 비스듬히 건너와 핸드가드를 받친다
    const elbowR = V(0.24, -0.36, 0.14).applyQuaternion(rootQ).add(this.root.position);
    const elbowL = V(-0.24, -0.38, this.current === 'rifle' ? -0.1 : 0.06).applyQuaternion(rootQ).add(this.root.position);
    const wristR = this.handR.localToWorld(V(0, 0.0, 0.07));
    const wristL = this.handL.localToWorld(V(0, 0.0, 0.07));
    placeLimb(this.foreR, elbowR, wristR); placeLimb(this.foreL, elbowL, wristL);
    placeLimb(this.cuffR, wristR, wristR.clone().lerp(elbowR, 0.13));
    placeLimb(this.cuffL, wristL, wristL.clone().lerp(elbowL, 0.13));

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
    if (on && !this.heldMag) { this.heldMag = mdl.mag.clone(true); this.heldMag.visible = true; this.handL.add(this.heldMag); this.heldMag.position.set(0.0, 0.06, -0.02); this.heldMag.rotation.set(0.2, 0, 0); }
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
