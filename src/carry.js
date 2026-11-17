// 몸에 들린 질량: 총과 두 팔을 가슴(카메라)에 매달린 강체 하나로 본다(2단계 ④, 2026-11-17).
// 이전에는 총이 카메라 틀 안에서 몸의 움직임과 상관없는 신호로만 움직였다. 걸음 위상의 사인, 0을 향해 같은 모양으로 튀었다 돌아오는
// 반동 스프링 둘, 위아래 가속을 0.03배로 받는 스프링 하나였다. 그래서 걸음 두 번마다 총이 같은 자리로 돌아왔고(0.5초 떨어진 프레임 차 3~5 px),
// 0.5 m 점프에서 총이 10 px밖에 움직이지 않았으며, 연사 묶음의 1↔5, 2↔6 프레임이 같았다(PROGRESS.md 2단계 ④ 원인).
//
// 상태는 카메라 기준이다. 병진 u(m)와 지지점(weapons.js PIVOT)을 축으로 한 회전 th(숙임 x +위, 돌림 y +왼쪽, 기울임 z), 그리고 각각의 속도다.
// 팔은 스프링과 댐퍼다. 강성은 자세마다 다르다(낮춰 든 자세가 가장 느슨하고, 조준하면 가장 단단하다). 긴장에 따라 천천히 바뀐다.
// 진동 모드는 둘이다. 느린 모드(2~4 Hz)는 팔과 몸통 전체가 총을 받치는 움직임이고, 빠른 모드(7~10 Hz)는 개머리판과 어깨, 손바닥과 손잡이 사이의
// 단단한 접촉이다. 느린 모드 하나만 두면 연사(0.088초 간격)의 충격이 걸러져 총이 한자리에 떠 있고 발마다 튀지 않는다(1단 시도에서 쟀다)
// 총에 걸리는 힘:
//  1. 가슴의 가속도: 카메라 위치를 두 번 미분해 카메라 기준으로 쓴다. 관성력(-a)이 지지점 앞의 무게중심에 걸려 병진과 숙임이 함께 생긴다.
//     걸음, 점프, 낙하, 착지, 출발과 정지가 같은 식이다. 몸이 떨어지면 팔이 받치던 무게가 풀려 총이 뜨고, 착지하면 몸보다 늦게 멈춰 처진다
//  2. 걸음 충격: 발마다 크기와 방향이 다르고 왼발과 오른발이 반대로 돌린다
//  3. 사격 충격: 총열 축을 따라 미는 힘과 들림 토크, 옆과 기울임 토크가 발마다 다르다. 바로잡지 못한 들림(hold)이 발마다 쌓인다.
//     사람은 연사 중에 계속 누르지 못하고 0.15~0.25초마다 끊어서 바로잡는다(간헐 제어). 매번 덜 잡거나 더 잡아서, 쥐는 자리가 톱니처럼 떠돈다
//  4. 숨: 운동량에 따라 빠르기와 깊이가 바뀐다  5. 손떨림: 8~12 Hz 띠의 잡음
// 개머리판과 손바닥(빠른 모드)이 총에 준 힘의 반작용은 가슴(카메라)을 민다. 카메라의 사격 반동은 이것뿐이다(takeReaction).
// 이전에는 카메라 반동을 발마다 같은 스프링에 같은 쪽(위)으로 따로 넣어, 배경의 발마다 궤적이 상관 0.96으로 같았다
import * as THREE from 'three';
import { noise1 } from './rng.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 무기별 값. w는 고유 진동수(rad/s, [낮춤, 쏘는 자세, 조준]), z는 감쇠비, lever는 지지점에서 무게중심까지(카메라 기준, m)
const ARM = {
  rifle: { wt: [12, 16, 26], wr: [13, 18, 28], z: [0.34, 0.4, 0.6], lever: V(0, -0.02, -0.3) },
  pistol: { wt: [12, 15, 22], wr: [13, 17, 24], z: [0.34, 0.4, 0.55], lever: V(0, 0, -0.24) },
};
// 사격 충격(속도 변화, 카메라 기준). 병진 m/s: x 옆, y 위, z 뒤. 회전 rad/s: x 들림, y 옆, z 기울임
const KICK = {
  rifle: { up: [0.04, 0.09], back: [0.22, 0.38], side: 0.05, pitch: [0.6, 1.9], yaw: 1.0, roll: 1.2, climb: [0.01, 0.022], wander: 0.03 },
  pistol: { up: [0.07, 0.13], back: [0.2, 0.34], side: 0.05, pitch: [1.5, 2.5], yaw: 0.6, roll: 0.8, climb: [0.01, 0.02], wander: 0.018 },
};
// 빠른 모드(접촉): 고유 진동수 [낮춤, 쏘는 자세, 조준], 감쇠비, 그리고 사격·걸음 충격 중 이 모드로 가는 몫
const FAST = {
  rifle: { w: [42, 48, 60], z: 0.32, back: [0.28, 0.5], up: [0.02, 0.06], side: 0.04, pitch: [2.0, 4.4], yaw: 2.2, roll: 2.0 },
  pistol: { w: [40, 46, 56], z: 0.3, back: [0.24, 0.42], up: [0.04, 0.09], side: 0.04, pitch: [2.8, 5.4], yaw: 1.6, roll: 1.5 },
};
const lerp3 = (a, k) => (k < 1 ? a[0] + (a[1] - a[0]) * k : a[1] + (a[2] - a[1]) * (k - 1));
// 달리기 자세(총을 가슴에 당겨 붙임)에서 가슴의 가속 가운데 팔이 더 받아 내는 몫. 걷다 뛰기 시작하는 가속에 총이 옆으로 200 px 넘게 흔들렸다(2단계 ④ 원인 6)
const BRACE_SPRINT = 0.6;

