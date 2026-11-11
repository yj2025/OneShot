// 플레이어: 이동, 가슴 카메라 리그(총이 먼저, 몸과 카메라가 뒤따름), 걸음·착지·사격·피격 흔들림
import * as THREE from 'three';
import { noise1 } from './rng.js';

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
  }

  get eyeHeight() { return 1.37 - this.crouch * 0.45; }

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
    this.camRecoil.v.add(V((0.55 + r() * 0.45) * scale, (r() - 0.5) * 0.5 * scale, (r() - 0.5) * 0.7 * scale));
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
    // 몸(카메라)은 뒤따르고, 총과 몸의 차이는 최대 ~10°
    const maxLag = 0.17 - weapon.ads * 0.08;
    let dyaw = this.aimYaw - this.bodyYaw;
    this.bodyYaw += dyaw * (1 - Math.exp(-dt * (5.5 + weapon.ads * 6)));
    dyaw = this.aimYaw - this.bodyYaw;
    if (dyaw > maxLag) this.bodyYaw = this.aimYaw - maxLag; if (dyaw < -maxLag) this.bodyYaw = this.aimYaw + maxLag;
    const pitchTarget = this.aimPitch * (0.7 + weapon.ads * 0.15);
    this.camPitch += (pitchTarget - this.camPitch) * (1 - Math.exp(-dt * 5));

    // 이동
    const fwd = (input.key('KeyW') ? 1 : 0) - (input.key('KeyS') ? 1 : 0);
    const side = (input.key('KeyD') ? 1 : 0) - (input.key('KeyA') ? 1 : 0);
    if (input.pressed('KeyC')) this.crouchToggle = !this.crouchToggle;
    const wantSprint = input.key('ShiftLeft') || input.key('ShiftRight');
    this.sprinting = wantSprint && fwd > 0 && !weapon.ads && this.crouch < 0.3;
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

    const before = this.pos.clone();
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    L.collide(this.pos, this.radius, this.pos.y, 1.75 - this.crouch * 0.5);
    // 실제 이동량으로 속도 보정 (벽에 막히면 멈춤)
    if (dt > 0) { this.vel.x = (this.pos.x - before.x) / dt; this.vel.z = (this.pos.z - before.z) / dt; }

    // 높이: 계단은 올라서고, 낮은 곳으로는 떨어진다
    const gh = L.groundHeight(this.pos.x, this.pos.z, this.pos.y, 0.2, 0.42);
    if (gh >= this.pos.y - 0.02) {
      if (!this.onGround && this.airTime > 0.12) this.land(-this.vel.y);
      this.pos.y = gh; this.vel.y = 0; this.onGround = true; this.airTime = 0;
    } else {
      this.vel.y -= 9.8 * dt; this.pos.y += this.vel.y * dt; this.airTime += dt;
      if (this.pos.y <= gh) { if (this.airTime > 0.12) this.land(-this.vel.y); this.pos.y = gh; this.vel.y = 0; this.onGround = true; this.airTime = 0; }
      else this.onGround = this.airTime < 0.08;
    }
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

    // 카메라 회전 속도 (모션 블러·바람·총 흔들림)
    const ny = this.bodyYaw, np = this.camPitch;
    this.yawVel = (ny - this.lastYaw) / Math.max(dt, 1e-3); this.pitchVel = (np - this.lastPitch) / Math.max(dt, 1e-3);
    this.lastYaw = ny; this.lastPitch = np;

    this.camShake.step(dt); this.camOffset.step(dt); this.camRecoil.step(dt);
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
    let pitch = this.camPitch + (this.camShake.x.x * 0.02 + idleN + this.camRecoil.x.x) * sh;
    let yaw = this.bodyYaw + (this.camShake.x.y * 0.02 + this.camRecoil.x.y + noise1(t * 0.4, 14) * 0.004 * (1 + this.exertion)) * sh;
    let rollF = roll + this.camRecoil.x.z * sh;
    if (!this.alive) {
      // 쓰러짐: 무릎이 꺾이고 옆으로 넘어간다
      const k = Math.min(1, this.deathT / 0.9), e = k * k;
      pos.y = this.eyeSmooth + eye * (1 - e) + 0.18 * e;
      rollF = roll + e * this.deathRoll;
      pitch = pitch * (1 - e) + e * (-0.25);
    }
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, rollF, 'YXZ'));
    return { pos, quat: q, roll: rollF, pitch, yaw };
  }

  aimQuat(t) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.aimPitch, this.aimYaw, 0, 'YXZ'));
    return q;
  }

  die(rng) { this.alive = false; this.deathT = 0; this.deathRoll = (rng() < 0.5 ? -1 : 1) * (0.9 + rng() * 0.6); this.events.push({ type: 'death' }); }
}
