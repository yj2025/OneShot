// 플레이어: 이동, 가슴 카메라 리그(총이 먼저, 몸과 카메라가 뒤따름), 걸음·착지·사격·피격 흔들림
import * as THREE from 'three';
import { noise1 } from './rng.js';
import { planParkour, buildParkourPath } from './parkour.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

class Spring3 {
  constructor(k, d) { this.k = k; this.d = d; this.x = V(0, 0, 0); this.v = V(0, 0, 0); }
  step(dt) {
    const n = Math.ceil(dt / 0.004), h = dt / n;
    for (let i = 0; i < n; i++) { this.v.addScaledVector(this.x, -this.k * h).multiplyScalar(Math.exp(-this.d * h)); this.x.addScaledVector(this.v, h); }
    return this.x;
  }
}

export class Player {
  constructor(level, rng) {
    this.level = level; this.rng = rng;
    this.pos = V(0, 0, 24); this.vel = V(0, 0, 0);
    this.aimYaw = 0; this.aimPitch = 0;
    this.bodyYaw = 0; this.camPitch = 0;
    this.crouch = 0; this.sprinting = false;
    this.hp = 100; this.alive = true;
    this.stepPhase = 0; this.stepDist = 0; this.nextStepLen = 0.72;
    this.camShake = new Spring3(90, 9);    // 회전 흔들림 (pitch, yaw, roll)
    this.camOffset = new Spring3(80, 10);  // 위치 흔들림
    this.camRecoil = new Spring3(140, 13);  // 사격 반동 (라디안)
    this.eyeSmooth = 0;
    this.exertion = 0;
    this.lastYaw = 0; this.lastPitch = 0; this.yawVel = 0; this.pitchVel = 0;
    this.deathT = 0; this.deathRoll = 0;
    this.radius = 0.3;
    this.events = [];
    this.moving = 0;
    this.airTime = 0; this.onGround = true;
    this.lastHitDir = V(0, 0, 0);
    // 점프와 파쿠르
    this.jumpBoost = 0; this.lastSpaceT = -9; this.groundY = 0;
    this.pk = null; this.eyeDip = 0; this.pkPitch = 0; this.pkRoll = 0; this.pkYaw = 0; this.pkHand = null;
  }

  spawn(x, z, yaw, pitch = 0) {
    this.pos.set(x, 0, z);
    this.pos.y = this.level.groundHeight(x, z, 2.0, 0.1, 0.5);
    if (this.pos.y < -0.2) this.pos.y = 0;
    this.vel.set(0, 0, 0);
    this.aimYaw = this.bodyYaw = this.lastYaw = yaw;
    this.aimPitch = pitch; this.camPitch = pitch * 0.7; this.lastPitch = this.camPitch;
    this.hp = 100; this.alive = true; this.deathT = 0; this.crouch = 0;
    this.camShake.x.set(0, 0, 0); this.camShake.v.set(0, 0, 0); this.camOffset.x.set(0, 0, 0); this.camOffset.v.set(0, 0, 0);
    this.eyeSmooth = this.pos.y; this.exertion = 0.1;
    this.pk = null; this.eyeDip = 0; this.pkPitch = 0; this.pkRoll = 0; this.pkYaw = 0; this.pkHand = null; this.jumpBoost = 0; this.groundY = this.pos.y; this.vel.y = 0; this.onGround = true;
  }

  get eyeHeight() { return 1.37 - this.crouch * 0.45 - this.eyeDip; }

  hit(fromDir) {
    // fromDir: 탄이 날아온 방향(봇 → 플레이어)
    const r = this.rng;
    this.camShake.v.add(V((r() - 0.3) * 5, (r() - 0.5) * 7, (r() - 0.5) * 9));
    this.camOffset.v.add(fromDir.clone().multiplyScalar(0.9));
    this.lastHitDir.copy(fromDir);
    this.exertion = Math.min(1, this.exertion + 0.4);
  }
  shotKick(scale) {
    const r = this.rng;
    this.camShake.v.add(V((2.6 + r() * 2.2) * scale, (r() - 0.5) * 3.4 * scale, (r() - 0.5) * 4.4 * scale));
    this.camRecoil.v.add(V((1.1 + r() * 0.9) * scale, (r() - 0.5) * 1.2 * scale, (r() - 0.5) * 1.6 * scale));
    this.camOffset.v.add(V((r() - 0.5) * 0.3 * scale, 0.15 * scale, 0.5 * scale));
  }

