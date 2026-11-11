// 1인칭 총과 팔: 절차 모델, 반동·흔들림·재장전 애니메이션 (매번 조금씩 다르게)
import * as THREE from 'three';
import { bcMaterial } from './materials.js';
import { noise1 } from './rng.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function part(group, mat, size, pos, rot = [0, 0, 0]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  m.position.set(...pos); m.rotation.set(...rot);
  group.add(m); return m;
}
function cylPart(group, mat, r, len, pos, axis = 'z', seg = 10, r2) {
  const g = new THREE.CylinderGeometry(r2 ?? r, r, len, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat); m.position.set(...pos); group.add(m); return m;
}

// 두 점 사이를 잇는 원기둥(팔)
function limb(mat, r0, r1) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, 10, 1); g.translate(0, 0.5, 0);
  return new THREE.Mesh(g, mat);
}
const _up = V(0, 1, 0), _d = V(0, 0, 0), _q = new THREE.Quaternion();
function placeLimb(m, a, b) {
  _d.subVectors(b, a); const L = _d.length();
  m.position.copy(a); _q.setFromUnitVectors(_up, _d.divideScalar(L)); m.quaternion.copy(_q); m.scale.set(1, L, 1);
}

export function buildMaterials() {
  return {
    polymer: bcMaterial({ color: 0x2c2d2b, roughness: 0.6, metalness: 0.05 }, { grime: 0 }),
    steel: bcMaterial({ color: 0x3a3c3d, roughness: 0.45, metalness: 0.35 }, { grime: 0 }),
    worn: bcMaterial({ color: 0x66686a, roughness: 0.35, metalness: 0.5 }, { grime: 0 }),
    tan: bcMaterial({ color: 0x8a7a5c, roughness: 0.72, metalness: 0.02 }, { grime: 0 }),
    glove: bcMaterial({ color: 0x34332f, roughness: 0.9 }, { grime: 0 }),
    gloveKnuckle: bcMaterial({ color: 0x343431, roughness: 0.75 }, { grime: 0 }),
    sleeve: bcMaterial({ color: 0x5a5d4a, roughness: 1.0 }, { grime: 0 }),
    cuff: bcMaterial({ color: 0x2f3128, roughness: 1.0 }, { grime: 0 }),
  };
}

function buildRifle(M) {
  const g = new THREE.Group();
  // 원점 = 권총손잡이 윗부분(오른손 위치). -z가 총구 방향
  part(g, M.steel, [0.052, 0.062, 0.30], [0, 0.035, -0.07]);            // 하부 리시버
  part(g, M.steel, [0.056, 0.05, 0.36], [0, 0.085, -0.09]);             // 상부 리시버
  part(g, M.tan, [0.062, 0.072, 0.30], [0, 0.07, -0.37]);             // 핸드가드
  for (let i = 0; i < 5; i++) part(g, M.steel, [0.062, 0.012, 0.035], [0, 0.07, -0.26 - i * 0.055]); // 레일 홈
  cylPart(g, M.steel, 0.0095, 0.26, [0, 0.07, -0.64]);                  // 총열
  cylPart(g, M.steel, 0.014, 0.05, [0, 0.07, -0.79], 'z', 8);          // 소염기
  part(g, M.steel, [0.012, 0.055, 0.012], [0, 0.125, -0.5]);           // 가늠쇠
  part(g, M.steel, [0.03, 0.04, 0.03], [0, 0.125, 0.04]);              // 가늠자
  part(g, M.steel, [0.035, 0.015, 0.05], [0, 0.112, 0.08]);            // 장전 손잡이
  part(g, M.tan, [0.03, 0.105, 0.045], [0, -0.035, 0.035], [0.32, 0, 0]); // 권총손잡이
  part(g, M.polymer, [0.012, 0.03, 0.05], [0, -0.005, -0.03]);          // 방아쇠울
  const mag = new THREE.Group();
  part(mag, M.tan, [0.026, 0.11, 0.07], [0, -0.05, 0], [-0.12, 0, 0]);
  part(mag, M.tan, [0.026, 0.09, 0.065], [0, -0.135, 0.018], [-0.32, 0, 0]);
  mag.position.set(0, 0.0, -0.13);
  g.add(mag);
  cylPart(g, M.steel, 0.016, 0.24, [0, 0.07, 0.17]);                    // 완충관
  part(g, M.tan, [0.042, 0.085, 0.14], [0, 0.04, 0.27]);            // 개머리판
  part(g, M.tan, [0.044, 0.02, 0.06], [0, 0.0, 0.31]);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.07, -0.82); g.add(muzzle);
  const ejection = new THREE.Object3D(); ejection.position.set(0.03, 0.085, -0.05); g.add(ejection);
  return { group: g, mag, muzzle, ejection, sightY: 0.125,
    rightHand: V(0.012, -0.035, 0.04), leftHand: V(-0.05, 0.05, -0.36), magPos: mag.position.clone() };
}