export class Carry {
  constructor(rng) {
    this.rng = rng;
    this.u = V(0, 0, 0); this.uv = V(0, 0, 0);
    this.th = V(0, 0, 0); this.tv = V(0, 0, 0);
    this.fu = V(0, 0, 0); this.fuv = V(0, 0, 0); this.fth = V(0, 0, 0); this.ftv = V(0, 0, 0);   // 빠른 모드
    this.fK = 1;   // 빠른 모드의 단단함 배율: 개머리판을 어깨에 당겨 붙인 힘이 순간마다 달라 발마다 다르다
    this.reactR = V(0, 0, 0); this.reactU = V(0, 0, 0);   // 가슴이 받은 반작용(회전 rad/s, 병진 m/s), 프레임마다 가져간다
    this.hold = V(0, 0, 0);           // 쏘는 사람이 아직 바로잡지 못한 들림과 옆 돌림(rad). 스프링의 평형점이 이만큼 옮겨진다
    this.lastShot = -9; this.react = 0.16; this.recTau = 0.2; this.nextCorr = 0;
    this.fireAct = 0;   // 사격의 세기(발마다 오르고 0.6초에 걸쳐 가라앉는다). 반동에 흔들린 자세를 다시 세우는 몸의 흔들림을 키운다
    this.prevPos = null; this.prevVel = null; this.acc = V(0, 0, 0);
    this.breath = 0; this.lastFoot = null; this.sprintAgo = 9;
    this.out = { u: V(0, 0, 0), th: V(0, 0, 0) };
    this._qi = new THREE.Quaternion(); this._a = V(0, 0, 0); this._f = V(0, 0, 0); this._t = V(0, 0, 0);
  }
  reset() {
    this.u.set(0, 0, 0); this.uv.set(0, 0, 0); this.th.set(0, 0, 0); this.tv.set(0, 0, 0); this.hold.set(0, 0, 0);
    this.fu.set(0, 0, 0); this.fuv.set(0, 0, 0); this.fth.set(0, 0, 0); this.ftv.set(0, 0, 0);
    this.prevPos = null; this.prevVel = null; this.acc.set(0, 0, 0); this.lastFoot = null; this.sprintAgo = 9;
  }
  // 지난번에 가져간 뒤로 가슴이 받은 반작용(총에 준 충격량과 크기가 같고 방향이 반대인 힘의 적분, 총의 단위 질량 기준)
  takeReaction() { const o = { rot: this.reactR.clone(), pos: this.reactU.clone() }; this.reactR.set(0, 0, 0); this.reactU.set(0, 0, 0); return o; }
  // 한 번의 충격(속도 변화). du: 병진 m/s, dth: 회전 rad/s
  impulse(du, dth) { if (du) this.uv.add(du); if (dth) this.tv.add(dth); }

  // 발 하나가 땅을 디딘 순간. side: 오른발 +1, 왼발 -1. k: 걸음 세기(속도, 달리기, 앉기, 조준이 정한다)
  footfall(side, k) {
    const r = this.rng, g = () => 0.5 + r();
    // 발이 땅을 디디면 몸이 위로 받쳐지고(가슴의 가속도가 따로 들어온다) 팔에 든 총은 늦게 따라와 처지고 숙여진다.
    // 오른발(총을 든 쪽)은 오른 어깨를 밀어 올려 총끝이 왼쪽으로 돌고 윗면이 왼쪽으로 기운다. 왼발은 반대
    this.uv.add(V(side * 0.05 * g() * k, -0.1 * g() * k, (r() - 0.5) * 0.06 * k));
    this.tv.add(V(-0.6 * g() * k, side * 0.45 * g() * k + (r() - 0.5) * 0.25 * k, side * 1.0 * g() * k + (r() - 0.5) * 0.4 * k));
  }