  update(dt, t, input, settings, weapon) {
    const L = this.level;
    if (!this.alive) return this.updateDead(dt);
    // 조준: 마우스는 총을 먼저 움직인다
    const sens = 0.0021 * settings.sens * (1 - weapon.ads * 0.35);
    this.aimYaw -= input.dx * sens;
    this.aimPitch -= input.dy * sens;
    this.aimPitch = Math.max(-1.35, Math.min(1.3, this.aimPitch));
    // 몸(카메라)은 뒤따르고, 총과 몸의 차이는 최대 4°(조준하면 1.7°). 이전에는 10°까지 벌어져 돌 때 총이 화면 위를 크게 미끄러졌다(2026-11-15)
    const maxLag = 0.07 - weapon.ads * 0.04;
    let dyaw = this.aimYaw - this.bodyYaw;
    this.bodyYaw += dyaw * (1 - Math.exp(-dt * (8 + weapon.ads * 6)));
    dyaw = this.aimYaw - this.bodyYaw;
    if (dyaw > maxLag) this.bodyYaw = this.aimYaw - maxLag; if (dyaw < -maxLag) this.bodyYaw = this.aimYaw + maxLag;
    const pitchTarget = this.aimPitch * (0.7 + weapon.ads * 0.15);
    this.camPitch += (pitchTarget - this.camPitch) * (1 - Math.exp(-dt * 8));

    // 파쿠르 중에는 경로를 따라 움직인다(충돌, 중력, 걸음 없음). 끝나면 웅크림과 숙임이 천천히 풀린다
    if (this.pk) this.updateParkour(dt);
    else this.move(dt, t, input, settings, weapon);
    if (!this.pk) { this.eyeDip *= Math.exp(-dt * 6); this.pkPitch *= Math.exp(-dt * 5); this.pkRoll *= Math.exp(-dt * 6); this.pkYaw *= Math.exp(-dt * 6); this.pkHand = null; }

    // 카메라 회전 속도 (모션 블러·바람·총 흔들림)
    const ny = this.bodyYaw, np = this.camPitch;
    this.yawVel = (ny - this.lastYaw) / Math.max(dt, 1e-3); this.pitchVel = (np - this.lastPitch) / Math.max(dt, 1e-3);
    this.lastYaw = ny; this.lastPitch = np;

    this.camShake.step(dt); this.camOffset.step(dt); this.camRecoil.step(dt);
  }

