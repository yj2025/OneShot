// 상대 봇: 사람 비율의 관절 인형, 절차 보행, 상태기계 AI(순찰·경계·교전·엄폐·측면 우회), 버렛 래그돌
import * as THREE from 'three';
import { shadowMaterial, bcMaterial } from './materials.js';
import { noise1 } from './rng.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createBody, Gear, BIND_J } from './body.js';
import { fabricMaps } from './fabric.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
// 관절 번호
const J = { pelvis: 0, chest: 1, head: 2, shL: 3, elL: 4, haL: 5, shR: 6, elR: 7, haR: 8, hipL: 9, knL: 10, ftL: 11, hipR: 12, knR: 13, ftR: 14 };
const EDGES = [[0, 1], [1, 2], [1, 3], [1, 6], [3, 6], [3, 4], [4, 5], [6, 7], [7, 8], [0, 9], [0, 12], [9, 12], [9, 10], [10, 11], [12, 13], [13, 14], [3, 9], [6, 12], [3, 12], [6, 9], [2, 3], [2, 6]];
// 옷 색(sRGB). 천 맵(fabric.js)은 선형 평균을 이 색에 맞춘다. 선형 반사율로 셔츠 10~15%, 바지 9~12%, 조끼 6~9%다.
// 이전에는 평균 반사율 0.1짜리 천 텍스처에 색을 곱해 셔츠가 2~3%였다. 그늘과 역광에서 사람만 검은 판이 된 까닭이다(15라운드)
const OUTFITS = [
  { shirt: '#57594c', pants: '#4e5045', vest: '#47493a', helmet: 0x504c3e },
  { shirt: '#535861', pants: '#474c53', vest: '#3b3f45', helmet: 0x3e4146 },
  { shirt: '#665f4e', pants: '#5b5545', vest: '#524b3e', helmet: 0x575042 },
  { shirt: '#51554b', pants: '#474a42', vest: '#3f423b', helmet: 0x44463f },
];