  // 한 발 쐈다. kind: 'rifle' | 'pistol', k: 반동 세기(무기 반동 × 조준 감쇠), t: 게임 시간
  shot(kind, k, t) {
    const r = this.rng, K = KICK[kind], rr = (a) => a[0] + (a[1] - a[0]) * r();
    const side = r() < 0.5 ? -1 : 1;
    this.uv.add(V((r() - 0.5) * 2 * K.side * k, rr(K.up) * k, rr(K.back) * k));
    this.tv.add(V(rr(K.pitch) * k, (r() - 0.5) * 2 * K.yaw * k, side * (0.3 + r() * 0.7) * K.roll * k));
    // 접촉이 먼저 받는 날카로운 충격: 발마다 들림, 옆 돌림, 기울임의 크기와 방향이 다르다
    const Fk = FAST[kind], s2 = r() < 0.5 ? -1 : 1;
    this.fK = 0.55 + r() * 0.9;
    this.fuv.add(V((r() - 0.5) * 2 * Fk.side * k, rr(Fk.up) * k, rr(Fk.back) * k));
    this.ftv.add(V(rr(Fk.pitch) * k, (r() - 0.5) * 2 * Fk.yaw * k, s2 * (0.25 + r() * 0.75) * Fk.roll * k));
    // 바로잡지 못한 들림: 발마다 조금씩 남고 옆으로는 떠돈다
    this.hold.x += rr(K.climb) * k;
    this.hold.y += (r() - 0.5) * 2 * K.wander * k;
    this.hold.z += (r() - 0.5) * 2 * K.wander * 1.5 * k;
    if (t - this.lastShot > 0.3) this.nextCorr = t + 0.12 + r() * 0.1;   // 연사의 첫 발: 첫 바로잡기는 반응 시간 뒤
    this.lastShot = t;
    this.fireAct = Math.min(1, this.fireAct + 0.2 * k);
    this.react = 0.12 + r() * 0.08; this.recTau = 0.15 + r() * 0.12;
  }