  // 걷기, 달리기, 앉기, 점프, 충돌, 걸음
  move(dt, t, input, settings, weapon) {
    const L = this.level;
    // 이동
    const fwd = (input.key('KeyW') ? 1 : 0) - (input.key('KeyS') ? 1 : 0);
    const side = (input.key('KeyD') ? 1 : 0) - (input.key('KeyA') ? 1 : 0);
    if (input.pressed('KeyC')) this.crouchToggle = !this.crouchToggle;
    const wantSprint = input.key('ShiftLeft') || input.key('ShiftRight');
    // 달리기를 막는 것은 '조준하려는 의도'(우클릭을 누르고 있음)다. weapon.ads는 0을 향해 지수로 다가가기만 해서
    // 놓은 뒤에도 정확히 0이 되지 않는다. 그 값을 참/거짓 조건(!weapon.ads)으로 쓰면 조준 한 번 뒤 1분 넘게 달리기가 막혔다
    this.sprinting = wantSprint && fwd > 0 && !input.rmb && this.crouch < 0.3;
    // 점프: 딛고 있을 때만 뛴다. 앉아 있으면 Space는 먼저 일으켜 세운다. 착지 직후에는 다리가 받칠 시간을 둔다.
    // Space를 0.35초 안에 두 번 누르면 앞의 장애물을 넘거나 오른다(파쿠르). 첫 번째 누름은 그대로 점프다(기다리면 조작이 굼떠진다)
    this.jumpCD = Math.max(0, (this.jumpCD || 0) - dt);
    if (input.pressed('Space')) {
      const dbl = t - this.lastSpaceT < 0.35;
      this.lastSpaceT = t;
      if (dbl && this.tryParkour()) { this.lastSpaceT = -9; return; }
      if (this.crouchToggle || this.crouch > 0.4) this.crouchToggle = false;
      else if (this.onGround && this.jumpCD <= 0) this.jump();
    }
    if (this.sprinting) this.crouchToggle = false;
    this.crouch += ((this.crouchToggle ? 1 : 0) - this.crouch) * (1 - Math.exp(-dt * 8));
    const speed = this.sprinting ? 5.0 : (2.75 * (1 - this.crouch * 0.45) * (1 - weapon.ads * 0.3));
    const sy = Math.sin(this.bodyYaw), cy = Math.cos(this.bodyYaw);
    const wish = V(-sy * fwd + cy * side, 0, -cy * fwd - sy * side);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(speed * (fwd < 0 ? 0.75 : 1));
    const accel = this.onGround ? 10 : 2;
    this.vel.x += (wish.x - this.vel.x) * (1 - Math.exp(-dt * accel));
    this.vel.z += (wish.z - this.vel.z) * (1 - Math.exp(-dt * accel));

    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    const mx = this.pos.x, mz = this.pos.z;
    // 공중에서는 무릎을 당겨 넘는 15 cm까지만 턱으로 친다(땅에서는 계단 한 단 0.42 m). 그래서 0.7~0.8 m 턱은 뛰어서 오를 수 없고 파쿠르로 넘는다
    const stepUp = this.onGround ? 0.42 : 0.15;
    L.collide(this.pos, this.radius, this.pos.y, 1.75 - this.crouch * 0.5, stepUp);
    // 벽에 막히면 벽 쪽 속도만 없앤다(벽을 따라 미끄러진다). 밀려난 거리를 속도로 바꾸지 않는다.
    // 이전에는 실제 이동량을 속도로 삼아서, 상자 위에서 걸어 내려가다 두 상자 사이 틈(몸보다 좁다)에 떨어지면
    // 한 프레임에 19 cm 밀려난 것이 11~13 m/s 속도가 되어 10프레임 넘게 옆으로 날아갔다(2026-11-15 파쿠르 조사에서 찾음)
    const px = this.pos.x - mx, pz = this.pos.z - mz, pl = Math.hypot(px, pz);
    if (pl > 1e-6) {
      const nx = px / pl, nz = pz / pl, vn = this.vel.x * nx + this.vel.z * nz;
      if (vn < 0) { this.vel.x -= vn * nx; this.vel.z -= vn * nz; }
    }

    // 높이: 계단은 올라서고, 낮은 곳으로는 떨어진다
    const gh = L.groundHeight(this.pos.x, this.pos.z, this.pos.y, 0.2, stepUp);
    if (gh >= this.pos.y - 0.02 && this.vel.y <= 0) {
      if (!this.onGround && this.airTime > 0.12) this.land(-this.vel.y);
      this.pos.y = gh; this.vel.y = 0; this.onGround = true; this.airTime = 0;
    } else {
      // 누르고 있는 동안(최대 0.17초) 다리가 더 민다
      if (this.jumpBoost > 0 && input.key('Space')) { this.vel.y += 12.7 * Math.min(dt, this.jumpBoost); this.jumpBoost -= dt; } else this.jumpBoost = 0;
      this.vel.y -= 9.8 * dt; this.pos.y += this.vel.y * dt; this.airTime += dt;
      if (this.pos.y <= gh) { if (this.airTime > 0.12) this.land(-this.vel.y); this.pos.y = gh; this.vel.y = 0; this.onGround = true; this.airTime = 0; this.jumpCD = Math.max(this.jumpCD, 0.25); }
      // 걸어서 턱을 내려설 때만 잠깐(0.08초) 딛고 있는 것으로 친다. 뛰어오르는 동안은 아니다
      else this.onGround = this.airTime < 0.08 && this.vel.y <= 0;
    }
    if (this.onGround) this.groundY = this.pos.y;
    // 계단에서 카메라가 뚝뚝 끊기지 않게
    this.eyeSmooth += (this.pos.y - this.eyeSmooth) * (1 - Math.exp(-dt * 14));
    if (Math.abs(this.pos.y - this.eyeSmooth) > 0.5) this.eyeSmooth = this.pos.y;

    // 걸음
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.moving += ((hs > 0.4 ? Math.min(1, hs / 2.8) : 0) - this.moving) * (1 - Math.exp(-dt * 8));
    if (this.onGround && hs > 0.3) {
      this.stepDist += hs * dt;
      this.stepPhase = this.stepDist / this.nextStepLen;
      if (this.stepDist >= this.nextStepLen) {
        this.stepDist -= this.nextStepLen;
        this.footIndex = (this.footIndex || 0) + 1;
        const base = this.sprinting ? 0.95 : 0.66 - this.crouch * 0.12;
        this.nextStepLen = base * (0.9 + this.rng() * 0.2);
        const mat = L.floorMaterial(this.pos.x, this.pos.y, this.pos.z);
        this.events.push({ type: 'step', mat, speed: hs, sprint: this.sprinting, crouch: this.crouch });
        // 걸음마다 다른 충격
        const k = (this.sprinting ? 1.6 : 0.8) * settings.shake;
        this.camShake.v.add(V((0.15 + this.rng() * 0.25) * k, (this.rng() - 0.5) * 0.3 * k, ((this.footIndex % 2) ? 1 : -1) * (0.25 + this.rng() * 0.2) * k));
      }
    } else { this.stepPhase = this.stepPhase * 0.9; }
    this.stepPhaseFrac = (this.stepDist / this.nextStepLen) + ((this.footIndex || 0) % 2);
    this.exertion += ((this.sprinting ? 1 : hs > 0.5 ? 0.3 : 0.1) - this.exertion) * (1 - Math.exp(-dt * (this.sprinting ? 0.35 : 0.12)));
  }

