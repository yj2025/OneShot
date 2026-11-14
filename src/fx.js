// 탄흔, 먼지·파편, 탄피, 총구 화염 (유혈 표현 없음)
import * as THREE from 'three';
import { bcMaterial } from './materials.js';
import { makeFlashTextures } from './textures.js';

// 총구 화염. 실제 화염은 1~3 ms지만 몸에 단 카메라는 초당 30프레임이라 한 프레임에 통째로 담기고 다음 프레임에는 없다.
// 그 한 프레임 안에서는 장면보다 수백 배 밝아 심이 하얗게 날아가고 둘레로 번진다(밝기는 HDR 배율 glow).
// 빛 세기는 천장 형광등 하나(13)와 같은 단위다. 실내에서 쏜 사람 둘레를 방 조명보다 밝게 비춘다
const FRAME = 1 / 30;
const FLASH_LIGHT_COLOR = 0xffd2a0;
const FLASH = {
  rifle: { star: [0.26, 0.4], plume: [0.3, 0.5], width: 0.18, glow: [16, 26], plumeGlow: 0.7, light: [9, 13] },
  pistol: { star: [0.15, 0.24], plume: [0.12, 0.22], width: 0.12, glow: [12, 20], plumeGlow: 0.6, light: [4.5, 7] },
};
const flashEnv = (age, life) => (age < life * 0.6 ? 1 : Math.max(0, 1 - (age - life * 0.6) / (life * 0.4)));

const HOLE_UV = { concrete: [0, 0.5], wood: [0.5, 0.5], metal: [0, 0], gravel: [0.5, 0], asphalt: [0, 0.5], rubber: [0, 0], cloth: [0.5, 0], plastic: [0, 0], fence: null, body: null };
const DUST = {
  concrete: { color: 0xb8b2a6, n: 9, speed: 2.2, size: 0.32, life: 1.4, chips: 6, chipColor: 0x8a877f },
  asphalt: { color: 0x7a7670, n: 7, speed: 2.0, size: 0.28, life: 1.1, chips: 5, chipColor: 0x333333 },
  gravel: { color: 0x9a8b74, n: 10, speed: 2.6, size: 0.36, life: 1.3, chips: 8, chipColor: 0x6a6052 },
  wood: { color: 0xc8a878, n: 5, speed: 1.6, size: 0.2, life: 0.9, chips: 9, chipColor: 0xb08850 },
  metal: { color: 0xd0d0d0, n: 3, speed: 3.5, size: 0.1, life: 0.3, chips: 0, spark: true },
  cloth: { color: 0x707070, n: 3, speed: 0.8, size: 0.15, life: 0.6, chips: 0 },
  rubber: { color: 0x303030, n: 3, speed: 1.0, size: 0.15, life: 0.6, chips: 2, chipColor: 0x111111 },
  plastic: { color: 0xa0a0a0, n: 3, speed: 1.2, size: 0.15, life: 0.6, chips: 3, chipColor: 0xb8541f },
  water: { color: 0x9aa4aa, n: 8, speed: 3.0, size: 0.22, life: 0.6, chips: 0 },
  body: { color: 0x6a6a5e, n: 4, speed: 1.0, size: 0.18, life: 0.7, chips: 0 },
  fence: { color: 0xcccccc, n: 2, speed: 2.5, size: 0.06, life: 0.25, chips: 0, spark: true },
};

