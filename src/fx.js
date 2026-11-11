// 탄흔, 먼지·파편, 탄피, 총구 화염 (유혈 표현 없음)
import * as THREE from 'three';

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
    this.holeMat = new THREE.MeshStandardMaterial({ map: tex.holes, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
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
    this.casingMat = new THREE.MeshStandardMaterial({ color: 0xb08a3c, metalness: 0.9, roughness: 0.35 });
    this.casings = [];
    this.onCasingLand = null;
    // 총구 화염
    this.flashMat = new THREE.SpriteMaterial({ map: tex.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffffff });
    this.flashes = [];
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
      const mm = new THREE.Mesh(this.chipGeo, new THREE.MeshStandardMaterial({ color: p.chipColor, roughness: 1 }));
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

  muzzleFlash(pos, dir, scale = 1) {
    const s = new THREE.Sprite(this.flashMat.clone());
    s.position.copy(pos).addScaledVector(dir, 0.04 * scale);
    const k = (0.22 + this.rng() * 0.16) * scale;
    s.scale.set(k, k, 1);
    s.material.rotation = this.rng() * 6;
    s.renderOrder = 4;
    this.scene.add(s);
    this.flashes.push({ s, age: 0 });
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
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]; f.age += dt;
      if (f.age > 0.045) { this.scene.remove(f.s); f.s.material.dispose(); this.flashes.splice(i, 1); }
      else f.s.material.opacity = 1 - f.age / 0.045;
    }
  }

  clear() {
    for (const d of this.decals) { this.scene.remove(d); d.geometry.dispose(); }
    for (const c of this.chips) { this.scene.remove(c.m); c.m.material.dispose(); }
    for (const c of this.casings) this.scene.remove(c.m);
    this.decals = []; this.chips = []; this.casings = [];
  }
}