  // o: { anchor(카메라 월드 위치), camQuat, kind, ads(0~1), alert(0~1), sprint(달리기 자세 섞임), sprintIntent(Shift 0/1), exertion, stress, foot(걸음 번호), moving, crouch, speed }
  update(dt, t, o) {
    if (!(dt > 0)) return this.out;
    const A = ARM[o.kind] || ARM.rifle;
    const T = t;
    t = t + (o.phase || 0);   // 잡음의 위상: 생명마다 다르다(weapons.js holdPhase)
    // 자세의 단단함: 0 낮춤 → 1 쏘는 자세 → 2 조준
    const pk = Math.min(1, o.alert || 0) + Math.min(1, o.ads || 0);
    // 팔의 긴장: 몇 초 단위로 바뀌고, 긴장(사격 직후, 피격)하면 단단해진다
    const tense = 1 + 0.16 * noise1(t * 0.55, 61) + 0.1 * noise1(t * 1.7, 62) + 0.3 * (o.stress || 0);
    // 걸을 때 낮춰 든 팔은 힘을 빼고 늘어진다(쏘는 자세와 조준에서는 아니다). 단단함이 줄어든 만큼 총이 무게로 처지고(아래 중력 항), 걸음의 충격에 더 크게 흔들린다.
    // 걷기에서는 더 늘어진다(walkLoose): 단단함이 35% 줄고, 가슴이 걸음마다 받는 가속을 팔이 미리 버티지 않아 관성력이 55% 대신 79%(돌림 30% → 50%) 넘어오며,
    // 발이 디딜 때의 충격이 어깨에서 덜 걸러져 1.5배로 온다. 이전 값에서는 걷는 동안 총구가 화면에서 위아래 ±9 px(720p, 약 ±1 cm)만 움직였다.
    // 2.4 cm 오르내리는 가슴에 1.5 Hz 남짓으로 매달린 팔(걸음은 2.2 Hz)이면 몸통과 비슷한 크기로 따로 논다(critic 39~40: '걷고 도는 동안 총이 오른쪽 아래에 그대로').
    // 달릴 때는 총을 몸에 당겨 붙여 다시 버티므로(달리기 자세) 이 몫이 없다. 넣어 보니 달리기의 옆 흔들림이 두 배가 됐다.
    // 버티는 것은 달리려는 순간(Shift, sprintIntent)부터다. 자세 섞임(o.sprint, 약 0.3초)을 따르면 걷다 뛰기 시작하는 가속을 늘어진 팔이 받아
    // 총이 화면 밖으로 빠졌다가 가운데로 크게 튀어 들어왔다(A/B 63 running-turn). 달리기를 멈춘 뒤에는 0.8초에 걸쳐 풀린다(멈추는 감속도 버틴 팔이 받는다)
    const loose = (0.2 + 0.1 * (o.sprint || 0)) * Math.min(1, o.moving || 0) * Math.max(0, 1 - pk);
    const sprintAny = Math.max(o.sprint || 0, o.sprintIntent || 0);
    this.sprintAgo = sprintAny > 0.05 ? 0 : this.sprintAgo + dt;
    const unbrace = Math.min(1, this.sprintAgo / 0.8), walkLoose = loose * unbrace * unbrace * (3 - 2 * unbrace);
    const relax = 1 - loose - 0.75 * walkLoose;
    const wt = lerp3(A.wt, pk) * Math.sqrt(tense) * relax, wr = lerp3(A.wr, pk) * Math.sqrt(tense) * relax, z = lerp3(A.z, pk);
    const FK = FAST[o.kind] || FAST.rifle, wf = lerp3(FK.w, pk) * Math.sqrt(tense * this.fK), zf = FK.z;

    // 1. 가슴의 가속도(카메라 기준). 순간 이동(시점 옮김, 다시 시작)은 건너뛴다
    const pos = o.anchor;
    if (this.prevPos && pos.distanceTo(this.prevPos) < 0.5) {
      const vel = pos.clone().sub(this.prevPos).divideScalar(dt);
      if (this.prevVel) {
        const a = vel.clone().sub(this.prevVel).divideScalar(dt);
        if (a.length() > 80) a.setLength(80);
        this._qi.copy(o.camQuat).invert(); a.applyQuaternion(this._qi);
        // 아주 짧은 꺾임(한 프레임)은 조금 무디게(프레임 간격이 들쭉날쭉할 때 흔들리지 않게)
        this.acc.lerp(a, 1 - Math.exp(-dt / 0.012));
      }
      this.prevVel = vel;
    } else { this.prevVel = null; this.acc.set(0, 0, 0); }
    this.prevPos = pos.clone();

    // 2. 걸음 충격: 새 발이 디뎠으면
    if (o.foot != null) {
      if (this.lastFoot != null && o.foot !== this.lastFoot && (o.moving || 0) > 0.2) {
        const k = Math.min(1.3, (o.speed || 0) / 2.75) * (1 + (o.sprint || 0) * 0.7) * (1 - (o.crouch || 0) * 0.35) * (1 - (o.ads || 0) * 0.6);
        this.footfall(o.foot % 2 ? 1 : -1, k * (1 + 2.5 * walkLoose));
      }
      this.lastFoot = o.foot;
    }

    // 3. 바로잡기: 쏘는 동안은 0.15~0.25초마다 끊어서 잡는다(매번 일부만 잡는다). 마지막 발에서 반응 시간이 지나면 빠르게 평형점으로 돌아온다
    const since = T - this.lastShot;
    if (since < this.react) {
      if (T >= this.nextCorr) {
        const r = this.rng;
        // 들림은 45~115%를 잡고(덜 누르거나 더 누른다), 옆 돌림과 기울임은 10~60%만 잡는다(연사 중에는 위로 뜨는 것을 누르는 데 힘이 간다)
        this.hold.x *= 1 - (0.45 + r() * 0.7); this.hold.y *= 1 - (0.1 + r() * 0.5); this.hold.z *= 1 - (0.1 + r() * 0.5);
        this.nextCorr = T + 0.15 + r() * 0.1;
      }
      this.hold.multiplyScalar(Math.exp(-dt / 2));
    } else this.hold.multiplyScalar(Math.exp(-dt / this.recTau));
    // 사격 중 몸의 흔들림(1~3 Hz): 반동이 발과 허리의 균형을 흔들고, 사람은 그것을 다시 세우며 총끝이 떠돈다. 발마다의 충격과 달리 이어진 움직임이다
    this.fireAct *= Math.exp(-dt / 0.6);
    const fAct = this.fireAct, sway = V(
      (noise1(t * 1.7, 71) * 0.6 + noise1(t * 2.9, 72) * 0.4) * 0.045 * fAct,
      (noise1(t * 1.4, 73) * 0.6 + noise1(t * 2.6, 74) * 0.4) * 0.05 * fAct,
      noise1(t * 1.9, 75) * 0.06 * fAct);

    // 4. 숨: 빠르기(분당 15~36회)와 깊이가 운동량을 따른다. 위상은 쌓아서 빠르기가 바뀌어도 이어진다
    const ex = o.exertion || 0, steady = 1 - (o.ads || 0) * 0.6;
    this.breath += dt * Math.PI * 2 * (0.25 + ex * 0.35) * (1 + 0.15 * noise1(t * 0.13, 63));
    const bA = (0.0025 + ex * 0.006) * steady;
    // 5. 손떨림: 생리적 떨림(8~12 Hz)은 긴장, 피로, 운동량이 키운다
    const trA = 0.0011 * (1 + 2 * (o.stress || 0) + ex) * steady;
    const trem = V(noise1(t * 9.3, 64) * 0.6 + noise1(t * 11.9, 65) * 0.4, noise1(t * 10.1, 66) * 0.6 + noise1(t * 8.4, 67) * 0.4, noise1(t * 9.7, 68) * 0.5).multiplyScalar(trA);

    // 가슴 가속도의 관성력은 팔이 일부를 미리 받아 낸다(근육이 버틴다). 병진 0.55, 숙임과 돌림 0.3(걸으며 늘어진 팔은 덜 버틴다, 위)
    // 달리기 자세는 총을 가슴에 당겨 붙인 자세라 가슴의 가속을 팔이 더 많이 받아 낸다(BRACE_SPRINT). 달리려는 순간부터다
    const brace = 1 - BRACE_SPRINT * sprintAny;
    const F = this._f.copy(this.acc).multiplyScalar(-(0.55 + 1.2 * walkLoose) * brace);
    const tq = this._t.copy(A.lever).cross(this.acc.clone().multiplyScalar(-1)).multiplyScalar((0.3 + walkLoose) * brace / A.lever.lengthSq());
    // 중력: 자세의 자리는 평소 단단함에서 무게를 받친 자리다. 팔이 늘어진 만큼(1 - (1 - loose)², 걷기의 더 늘어진 몫은 넣지 않는다)만 더 처지고 총구가 숙여진다(무게중심이 지지점 앞에 있다)
    const sag = 1 - (1 - loose) * (1 - loose);
    if (sag > 0) {
      const g = V(0, -9.8, 0).applyQuaternion(this._qi.copy(o.camQuat).invert());
      F.addScaledVector(g, sag);
      tq.add(A.lever.clone().cross(g).multiplyScalar(0.5 * sag / A.lever.lengthSq()));
    }
    const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    for (let i = 0; i < n; i++) {
      for (const ax of ['x', 'y', 'z']) {
        const au = -wt * wt * this.u[ax] - 2 * z * wt * this.uv[ax] + F[ax];
        this.uv[ax] += au * h; this.u[ax] += this.uv[ax] * h;
        const at = -wr * wr * (this.th[ax] - this.hold[ax] - sway[ax]) - 2 * z * wr * this.tv[ax] + tq[ax];
        this.tv[ax] += at * h; this.th[ax] += this.tv[ax] * h;
        const fa = -wf * wf * this.fu[ax] - 2 * zf * wf * this.fuv[ax], fr = -wf * wf * this.fth[ax] - 2 * zf * wf * this.ftv[ax];
        this.fuv[ax] += fa * h; this.fu[ax] += this.fuv[ax] * h;
        this.ftv[ax] += fr * h; this.fth[ax] += this.ftv[ax] * h;
        this.reactU[ax] -= fa * h; this.reactR[ax] -= fr * h;
      }
    }
    // 너무 크게 벌어지지 않게(팔이 뻗을 수 있는 범위). 부드럽게 누른다
    const soft = (x, m) => m * Math.tanh(x / m);
    this.out.u.set(soft(this.u.x + this.fu.x, 0.06), soft(this.u.y + this.fu.y, 0.07), soft(this.u.z + this.fu.z, 0.06)).add(V(0, Math.sin(this.breath) * bA, 0));
    this.out.th.set(soft(this.th.x + this.fth.x, 0.2), soft(this.th.y + this.fth.y, 0.15), soft(this.th.z + this.fth.z, 0.25)).add(trem).add(V(Math.sin(this.breath - 0.6) * bA * 0.9, 0, 0));
    return this.out;
  }
}