export class FX {
  constructor(scene, tex, level, rng) {
    this.scene = scene; this.level = level; this.rng = rng;
    this.holeMat = bcMaterial({ map: tex.holes, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 }, { grime: 0 });
    this.decals = [];
    this.puffMat = tex.puff;
    this.particles = [];
    this.pool = [];
    const pg = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: tex.puff, transparent: true, depthWrite: false, opacity: 0, color: 0xffffff }));
      m.visible = false; m.renderOrder = 3; scene.add(m); this.pool.push(m);
    }
    this.chipGeo = new THREE.BoxGeometry(0.02, 0.012, 0.016);
    this.chips = [];
    // 탄피
    this.casingGeo = { rifle: new THREE.CylinderGeometry(0.0048, 0.0048, 0.045, 6), pistol: new THREE.CylinderGeometry(0.005, 0.005, 0.019, 6) };
    this.casingMat = bcMaterial({ color: 0xb08a3c, metalness: 0.9, roughness: 0.35 }, { grime: 0 });
    this.casings = [];
    this.onCasingLand = null;
    // 총구 화염: 플레이어와 봇이 같은 모델을 쓴다(FLASH). 빛은 형광등과 같은 단위의 점광원 두 개(플레이어, 봇)이고
    // 장면에 놓인 순서가 형광등 뒤라 가시도 채널이 없다(가려짐 없이 비춘다)
    this.flashTex = makeFlashTextures(7);
    this.plumeGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.flashes = [];
    this.flashLights = {};
    for (const k of ['player', 'bot']) {
      const l = new THREE.PointLight(FLASH_LIGHT_COLOR, 0, 12, 2);
      scene.add(l);
      this.flashLights[k] = { light: l, age: 1, life: 0, peak: 0 };
    }
    this.cameraPos = null;
    this.dummy = new THREE.Object3D();
  }

  hole(point, normal, mat) {
    const uvo = HOLE_UV[mat] === undefined ? HOLE_UV.concrete : HOLE_UV[mat];
    if (!uvo) return;
    const s = (mat === 'metal' ? 0.05 : mat === 'gravel' ? 0.18 : 0.09) * (0.8 + this.rng() * 0.5);
    const g = new THREE.PlaneGeometry(s, s);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uvo[0] + uv.getX(i) * 0.5, uvo[1] + uv.getY(i) * 0.5);
    const m = new THREE.Mesh(g, this.holeMat);
    m.position.copy(point).addScaledVector(normal, 0.004);
    m.lookAt(point.clone().add(normal));
    m.rotateZ(this.rng() * Math.PI * 2);
    m.renderOrder = 2;
    this.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > 220) { const old = this.decals.shift(); this.scene.remove(old); old.geometry.dispose(); }
  }

  impact(point, normal, mat, dir) {
    const p = DUST[mat] || DUST.concrete;
    for (let i = 0; i < p.n; i++) {
      const m = this.pool.find(q => !q.visible); if (!m) break;
      m.visible = true;
      m.material.color.setHex(p.spark && i < 2 ? 0xffd890 : p.color);
      m.material.blending = p.spark && i < 2 ? THREE.AdditiveBlending : THREE.NormalBlending;
      const v = normal.clone().multiplyScalar(0.6 + this.rng() * 0.9).add(new THREE.Vector3(this.rng() - 0.5, this.rng() - 0.3, this.rng() - 0.5).multiplyScalar(0.9)).addScaledVector(dir, -0.25).normalize().multiplyScalar(p.speed * (0.3 + this.rng() * 0.8));
      m.position.copy(point).addScaledVector(normal, 0.05);
      const s = p.size * (0.4 + this.rng() * 0.8);
      this.particles.push({ m, v, life: p.life * (0.5 + this.rng() * 0.8), age: 0, s0: s * 0.4, s1: s * (2.0 + this.rng()), op: p.spark && i < 2 ? 1 : 0.55, drag: 3.5, grav: p.spark ? -6 : -0.4, rot: this.rng() * 6 });
    }
    for (let i = 0; i < (p.chips || 0); i++) {
      const mm = new THREE.Mesh(this.chipGeo, bcMaterial({ color: p.chipColor, roughness: 1 }, { grime: 0 }));
      mm.position.copy(point).addScaledVector(normal, 0.02);
      const v = normal.clone().multiplyScalar(1.5 + this.rng() * 2.5).add(new THREE.Vector3(this.rng() - 0.5, this.rng(), this.rng() - 0.5).multiplyScalar(2.2));
      mm.scale.setScalar(0.5 + this.rng() * 1.5);
      this.scene.add(mm);
      this.chips.push({ m: mm, v, age: 0, spin: new THREE.Vector3(this.rng() * 20, this.rng() * 20, this.rng() * 20), rest: false });
    }
    if (this.chips.length > 120) { const c = this.chips.splice(0, this.chips.length - 120); c.forEach(o => { this.scene.remove(o.m); o.m.material.dispose(); }); }
  }

  casing(pos, vel, kind) {
    const m = new THREE.Mesh(this.casingGeo[kind], this.casingMat);
    m.position.copy(pos);
    m.rotation.set(this.rng() * 6, this.rng() * 6, this.rng() * 6);
    this.scene.add(m);
    this.casings.push({ m, v: vel.clone(), spin: new THREE.Vector3(this.rng() * 30 - 15, this.rng() * 30 - 15, this.rng() * 30 - 15), bounces: 0, rest: false, age: 0, kind });
    if (this.casings.length > 80) { const c = this.casings.shift(); this.scene.remove(c.m); }
  }

  // 총구 화염 한 발. kind: 'rifle' | 'pistol', who: 'player' | 'bot'.
  // lightPos: 빛을 둘 자리(총구가 벽 너머로 나갔으면 벽 이쪽). seen: 빛의 배율(봇 총구가 플레이어에게서 가려졌으면 작게)
  muzzleFlash(pos, dir, kind = 'rifle', who = 'player', lightPos = null, seen = 1) {
    const F = FLASH[kind] || FLASH.rifle, r = this.rng;
    const life = FRAME * (1 + r() * 0.2);
    const glow = F.glow[0] + r() * (F.glow[1] - F.glow[0]);
    // 정면 별꼴: 총구에 붙은 카메라 쪽 판
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex.stars[Math.floor(r() * 4)], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    star.material.color.setRGB(glow, glow, glow);
    star.material.rotation = r() * Math.PI * 2;
    const k = F.star[0] + r() * (F.star[1] - F.star[0]);
    star.scale.set(k, k, 1);
    star.position.copy(pos).addScaledVector(dir, 0.015);
    star.renderOrder = 4;
    // 옆에서 본 불꽃: 총열 축을 따라 앞으로 뻗고, 축을 중심으로 돌아 카메라를 향한다(update에서)
    const plume = new THREE.Mesh(this.plumeGeo, new THREE.MeshBasicMaterial({ map: this.flashTex.plumes[Math.floor(r() * 4)], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide }));
    const pg = glow * F.plumeGlow;
    plume.material.color.setRGB(pg, pg, pg);
    plume.position.copy(pos);
    plume.userData.len = F.plume[0] + r() * (F.plume[1] - F.plume[0]);
    plume.userData.wid = F.width * (0.8 + r() * 0.4);
    plume.renderOrder = 4;
    this.scene.add(star, plume);
    this.flashes.push({ star, plume, dir: dir.clone(), age: 0, life, glow, pg });
    this.orientPlume(plume, dir);
    // 빛: 화염과 같은 시간 동안
    const L = this.flashLights[who] || this.flashLights.player;
    L.light.position.copy(lightPos || pos).addScaledVector(dir, lightPos ? 0 : 0.12);
    L.peak = (F.light[0] + r() * (F.light[1] - F.light[0])) * seen;
    L.age = 0; L.life = life;
    L.light.intensity = L.peak;
    // 연기: 화염이 꺼진 뒤 총구 앞에 옅은 회색 연기가 잠깐 남아 앞으로 밀려 나가다 퍼진다
    for (let i = 0, n = kind === 'pistol' ? 1 : 2; i < n; i++) {
      const m = this.pool.find(q => !q.visible); if (!m) break;
      m.visible = true;
      m.material.color.setHex(0x8c8a84);
      m.material.blending = THREE.NormalBlending;
      m.position.copy(pos).addScaledVector(dir, 0.04 + i * 0.08);
      const v = dir.clone().multiplyScalar(0.8 + r() * 0.8).add(new THREE.Vector3(r() - 0.5, r() * 0.5, r() - 0.5).multiplyScalar(0.25));
      const s = (kind === 'pistol' ? 0.05 : 0.07) * (0.8 + r() * 0.4);
      this.particles.push({ m, v, life: 0.6 + r() * 0.5, age: 0, s0: s, s1: s * (4 + r() * 2), op: 0.16 + r() * 0.06, drag: 4.5, grav: 0.25, rot: r() * 6 });
    }
  }

  orientPlume(m, dir) {
    const v = this.cameraPos ? this.cameraPos.clone().sub(m.position) : new THREE.Vector3(0, 1, 0);
    const z = v.addScaledVector(dir, -v.dot(dir));
    if (z.lengthSq() < 1e-8) z.set(dir.y, -dir.x, 0).lengthSq() < 1e-8 ? z.set(1, 0, 0) : z;
    z.normalize();
    const x = new THREE.Vector3().crossVectors(dir, z);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, dir, z));
    m.scale.set(m.userData.wid, m.userData.len, 1);
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) { p.m.visible = false; p.m.material.opacity = 0; this.particles.splice(i, 1); continue; }
      p.v.multiplyScalar(Math.exp(-p.drag * dt)); p.v.y += p.grav * dt;
      p.m.position.addScaledVector(p.v, dt);
      const s = p.s0 + (p.s1 - p.s0) * Math.sqrt(t);
      p.m.scale.set(s, s, s);
      p.m.material.opacity = p.op * (1 - t) * (1 - t);
      p.m.quaternion.copy(this.cameraQuat || p.m.quaternion);
      p.m.rotateZ(p.rot);
    }
    for (const c of this.chips) {
      if (c.rest) continue;
      c.age += dt;
      c.v.y -= 9.8 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt;
      const gh = this.level.groundHeight(c.m.position.x, c.m.position.z, c.m.position.y + 0.05, 0.0, 0.1);
      if (c.m.position.y < gh + 0.006) { c.m.position.y = gh + 0.006; c.v.multiplyScalar(0.3); c.v.y = Math.abs(c.v.y) * 0.3; if (c.v.length() < 0.3) c.rest = true; }
    }
    for (const c of this.casings) {
      if (c.rest) continue;
      c.age += dt;
      c.v.y -= 9.8 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt; c.m.rotation.z += c.spin.z * dt;
      const gh = this.level.groundHeight(c.m.position.x, c.m.position.z, c.m.position.y + 0.05, 0.0, 0.1);
      if (c.m.position.y < gh + 0.005) {
        c.m.position.y = gh + 0.005;
        if (c.bounces < 3 && Math.abs(c.v.y) > 0.6) this.onCasingLand?.(c.m.position, this.level.floorMaterial(c.m.position.x, gh, c.m.position.z), c.bounces);
        c.bounces++;
        c.v.y = Math.abs(c.v.y) * 0.35; c.v.x *= 0.5; c.v.z *= 0.5; c.spin.multiplyScalar(0.5);
        if (c.bounces > 4 || c.v.length() < 0.25) { c.rest = true; c.m.rotation.x = Math.PI / 2; c.m.rotation.z = this.rng() * 6; }
      }
      if (c.age > 6) c.rest = true;
    }
    // 화염과 빛은 카메라 한 프레임(1/30초) 동안 켜져 있다가 끝에서 빠르게 꺼진다
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]; f.age += dt;
      if (f.age > f.life) { this.scene.remove(f.star, f.plume); f.star.material.dispose(); f.plume.material.dispose(); this.flashes.splice(i, 1); continue; }
      const e = flashEnv(f.age, f.life);
      f.star.material.color.setScalar(f.glow * e); f.plume.material.color.setScalar(f.pg * e);
      this.orientPlume(f.plume, f.dir);
    }
    for (const L of Object.values(this.flashLights)) {
      L.age += dt;
      L.light.intensity = L.age > L.life ? 0 : L.peak * flashEnv(L.age, L.life);
    }
  }

  clear() {
    for (const f of this.flashes) { this.scene.remove(f.star, f.plume); f.star.material.dispose(); f.plume.material.dispose(); }
    this.flashes = [];
    for (const L of Object.values(this.flashLights)) { L.age = 1; L.light.intensity = 0; }
    for (const d of this.decals) { this.scene.remove(d); d.geometry.dispose(); }
    for (const c of this.chips) { this.scene.remove(c.m); c.m.material.dispose(); }
    for (const c of this.casings) this.scene.remove(c.m);
    this.decals = []; this.chips = []; this.casings = [];
  }
}