function buildPistol(M) {
  const g = new THREE.Group();
  part(g, M.steel, [0.03, 0.032, 0.19], [0, 0.058, -0.06]);   // 슬라이드
  part(g, M.polymer, [0.028, 0.025, 0.16], [0, 0.03, -0.05]); // 프레임
  part(g, M.polymer, [0.03, 0.11, 0.05], [0, -0.03, 0.02], [0.26, 0, 0]); // 손잡이
  part(g, M.polymer, [0.01, 0.025, 0.04], [0, 0.005, -0.03]);
  part(g, M.steel, [0.008, 0.01, 0.008], [0, 0.079, -0.145]);
  part(g, M.steel, [0.022, 0.01, 0.008], [0, 0.079, 0.025]);
  const mag = new THREE.Group(); part(mag, M.steel, [0.024, 0.02, 0.04], [0, 0, 0]); mag.position.set(0, -0.085, 0.035); g.add(mag);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.058, -0.16); g.add(muzzle);
  const ejection = new THREE.Object3D(); ejection.position.set(0.02, 0.07, -0.03); g.add(ejection);
  const slide = g.children[0];
  return { group: g, mag, muzzle, ejection, slide, sightY: 0.08, rightHand: V(0, -0.02, 0.02), leftHand: V(-0.03, -0.025, 0.0), magPos: mag.position.clone() };
}

function buildHand(M) {
  const h = new THREE.Group();
  part(h, M.glove, [0.085, 0.035, 0.1], [0, 0, 0]);
  part(h, M.gloveKnuckle, [0.088, 0.02, 0.035], [0, 0.02, -0.035]);
  for (let i = 0; i < 4; i++) part(h, M.glove, [0.019, 0.022, 0.06], [-0.031 + i * 0.021, -0.012, -0.075], [-0.9, 0, 0]);
  part(h, M.glove, [0.022, 0.022, 0.06], [0.05, -0.005, -0.02], [0, 0.6, 0]);
  return h;
}

