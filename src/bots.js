// 상대 봇: 사람 비율의 관절 인형, 절차 보행, 상태기계 AI(순찰·경계·교전·엄폐·측면 우회), 버렛 래그돌
import * as THREE from 'three';
import { bcMaterial } from './materials.js';
import { noise1 } from './rng.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
// 관절 번호
const J = { pelvis: 0, chest: 1, head: 2, shL: 3, elL: 4, haL: 5, shR: 6, elR: 7, haR: 8, hipL: 9, knL: 10, ftL: 11, hipR: 12, knR: 13, ftR: 14 };
const EDGES = [[0, 1], [1, 2], [1, 3], [1, 6], [3, 6], [3, 4], [4, 5], [6, 7], [7, 8], [0, 9], [0, 12], [9, 12], [9, 10], [10, 11], [12, 13], [13, 14], [3, 9], [6, 12], [3, 12], [6, 9], [2, 3], [2, 6]];
const OUTFITS = [
  { cloth: 0x4c5040, vest: 0x2e3329, helmet: 0x5f5a48 },
  { cloth: 0x3b4150, vest: 0x262a30, helmet: 0x3a3e44 },
  { cloth: 0x6a6656, vest: 0x3c3b31, helmet: 0x6c6550 },
  { cloth: 0x2d2f2c, vest: 0x1f211f, helmet: 0x45473f },
];

function limbMesh(mat, r0, r1, seg = 8) { const g = new THREE.CylinderGeometry(r1, r0, 1, seg); g.translate(0, 0.5, 0); return new THREE.Mesh(g, mat); }
const _d = V(0, 0, 0), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
function placeLimb(m, a, b) { _d.subVectors(b, a); const L = Math.max(1e-4, _d.length()); m.position.copy(a); _q.setFromUnitVectors(UP, _d.divideScalar(L)); m.quaternion.copy(_q); m.scale.set(1, L, 1); }
function placeBasis(m, pos, side, up) {
  const u = up.clone().normalize(); const s = side.clone().addScaledVector(u, -side.dot(u)).normalize(); const f = new THREE.Vector3().crossVectors(s, u);
  _m.makeBasis(s, u, f); m.quaternion.setFromRotationMatrix(_m); m.position.copy(pos);
}