  // 누르는 순간 바로 뜬다(위로 1.45~1.55 m/s). 누르고 있는 동안 최대 0.16~0.18초 더 민다(move의 jumpBoost).
  // 짧게(50 ms) 누르면 0.2 m 남짓, 끝까지 누르면 0.5 m. 장비를 멘 사람이 제자리에서 뛰는 높이가 0.4~0.5 m다.
  // 무릎을 굽혔다 펴는 동안 가슴 카메라가 잠깐 가라앉았다가 솟고, 몸이 조금 앞으로 숙여진다
  jump() {
    const r = this.rng;
    this.vel.y = 1.45 + r() * 0.1;
    this.jumpBoost = 0.16 + r() * 0.02;
    this.onGround = false; this.airTime = 0; this.jumpCD = 0.35;
    this.camOffset.v.add(V((r() - 0.5) * 0.2, -0.7 - r() * 0.3, 0));
    this.camShake.v.add(V(1.0 + r() * 0.8, (r() - 0.5) * 0.8, (r() - 0.5) * 1.4));
    this.exertion = Math.min(1, this.exertion + 0.08);
    this.events.push({ type: 'jump', mat: this.level.floorMaterial(this.pos.x, this.pos.y, this.pos.z) });
  }

  // 파쿠르 시작: 몸 앞의 장애물을 재서(parkour.js) 넘을 수 있으면 경로를 만든다. 뛰어오른 직후(두 번째 누름)에도 된다
  tryParkour() {
    if (this.pk || !this.alive) return false;
    if (!this.onGround && (this.airTime > 0.6 || this.pos.y - this.groundY > 0.7)) return false;
    const plan = planParkour(this.level, this.pos, this.onGround ? this.pos.y : this.groundY, this.bodyYaw);
    if (!plan) return false;
    // 앉아 있었으면 그 낮춤을 눈 높이 낮춤으로 옮겨 이어지게 한다
    const dip0 = this.eyeDip + this.crouch * 0.45;
    this.crouch = 0; this.crouchToggle = false;
    const vS = this.vel.x * plan.fx + this.vel.z * plan.fz;
    this.pk = { plan, t: 0, ev: 0, x0: this.pos.x, z0: this.pos.z,
      path: buildParkourPath(plan, this.rng, { y0: this.pos.y, dip0, pitch0: this.pkPitch, vS, vY: this.vel.y }) };
    this.jumpBoost = 0; this.sprinting = false;
    return true;
  }