function limbMesh(mat, r0, r1, seg = 10) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, seg, seg > 6 ? 10 : 1); g.translate(0, 0.5, 0);
  if (seg > 6) {
    // 옷 주름: 길이 방향으로 불규칙한 접힘, 관절 쪽이 조금 부풂
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
      const k = 1 + 0.09 * Math.sin(y * 26 + a * 2) * Math.sin(a * 3 + y * 9) + 0.06 * Math.sin(y * 47 + a * 4) + 0.08 * Math.exp(-((y - 0.92) ** 2) * 60);
      p.setXYZ(i, x * k, y, z * k * 1.08);
    }
    g.computeVertexNormals();
  }
  return new THREE.Mesh(g, mat);
}
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
    // 동작의 난수(2단계 ②): 게임 공용 난수(플레이어 탄 퍼짐과 같은 열)를 더 쓰지 않도록 봇마다 따로 둔다
    { let a = (0x9e3779b9 ^ (idx * 7919 + 13)) >>> 0; this.mr = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    const o = OUTFITS[idx % OUTFITS.length];
    this.height = 0.97 + rng() * 0.06; // 키 비율
    // 몸: 거리장으로 지은 옷 입은 사람 하나를 뼈 11개에 스키닝한다(body.js). 재질은 영역마다 하나(셔츠, 바지, 조끼, 장갑, 부츠, 얼굴 가리개, 띠, 보호대).
    // 장갑, 부츠, 띠는 반사율 4~8%(이전 1~2%)로 올렸다. 그늘과 역광에서 몸 전체가 한 덩어리의 검은 판이 되지 않게 하려는 것이다
    // 몸 메시의 UV는 0.25 m가 1이다. 천 맵 한 장(4 cm)이 실제 치수가 되게 반복한다
    const fab = (c, rough, grime, seed) => { const F = fabricMaps(c, { kind: 'ripstop', seed }); for (const tx of [F.map, F.normalMap]) tx.repeat.set(6.25, 6.25); return bcMaterial({ map: F.map, normalMap: F.normalMap, roughness: rough, envMapIntensity: 0.5, vertexColors: true }, { grime }); };
    const plain = (c, rough, grime) => bcMaterial({ color: c, roughness: rough, vertexColors: true }, { grime });
    const M = {
      shirt: fab(o.shirt, 0.95, 0.3, idx * 4 + 1), pants: fab(o.pants, 1, 0.5, idx * 4 + 2),
      vest: fab(o.vest, 0.88, 0.3, idx * 4 + 3), glove: plain(0x45433d, 0.85, 0), boot: plain(0x332e28, 0.75, 0.4),
      face: fab('#34332f', 1, 0, idx * 4 + 4), strap: plain(0x3a3b36, 0.9, 0.2), pad: plain(0x3e3e38, 0.65, 0.3),
      helmet: (() => { const F = fabricMaps('#' + new THREE.Color(o.helmet).getHexString(), { kind: 'ripstop', seed: idx * 4 + 9 }); for (const tx of [F.map, F.normalMap]) tx.repeat.set(5, 5); return bcMaterial({ map: F.map, normalMap: F.normalMap, roughness: 0.92, envMapIntensity: 0.2 }, { grime: 0.2 }); })(),
      lens: bcMaterial({ color: 0x0b0c0d, roughness: 0.12, metalness: 0.4 }, { grime: 0 }),
      dark: bcMaterial({ color: 0x2a2a27, roughness: 0.9 }, { grime: 0 }),
      gun: bcMaterial({ color: 0x1f2020, roughness: 0.5, metalness: 0.5 }, { grime: 0 }),
      pouch: bcMaterial({ color: new THREE.Color(o.vest), roughness: 1 }, { grime: 0.3 }),
      strapS: bcMaterial({ color: 0x2c2d29, roughness: 0.9 }, { grime: 0 }),
    };
    this.M = M;
    const grp = new THREE.Group();
    this.group = grp;
    const box = (mat, sx, sy, sz) => new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz, 3, Math.min(sx, sy, sz) * 0.32), mat);
    this.body = createBody(M);
    grp.add(this.body.mesh);
    this.parts = { head: new THREE.Group(), sling: limbMesh(M.strapS, 0.012, 0.012, 4) };
    // 머리: 헬멧 + 고글(얼굴 가리개와 목은 몸 메시에 있다)
    const h = this.parts.head;
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.55), M.helmet); helm.position.y = 0.03; helm.scale.set(1.0, 0.95, 1.08); h.add(helm);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.138, 0.14, 0.03, 14), M.helmet); rim.position.y = 0.03; h.add(rim);
    const gog = box(M.lens, 0.17, 0.05, 0.03); gog.position.set(0, 0.0, -0.105); h.add(gog);
    const mount = box(M.dark, 0.05, 0.04, 0.03); mount.position.set(0, 0.11, -0.12); h.add(mount);
    for (const sx of [-1, 1]) { const rail = box(M.dark, 0.02, 0.025, 0.14); rail.position.set(sx * 0.13, 0.05, 0.0); h.add(rail); }
    const cover = box(M.helmet, 0.06, 0.03, 0.07); cover.position.set(0.0, 0.135, 0.07); h.add(cover);
    for (const sx of [-1, 1]) { const cs = box(M.dark, 0.012, 0.11, 0.02); cs.position.set(sx * 0.085, -0.04, -0.01); cs.rotation.x = 0.25; h.add(cs); }
    // 헤드셋: 헬멧 레일 아래 귀를 덮는 귀덮개와 목 뒤로 도는 띠. 둥근 공 같던 머리 실루엣의 옆을 깬다
    const cupG = new THREE.CylinderGeometry(0.048, 0.052, 0.045, 12); cupG.rotateZ(Math.PI / 2);
    for (const sx of [-1, 1]) {
      const cup = new THREE.Mesh(cupG, M.dark); cup.position.set(sx * 0.112, -0.015, 0.008); cup.rotation.y = sx * 0.12; h.add(cup);
      const arm = box(M.dark, 0.014, 0.05, 0.016); arm.position.set(sx * 0.122, 0.025, 0.008); h.add(arm);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.008, 4, 14, Math.PI), M.dark); band.position.set(0, -0.03, 0.03); band.rotation.set(Math.PI / 2 + 0.5, 0, 0); h.add(band);
    // 헬멧 덮개의 번지 줄
    const bung = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.005, 4, 20), M.dark); bung.position.y = 0.075; bung.scale.set(1, 1.08, 1); bung.rotation.x = Math.PI / 2; h.add(bung);
    for (const k in this.parts) grp.add(this.parts[k]);
    // 흔들리는 장비: 등의 물주머니 배낭, 허리 뒤 왼쪽 덤프 주머니, 무전기 안테나(위로 선 채찍). 몸을 늦게 따라온다(body.js Gear)
    const hang = (g, x, y, z) => { g.translate(x, y, z); return g; };
    const pack = new THREE.Mesh(hang(new RoundedBoxGeometry(0.24, 0.34, 0.075, 3, 0.03), 0, -0.17, 0.035), M.pouch);
    const dump = new THREE.Mesh(hang(new RoundedBoxGeometry(0.12, 0.16, 0.085, 3, 0.03), 0, -0.085, 0.03), M.pouch);
    const ant = new THREE.Mesh(hang(new THREE.CylinderGeometry(0.0035, 0.007, 0.34, 5), 0, 0.17, 0), M.dark);
    this.gear = [
      new Gear(pack, 'chest', V(0, -0.055, 0.175), { k: 55, c: 6, gain: 0.05, bounce: 0.012, maxTilt: 0.25 }),
      new Gear(dump, 'pelvis', V(-0.12, -0.02, 0.125), { k: 30, c: 3.2, gain: 0.09, bounce: 0.02, maxTilt: 0.6 }),
      new Gear(ant, 'chest', V(-0.2, -0.14, 0.075), { k: 90, c: 1.8, gain: -0.035, bounce: 0, maxTilt: 0.5 }),
    ];
    for (const gr of this.gear) grp.add(gr.mesh);
    // 소총
    const gun = new THREE.Group();
    const gb = (sx, sy, sz, x, y, z) => { const m = box(M.gun, sx, sy, sz); m.position.set(x, y, z); gun.add(m); };
    gb(0.05, 0.07, 0.42, 0, 0.03, -0.1); gb(0.055, 0.06, 0.26, 0, 0.04, -0.42); gb(0.02, 0.02, 0.24, 0, 0.04, -0.67);
    gb(0.04, 0.08, 0.2, 0, 0.0, 0.2); gb(0.03, 0.1, 0.05, 0, -0.06, 0.0); gb(0.028, 0.13, 0.06, 0, -0.07, -0.16);
    this.gun = gun; this.gunMuzzle = V(0, 0.04, -0.8);
    grp.add(gun);
    grp.traverse(m => { if (m.isMesh) m.frustumCulled = false; });
    game.scene.add(grp);
    // 바닥 그림자: 몸이 가린 빛만큼 바닥을 어둡게 하는 판(materials.js shadowMaterial)
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2), shadowMaterial());
    this.blob.frustumCulled = false;
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
    this.feet = null; this.gaitC = this.mr(); this.pelY = null; this.shift = 0; this.prevVel = V(0, 0, 0); this.avel = V(0, 0, 0);
    this.stance = [this.mr() - 0.5, this.mr() - 0.5];
    this.hrP = V(0, 0, 0); this.hrPv = V(0, 0, 0); this.hrC = V(0, 0, 0); this.hrCv = V(0, 0, 0); this.hrH = V(0, 0, 0); this.hrHv = V(0, 0, 0);
    this.group.visible = true; this.blob.visible = true;
    for (const gr of this.gear) gr.reset();
    this.pose(0, 0);
    for (let i = 0; i < 15; i++) this.prevJ[i].copy(this.J[i]);
    this.render();
  }

  get chest() { return this.alive ? this.J[J.chest].clone().lerp(this.J[J.pelvis], 0.3) : this.J[J.chest].clone(); }
  get headPos() { return this.J[J.head].clone(); }
  get eye() { return this.J[J.head].clone().add(V(0, 0.02, 0)); }

  // ===== 자세 계산 =====
  // 봇 하나를 감싸는 구(그리기 패스마다 통째로 거르는 데 쓴다). 관절 15개의 중심에서 가장 먼 관절까지에 총과 팔다리 두께를 더한다.
  // 쓰러진 뒤에는 따로 떨어진 총의 두 끝도 넣는다
  bounds() {
    const s = this._bs || (this._bs = new THREE.Sphere()), c = s.center.set(0, 0, 0);
    for (const j of this.J) c.add(j);
    c.multiplyScalar(1 / this.J.length);
    let r = 0; for (const j of this.J) r = Math.max(r, c.distanceTo(j));
    if (this.ragdoll) { r = Math.max(r, c.distanceTo(this.ragdoll.gun.a), c.distanceTo(this.ragdoll.gun.b)); s.radius = r + 0.3; }
    else s.radius = r + 0.95;
    return s;
  }

  // ===== 걸음(2단계 ②, 2026-11-18) =====
  // 발은 세상에 놓인다. 디딘 발은 제자리에 있고, 든 발은 다음 디딜 자리(몸의 속도와 남은 시간으로 예측)로 호를 그리며 옮긴다.
  // 걸을 때는 걸음 박자가 발을 들고, 서 있을 때는 발이 쉬는 자리에서 멀어지면(돌기, 밀림, 피격으로 골반이 밀림) 한 발씩 고쳐 딛는다.
  // 그 전에는 다리가 엉덩이에 매단 진자(허벅지 sin, 무릎 -cos)라 디딘 발이 몸보다 더 움직였다(검사 (r) 154~170%).
  footHome(s) {
    const side = s ? 1 : -1, H = this.height, cr = this.crouch;
    const f = V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const idle = Math.max(0, 1 - this.speed * 2) * (1 - cr);
    const wSide = (this.idx % 2) ? 1 : -1;
    const w = (0.115 + 0.035 * cr) * H + (side === wSide ? idle * 0.04 : 0) + this.stance[s] * 0.03;
    const fo = cr * (s ? -0.16 : 0.26) + idle * (s ? -0.04 : 0.06) * wSide;
    return this.pos.clone().addScaledVector(r, side * w).addScaledVector(f, fo).add(V(this.hrP.x, 0, this.hrP.z));
  }

  gait(dt) {
    const H = this.height, sp = this.speed, cr = this.crouch, m = this.mr, L = this.g.level;
    const home = [this.footHome(0), this.footHome(1)];
    let F = this.feet;
    if (!F || Math.hypot(F[0].p.x - home[0].x, F[0].p.z - home[0].z) > 1.5 || Math.abs(F[0].p.y - this.pos.y) > 0.8) {
      // 처음이거나 테스트 경로로 자리를 옮김
      this.feet = F = [0, 1].map(s => ({ p: home[s].clone().setY(this.pos.y), from: V(0, 0, 0), t: -1, dur: 0.3, lift: 0.07, vr: 1, jit: 0, gy: this.pos.y, k: null }));
      return;
    }
    const run = Math.min(1, Math.max(0, (sp - 2.2) / 1.1));
    const duty = 0.63 - 0.06 * Math.min(1, sp / 2) - 0.2 * run;   // 한 걸음 주기에서 발이 땅에 있는 비율(달리면 0.37: 두 발이 다 뜨는 순간이 있다)
    const stepLen = (0.42 + 0.2 * sp) * H * (1 - 0.3 * cr);         // 한 걸음 길이(1.3 m/s 0.68 m, 3.3 m/s 1.08 m)
    const Tc = 2 * stepLen / Math.max(sp, 0.05);
    const moving = sp > 0.25;
    if (moving) this.gaitC += dt / Tc;
    const r = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    for (let s = 0; s < 2; s++) {
      const ft = F[s], o = F[1 - s];
      const k = Math.floor(this.gaitC + s * 0.5 - duty);
      if (ft.k === null) ft.k = k;
      if (ft.t < 0) {
        let dur = 0;
        const e = Math.hypot(ft.p.x - home[s].x, ft.p.z - home[s].z), eo = Math.hypot(o.p.x - home[1 - s].x, o.p.z - home[1 - s].z);
        if (moving) { if (k > ft.k) dur = Math.min(0.45, (1 - duty) * Tc); }
        else if (o.t < 0 && e > 0.14 && e >= eo) dur = 0.24 + 0.1 * m();
        // 뒤에 남은 발: 출발하며 가속할 때는 걸음 박자가 느려 디딘 발이 0.8 m 뒤에 남았고 골반이 그 발에 닿도록 주저앉았다. 박자와 상관없이 든다
        if (!dur && e > Math.max(0.45, 0.55 * stepLen) && (o.t < 0 || o.t > 0.6 || e > 0.7)) dur = 0.26;
        ft.k = k;
        if (dur > 0) {
          ft.from.copy(ft.p); ft.t = 0; ft.dur = Math.max(0.12, dur);
          ft.vr = 0.92 + m() * 0.16; ft.jit = (m() - 0.5) * 0.045;
          ft.lift = (0.045 + 0.075 * Math.min(1, sp / 3)) * (1 - 0.45 * cr) * (0.75 + m() * 0.5);
          const g0 = this.footTarget(s, home[s], duty, Tc, moving, r);
          const gh = L.groundHeight(g0.x, g0.z, this.pos.y, 0.05, 0.42); ft.gy = gh > -0.4 && Math.abs(gh - this.pos.y) < 0.45 ? gh : this.pos.y;   // 실내 바닥(0.7 m)에서는 바깥 땅을 돌려줄 수 있다
        }
      }
      if (ft.t >= 0) {
        ft.t = Math.min(1, ft.t + dt / ft.dur);
        const tgt = this.footTarget(s, home[s], duty, Tc, moving, r);
        { const gh = L.groundHeight(tgt.x, tgt.z, this.pos.y, 0.05, 0.42); ft.gy = gh > -0.4 && Math.abs(gh - this.pos.y) < 0.45 ? gh : this.pos.y; }   // 단을 오르내리면 디딜 높이가 바뀐다
        // 발꿈치부터 들고 나서 앞으로 옮기고, 거의 다 옮긴 뒤 내려 딛는다(수평은 t 0.08~0.92, 높이는 앞쪽이 빨리 오른다)
        const u = Math.max(0, Math.min(1, (ft.t - 0.08) / 0.84)), e = u * u * (3 - 2 * u);
        ft.p.lerpVectors(ft.from, tgt, e);
        // 단을 오를 때는 발을 먼저 단 높이까지 올리고, 내려갈 때는 거의 다 옮긴 뒤 내린다
        const ev = ft.gy > ft.from.y ? Math.min(1, ft.t * 2.2) : e;
        ft.p.y = ft.from.y + (ft.gy - ft.from.y) * ev * ev * (3 - 2 * ev) + Math.pow(Math.sin(Math.PI * ft.t), 0.7) * ft.lift;
        if (ft.t >= 1) {
          ft.t = -1; ft.p.y = ft.gy;
          // 디딤: 골반과 가슴이 한 번 내려앉고 발소리가 난다
          this.hrPv.y -= (0.05 + 0.28 * Math.min(1, sp / 3.3)) * (0.8 + m() * 0.4);
          this.hrCv.y -= 0.06 + 0.12 * Math.min(1, sp / 3.3);
          this.g.events.push({ type: 'botStep', pos: ft.p.clone(), mat: L.floorMaterial(ft.p.x, this.pos.y, ft.p.z), speed: Math.max(sp, 0.4) });
        }
      }
    }
  }

  // 든 발이 내려앉을 자리: 쉬는 자리 + 속도 × (남은 흔들기 시간 + 디딤 시간의 반). 디딘 발이 디딤의 한가운데에서 엉덩이 밑을 지나간다
  footTarget(s, home, duty, Tc, moving, r) {
    const ft = this.feet[s];
    const rem = (1 - Math.max(0, ft.t)) * ft.dur, stance = moving ? duty * Tc : 0;
    return home.clone().addScaledVector(this.avel, (rem + stance * 0.5) * ft.vr).addScaledVector(r, ft.jit);
  }

  // 피격, 디딤, 가속에 반응하는 감쇠 스프링 층(골반, 가슴, 머리의 어긋남)
  springs(dt) {
    const ax = (this.avel.x - this.prevVel.x) / Math.max(dt, 1e-3), az = (this.avel.z - this.prevVel.z) / Math.max(dt, 1e-3);
    this.prevVel.copy(this.avel);
    const S = (x, v, k, c, fx, fy, fz, mx) => {
      v.x += (-k * x.x - c * v.x + fx) * dt; v.y += (-k * x.y - c * v.y + fy) * dt; v.z += (-k * x.z - c * v.z + fz) * dt;
      x.addScaledVector(v, dt);
      const l = x.length(); if (l > mx) { x.multiplyScalar(mx / l); v.multiplyScalar(0.5); }
    };
    const cl = (a) => Math.max(-30, Math.min(30, a));
    S(this.hrP, this.hrPv, 16, 6, 0, 0, 0, 0.32);   // 골반: 맞은 뒤 천천히 돌아온다(전에는 34·7.5로 0.2초 만에 꼿꼿이 서서 '맞고-회복-쓰러짐'으로 보였다)
    S(this.hrC, this.hrCv, 70, 9, -cl(ax) * 0.35, 0, -cl(az) * 0.35, 0.3);
    S(this.hrH, this.hrHv, 130, 11, -cl(ax) * 0.15, 0, -cl(az) * 0.15, 0.2);
  }

  pose(t, dt) {
    const f = V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const H = this.height;
    const sp = Math.min(1, this.speed / 3.5);
    const cr = this.crouch;
    const idle = Math.max(0, 1 - this.speed * 2) * (1 - cr);
    const wSide = (this.idx % 2) ? 1 : -1;
    if (!this.feet || dt === 0) this.gait(0);
    const F = this.feet;
    const LT = 0.455 * H, LS = 0.435 * H, REACH = (LT + LS) * 0.995, HIPW = 0.11 * H, HIPD = 0.05;
    const run = Math.min(1, Math.max(0, (this.speed - 2.2) / 1.1));
    // 골반: 무게를 디딘 발 쪽으로 옮기고, 디딘 발이 닿는 높이를 넘지 않는다(걸으면 두 발로 설 때 낮아지는 뒤집힌 진자)
    let cx = 0, cz = 0, n = 0;
    for (const ft of F) if (ft.t < 0 || ft.t > 0.9) { cx += ft.p.x; cz += ft.p.z; n++; }
    const lat = n ? (cx / n - this.pos.x) * r.x + (cz / n - this.pos.z) * r.z : 0;
    const shiftT = lat * (0.5 - 0.3 * run) + idle * wSide * (0.035 + 0.012 * Math.sin(t * 0.37 + this.idx));
    const kk = dt > 0 ? 1 - Math.exp(-dt * 9) : 1;
    this.shift += (shiftT - this.shift) * kk;
    const pelvis = this.pos.clone().addScaledVector(r, this.shift).addScaledVector(f, -cr * 0.06).add(this.hrP);
    const base = this.pos.y + 0.06 + (LT + LS) * (0.975 - 0.035 * run - 0.02 * sp) + HIPD - cr * 0.42 * H + this.hrP.y;
    const dlt = Math.max(-0.4, Math.min(0.4, (F[0].p.x - F[1].p.x) * f.x + (F[0].p.z - F[1].p.z) * f.z));
    const tw = Math.max(-0.22, Math.min(0.22, dlt * 0.38)) * (1 - cr * 0.7);   // 앞으로 나간 발 쪽 엉덩이가 앞으로 돈다
    const rp = r.clone().multiplyScalar(Math.cos(tw)).addScaledVector(f, -Math.sin(tw));
    let yMax = Infinity;
    for (let s = 0; s < 2; s++) {
      const ft = F[s]; if (!(ft.t < 0 || ft.t > 0.85)) continue;
      const hx = pelvis.x + rp.x * (s ? 1 : -1) * HIPW, hz = pelvis.z + rp.z * (s ? 1 : -1) * HIPW;
      const hd = Math.hypot(hx - ft.p.x, hz - ft.p.z);
      // 뒤에 남은 발은 발끝으로 서서(발꿈치가 들려) 8 cm까지 더 닿는다
      const behind = (ft.p.x - hx) * f.x + (ft.p.z - hz) * f.z < -0.1 ? 0.08 : 0;
      yMax = Math.min(yMax, ft.p.y + 0.06 + behind + Math.sqrt(Math.max(0, REACH * REACH - hd * hd)) + HIPD);
    }
    const py = Math.min(base, yMax);
    if (this.pelY === null || dt === 0) this.pelY = py; else this.pelY += (py - this.pelY) * (1 - Math.exp(-dt * 20));
    pelvis.y = Math.min(this.pelY, yMax + 0.01);
    this.J[J.pelvis].copy(pelvis);
    // 다리: 엉덩이에서 발목까지 두 마디 IK. 무릎은 앞(조금 바깥)으로 굽는다. 흔드는 다리 쪽 골반이 조금 내려간다
    for (let s = 0; s < 2; s++) {
      const side = s ? 1 : -1, ft = F[s];
      const sw = ft.t >= 0 ? Math.sin(Math.PI * ft.t) * Math.min(1, this.speed * 1.5) : 0;
      const hip = pelvis.clone().addScaledVector(rp, side * HIPW).add(V(0, -HIPD - sw * 0.025 * (1 - run), 0));
      const ank = ft.p.clone().add(V(0, 0.06, 0));
      const d = ank.clone().sub(hip); let dl = d.length();
      if (dl > LT + LS - 1e-3) { d.multiplyScalar((LT + LS - 1e-3) / dl); dl = LT + LS - 1e-3; ank.copy(hip).add(d); }
      const ax = d.clone().divideScalar(dl);
      const a = (LT * LT - LS * LS + dl * dl) / (2 * dl), h = Math.sqrt(Math.max(0, LT * LT - a * a));
      const bend = f.clone().addScaledVector(r, side * 0.07); bend.addScaledVector(ax, -bend.dot(ax)).normalize();
      const knee = hip.clone().addScaledVector(ax, a).addScaledVector(bend, h);
      const [jh, jk, jf] = s ? [J.hipR, J.knR, J.ftR] : [J.hipL, J.knL, J.ftL];
      this.J[jh].copy(hip); this.J[jk].copy(knee); this.J[jf].copy(ank);
    }
    const lean = 0.08 + this.aimRaise * 0.12 + cr * 0.25 + sp * 0.12;
    const spineUp = V(0, 1, 0).addScaledVector(f, Math.sin(lean) + idle * 0.012 * Math.sin(t * 1.3 + this.idx)).addScaledVector(r, -idle * wSide * 0.06 - this.shift * 0.25).normalize();
    const chest = pelvis.clone().addScaledVector(spineUp, 0.5 * H).add(this.hrC);
    chest.sub(pelvis).setLength(0.5 * H).add(pelvis);
    // 조준하면 상체가 조준 방향으로 비틀림. 걸을 때 어깨는 골반과 반대로 돈다
    const twist = Math.max(-0.6, Math.min(0.6, angDiff(this.aimYaw, this.yaw))) - tw * 0.6 * (1 - this.aimRaise * 0.7);
    const tf = V(-Math.sin(this.yaw + twist), 0, -Math.cos(this.yaw + twist)), tr = V(Math.cos(this.yaw + twist), 0, -Math.sin(this.yaw + twist));
    this.J[J.chest].copy(chest);
    const sU = chest.clone().sub(pelvis).normalize();
    const headDir = sU.clone().addScaledVector(tf, 0.12 + this.aimPitch * 0.15).normalize().multiplyScalar(0.215 * H).add(this.hrH).setLength(0.215 * H);
    this.J[J.head].copy(chest).add(headDir);
    this.J[J.shL].copy(chest).addScaledVector(tr, -0.19 * H).add(V(0, -0.04, 0));
    this.J[J.shR].copy(chest).addScaledVector(tr, 0.19 * H).add(V(0, -0.04, 0));
    // 총 방향: 조준 중이면 aimYaw/aimPitch, 아니면 앞으로 낮게. 낮춰 든 총은 걸음마다 좌우로 조금 흔들린다
    const gp = this.aimPitch * this.aimRaise + (-0.5) * (1 - this.aimRaise);
    const gy = this.aimYaw + Math.sin(this.gaitC * Math.PI * 2) * 0.06 * Math.min(1, this.speed) * (1 - this.aimRaise);
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
    // 살펴보기용(테스트 진입 경로 ?bots=…,bind): 몸 메시의 바인드 자세 그대로 세운다
    if (this.testBind) for (let i = 0; i < 15; i++) { const b = BIND_J[i]; this.J[i].copy(this.pos).addScaledVector(r, b.x).addScaledVector(f, -b.z); this.J[i].y += b.y; }
  }

  render() {
    const P = this.parts, j = this.J;
    const side = j[J.shR].clone().sub(j[J.shL]);
    const up = j[J.chest].clone().sub(j[J.pelvis]);
    const fwdT = new THREE.Vector3().crossVectors(side, up).normalize();
    const hu = j[J.head].clone().sub(j[J.chest]);
    placeBasis(P.head, j[J.head], side, hu);
    // 머리는 조준 방향을 본다
    if (this.alive) { P.head.rotation.set(-this.aimPitch * 0.6 * this.aimRaise, this.aimYaw + 0, 0, 'YXZ'); }
    P.head.updateMatrix();
    // 몸: 관절을 따라 뼈를 놓는다(머리 뼈는 헬멧과 같은 틀)
    this.body.pose(j, P.head.matrix);
    const dt = this.g.lastDt || 1 / 60;
    for (const gr of this.gear) gr.update(this.body.boneMatrix(gr.bone), dt);
    placeLimb(P.sling, j[J.shL].clone().addScaledVector(fwdT, -0.12), this.gun.position);
    if (this.alive) {
      const gp = this.gunPose;
      _m.lookAt(V(0, 0, 0), gp.dir, UP);
      this.gun.quaternion.setFromRotationMatrix(_m);
      this.gun.position.copy(gp.pos);
    }
    const gh = this.alive ? this.pos.y : this.g.level.groundHeight(j[J.pelvis].x, j[J.pelvis].z, j[J.pelvis].y + 0.3, 0.05, 0.4);
    // 그림자 캡슐: 두 발 사이에서 머리까지. 쓰러지면 누운 몸을 따라간다
    const su = this.blob.material.userData.local;
    su.uCA.value.copy(j[J.ftL]).add(j[J.ftR]).multiplyScalar(0.5); su.uCA.value.y = Math.max(su.uCA.value.y, gh + 0.1);
    su.uCB.value.copy(j[J.head]); su.uCB.value.y = Math.max(su.uCB.value.y, gh + 0.12);
    this.blob.position.set((su.uCA.value.x + su.uCB.value.x) / 2, gh + 0.012, (su.uCA.value.z + su.uCB.value.z) / 2);
    const fx = this.g.level.fixtures;
    for (let i = 0; i < 8; i++) { const f = fx[i]; if (f) { su.uLP.value[i].copy(f.light.position); su.uLI.value[i] = f.light.visible ? f.light.intensity : 0; } }
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
    this.impact(part, dir, point, 1);
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

  // 맞은 자리의 충격(2단계 ②). 몸통은 맞은 높이에 따라 가슴과 골반에 나눠 주고, 머리는 젖혀지고, 다리는 무릎이 꺾여 주저앉는다.
  // 크기와 방향은 매번 다르다. 그 전에는 등뼈를 맞은 방향으로 0.25 기울였다 돌아오는 것 하나였다
  impact(part, dir, point, gain) {
    const m = this.mr, d = dir.clone().setY(0); if (d.lengthSq() < 1e-6) d.set(0, 0, 1); d.normalize();
    const q = (0.75 + m() * 0.5) * gain, side = V(-d.z, 0, d.x).multiplyScalar((m() - 0.5) * 0.8);
    const pv = this.J[J.pelvis], cv = this.J[J.chest];
    if (part === 'head') { this.hrHv.addScaledVector(d, 2.6 * q).add(V(0, 0.4 * q, 0)); this.hrCv.addScaledVector(d, 0.8 * q); this.hrPv.addScaledVector(d, 0.25 * q); }
    else if (part === 'torso') {
      const hi = Math.max(0, Math.min(1, (point.y - pv.y) / Math.max(0.1, cv.y - pv.y)));
      this.hrCv.addScaledVector(d, (0.7 + 1.1 * hi) * q).addScaledVector(side, q); this.hrPv.addScaledVector(d, (0.25 + 0.9 * (1 - hi)) * q).add(V(0, -0.35 * q, 0));
      this.hrHv.addScaledVector(d, -0.6 * q).add(V(0, -0.3 * q, 0));
    } else if (point.y < pv.y) { this.hrPv.addScaledVector(d, 0.5 * q).add(V(0, -1.1 * q, 0)); this.hrCv.addScaledVector(d, -0.3 * q); this.crouch = Math.min(1, this.crouch + 0.3 * q); }
    else { this.hrCv.addScaledVector(d, 0.6 * q).addScaledVector(side, 1.2 * q); }
    // 맞으면 총구가 처진다(A/B 73·74: 총 든 팔이 뻣뻣하게 위로 들리는 것이 연출로 읽혔다). 몸통을 맞으면 무릎도 조금 꺾여 그 자세가 남는다
    if (this.alive) { this.aimYaw += (m() - 0.5) * 0.3 * q; this.aimPitch -= (0.03 + m() * 0.09) * q; if (part === 'torso') this.crouch = Math.min(1, this.crouch + 0.22 * q); }
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
    // 근육이 남은 인형(2단계 ②): 몸통 틀에 대한 관절 자리를 기억해 두고, 관절마다 정한 시간에 걸쳐 그 자세로 당기는 힘을 푼다.
    //  다리는 바로 풀려 무릎이 꺾이고, 팔은 0.06~0.2초, 등과 머리는 0.15~0.45초 버틴다. 풀리는 차례와 시간은 매번 다르다
    const m = this.mr, fr = ragFrame(P), loc = P.map(p => { const v = p.clone().sub(P[0]); return [v.dot(fr.s), v.dot(fr.u), v.dot(fr.f)]; });
    const lg = [m() * 0.08, m() * 0.08], ar = 0.06 + m() * 0.14;   // 다리는 바로, 팔은 0.06~0.2초에 풀린다(A/B 73·74: 오래 버티는 팔과 다리가 '팔을 휘젓다 늦게 쓰러진다'로 읽혔다)
    // 상체는 맞은 방향으로 넘어간다(무릎만 꺾여 꿇어앉은 채 멈추지 않게)
    { const tp = 0.25 + m() * 0.35, dh = dir.clone().setY(0).normalize(); for (const [i, k] of [[J.chest, 1], [J.head, 1.2], [J.shL, 1], [J.shR, 1]]) prev[i].addScaledVector(dh, -tp * k * dt); }   // 속도는 이전 위치(prev)로 준다
    const hold = [0, 0.25 + m() * 0.2, 0.15 + m() * 0.2, ar, ar * (0.8 + m() * 0.3), ar * (0.6 + m() * 0.3), ar, ar * (0.8 + m() * 0.3), ar * (0.6 + m() * 0.3), lg[0] + 0.1, lg[0], lg[0], lg[1] + 0.1, lg[1], lg[1]];
    // 총은 손에서 빠져 손 옆에 떨어진다(그 전에는 몸과 같이 넘어가 몸을 뚫고 섰다, A/B 72)
    const gth = V(-dir.z, 0, dir.x).multiplyScalar((m() < 0.5 ? -1 : 1) * (0.2 + m() * 0.3)).add(V(0, 0.05 + m() * 0.15, 0));   // 손에서 놓쳐 손 옆에 떨어진다(A/B 76: 멀리 던진 총이 몸 옆의 긴 막대로 읽혔다)
    // 넘어갈 방향: 맞은 방향에서 옆으로 ±35° 안. 몸통이 아직 서 있는 동안 이쪽으로 균형을 잃는다(아래 stepRagdoll)
    const tip = (() => { const a = (m() - 0.5) * 1.2, d = dir.clone().setY(0); if (d.lengthSq() < 1e-6) d.set(0, 0, 1); d.normalize(); return V(d.x * Math.cos(a) - d.z * Math.sin(a), 0, d.x * Math.sin(a) + d.z * Math.cos(a)); })();
    const leg = [m(), m()];   // 누운 뒤 다리를 펴는 정도(반쯤 굽힘~거의 폄), 다리마다 다르다
    this.ragdoll = { tip, tipA: 2.5 + m() * 2.5, leg, loc, hold, P, prev, rest, t: 0, gun: { a: g0, b: g1, pa: g0.clone().addScaledVector(dir, -dt * 1.5).add(V(0, dt, 0)).addScaledVector(gth, -dt), pb: g1.clone().addScaledVector(dir, -dt * 0.5).addScaledVector(gth, -dt * 0.5).add(V(0, -dt * 0.8, 0)), len: g0.distanceTo(g1) }, sleep: false };
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
      if (R.tip && R.t < 1.5 && R.P[J.chest].y - R.P[J.pelvis].y > 0.25) {
        // 균형 잃기(A/B 77: 무릎이 꺾인 뒤 상체가 꼿꼿이 선 채 무릎 꿇고 멈췄다). 서 있는 상체는 뒤집힌 진자라 조금만 기울어도 넘어간다
        const up = (R.P[J.chest].y - R.P[J.pelvis].y) / (R.P[J.chest].distanceTo(R.P[J.pelvis]) || 1), a = R.tipA * up * h * h;
        for (const [i, k] of [[J.chest, 1], [J.head, 1.2], [J.shL, 1], [J.shR, 1]]) R.P[i].addScaledVector(R.tip, a * k);
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
      // 근육: 몸통 틀 기준의 죽기 직전 자세로 당긴다. 다리는 골반과, 팔과 머리는 가슴과 나눠 움직여 몸을 떠받친다
      if (R.loc) {
        const fr = ragFrame(R.P), P0 = R.P[0];
        for (let i = 1; i < 15; i++) {
          const T = R.hold[i]; if (!(R.t < T)) continue;
          const k = 0.25 * Math.pow(1 - R.t / T, 1.5), l = R.loc[i];
          const c = P0.clone().addScaledVector(fr.s, l[0]).addScaledVector(fr.u, l[1]).addScaledVector(fr.f, l[2]).sub(R.P[i]).multiplyScalar(k);
          const base = i >= J.hipL ? R.P[0] : R.P[1];
          if (i === J.chest) { R.P[i].addScaledVector(c, 0.5); R.P[0].addScaledVector(c, -0.5); }
          else { R.P[i].addScaledVector(c, 0.6); base.addScaledVector(c, -0.4); }
        }
      }
      // 누운 뒤(몸통이 거의 수평): 근육이 풀린 팔다리는 무게로 펴진다. 접힌 다리를 조금씩 늘여 몸 밑에 깔린 덩어리로 멈추지 않게 한다
      if (R.t > 0.6 && R.P[1].y - R.P[0].y < 0.22) {
        for (const [a, b, L0] of [[J.hipL, J.ftL, 0.62 + 0.12 * R.leg[0]], [J.hipR, J.ftR, 0.62 + 0.12 * R.leg[1]], [J.shL, J.haL, 0.42], [J.shR, J.haR, 0.42]]) {
          const d = R.P[b].clone().sub(R.P[a]), l = d.length(); if (l < L0 && l > 1e-4) R.P[b].addScaledVector(d, (L0 - l) / l * 0.03);
        }
      }
      // 바닥·벽 충돌. 몸통 점은 몸의 두께만큼 반경을 둔다(그 전에는 모두 7 cm라 몸통이 바닥에 납작하게 깔렸다)
      const pts = [...R.P.map((p, i) => [p, R.prev[i], RAD[i]]), [R.gun.a, R.gun.pa, 0.04], [R.gun.b, R.gun.pb, 0.03]];
      for (const [p, q, rad] of pts) {
        const gh = L.groundHeight(p.x, p.z, p.y + 0.15, 0.0, 0.3);
        if (p.y < gh + rad) {
          p.y = gh + rad;
          // 마찰
          q.x = p.x - (p.x - q.x) * 0.55; q.z = p.z - (p.z - q.z) * 0.55;
          if (q.y < p.y) q.y = p.y + (q.y - p.y) * -0.15;
        }
        L.collide(p, rad, p.y - 0.05, 0.1, 0.0);
      }
      // 총은 몸통을 뚫지 않는다
      for (const p of [R.gun.a, R.gun.b]) for (const i of [0, 1, 2, 3, 6, 9, 12]) { const d = p.clone().sub(R.P[i]), l = d.length(), rr = RAD[i] + 0.04; if (l < rr && l > 1e-5) p.addScaledVector(d, (rr - l) / l); }
      // 경첩: 무릎은 몸 앞쪽으로만, 팔꿈치는 몸 앞쪽으로 크게 꺾이지 않는다
      hinge(R.P);
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
    if (!this.alive) return;
    if (this.dormant) {
      // 정지 상태여도 총성에는 움찔하고 소리 쪽으로 몸을 돌린다
      if (loud > 20 && this.pos.distanceTo(pos) < loud) {
        this.startle = 1; this.startleDelay = 0.12 + this.rng() * 0.25;
        this.lookYaw = Math.atan2(-(pos.x - this.pos.x), -(pos.z - this.pos.z));
        this.hitFlinch = Math.max(this.hitFlinch, 0.5); this.flinchDir.set(this.pos.x - pos.x, 0, this.pos.z - pos.z).normalize();
        this.hrCv.addScaledVector(this.flinchDir, -0.35 * (0.7 + this.mr() * 0.6)); this.hrPv.y -= 0.25;
      }
      return;
    }
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
    const px0 = this.pos.x, pz0 = this.pos.z;
    const g = this.g, p = g.player, r = this.rng, L = g.level;
    // 촬영용(테스트 진입 경로 ?bots=…,dead): 첫 프레임에 플레이어 쪽에서 가슴에 맞은 것처럼 쓰러진다
    if (this.testKill) { this.testKill = false; const c = this.chest, d = c.clone().sub(V(p.pos.x, p.pos.y + 1.3, p.pos.z)).normalize(); this.die(d, c, 'torso'); this.stepRagdoll(dt); this.render(); return; }
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
    if (this.dormant) { this.state = this.dormant === 'walk' ? 'patrol' : this.dormant === 'march' || this.dormant === 'run' ? 'march' : 'idle'; }

    switch (this.state) {
      case 'idle': {
        this.startleDelay = (this.startleDelay || 0) - dt;
        const st = this.startleDelay > 0 ? 0 : (this.startle || 0);
        this.startle = Math.max(0, (this.startle || 0) - dt * 0.15);
        raise = this.dormant === 'aim' ? 1 : st * 0.95; wantCrouch = st * 0.45;
        if (st <= 0) this.lookYaw += Math.sin(now * 0.3 + this.idx) * 0.002;
        faceYaw = st > 0 ? this.lookYaw : this.lookYaw; break;
      }
      // 촬영용: 바라보는 방향으로 곧게 걷거나 뛴다(테스트 진입 경로 전용)
      case 'march': {
        const run = this.dormant === 'run', s = run ? 3.3 : 1.3;
        raise = run ? 0.3 : 0; faceYaw = this.lookYaw;
        this.vel.x += (-Math.sin(this.lookYaw) * s - this.vel.x) * (1 - Math.exp(-dt * 6));
        this.vel.z += (-Math.cos(this.lookYaw) * s - this.vel.z) * (1 - Math.exp(-dt * 6));
        break;
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
    } else if (this.state !== 'march') {
      this.vel.x *= Math.exp(-dt * 8); this.vel.z *= Math.exp(-dt * 8);
    }
    // 다른 봇, 플레이어와 겹치지 않게
    for (const o of g.bots) if (o !== this && o.alive) { const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d = Math.hypot(dx, dz); if (d < 0.7 && d > 1e-3) { this.pos.x += dx / d * (0.7 - d) * 0.5; this.pos.z += dz / d * (0.7 - d) * 0.5; } }
    { const dx = this.pos.x - p.pos.x, dz = this.pos.z - p.pos.z, d = Math.hypot(dx, dz); if (d < 0.65 && d > 1e-3) { this.pos.x += dx / d * (0.65 - d); this.pos.z += dz / d * (0.65 - d); } }

    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    L.collide(this.pos, 0.28, this.pos.y, 1.7);
    const gh = L.groundHeight(this.pos.x, this.pos.z, this.pos.y, 0.15, 0.42);
    if (gh > -0.4) this.pos.y += (gh - this.pos.y) * Math.min(1, dt * 16);
    // 걸음은 실제로 움직인 속도를 쓴다(벽이나 방벽에 막혀 서 있는데 발만 원래 속도로 앞으로 디뎌 다리가 벌어지고 주저앉았다, A/B 72)
    { const k = 1 - Math.exp(-dt * 12), ax = (this.pos.x - px0) / Math.max(dt, 1e-3), az = (this.pos.z - pz0) / Math.max(dt, 1e-3); this.avel.x += (Math.max(-6, Math.min(6, ax)) - this.avel.x) * k; this.avel.z += (Math.max(-6, Math.min(6, az)) - this.avel.z) * k; }
    this.speed = Math.hypot(this.avel.x, this.avel.z);
    // 걸음 위상 (보폭에 맞춤) 과 발소리
    const stride = 0.7 + Math.min(1, this.speed / 3.5) * 0.45;
    this.walkPhase += this.speed / stride * Math.PI * dt;

    // 몸 회전: 사람처럼 약간의 지연
    if (faceYaw !== null) {
      const turn = 4.5 * dt;
      const dy = angDiff(faceYaw, this.yaw);
      this.yaw += Math.max(-turn, Math.min(turn, dy * Math.min(1, dt * 7)));
    }
    // 조준 방향
    const tgt = (this.state === 'engage' || this.state === 'cover') && this.lastKnown ? this.lastKnown : this.dormant === 'aim' ? p.pos : null;
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
    this.springs(dt);
    this.gait(dt);
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

// 쓰러짐의 몸통 틀: u 골반→가슴, s 왼어깨→오른어깨(u에 수직), f = u × s(몸 앞)
function ragFrame(P) {
  const u = P[1].clone().sub(P[0]).normalize(), s = P[6].clone().sub(P[3]); s.addScaledVector(u, -s.dot(u)).normalize();
  return { u, s, f: new THREE.Vector3().crossVectors(u, s) };
}
const RAD = [0.13, 0.14, 0.11, 0.08, 0.055, 0.05, 0.08, 0.055, 0.05, 0.09, 0.065, 0.06, 0.09, 0.065, 0.06];
function hinge(P) {
  const fr = ragFrame(P);
  for (const [a, b, c, mn, mx] of [[9, 10, 11, 0.015, 9], [12, 13, 14, 0.015, 9], [3, 4, 5, -9, 0.08], [6, 7, 8, -9, 0.08]]) {
    const ax = P[c].clone().sub(P[a]); const l = ax.length(); if (l < 1e-4) continue; ax.divideScalar(l);
    const v = P[b].clone().sub(P[a]); const perp = v.addScaledVector(ax, -v.dot(ax));
    const fd = perp.dot(fr.f);
    if (fd < mn) P[b].addScaledVector(fr.f, mn - fd); else if (fd > mx) P[b].addScaledVector(fr.f, mx - fd);
  }
}

export function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