export class Bot {
  constructor(game, idx, spawn, patrol, role) {
    this.g = game; this.idx = idx; this.spawnDef = spawn; this.patrolNodes = patrol; this.role = role;
    const rng = game.rng;
    this.rng = rng;
    const o = OUTFITS[idx % OUTFITS.length];
    this.height = 0.97 + rng() * 0.06; // 키 비율
    const M = {
      cloth: bcMaterial({ map: game.tex.fabric, color: o.cloth, roughness: 1 }, { grime: 0.3 }),
      vest: bcMaterial({ map: game.tex.fabric, color: o.vest, roughness: 0.95 }, { grime: 0.3 }),
      helmet: bcMaterial({ color: o.helmet, roughness: 0.8, metalness: 0.05 }, { grime: 0.2 }),
      lens: bcMaterial({ color: 0x0b0c0d, roughness: 0.12, metalness: 0.4 }, { grime: 0 }),
      face: bcMaterial({ map: game.tex.fabric, color: 0x262624, roughness: 1 }, { grime: 0 }),
      glove: bcMaterial({ color: 0x1e1e1c, roughness: 0.9 }, { grime: 0 }),
      boot: bcMaterial({ color: 0x241f1a, roughness: 0.8 }, { grime: 0.4 }),
      gun: bcMaterial({ color: 0x1f2020, roughness: 0.5, metalness: 0.5 }, { grime: 0 }),
      pouch: bcMaterial({ map: game.tex.fabric, color: o.vest, roughness: 1 }, { grime: 0.3 }),
    };
    this.M = M;
    const grp = new THREE.Group();
    this.group = grp;
    const box = (mat, sx, sy, sz) => new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    this.parts = {
      torsoLow: box(M.cloth, 0.34, 1, 0.21),
      torsoUp: box(M.cloth, 0.38, 1, 0.23),
      vest: box(M.vest, 0.42, 0.36, 0.3),
      pouch: box(M.pouch, 0.34, 0.12, 0.08),
      neck: limbMesh(M.face, 0.055, 0.05),
      head: new THREE.Group(),
      uArmL: limbMesh(M.cloth, 0.058, 0.05), fArmL: limbMesh(M.cloth, 0.048, 0.04),
      uArmR: limbMesh(M.cloth, 0.058, 0.05), fArmR: limbMesh(M.cloth, 0.048, 0.04),
      thighL: limbMesh(M.cloth, 0.085, 0.065), shinL: limbMesh(M.cloth, 0.06, 0.05),
      thighR: limbMesh(M.cloth, 0.085, 0.065), shinR: limbMesh(M.cloth, 0.06, 0.05),
      handL: box(M.glove, 0.08, 0.1, 0.035), handR: box(M.glove, 0.08, 0.1, 0.035),
      bootL: box(M.boot, 0.11, 0.1, 0.28), bootR: box(M.boot, 0.11, 0.1, 0.28),
      pelvisBox: box(M.cloth, 0.36, 0.2, 0.22),
    };
    // 머리: 발라클라바 + 헬멧 + 고글
    const h = this.parts.head;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), M.face); skull.scale.set(0.92, 1.12, 1.0); h.add(skull);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.55), M.helmet); helm.position.y = 0.03; helm.scale.set(1.0, 0.95, 1.08); h.add(helm);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.138, 0.14, 0.03, 14), M.helmet); rim.position.y = 0.03; h.add(rim);
    const gog = box(M.lens, 0.17, 0.05, 0.03); gog.position.set(0, 0.0, -0.105); h.add(gog);
    const strap = box(M.glove, 0.23, 0.025, 0.2); strap.position.set(0, 0.0, 0.0); h.add(strap);
    for (const k in this.parts) grp.add(this.parts[k]);
    // 소총
    const gun = new THREE.Group();
    const gb = (sx, sy, sz, x, y, z) => { const m = box(M.gun, sx, sy, sz); m.position.set(x, y, z); gun.add(m); };
    gb(0.05, 0.07, 0.42, 0, 0.03, -0.1); gb(0.055, 0.06, 0.26, 0, 0.04, -0.42); gb(0.02, 0.02, 0.24, 0, 0.04, -0.67);
    gb(0.04, 0.08, 0.2, 0, 0.0, 0.2); gb(0.03, 0.1, 0.05, 0, -0.06, 0.0); gb(0.028, 0.13, 0.06, 0, -0.07, -0.16);
    this.gun = gun; this.gunMuzzle = V(0, 0.04, -0.8);
    grp.add(gun);
    grp.traverse(m => { if (m.isMesh) m.frustumCulled = false; });
    game.scene.add(grp);
    // 그림자 대신 발밑 접지 얼룩
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, map: game.tex.puff }));
    this.blob.renderOrder = 1;
    game.scene.add(this.blob);
    this.J = Array.from({ length: 15 }, () => V(0, 0, 0));
    this.prevJ = Array.from({ length: 15 }, () => V(0, 0, 0));
    this.reset();
  }

  reset() {
    const s = this.spawnDef, r = this.rng;
    this.pos = V(s[0], 0, s[1]);
    this.pos.y = this.g.level.insideBuilding(s[0], s[1]) ? 0.7 : this.g.level.groundHeight(s[0], s[1], 1.0, 0.1, 0.3);
    this.yaw = s[2]; this.aimYaw = s[2]; this.aimPitch = -0.55;
    this.vel = V(0, 0, 0);
    this.hp = 100; this.alive = true; this.ragdoll = null;
    this.state = 'patrol'; this.alerted = false;
    this.path = null; this.pathI = 0;
    this.timer = 1 + r() * 3; this.patrolI = 0;
    this.walkPhase = r() * 10; this.speed = 0; this.crouch = 0; this.aimRaise = 0;
    this.reaction = 0; this.lastSeen = -99; this.lastKnown = null; this.seeing = false;
    this.burstLeft = 0; this.shotCool = 0; this.aimErr = 0.1;
    this.coverUntil = 0; this.suppressed = 0;
    this.lookYaw = this.yaw; this.thinkT = r() * 0.15;
    this.stepAcc = 0; this.hitFlinch = 0; this.flinchDir = V(0, 0, 0);
    this.group.visible = true; this.blob.visible = true;
    this.pose(0, 0);
    for (let i = 0; i < 15; i++) this.prevJ[i].copy(this.J[i]);
    this.render();
  }

  get chest() { return this.alive ? this.J[J.chest].clone().lerp(this.J[J.pelvis], 0.3) : this.J[J.chest].clone(); }
  get headPos() { return this.J[J.head].clone(); }
  get eye() { return this.J[J.head].clone().add(V(0, 0.02, 0)); }

  // ===== 자세 계산 =====
  pose(t, dt) {
    const f = V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const H = this.height;
    const sp = Math.min(1, this.speed / 3.5);
    const ph = this.walkPhase;
    const cr = this.crouch;
    const legLen = 0.46 * H;
    const legs = [];
    for (const side of [-1, 1]) {
      const p = ph + (side < 0 ? 0 : Math.PI);
      let a = Math.sin(p) * (0.25 + sp * 0.35) * Math.min(1, this.speed * 1.5) + cr * 1.15 * (side < 0 ? 1.0 : 0.25);
      let kb = Math.max(0, -Math.cos(p)) * (0.4 + sp * 0.7) * Math.min(1, this.speed * 1.5) + cr * (side < 0 ? 1.35 : 2.3) + 0.05;
      const hip = V(0, 0, 0).addScaledVector(r, side * 0.1 * H);
      const knee = hip.clone().addScaledVector(f, Math.sin(a) * legLen).add(V(0, -Math.cos(a) * legLen, 0));
      const b = a - kb;
      const foot = knee.clone().addScaledVector(f, Math.sin(b) * legLen).add(V(0, -Math.cos(b) * legLen, 0));
      legs.push({ hip, knee, foot });
    }
    const drop = -Math.min(legs[0].foot.y, legs[1].foot.y) + 0.06;
    const bounce = Math.abs(Math.sin(ph)) * 0.025 * Math.min(1, this.speed);
    const pelvis = this.pos.clone().add(V(0, drop + bounce, 0)).addScaledVector(f, -cr * 0.05);
    const [L, R] = legs;
    this.J[J.hipL].copy(pelvis).add(L.hip).add(V(0, -0.05, 0)); this.J[J.knL].copy(pelvis).add(L.knee); this.J[J.ftL].copy(pelvis).add(L.foot);
    this.J[J.hipR].copy(pelvis).add(R.hip).add(V(0, -0.05, 0)); this.J[J.knR].copy(pelvis).add(R.knee); this.J[J.ftR].copy(pelvis).add(R.foot);
    this.J[J.pelvis].copy(pelvis);
    const lean = 0.08 + this.aimRaise * 0.12 + cr * 0.25 + sp * 0.12;
    const flinch = this.flinchDir.clone().multiplyScalar(this.hitFlinch * 0.25);
    const spineUp = V(0, 1, 0).addScaledVector(f, Math.sin(lean)).add(flinch).normalize();
    const chest = pelvis.clone().addScaledVector(spineUp, 0.5 * H);
    // 조준하면 상체가 조준 방향으로 비틀림
    const twist = Math.max(-0.6, Math.min(0.6, angDiff(this.aimYaw, this.yaw)));
    const tf = V(-Math.sin(this.yaw + twist), 0, -Math.cos(this.yaw + twist)), tr = V(Math.cos(this.yaw + twist), 0, -Math.sin(this.yaw + twist));
    this.J[J.chest].copy(chest);
    const headDir = spineUp.clone().addScaledVector(tf, 0.12 + this.aimPitch * 0.15).normalize();
    this.J[J.head].copy(chest).addScaledVector(headDir, 0.27 * H);
    this.J[J.shL].copy(chest).addScaledVector(tr, -0.19 * H).add(V(0, -0.04, 0));
    this.J[J.shR].copy(chest).addScaledVector(tr, 0.19 * H).add(V(0, -0.04, 0));
    // 총 방향: 조준 중이면 aimYaw/aimPitch, 아니면 앞으로 낮게
    const gp = this.aimPitch * this.aimRaise + (-0.75) * (1 - this.aimRaise);
    const gy = this.aimYaw;
    const gdir = V(-Math.sin(gy) * Math.cos(gp), Math.sin(gp), -Math.cos(gy) * Math.cos(gp));
    const gside = V(Math.cos(gy), 0, -Math.sin(gy));
    const stock = this.J[J.shR].clone().addScaledVector(gside, -0.05).add(V(0, -0.02 - (1 - this.aimRaise) * 0.12, 0)).addScaledVector(gdir, 0.06 + (1 - this.aimRaise) * 0.1);
    const grip = stock.clone().addScaledVector(gdir, 0.2).add(V(0, -0.06, 0));
    const fore = stock.clone().addScaledVector(gdir, 0.5).add(V(0, -0.03, 0)).addScaledVector(gside, -0.01);
    this.J[J.haR].copy(grip); this.J[J.haL].copy(fore);
    const elbow = (sh, ha, out) => { const mid = sh.clone().lerp(ha, 0.5); const len = 0.3 * H; const d = sh.distanceTo(ha); const k = Math.sqrt(Math.max(0, len * len - (d / 2) ** 2)); return mid.add(V(0, -k * 0.85, 0)).addScaledVector(out, k * 0.5); };
    this.J[J.elR].copy(elbow(this.J[J.shR], grip, tr));
    this.J[J.elL].copy(elbow(this.J[J.shL], fore, tr.clone().negate()));
    this.gunPose = { pos: stock.clone().addScaledVector(gdir, 0.25), dir: gdir, side: gside };
  }

  render() {
    const P = this.parts, j = this.J;
    const side = j[J.shR].clone().sub(j[J.shL]);
    const up = j[J.chest].clone().sub(j[J.pelvis]);
    const mid = j[J.pelvis].clone().lerp(j[J.chest], 0.5);
    placeBasis(P.pelvisBox, j[J.pelvis].clone().add(V(0, -0.02, 0)), j[J.hipR].clone().sub(j[J.hipL]), up);
    placeBasis(P.torsoLow, j[J.pelvis].clone().lerp(mid, 0.5), side, up); P.torsoLow.scale.y = up.length() * 0.5;
    placeBasis(P.torsoUp, mid.clone().lerp(j[J.chest], 0.5), side, up); P.torsoUp.scale.y = up.length() * 0.55;
    placeBasis(P.vest, mid.clone().lerp(j[J.chest], 0.42), side, up);
    const fwdT = new THREE.Vector3().crossVectors(side, up).normalize();
    placeBasis(P.pouch, mid.clone().lerp(j[J.chest], 0.1).addScaledVector(fwdT, -0.17), side, up);
    placeLimb(P.neck, j[J.chest], j[J.head]);
    const hu = j[J.head].clone().sub(j[J.chest]);
    placeBasis(P.head, j[J.head], side, hu);
    // 머리는 조준 방향을 본다
    if (this.alive) { P.head.rotation.set(-this.aimPitch * 0.6 * this.aimRaise, this.aimYaw + 0, 0, 'YXZ'); }
    placeLimb(P.uArmL, j[J.shL], j[J.elL]); placeLimb(P.fArmL, j[J.elL], j[J.haL]);
    placeLimb(P.uArmR, j[J.shR], j[J.elR]); placeLimb(P.fArmR, j[J.elR], j[J.haR]);
    placeLimb(P.thighL, j[J.hipL], j[J.knL]); placeLimb(P.shinL, j[J.knL], j[J.ftL]);
    placeLimb(P.thighR, j[J.hipR], j[J.knR]); placeLimb(P.shinR, j[J.knR], j[J.ftR]);
    P.handL.position.copy(j[J.haL]); P.handL.quaternion.copy(P.fArmL.quaternion);
    P.handR.position.copy(j[J.haR]); P.handR.quaternion.copy(P.fArmR.quaternion);
    for (const [boot, k, ft] of [[P.bootL, J.knL, J.ftL], [P.bootR, J.knR, J.ftR]]) {
      const shin = j[ft].clone().sub(j[k]).normalize();
      const fwd = this.alive ? V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)) : fwdT.clone();
      const bootUp = shin.clone().negate();
      const s = new THREE.Vector3().crossVectors(bootUp, fwd);
      if (s.lengthSq() < 1e-4) s.set(1, 0, 0);
      placeBasis(boot, j[ft].clone().addScaledVector(fwd, 0.06).add(V(0, -0.0, 0)), s, bootUp);
    }
    if (this.alive) {
      const gp = this.gunPose;
      _m.lookAt(V(0, 0, 0), gp.dir, UP);
      this.gun.quaternion.setFromRotationMatrix(_m);
      this.gun.position.copy(gp.pos);
    }
    const gh = this.alive ? this.pos.y : this.g.level.groundHeight(j[J.pelvis].x, j[J.pelvis].z, j[J.pelvis].y + 0.3, 0.05, 0.4);
    this.blob.position.set(j[J.pelvis].x, gh + 0.012, j[J.pelvis].z);
    this.blob.scale.setScalar(this.alive ? 1 : 1.6);
  }

  muzzleWorld() { const m = this.gunMuzzle.clone(); return m.applyQuaternion(this.gun.quaternion).add(this.gun.position); }

  // ===== 피격 판정 =====
  hitTest(o, d, maxDist) {
    if (!this.alive) return null;
    const j = this.J;
    const spheres = [
      [j[J.head], 0.13, 'head'],
      [j[J.chest].clone().lerp(j[J.pelvis], 0.15), 0.2, 'torso'], [j[J.chest].clone().lerp(j[J.pelvis], 0.55), 0.19, 'torso'], [j[J.pelvis], 0.17, 'torso'],
      [j[J.elL].clone().lerp(j[J.shL], 0.5), 0.07, 'limb'], [j[J.elR].clone().lerp(j[J.shR], 0.5), 0.07, 'limb'], [j[J.elL].clone().lerp(j[J.haL], 0.5), 0.06, 'limb'], [j[J.elR].clone().lerp(j[J.haR], 0.5), 0.06, 'limb'],
      [j[J.knL].clone().lerp(j[J.hipL], 0.5), 0.09, 'limb'], [j[J.knR].clone().lerp(j[J.hipR], 0.5), 0.09, 'limb'], [j[J.knL].clone().lerp(j[J.ftL], 0.45), 0.07, 'limb'], [j[J.knR].clone().lerp(j[J.ftR], 0.45), 0.07, 'limb'],
    ];
    let best = null;
    for (const [c, r, part] of spheres) {
      const oc = o.clone().sub(c); const b = oc.dot(d); const cc = oc.lengthSq() - r * r; const disc = b * b - cc;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < maxDist && (!best || t < best.dist)) best = { dist: t, part, point: o.clone().addScaledVector(d, t), center: c };
    }
    return best;
  }

  damage(part, dir, point, now) {
    const dmg = part === 'head' ? 100 : part === 'torso' ? 55 + this.rng() * 8 : 34 + this.rng() * 4;
    this.hp -= dmg;
    this.alerted = true;
    this.hitFlinch = 1; this.flinchDir.copy(dir).setY(0).normalize();
    this.suppressed = now;
    if (!this.lastKnown) this.lastKnown = this.g.player.pos.clone();
    if (this.hp <= 0) { this.die(dir, point, part); return true; }
    // 맞으면 바로 응사하거나 엄폐로 간다
    this.lastKnown = this.g.player.pos.clone();
    if (this.rng() < 0.55 || !this.seekCover(now)) {
      this.state = 'engage'; this.path = null; this.lastSeen = now;
      this.shotCool = Math.min(this.shotCool, 0.12 + this.rng() * 0.25); this.aimErr = Math.max(this.aimErr, 0.06);
    }
    return false;
  }

  die(dir, point, part) {
    this.alive = false; this.state = 'dead';
    const P = this.J.map(p => p.clone());
    const vel = this.J.map((p, i) => p.clone().sub(this.prevJ[i]).divideScalar(Math.max(this.g.lastDt, 1 / 120)).multiplyScalar(0.6));
    // 피격 임펄스: 맞은 곳에 가까운 관절일수록 크게
    const r = this.rng;
    for (let i = 0; i < 15; i++) {
      const d = P[i].distanceTo(point);
      const k = Math.exp(-d * 4) * (part === 'head' ? 3.2 : 2.4) * (0.7 + r() * 0.6);
      vel[i].addScaledVector(dir, k);
    }
    // 무릎이 꺾이는 방향과 정도를 매번 다르게
    const buckle = V(r() - 0.5, -0.5 - r() * 0.6, r() - 0.5);
    for (const i of [J.knL, J.knR, J.pelvis]) vel[i].addScaledVector(buckle, 1.2 + r());
    vel[J.knL].addScaledVector(V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r() * 1.5);
    vel[J.knR].addScaledVector(V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r() * 1.5);
    const dt = 1 / 120;
    const prev = P.map((p, i) => p.clone().addScaledVector(vel[i], -dt));
    const rest = EDGES.map(([a, b]) => P[a].distanceTo(P[b]));
    // 총: 두 점 강체
    const g0 = this.gun.position.clone(), g1 = this.muzzleWorld();
    this.ragdoll = { P, prev, rest, t: 0, gun: { a: g0, b: g1, pa: g0.clone().addScaledVector(dir, -dt * 1.5).add(V(0, dt, 0)), pb: g1.clone().addScaledVector(dir, -dt * 0.5), len: g0.distanceTo(g1) }, sleep: false };
    this.g.events.push({ type: 'botDown', bot: this.idx, pos: this.pos.clone() });
  }

  stepRagdoll(dt) {
    const R = this.ragdoll; if (!R || R.sleep) return;
    R.t += dt;
    const L = this.g.level;
    const sub = 3, h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < 15; i++) {
        const p = R.P[i], q = R.prev[i];
        const vx = (p.x - q.x) * 0.995, vy = (p.y - q.y) * 0.995, vz = (p.z - q.z) * 0.995;
        q.copy(p);
        p.x += vx; p.y += vy - 9.8 * h * h; p.z += vz;
      }
      for (const G of [R.gun]) {
        for (const [p, q] of [[G.a, G.pa], [G.b, G.pb]]) { const v = p.clone().sub(q).multiplyScalar(0.995); q.copy(p); p.add(v); p.y -= 9.8 * h * h; }
      }
      for (let it = 0; it < 8; it++) {
        EDGES.forEach(([a, b], k) => {
          const pa = R.P[a], pb = R.P[b];
          const d = pb.clone().sub(pa), L0 = d.length() || 1e-5, diff = (L0 - R.rest[k]) / L0;
          const wa = a === J.head ? 0.35 : 0.5, wb = 1 - wa;
          pa.addScaledVector(d, diff * wa); pb.addScaledVector(d, -diff * wb);
        });
        // 무릎·팔꿈치가 반대로 접히지 않도록 최소 거리
        for (const [a, b, mn] of [[J.hipL, J.ftL, 0.42], [J.hipR, J.ftR, 0.42], [J.shL, J.haL, 0.3], [J.shR, J.haR, 0.3], [J.head, J.pelvis, 0.6]]) {
          const pa = R.P[a], pb = R.P[b]; const d = pb.clone().sub(pa); const l = d.length();
          if (l < mn) { const k = (mn - l) / (l || 1e-5) * 0.5; pa.addScaledVector(d, -k); pb.addScaledVector(d, k); }
        }
        const G = R.gun; const d = G.b.clone().sub(G.a); const l = d.length() || 1e-5; const k = (l - G.len) / l * 0.5; G.a.addScaledVector(d, k); G.b.addScaledVector(d, -k);
      }
      // 바닥·벽 충돌
      const pts = [...R.P.map((p, i) => [p, R.prev[i]]), [R.gun.a, R.gun.pa], [R.gun.b, R.gun.pb]];
      for (const [p, q] of pts) {
        const rad = 0.07;
        const gh = L.groundHeight(p.x, p.z, p.y + 0.15, 0.0, 0.3);
        if (p.y < gh + rad) {
          p.y = gh + rad;
          // 마찰
          q.x = p.x - (p.x - q.x) * 0.55; q.z = p.z - (p.z - q.z) * 0.55;
          if (q.y < p.y) q.y = p.y + (q.y - p.y) * -0.15;
        }
        L.collide(p, rad, p.y - 0.05, 0.1, 0.0);
      }
    }
    // 정지 판정
    let e = 0; for (let i = 0; i < 15; i++) e += R.P[i].distanceToSquared(R.prev[i]);
    if (R.t > 2.5 && e < 1e-6) R.sleep = true;
    if (R.t > 7) R.sleep = true;
    for (let i = 0; i < 15; i++) this.J[i].copy(R.P[i]);
    const gd = R.gun.b.clone().sub(R.gun.a).normalize();
    _m.lookAt(V(0, 0, 0), gd, UP); this.gun.quaternion.setFromRotationMatrix(_m);
    this.gun.position.copy(R.gun.a).addScaledVector(gd, 0.25);
  }

  // ===== AI =====
  canSee(now) {
    const p = this.g.player; if (!p.alive) return false;
    const eye = this.eye;
    const target = V(p.pos.x, p.pos.y + p.eyeHeight + 0.15, p.pos.z);
    const to = target.clone().sub(eye); const dist = to.length();
    if (dist > 48) return false;
    const ang = Math.abs(angDiff(Math.atan2(-to.x, -to.z), this.state === 'engage' ? this.aimYaw : this.yaw));
    const fov = this.alerted ? 1.5 : 1.05;
    if (ang > fov && dist > 2.5) return false;
    // 어두운 실내의 플레이어는 멀리서 덜 보인다
    const dark = this.g.level.insideBuilding(p.pos.x, p.pos.z) && !this.g.level.insideBuilding(this.pos.x, this.pos.z);
    if (dark && dist > 14 && !this.alerted) return false;
    if (this.g.level.lineClear(eye, target)) return true;
    const torso = V(p.pos.x, p.pos.y + 1.0 - p.crouch * 0.35, p.pos.z);
    return this.g.level.lineClear(eye, torso);
  }

  hear(pos, loud, now) {
    if (!this.alive || this.dormant) return;
    const d = this.pos.distanceTo(pos);
    const inSame = this.g.level.insideBuilding(pos.x, pos.z) === this.g.level.insideBuilding(this.pos.x, this.pos.z);
    const range = loud * (inSame ? 1 : 0.6);
    if (d > range) return;
    this.alerted = true;
    if (this.state === 'patrol' || this.state === 'investigate' || this.state === 'search') {
      const r = this.rng;
      const err = d * 0.12;
      this.lastKnown = pos.clone().add(V((r() - 0.5) * err, 0, (r() - 0.5) * err));
      if (this.state !== 'investigate') { this.state = 'investigate'; this.timer = 0.3 + r() * 0.8; this.path = null; }
    }
  }

  seekCover(now) {
    const L = this.g.level, p = this.g.player;
    const threat = V(p.pos.x, p.pos.y + 1.3, p.pos.z);
    let best = null, bs = Infinity;
    for (const n of L.nodes) {
      const d = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
      if (d > 10 || d < 0.8) continue;
      if (Math.abs(n.y - this.pos.y) > 0.5) continue;
      const hidden = !L.lineClear(threat, V(n.x, n.y + 1.0, n.z));
      if (!hidden) continue;
      const dp = Math.hypot(n.x - p.pos.x, n.z - p.pos.z);
      const score = d + (dp < 4 ? 8 : 0) + this.rng() * 2;
      if (score < bs) { bs = score; best = n; }
    }
    if (best) {
      const start = L.nearestNode(this.pos.x, this.pos.z, this.pos.y);
      const path = start && L.path(start, best);
      if (path) { this.path = path; this.pathI = 0; this.state = 'tocover'; this.coverNode = best; return true; }
    }
    return false;
  }

  planTo(target, flank = false) {
    const L = this.g.level, p = this.g.player;
    const start = L.nearestNode(this.pos.x, this.pos.z, this.pos.y);
    const goal = L.nearestNode(target.x, target.z, target.y, false);
    if (!start || !goal) return false;
    const threat = V(p.pos.x, p.pos.y + 1.3, p.pos.z);
    const avoid = flank ? (n) => (L.lineClear(threat, V(n.x, n.y + 1.2, n.z)) ? 18 : 0) : null;
    const path = L.path(start, goal, avoid);
    if (!path) return false;
    this.path = path; this.pathI = 0;
    return true;
  }

  update(dt, now) {
    for (let i = 0; i < 15; i++) this.prevJ[i].copy(this.J[i]);
    if (!this.alive) { this.stepRagdoll(dt); this.render(); return; }
    const g = this.g, p = g.player, r = this.rng, L = g.level;
    this.hitFlinch = Math.max(0, this.hitFlinch - dt * 3);
    this.shotCool -= dt;
    let moveTarget = null, wantSpeed = 0, faceYaw = null, wantCrouch = 0, raise = 0;

    // 지각 (0.12 s마다)
    this.thinkT -= dt;
    if (this.thinkT <= 0 && !this.dormant) {
      this.thinkT = 0.1 + r() * 0.06;
      const see = this.canSee(now);
      if (see) {
        this.lastKnown = p.pos.clone(); this.lastSeen = now;
        if (!this.seeing) {
          this.seeing = true;
          // 사람 같은 반응 시간 편차
          const d = this.pos.distanceTo(p.pos);
          this.reaction = 0.22 + r() * 0.42 + (this.alerted ? 0 : 0.3) + d * 0.006 + (r() < 0.12 ? 0.35 : 0);
          this.aimErr = 0.05 + r() * 0.05 + (p.sprinting ? 0.04 : 0);
          this.alerted = true;
          if (this.state !== 'tocover' && this.state !== 'cover') { this.state = 'engage'; this.path = null; this.burstLeft = 0; this.shotCool = this.reaction; }
          for (const b of g.bots) if (b !== this && b.alive) b.hear(p.pos, 18, now);
        }
      } else if (this.seeing) {
        this.seeing = false;
      }
    }
    if (this.dormant) { this.state = this.dormant === 'walk' ? 'patrol' : 'idle'; }

    switch (this.state) {
      case 'idle': {
        raise = 0.0; this.lookYaw += Math.sin(now * 0.3 + this.idx) * 0.002; faceYaw = this.lookYaw; break;
      }
      case 'patrol': {
        raise = 0.0;
        this.timer -= dt;
        if (!this.path && this.timer <= 0) {
          this.patrolI = (this.patrolI + 1) % this.patrolNodes.length;
          const n = this.patrolNodes[this.patrolI];
          this.planTo(V(n[0], 0, n[1]));
        }
        if (this.path) { moveTarget = true; wantSpeed = 1.25 + r() * 0.05; }
        else { faceYaw = this.lookYaw + Math.sin(now * 0.4 + this.idx * 2) * 0.6; }
        break;
      }
      case 'investigate': {
        raise = 0.6;
        this.timer -= dt;
        if (this.timer <= 0 && !this.path && this.lastKnown) {
          const flank = this.role === 'flank' && g.bots.filter(b => b.alive && b.alerted).length > 1;
          this.planTo(this.lastKnown, flank);
          this.timer = 99;
        }
        if (this.path) { moveTarget = true; wantSpeed = this.role === 'flank' ? 3.3 : 2.2; }
        else if (this.timer > 50) { this.state = 'search'; this.timer = 3 + r() * 4; }
        break;
      }
      case 'search': {
        raise = 0.7; this.timer -= dt;
        faceYaw = this.yaw + Math.sin(now * 1.1 + this.idx) * 0.03;
        if (this.timer <= 0) { this.state = 'investigate'; this.timer = 0.5; if (this.lastKnown) this.lastKnown = this.lastKnown.clone().add(V((r() - 0.5) * 8, 0, (r() - 0.5) * 8)); }
        break;
      }
      case 'engage': {
        raise = 1;
        const lostFor = now - this.lastSeen;
        const tgt = this.lastKnown || p.pos;
        faceYaw = Math.atan2(-(tgt.x - this.pos.x), -(tgt.z - this.pos.z));
        // 조준 오차는 시간이 지나며 줄어든다
        const d = this.pos.distanceTo(p.pos);
        const floorErr = 0.018 + d * 0.0009;
        this.aimErr += (floorErr - this.aimErr) * (1 - Math.exp(-dt * 1.1));
        if (this.seeing && this.shotCool <= 0 && Math.abs(angDiff(this.aimYaw, faceYaw)) < 0.2) {
          if (this.burstLeft <= 0) { this.burstLeft = 2 + Math.floor(r() * 4); }
          this.fire(now);
          this.burstLeft--;
          this.shotCool = this.burstLeft > 0 ? 0.1 + r() * 0.06 : 0.45 + r() * 0.8;
        }
        // 가끔 옆걸음
        if (this.seeing && r() < dt * 0.5) this.strafe = (r() - 0.5) * 2;
        if (this.strafe) { const s = this.strafe; this.vel.x += Math.cos(this.yaw) * s * dt * 4; this.vel.z += -Math.sin(this.yaw) * s * dt * 4; this.strafe *= Math.exp(-dt * 2); if (Math.abs(this.strafe) < 0.05) this.strafe = 0; }
        if (!this.seeing && lostFor > 1.0 + r() * 0.5) {
          this.state = 'investigate'; this.timer = 0.2 + r() * 0.5; this.path = null;
        }
        // 오래 노출되면 엄폐 시도
        if (this.seeing && now - this.suppressed < 0.6 && r() < dt * 3) this.seekCover(now);
        break;
      }
      case 'tocover': {
        raise = 0.8;
        if (this.path) { moveTarget = true; wantSpeed = 3.6; }
        else { this.state = 'cover'; this.timer = 1.0 + r() * 2.2; }
        break;
      }
      case 'cover': {
        raise = 0.7; wantCrouch = 1;
        this.timer -= dt;
        const tgt = this.lastKnown || p.pos;
        faceYaw = Math.atan2(-(tgt.x - this.pos.x), -(tgt.z - this.pos.z));
        if (this.timer <= 0) {
          // 일어나서 다시 교전하거나, 다른 길로 돌아 들어간다
          if (this.role === 'flank' || r() < 0.35) { this.state = 'investigate'; this.timer = 0.2; this.path = null; this.role = r() < 0.5 ? 'flank' : this.role; }
          else { this.state = 'engage'; this.lastSeen = now; }
        }
        break;
      }
    }

    // 경로 따라 이동
    if (moveTarget && this.path) {
      const n = this.path[this.pathI];
      const dx = n.x - this.pos.x, dz = n.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.45) { this.pathI++; if (this.pathI >= this.path.length) { this.path = null; if (this.state === 'patrol') { this.timer = 2 + r() * 4; this.lookYaw = this.yaw; } } }
      else {
        const s = wantSpeed;
        this.vel.x += (dx / d * s - this.vel.x) * (1 - Math.exp(-dt * 6));
        this.vel.z += (dz / d * s - this.vel.z) * (1 - Math.exp(-dt * 6));
        if (faceYaw === null) faceYaw = Math.atan2(-dx, -dz);
      }
    } else {
      this.vel.x *= Math.exp(-dt * 8); this.vel.z *= Math.exp(-dt * 8);
    }
    // 다른 봇, 플레이어와 겹치지 않게
    for (const o of g.bots) if (o !== this && o.alive) { const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d = Math.hypot(dx, dz); if (d < 0.7 && d > 1e-3) { this.pos.x += dx / d * (0.7 - d) * 0.5; this.pos.z += dz / d * (0.7 - d) * 0.5; } }
    { const dx = this.pos.x - p.pos.x, dz = this.pos.z - p.pos.z, d = Math.hypot(dx, dz); if (d < 0.65 && d > 1e-3) { this.pos.x += dx / d * (0.65 - d); this.pos.z += dz / d * (0.65 - d); } }

    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    L.collide(this.pos, 0.28, this.pos.y, 1.7);
    const gh = L.groundHeight(this.pos.x, this.pos.z, this.pos.y, 0.15, 0.42);
    if (gh > -0.4) this.pos.y += (gh - this.pos.y) * Math.min(1, dt * 16);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // 걸음 위상 (보폭에 맞춤) 과 발소리
    const stride = 0.7 + Math.min(1, this.speed / 3.5) * 0.45;
    this.walkPhase += this.speed / stride * Math.PI * dt;
    this.stepAcc += this.speed * dt;
    if (this.stepAcc > stride * 0.98) { this.stepAcc = 0; g.events.push({ type: 'botStep', pos: this.pos.clone(), mat: L.floorMaterial(this.pos.x, this.pos.y, this.pos.z), speed: this.speed }); }

    // 몸 회전: 사람처럼 약간의 지연
    if (faceYaw !== null) {
      const turn = 4.5 * dt;
      const dy = angDiff(faceYaw, this.yaw);
      this.yaw += Math.max(-turn, Math.min(turn, dy * Math.min(1, dt * 7)));
    }
    // 조준 방향
    const tgt = (this.state === 'engage' || this.state === 'cover') && this.lastKnown ? this.lastKnown : null;
    let aimY = this.yaw, aimP = -0.1;
    if (tgt) {
      const e = this.eye; const tp = V(p.pos.x, p.pos.y + 1.2 - p.crouch * 0.35, p.pos.z);
      const d = (this.seeing ? tp : V(tgt.x, tgt.y + 1.2, tgt.z)).sub(e);
      aimY = Math.atan2(-d.x, -d.z); aimP = Math.atan2(d.y, Math.hypot(d.x, d.z));
    }
    const ak = 1 - Math.exp(-dt * 9);
    this.aimYaw += angDiff(aimY, this.aimYaw) * ak; this.aimPitch += (aimP - this.aimPitch) * ak;
    this.aimRaise += (raise - this.aimRaise) * (1 - Math.exp(-dt * 5));
    this.crouch += (wantCrouch - this.crouch) * (1 - Math.exp(-dt * 5));
    this.pose(now, dt);
    this.render();
  }

  fire(now) {
    const g = this.g, p = g.player, r = this.rng;
    const m = this.muzzleWorld();
    const target = V(p.pos.x, p.pos.y + 1.15 - p.crouch * 0.3, p.pos.z).add(V((r() - 0.5) * 0.2, (r() - 0.5) * 0.3, (r() - 0.5) * 0.2));
    const dir = target.clone().sub(m).normalize();
    const moving = Math.hypot(p.vel.x, p.vel.z);
    const err = this.aimErr * (1 + moving * 0.22 + (p.crouch > 0.5 ? 0.25 : 0)) * (this.state === 'cover' ? 1.4 : 1);
    const right = new THREE.Vector3().crossVectors(dir, UP).normalize(); const up2 = new THREE.Vector3().crossVectors(right, dir);
    dir.addScaledVector(right, r.gauss() * err).addScaledVector(up2, r.gauss() * err * 0.8).normalize();
    g.botShot(this, m, dir);
  }
}

export function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