  updateParkour(dt) {
    const k = this.pk, P = k.plan, path = k.path, r = this.rng;
    k.t += dt;
    const t = Math.min(k.t, path.T), s = path.s(t);
    const before = this.pos.clone();
    this.pos.set(k.x0 + P.fx * s, path.y(t), k.z0 + P.fz * s);
    if (dt > 0) this.vel.subVectors(this.pos, before).divideScalar(dt);
    // 경로가 이미 매끄러우니 카메라 높이를 늦추지 않는다(늦추면 창턱을 지날 때 카메라가 벽 속으로 들어간다)
    this.eyeSmooth = this.pos.y;
    this.eyeDip = path.dip(t); this.pkPitch = path.pitch(t); this.pkRoll = path.roll(t); this.pkYaw = path.yaw(t);
    this.onGround = false; this.airTime = 0; this.sprinting = false;
    // 왼손이 짚는 자리(월드). 짚기 0.15초 전부터 손이 가고, 떼고 0.12초 뒤 총으로 돌아간다(weapons.js가 손을 옮긴다)
    const H = path.hand;
    if (H) {
      const w = Math.min(1, Math.max(0, (k.t - H.t0 + 0.15) / 0.15)) * Math.min(1, Math.max(0, (H.t1 + 0.12 - k.t) / 0.12));
      const rx = -P.fz, rz = P.fx;   // 몸의 오른쪽
      const side = H.kind === 'vault' ? -0.13 : -0.17;
      this.pkHand = { pos: V(k.x0 + P.fx * H.s + rx * side, H.y, k.z0 + P.fz * H.s + rz * side), fx: P.fx, fz: P.fz, w, kind: H.kind };
    }
    this.moving += (0 - this.moving) * (1 - Math.exp(-dt * 6));
    this.exertion = Math.min(1, this.exertion + dt * 0.3);
    // 손을 짚는 순간, 무릎을 올리는 순간: 몸이 덜컥 서고 장비가 부딪는다
    while (k.ev < path.events.length && path.events[k.ev].t <= k.t) {
      const e = path.events[k.ev++].ev;
      if (e === 'hands' || e === 'knee') {
        const g = e === 'hands' ? 1 : 0.6;
        this.camShake.v.add(V((1.0 + r() * 0.8) * g, (r() - 0.5) * 1.2 * g, (r() - 0.5) * 2.0 * g));
        this.camOffset.v.add(V((r() - 0.5) * 0.3, (-0.4 - r() * 0.3) * g, 0));
        this.events.push({ type: 'vault', mat: P.mat, phase: e });
      } else if (e === 'land') this.land(Math.max(1.5, -this.vel.y, Math.sqrt(2 * 9.8 * Math.max(0, P.top - P.landY - 0.5))));
      else if (e === 'stand') this.events.push({ type: 'step', mat: this.level.floorMaterial(this.pos.x, this.pos.y, this.pos.z), speed: 1, sprint: false, crouch: 0 });
    }
    if (k.t < path.T) return;
    // 끝: 탐색에서 확인한 자리에 정확히 선다. 들어오던 속도의 일부(경로 끝의 속도)로 이어 걷는다. 이동 키를 놓고 있으면 곧 선다
    this.pos.set(k.x0 + P.fx * P.land, P.landY, k.z0 + P.fz * P.land);
    this.vel.set(P.fx * path.vExit, 0, P.fz * path.vExit);
    if (P.crouch) { this.crouchToggle = true; this.crouch = 1; this.eyeDip = Math.max(0, this.eyeDip - 0.45); }
    this.eyeSmooth = this.pos.y;
    this.onGround = true; this.groundY = P.landY; this.jumpCD = 0.3; this.airTime = 0;
    this.pk = null;
  }