const WEAPONS = {
  rifle: { mag: 30, spareMags: 4, interval: 0.088, auto: true, reload: 2.35, recoil: 1.0, kind: 'rifle', damage: 1, spread: 0.0016,
    hip: V(0.16, -0.19, -0.36), ads: V(0.0, -0.105, -0.27), sprint: V(0.06, -0.24, -0.3) },
  pistol: { mag: 15, spareMags: 3, interval: 0.13, auto: false, reload: 1.75, recoil: 0.8, kind: 'pistol', damage: 0.85, spread: 0.003,
    hip: V(0.09, -0.19, -0.33), ads: V(0.0, -0.085, -0.36), sprint: V(0.06, -0.27, -0.2) },
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
    this.handR = buildHand(this.M); this.handL = buildHand(this.M);
    scene.add(this.handR, this.handL);
    this.foreR = limb(this.M.sleeve, 0.04, 0.05); this.foreL = limb(this.M.sleeve, 0.04, 0.05);
    this.cuffR = limb(this.M.cuff, 0.037, 0.037); this.cuffL = limb(this.M.cuff, 0.037, 0.037);
    scene.add(this.foreR, this.foreL, this.cuffR, this.cuffL);
    for (const m of [this.foreR, this.foreL, this.cuffR, this.cuffL]) m.frustumCulled = false;
    this.heldMag = null;
    this.state = {
      rifle: { ammo: WEAPONS.rifle.mag, spare: WEAPONS.rifle.spareMags },
      pistol: { ammo: WEAPONS.pistol.mag, spare: WEAPONS.pistol.spareMags },
    };
    this.current = 'rifle';
    this.models.rifle.group.visible = true;
    this.recoilT = new Spring(260, 22);   // 위치 반동
    this.recoilR = new Spring(200, 17);   // 회전 반동
    this.swaySpring = new Spring(70, 11);
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
    const swayTarget = V(-p.camYawVel * 0.012, p.camPitchVel * 0.01, 0);
    swayTarget.x = Math.max(-0.05, Math.min(0.05, swayTarget.x)); swayTarget.y = Math.max(-0.04, Math.min(0.04, swayTarget.y));
    const sway = this.swaySpring.step(dt, swayTarget);
    const breath = (1 - this.ads * 0.6) * (0.003 + p.exertion * 0.006);
    const by = Math.sin(t * (1.6 + p.exertion * 1.8)) * breath, bx = noise1(t * 0.6, 3) * breath * 1.2;
    const stepAmp = p.moving * (0.012 + this.sprint * 0.02) * (1 - this.ads * 0.6);
    const sx = Math.sin(p.stepPhase * Math.PI) * stepAmp * 0.8, sy = -Math.abs(Math.sin(p.stepPhase * Math.PI)) * stepAmp;

    const rt = this.recoilT.step(dt), rr = this.recoilR.step(dt);
    const base = def.hip.clone().lerp(def.ads, this.ads).lerp(def.sprint, this.sprint);
    const pos = base.add(V(sway.x + bx + sx, sway.y + by + sy - rl.drop - this.lower * 0.06 - switchDrop * 0.25, rt.z * 0.025 + this.lower * 0.06));
    pos.x += rt.x * 0.01; pos.y += rt.y * 0.01;

    // 총 회전(총 기준): 반동, 달리기 자세, 벽 앞에서 내림, 재장전 기울임
    const rotX = rr.x * 0.03 - this.sprint * 0.55 - this.lower * 0.75 - switchDrop * 0.9 + rl.pitch + sway.y * 1.5;
    const rotY = rr.y * 0.02 + this.sprint * 0.55 + sway.x * -2.0;
    const rotZ = rr.z * 0.02 + this.sprint * 0.45 + rl.tilt + p.roll * 0.4;

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
    const gm = this.gunHolder.matrixWorld;
    const rh = mdl.rightHand.clone().applyMatrix4(gm);
    const lhLocal = rl.handL || mdl.leftHand;
    const lh = lhLocal.clone().applyMatrix4(gm);
    const gq = new THREE.Quaternion().setFromRotationMatrix(gm);
    this.handR.position.copy(rh); this.handR.quaternion.copy(gq); this.handR.rotateX(-0.25); this.handR.rotateZ(-0.2);
    this.handL.position.copy(lh); this.handL.quaternion.copy(gq); this.handL.rotateZ(this.current === 'rifle' ? 1.3 : 0.6); this.handL.rotateX(-0.2);
    const rootQ = this.root.quaternion;
    const elbowR = V(0.2, -0.32, 0.22).applyQuaternion(rootQ).add(this.root.position);
    const elbowL = V(-0.24, -0.34, this.current === 'rifle' ? -0.02 : 0.12).applyQuaternion(rootQ).add(this.root.position);
    const wristR = rh.clone().add(V(0, -0.01, 0.06).applyQuaternion(gq));
    const wristL = lh.clone().add(V(0.0, -0.01, 0.06).applyQuaternion(gq));
    placeLimb(this.foreR, elbowR, wristR); placeLimb(this.foreL, elbowL, wristL);
    placeLimb(this.cuffR, wristR.clone().lerp(elbowR, 0.0), wristR.clone().lerp(elbowR, 0.12));
    placeLimb(this.cuffL, wristL.clone().lerp(elbowL, 0.0), wristL.clone().lerp(elbowL, 0.12));

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