  land(v) {
    const k = Math.min(1.5, v / 3);
    this.camOffset.v.add(V(0, -k * 1.2, 0));
    this.camShake.v.add(V(k * 2, 0, (this.rng() - 0.5) * k * 2));
    this.events.push({ type: 'land', strength: k, mat: this.level.floorMaterial(this.pos.x, this.pos.y, this.pos.z) });
  }

  updateDead(dt) {
    this.deathT += dt;
    this.camShake.step(dt); this.camOffset.step(dt);
  }

  // 카메라 변환 계산. 반환: {pos, quat, roll}
  cameraTransform(t, settings) {
    const sh = settings.shake;
    const bobV = -Math.abs(Math.sin((this.stepPhaseFrac || 0) * Math.PI)) * (this.sprinting ? 0.05 : 0.024) * this.moving;
    const bobL = Math.sin((this.stepPhaseFrac || 0) * Math.PI) * (this.sprinting ? 0.03 : 0.014) * this.moving;
    const idleN = (noise1(t * 0.35, 11) * 0.006 + noise1(t * 1.3, 12) * 0.002) * (1 + this.exertion * 2);
    const roll = (bobL * 1.6 + noise1(t * 0.5, 13) * 0.008) * sh + this.camShake.x.z * 0.02;
    let eye = this.eyeHeight;
    const pos = V(0, 0, 0);
    const sy = Math.sin(this.bodyYaw), cy = Math.cos(this.bodyYaw);
    pos.set(this.pos.x - sy * 0.1, this.eyeSmooth + eye + bobV * sh, this.pos.z - cy * 0.1);
    pos.x += cy * bobL * sh; pos.z -= sy * bobL * sh;
    pos.addScaledVector(this.camOffset.x, 0.02 * sh);
    let pitch = this.camPitch + this.pkPitch + (this.camShake.x.x * 0.02 + idleN + this.camRecoil.x.x) * sh;
    let yaw = this.bodyYaw + this.pkYaw + (this.camShake.x.y * 0.02 + this.camRecoil.x.y + noise1(t * 0.4, 14) * 0.004 * (1 + this.exertion)) * sh;
    let rollF = roll + this.pkRoll + this.camRecoil.x.z * sh;
    if (!this.alive) {
      // 쓰러짐: 무릎이 꺾이고 옆으로 넘어간다
      const k = Math.min(1, this.deathT / 0.9), e = k * k;
      pos.y = this.eyeSmooth + eye * (1 - e) + 0.18 * e;
      rollF = roll + e * this.deathRoll;
      pitch = pitch * (1 - e) + e * (-0.25);
    }
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, rollF, 'YXZ'));
    // 총(weapons.js)은 카메라에 붙어 흔들림의 75%를 따르고 카메라 반동은 따르지 않는다. 그 몫을 따로 넘긴다
    const recoil = [this.camRecoil.x.x * sh, this.camRecoil.x.y * sh, this.camRecoil.x.z * sh];
    const shake = [pitch - this.camPitch - this.pkPitch - recoil[0], yaw - this.bodyYaw - this.pkYaw - recoil[1], rollF - this.pkRoll - recoil[2]];
    return { pos, quat: q, roll: rollF, pitch, yaw, recoil, shake };
  }

  aimQuat(t) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.aimPitch, this.aimYaw, 0, 'YXZ'));
    return q;
  }

  die(rng) { this.alive = false; this.deathT = 0; this.deathRoll = (rng() < 0.5 ? -1 : 1) * (0.9 + rng() * 0.6); this.events.push({ type: 'death' }); }
}
