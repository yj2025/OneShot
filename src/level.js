// 폐건물 CQB 훈련장과 앞마당. 모든 형태는 상자·원기둥으로 코드에서 만든다.
// 좌표: y 위, 건물은 x[-12,12] z[-16,0], 정면(z=0)이 마당(+z) 쪽. 실내 바닥 높이 FL = 0.7 m.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bcMaterial, envUniforms, setOpenings } from './materials.js';
import { mulberry32 } from './rng.js';

export const FL = 0.7;
const CA = FL + 2.8;   // 일반 천장
const CH = FL + 4.6;   // 창고 홀 천장
const DOOR_H = FL + 2.05;
const BLDG = { x0: -12, z0: -16, x1: 12, z1: 0 };

// 상자 (월드 좌표 UV, tile = 텍스처 1장이 덮는 미터)
function boxGeometry(min, max, tile, matrix) {
  const pos = [], nor = [], uv = [], idx = [];
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const faces = [
    // normal, 4 corners
    [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], (p) => [-p[2], p[1]]],
    [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], (p) => [p[2], p[1]]],
    [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], (p) => [p[0], -p[2]]],
    [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], (p) => [p[0], p[2]]],
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], (p) => [p[0], p[1]]],
    [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], (p) => [-p[0], p[1]]],
  ];
  for (const [n, cs, uvf] of faces) {
    const b = pos.length / 3;
    for (const c of cs) { pos.push(...c); nor.push(...n); const t = uvf(c); uv.push(t[0] / tile, t[1] / tile); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (matrix) g.applyMatrix4(matrix);
  return g;
}

function cleanGeo(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.index) { const n = g.attributes.position.count; const a = []; for (let i = 0; i < n; i++) a.push(i); g.setIndex(a); }
  return g;
}

export class Level {
  constructor(tex, seed, quality) {
    this.tex = tex;
    this.rng = mulberry32(seed * 13 + 5);
    this.quality = quality;
    this.group = new THREE.Group();
    this.boxes = [];          // 충돌·사격용 AABB {min:[..], max:[..], mat, cover}
    this.buckets = new Map(); // 재질 키 → geometry[]
    this.mats = {};
    this.lights = [];
    this.fixtures = [];
    this.openings = [];
    this.nodes = [];
    this.puddles = [];
    this.decalSpots = [];
    this.makeMaterials();
    this.build();
    this.finish();
  }

  makeMaterials() {
    const t = this.tex;
    const M = (k, p, o) => (this.mats[k] = bcMaterial(p, o));
    M('concrete', { map: t.concrete, roughness: 0.92, color: 0xffffff });
    M('plaster', { map: t.plaster, roughness: 0.95 });
    M('ceiling', { map: t.ceiling, roughness: 1.0 }, { grime: 0.5 });
    M('block', { map: t.block, roughness: 0.95 });
    M('asphalt', { map: t.asphalt, roughness: 0.88 });
    M('gravel', { map: t.gravel, roughness: 1.0 });
    M('contBlue', { map: t.corrugated, color: 0x5f7486, roughness: 0.7, metalness: 0.3 }, { grime: 0.6 });
    M('contRust', { map: t.corrugated, color: 0x8a4e36, roughness: 0.75, metalness: 0.3 }, { grime: 0.6 });
    M('roofMetal', { map: t.corrugated, color: 0x6a6e70, roughness: 0.7, metalness: 0.4 }, { grime: 0.4 });
    M('plywood', { map: t.plywood, roughness: 0.9 }, { grime: 0.6 });
    M('pallet', { map: t.plywood, color: 0xb59a7a, roughness: 0.95 }, { grime: 0.8 });
    M('linoleum', { map: t.linoleum, roughness: 0.6 }, { grime: 0.8 });
    M('cardboard', { map: t.cardboard, roughness: 1 }, { grime: 0.3 });
    M('locker', { map: t.locker, roughness: 0.55, metalness: 0.35 }, { grime: 0.4 });
    M('metalDark', { color: 0x3b3d3c, roughness: 0.55, metalness: 0.6 }, { grime: 0.5 });
    M('metalGalv', { color: 0x8c8f8e, roughness: 0.5, metalness: 0.7 }, { grime: 0.5 });
    M('steelGrate', { color: 0x5a5b58, roughness: 0.6, metalness: 0.7 }, { grime: 0.7 });
    M('rubber', { color: 0x1a1a1a, roughness: 0.9 }, { grime: 0.2 });
    M('drumBlue', { color: 0x2f4a6b, roughness: 0.6, metalness: 0.3 }, { grime: 0.8 });
    M('drumRed', { color: 0x7a2c22, roughness: 0.6, metalness: 0.3 }, { grime: 0.8 });
    M('jersey', { map: t.concrete, color: 0xd8d4c8, roughness: 0.95 });
    M('doorPaint', { map: t.plywood, color: 0x7a8a8c, roughness: 0.7 }, { grime: 0.7 });
    M('deskTop', { map: t.plywood, color: 0x9c968a, roughness: 0.6 }, { grime: 0.5 });
    M('fabricChair', { map: t.fabric, color: 0x4a4e5a, roughness: 1 }, { grime: 0.5 });
    M('trash', { color: 0x161616, roughness: 0.35, metalness: 0.0 }, { grime: 0.2 });
    M('paper', { map: t.paper, roughness: 1, side: THREE.DoubleSide }, { grime: 0.3 });
    M('backdrop', { color: 0x6c6f6c, roughness: 1 }, { grime: 1, ao: 0 });
    M('treeDark', { color: 0x2c3328, roughness: 1 }, { grime: 1, ao: 0 });
    M('grass', { map: t.gravel, color: 0x7d8466, roughness: 1 }, { grime: 1, ao: 0 });
    M('cone', { color: 0xb8541f, roughness: 0.7 }, { grime: 0.8 });
    this.mats.chain = new THREE.MeshStandardMaterial({ map: t.chainlink, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.6, color: 0x9a9a96 });
    this.mats.tube = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xeef3ff, emissiveIntensity: 3.5 });
    this.mats.tubeDead = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.4 });
    this.mats.puddle = new THREE.MeshStandardMaterial({ color: 0x1d1f20, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mats.stain = new THREE.MeshStandardMaterial({ map: t.stain, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
  }

  // ---- 기본 도형 ----
  add(matKey, geo) { cleanGeo(geo); if (!this.buckets.has(matKey)) this.buckets.set(matKey, []); this.buckets.get(matKey).push(geo); }
  box(matKey, min, max, { tile = 2, collide = true, mat = 'concrete', cover = false, visual = true } = {}) {
    if (visual) this.add(matKey, boxGeometry(min, max, tile));
    if (collide) this.boxes.push({ min: [...min], max: [...max], mat, cover });
  }
  collider(min, max, mat = 'concrete') { this.boxes.push({ min, max, mat }); }
  // 회전된 상자: 시각은 정확히, 충돌은 감싸는 AABB
  obox(matKey, center, size, rotY, { tile = 2, collide = true, mat = 'metal', rotX = 0, rotZ = 0 } = {}) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...center), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ)), new THREE.Vector3(1, 1, 1));
    const h = size.map(s => s / 2);
    this.add(matKey, boxGeometry([-h[0], -h[1], -h[2]], h, tile, m));
    if (collide) {
      const bb = new THREE.Box3().setFromBufferAttribute(boxGeometry([-h[0], -h[1], -h[2]], h, tile, m).attributes.position);
      this.boxes.push({ min: bb.min.toArray(), max: bb.max.toArray(), mat });
    }
  }
  cyl(matKey, center, r, h, { seg = 14, collide = true, mat = 'metal', rotX = 0, rotZ = 0, r2 } = {}) {
    const g = new THREE.CylinderGeometry(r2 ?? r, r, h, seg);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...center), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, 0, rotZ)), new THREE.Vector3(1, 1, 1)));
    this.add(matKey, g);
    if (collide) { const bb = new THREE.Box3().setFromBufferAttribute(g.attributes.position); this.boxes.push({ min: bb.min.toArray(), max: bb.max.toArray(), mat }); }
  }

  // z 방향에 수직인 벽(x로 뻗음). openings: {c, w, b, t}
  wallZ(z0, z1, x0, x1, y0, y1, openings, matKey, frameMat = 'metalDark') {
    const ops = [...openings].sort((a, b) => a.c - b.c);
    let x = x0;
    for (const o of ops) {
      const ox0 = o.c - o.w / 2, ox1 = o.c + o.w / 2;
      if (ox0 > x) this.box(matKey, [x, y0, z0], [ox0, y1, z1], { tile: 3, mat: 'concrete' });
      if (o.b > y0) this.box(matKey, [ox0, y0, z0], [ox1, o.b, z1], { tile: 3, mat: 'concrete' });
      if (o.t < y1) this.box(matKey, [ox0, o.t, z0], [ox1, y1, z1], { tile: 3, mat: 'concrete' });
      if (frameMat && !o.noFrame) {
        const f = 0.05;
        this.box(frameMat, [ox0, o.b, z0 - 0.01], [ox0 + f, o.t, z1 + 0.01], { collide: false });
        this.box(frameMat, [ox1 - f, o.b, z0 - 0.01], [ox1, o.t, z1 + 0.01], { collide: false });
        this.box(frameMat, [ox0, o.t - f, z0 - 0.01], [ox1, o.t, z1 + 0.01], { collide: false });
        if (o.b > y0 + 0.2) this.box(frameMat, [ox0 - 0.03, o.b - 0.03, z0 - 0.06], [ox1 + 0.03, o.b + 0.01, z1 + 0.06], { collide: false });
      }
      x = Math.max(x, ox1);
    }
    if (x1 > x) this.box(matKey, [x, y0, z0], [x1, y1, z1], { tile: 3, mat: 'concrete' });
  }
  // x 방향에 수직인 벽(z로 뻗음)
  wallX(x0, x1, z0, z1, y0, y1, openings, matKey, frameMat = 'metalDark') {
    const ops = [...openings].sort((a, b) => a.c - b.c);
    let z = z0;
    for (const o of ops) {
      const oz0 = o.c - o.w / 2, oz1 = o.c + o.w / 2;
      if (oz0 > z) this.box(matKey, [x0, y0, z], [x1, y1, oz0], { tile: 3, mat: 'concrete' });
      if (o.b > y0) this.box(matKey, [x0, y0, oz0], [x1, o.b, oz1], { tile: 3, mat: 'concrete' });
      if (o.t < y1) this.box(matKey, [x0, o.t, oz0], [x1, y1, oz1], { tile: 3, mat: 'concrete' });
      if (frameMat && !o.noFrame) {
        const f = 0.05;
        this.box(frameMat, [x0 - 0.01, o.b, oz0], [x1 + 0.01, o.t, oz0 + f], { collide: false });
        this.box(frameMat, [x0 - 0.01, o.b, oz1 - f], [x1 + 0.01, o.t, oz1], { collide: false });
        this.box(frameMat, [x0 - 0.01, o.t - f, oz0], [x1 + 0.01, o.t, oz1], { collide: false });
        if (o.b > y0 + 0.2) this.box(frameMat, [x0 - 0.06, o.b - 0.03, oz0 - 0.03], [x1 + 0.06, o.b + 0.01, oz1 + 0.03], { collide: false });
      }
      z = Math.max(z, oz1);
    }
    if (z1 > z) this.box(matKey, [x0, y0, z], [x1, y1, z1], { tile: 3, mat: 'concrete' });
  }
  // 바깥(블록)·안(회반죽) 두 겹 외벽
  extWallZ(zOut, dir, x0, x1, y1, ops) {
    // dir: 바깥쪽이 +z면 +1
    const t = 0.15;
    const zo0 = dir > 0 ? zOut - t : zOut, zo1 = dir > 0 ? zOut : zOut + t;
    const zi0 = dir > 0 ? zOut - 2 * t : zOut + t, zi1 = dir > 0 ? zOut - t : zOut + 2 * t;
    this.wallZ(zo0, zo1, x0, x1, 0, y1, ops, 'block');
    this.wallZ(zi0, zi1, x0, x1, FL, Math.min(y1, ops.ceil ?? y1), ops.map(o => ({ ...o, b: Math.max(o.b, FL), noFrame: true })), 'plaster', null);
  }
  extWallX(xOut, dir, z0, z1, y1, ops, yIn1) {
    const t = 0.15;
    const xo0 = dir > 0 ? xOut - t : xOut, xo1 = dir > 0 ? xOut : xOut + t;
    const xi0 = dir > 0 ? xOut - 2 * t : xOut + t, xi1 = dir > 0 ? xOut - t : xOut + 2 * t;
    this.wallX(xo0, xo1, z0, z1, 0, y1, ops, 'block');
    this.wallX(xi0, xi1, z0, z1, FL, yIn1 ?? y1, ops.map(o => ({ ...o, b: Math.max(o.b, FL), noFrame: true })), 'plaster', null);
  }
  opening(x, y, z, r) { this.openings.push([x, y, z, r]); }

  fluorescent(x, z, y, { dead = false, flicker = false, along = 'x', color = 0xe4ecff, intensity = 13 } = {}) {
    const L = 1.25;
    const sx = along === 'x' ? L : 0.22, sz = along === 'x' ? 0.22 : L;
    this.box('metalGalv', [x - sx / 2, y - 0.07, z - sz / 2], [x + sx / 2, y, z + sz / 2], { collide: false });
    const tube = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? L * 0.94 : 0.05, 0.035, along === 'x' ? 0.05 : L * 0.94), dead ? this.mats.tubeDead : this.mats.tube);
    tube.position.set(x, y - 0.085, z);
    this.group.add(tube);
    const tube2 = tube.clone(); tube2.position.x += along === 'x' ? 0 : 0.07; tube2.position.z += along === 'x' ? 0.07 : 0; tube2.position.x -= along === 'x' ? 0 : 0.035; tube2.position.z -= along === 'x' ? 0.035 : 0; this.group.add(tube2);
    if (!dead) {
      const light = new THREE.PointLight(color, intensity, 9.5, 1.6);
      light.position.set(x, y - 0.25, z);
      this.group.add(light);
      this.lights.push(light);
      this.fixtures.push({ light, tube, tube2, base: intensity, flicker, phase: this.rng() * 100 });
    }
  }

  build() {
    const r = this.rng;
    const W = (x0, z0, x1, z1) => ({ x0, z0, x1, z1 });

    // ===== 지면 =====
    this.box('gravel', [-24, -0.5, -20], [24, 0, 30], { tile: 3, mat: 'gravel' });
    this.box('asphalt', [-5, -0.5, 0], [5, 0.02, 30.5], { tile: 5, mat: 'asphalt' });
    this.box('asphalt', [-14, -0.5, 0], [14, 0.02, 7], { tile: 5, mat: 'asphalt' });
    // 담장 밖
    this.box('grass', [-140, -0.6, -140], [140, -0.05, -20], { tile: 3, collide: false });
    this.box('grass', [-140, -0.6, 30.5], [140, -0.05, 140], { tile: 3, collide: false });
    this.box('grass', [-140, -0.6, -20], [-24, -0.05, 30.5], { tile: 3, collide: false });
    this.box('grass', [24, -0.6, -20], [140, -0.05, 30.5], { tile: 3, collide: false });
    this.box('asphalt', [-140, -0.55, 33], [140, -0.04, 41], { tile: 5, collide: false });

    // ===== 건물 바닥, 천장, 지붕 =====
    this.collider([-12, -0.5, -16], [12, FL, 0], 'concrete');
    this.box('concrete', [-12, 0, -16], [-3, FL, 0], { collide: false, tile: 3 });
    this.box('linoleum', [-3, 0, -5], [4, FL, 0], { collide: false, tile: 2.4 });
    this.box('concrete', [4, 0, -5], [12, FL, 0], { collide: false, tile: 3 });
    this.box('concrete', [-3, 0, -16], [12, FL, -5], { collide: false, tile: 3 });
    this.box('ceiling', [-12, CA, -6.6], [12, CA + 0.4, 0], { tile: 2.4, mat: 'concrete' });
    this.box('ceiling', [4.5, CA, -16], [12, CA + 0.4, -6.6], { tile: 2.4, mat: 'concrete' });
    this.box('roofMetal', [-12, CH, -16], [4.5, CH + 0.4, -6.6], { tile: 2.4, mat: 'metal' });
    // 홀 철골 보와 배관
    for (let z = -15; z <= -7; z += 2.7) this.box('metalDark', [-12, CH - 0.35, z - 0.08], [4.5, CH, z + 0.08], { collide: false });
    this.box('metalGalv', [-11.6, CH - 0.7, -15.4], [4.2, CH - 0.6, -15.3], { collide: false });
    this.cyl('metalGalv', [-4, CA - 0.18, -5.8], 0.06, 24, { collide: false, rotZ: Math.PI / 2 });
    this.cyl('metalDark', [-4, CA - 0.12, -6.2], 0.03, 24, { collide: false, rotZ: Math.PI / 2 });

    // ===== 외벽 =====
    const win = (c, w = 1.4, b = FL + 0.9, t = FL + 2.1) => ({ c, w, b, t });
    const door = (c, w = 1.0) => ({ c, w, b: FL, t: DOOR_H });
    // 정면 (z=0, 바깥 +z)
    this.extWallZ(0, 1, -12, 12, 3.9, [win(-10.5), door(-7.5), win(-4.6), win(-1.2), win(2.2), { c: 8, w: 3.0, b: FL, t: FL + 2.5 }]);
    // 뒷면 (z=-16, 바깥 -z)
    this.extWallZ(-16, -1, -12, 12, CH + 0.4, [win(-9, 1.8, FL + 2.6, FL + 3.8), win(-5, 1.8, FL + 2.6, FL + 3.8), win(-1, 1.8, FL + 2.6, FL + 3.8), win(8, 1.2, FL + 1.6, FL + 2.4)]);
    // 서쪽 (x=-12, 바깥 -x)
    this.extWallX(-12, -1, -6.6, 0, 3.9, [win(-2.5)]);
    this.extWallX(-12, -1, -16, -6.6, CH + 0.4, [win(-9.5, 1.8, FL + 1.0, FL + 2.4), win(-13, 1.8, FL + 1.0, FL + 2.4)]);
    // 동쪽 (x=12, 바깥 +x)
    this.extWallX(12, 1, -16, 0, 3.9, [win(-2.5), door(-5.8), win(-12, 1.2, FL + 1.0, FL + 2.0)]);
    // 홀 위쪽(로커룸 지붕 위로 드러난 벽)
    this.box('block', [4.5, CA + 0.4, -16], [4.65, CH + 0.4, -6.6], { tile: 2, mat: 'concrete' });
    this.box('block', [-12, CA + 0.4, -6.75], [4.65, CH + 0.4, -6.6], { tile: 2, mat: 'concrete' });

    // 하늘 가시도용 개구부 (실내 쪽으로 조금 들인 위치, 반경)
    const op = (x, y, z, rad) => this.opening(x, y, z, rad);
    op(-10.5, FL + 1.5, -0.7, 2.4); op(-7.5, FL + 1.1, -0.7, 2.0); op(-4.6, FL + 1.5, -0.7, 2.4);
    op(-1.2, FL + 1.5, -0.7, 2.4); op(2.2, FL + 1.5, -0.7, 2.4); op(8, FL + 1.4, -0.9, 3.6);
    op(-9, FL + 3.0, -15.0, 3.0); op(-5, FL + 3.0, -15.0, 3.0); op(-1, FL + 3.0, -15.0, 3.0); op(8, FL + 2.0, -15.3, 1.6);
    op(-11.3, FL + 1.5, -2.5, 2.2); op(-11.2, FL + 1.6, -9.5, 2.8); op(-11.2, FL + 1.6, -13, 2.8);
    op(11.3, FL + 1.5, -2.5, 2.2); op(11.3, FL + 1.1, -5.8, 1.7); op(11.3, FL + 1.5, -12, 1.8);
    setOpenings(this.openings);

    // ===== 내벽 =====
    const it = 0.075;
    this.wallX(-3 - it, -3 + it, -5, 0, FL, CA, [door(-3.6, 0.9)], 'plaster');
    this.wallX(4 - it, 4 + it, -5, 0, FL, CA, [], 'plaster');
    this.wallZ(-5 - it, -5 + it, -12, 12, FL, CA, [door(-9, 1.6), door(0.5, 0.9), door(8, 0.9)], 'plaster');
    this.wallZ(-6.6 - it, -6.6 + it, -12, 4.5, FL, CH, [door(-8, 1.8), door(0, 0.9)], 'plaster');
    this.wallZ(-6.6 - it, -6.6 + it, 4.5, 12, FL, CA, [door(8, 0.9)], 'plaster');
    this.wallX(4.5 - it, 4.5 + it, -16, -6.6, FL, CH, [door(-11, 0.9)], 'plaster');

    // 문짝 (열려서 벽에 붙어 있음)
    const leaf = (x, z, along, len, sign) => {
      if (along === 'x') this.box('doorPaint', [x, FL + 0.01, z], [x + len * sign, FL + 2.02, z + 0.045 * (sign)], { tile: 2, mat: 'wood' });
      else this.box('doorPaint', [x, FL + 0.01, z], [x + 0.045 * sign, FL + 2.02, z + len * sign], { tile: 2, mat: 'wood' });
    };
    // 정문: 경첩 x=-8, 안쪽으로 90° 열려 정면 벽 안쪽에 붙음
    this.box('doorPaint', [-8.98, FL + 0.01, -0.36], [-8.0, FL + 2.02, -0.31], { tile: 2, mat: 'wood' });
    this.box('doorPaint', [0.95, FL + 0.01, -4.92], [1.0, FL + 2.02, -4.0], { tile: 2, mat: 'wood' });
    this.box('doorPaint', [8.45, FL + 0.01, -6.53], [8.5, FL + 2.02, -5.62], { tile: 2, mat: 'wood' });
    this.box('doorPaint', [11.55, FL + 0.01, -6.3], [11.6, FL + 2.02, -7.2], { tile: 2, mat: 'wood', collide: false });
    // 셔터: 반쯤 올라간 롤러 셔터
    this.box('roofMetal', [6.5, FL + 2.0, 0.0], [9.5, FL + 2.5, 0.08], { tile: 2.4, mat: 'metal' });
    this.cyl('metalDark', [8, FL + 2.75, 0.18], 0.22, 3.2, { rotZ: Math.PI / 2, mat: 'metal' });

    // ===== 정문 계단과 하역장 =====
    this.box('concrete', [-8.8, 0, 0], [-6.2, FL, 1.3], { tile: 2, mat: 'concrete' });
    for (let i = 0; i < 3; i++) this.box('concrete', [-8.8, 0, 1.3 + i * 0.3], [-6.2, FL - 0.175 * (i + 1), 1.6 + i * 0.3], { tile: 2, mat: 'concrete' });
    // 난간
    this.cyl('metalGalv', [-8.75, 1.15, 1.6], 0.025, 1.5, { rotX: 0.55, collide: false });
    this.cyl('metalGalv', [-8.75, 0.55, 2.2], 0.025, 1.0, { collide: false });
    this.cyl('metalGalv', [-8.75, FL + 0.5, 0.1], 0.025, 1.0, { collide: false });
    // 하역장 (강판)
    this.box('steelGrate', [5, 0, 0], [11, FL, 3.2], { tile: 1.2, mat: 'metal' });
    this.box('rubber', [5.5, 0.15, 3.2], [6.2, 0.6, 3.32], { collide: false });
    this.box('rubber', [9.8, 0.15, 3.2], [10.5, 0.6, 3.32], { collide: false });
    for (let i = 0; i < 4; i++) this.box('steelGrate', [5 - 0.28 * (4 - i), 0, 1.0], [5 - 0.28 * (3 - i), 0.175 * (i + 1), 2.6], { tile: 1, mat: 'metal' });

    // ===== 마당 소품 =====
    // 컨테이너 (6.06 × 2.44 × 2.59)
    this.container([-16, 0, 6], 0, 'contBlue');
    this.container([-17.5, 0, 14], 0.06, 'contRust');
    this.container([16.5, 0, 15], Math.PI / 2 + 0.03, 'contBlue');
    this.container([-17.5, 2.59, 14.2], 0.02, 'contBlue', false);
    // 콘크리트 방호벽
    for (const [x, z, a] of [[-3, 12, 0.1], [2.5, 12.5, -0.05], [9, 9, 1.4], [-9, 16, 0.3], [6.5, 20, 0.0], [-20, -8, 1.57]]) this.jersey(x, z, a);
    // 팔레트 더미
    for (const [x, z, n, a] of [[-10, 9, 5, 0.2], [12, 6, 3, -0.3], [-14, -1.2, 7, 0.0], [10, 22, 4, 0.5], [18, -10, 6, 0.1], [3, -18, 4, 1.2]]) this.palletStack(x, 0, z, n, a);
    // 드럼통, 타이어, 콘, 쓰레기봉투
    for (const [x, z, c] of [[13, 4.2, 'drumBlue'], [13.7, 4.6, 'drumRed'], [13.3, 5.0, 'drumBlue'], [-13.6, -14, 'drumRed'], [-13.2, -14.8, 'drumRed'], [18.5, -3, 'drumBlue']]) this.cyl(c, [x, 0.45, z], 0.29, 0.9, { mat: 'metal' });
    for (const [x, z] of [[-6, 22], [-6.4, 22.3], [15, -16]]) this.tire(x, 0.11, z, r() * 3);
    for (const [x, z] of [[-4.6, 25], [4.6, 25], [-4.6, 6.5], [1, 7.5]]) this.cyl('cone', [x, 0.36, z], 0.03, 0.7, { r2: 0.03, mat: 'plastic', collide: false }), this.cyl('cone', [x, 0.36, z], 0.17, 0.7, { r2: 0.02, mat: 'plastic' });
    for (const [x, z, s] of [[-11.5, 1.2, 0.4], [-11.0, 1.6, 0.33], [11.5, -0.6 + 4.3, 0.36]]) this.trashBag(x, z, s);
    // 가로등 기둥
    for (const [x, z] of [[-8, 18], [8, 4]]) { this.cyl('metalGalv', [x, 3.5, z], 0.08, 7, { mat: 'metal', r2: 0.06 }); this.box('metalDark', [x - 0.15, 6.9, z - 0.6], [x + 0.15, 7.05, z + 0.1], { collide: false }); }
    // 전신주와 전선(담장 밖)
    for (let i = 0; i < 6; i++) { const x = -60 + i * 25; this.cyl('pallet', [x, 4.5, 35], 0.14, 9, { collide: false, r2: 0.12 }); this.box('pallet', [x - 0.9, 8.3, 34.95], [x + 0.9, 8.42, 35.05], { collide: false }); }
    for (let i = 0; i < 5; i++) { const x = -47.5 + i * 25; for (const dx of [-0.8, 0, 0.8]) this.cyl('rubber', [x, 8.2, 35], 0.012, 25, { rotZ: Math.PI / 2, collide: false, seg: 4 }); }

    // 담장 (2.4 m 철망) + 기둥
    this.fence(-24, -20, 24, -20); this.fence(-24, -20, -24, 30); this.fence(24, -20, 24, 30);
    this.fence(-24, 30, -5, 30); this.fence(5, 30, 24, 30); this.fence(-5, 30.3, 5, 30.3);

    // 담장 밖 배경: 낮은 공장 건물, 나무 줄
    const bg = [[-60, -55, 30, 9, 20], [-20, -48, 26, 12, 14], [25, -52, 34, 8, 18], [65, -30, 20, 14, 40], [-70, 0, 18, 7, 50], [62, 20, 22, 10, 26], [-40, 70, 40, 11, 14], [30, 75, 30, 8, 16]];
    for (const [x, z, w, h, d] of bg) this.box('backdrop', [x - w / 2, 0, z - d / 2], [x + w / 2, h, z + d / 2], { collide: false, tile: 4 });
    const tr = mulberry32(77);
    for (let i = 0; i < 70; i++) {
      const a = tr() * Math.PI * 2, d = 45 + tr() * 50;
      const x = Math.cos(a) * d * 1.3, z = Math.sin(a) * d + 5;
      const h = 7 + tr() * 9;
      const g = new THREE.ConeGeometry(2.2 + tr() * 2.5, h, 7);
      g.translate(x, h / 2 + 1.5, z);
      this.add('treeDark', g);
      this.cyl('pallet', [x, 1.0, z], 0.2, 2, { collide: false, seg: 5 });
    }

    // ===== 실내 =====
    // 형광등
    this.fluorescent(-7.5, -2.5, CA, { flicker: false });
    this.fluorescent(0.5, -2.5, CA, {});
    this.fluorescent(8, -2.0, CA, { flicker: true });
    this.fluorescent(-8, -5.8, CA, { along: 'x' });
    this.fluorescent(1, -5.8, CA, { dead: true });
    this.fluorescent(8, -5.8, CA, {});
    this.fluorescent(-6, -10, CH - 0.4, { intensity: 22 });
    this.fluorescent(0, -13.5, CH - 0.4, { intensity: 22 });
    this.fluorescent(-8, -14, CH - 0.4, { dead: true });
    this.fluorescent(8, -11, CA, { flicker: true });

    // 로비: 접수대, 의자, 게시판, 소화기
    this.box('deskTop', [-6.4, FL, -2.2], [-4.2, FL + 1.05, -1.6], { tile: 2, mat: 'wood', cover: true });
    this.box('deskTop', [-6.4, FL, -3.6], [-5.8, FL + 1.05, -2.2], { tile: 2, mat: 'wood', cover: true });
    this.chair(-11, -4.2, 0.4); this.chair(-10.3, -4.3, 0.1); this.chair(-5.2, -3.0, 2.8);
    this.box('cardboard', [-11.7, FL, -1.0], [-11.1, FL + 0.45, -0.4], { tile: 0.6, mat: 'cardboard' });
    this.box('cardboard', [-11.65, FL + 0.45, -0.95], [-11.15, FL + 0.8, -0.5], { tile: 0.6, mat: 'cardboard' });
    this.box('drumRed', [-3.25, FL + 0.5, -1.0], [-3.1, FL + 1.0, -0.85], { collide: false });
    this.box('plywood', [-11.84, FL + 1.1, -4.3], [-11.82, FL + 2.0, -3.0], { collide: false, tile: 2 });
    // 사무실: 책상 두 개, 캐비닛, 종이
    this.desk(-1.4, -1.6, 0); this.desk(2.4, -3.2, Math.PI / 2 + 0.1);
    this.box('metalGalv', [3.3, FL, -4.85], [3.85, FL + 1.32, -4.25], { tile: 1, mat: 'metal', cover: true });
    this.box('metalGalv', [2.7, FL, -4.85], [3.25, FL + 1.32, -4.25], { tile: 1, mat: 'metal', cover: true });
    this.chair(-1.2, -2.5, 3.4); this.chair(1.6, -2.8, 1.3);
    for (let i = 0; i < 9; i++) this.paper(-2 + r() * 5.5, -0.8 - r() * 3.8, r() * 6);
    // 창고: 선반과 상자
    for (const z of [-4.3, -1.2]) this.shelf(6.2, z, 3.2);
    this.shelf(11.3, -2.6, 2.6, true);
    this.palletStack(9.5, FL, -3.8, 2, 0.1);
    for (const [x, z, c] of [[10.6, -0.9, 'drumBlue'], [11.2, -1.3, 'drumBlue']]) this.cyl(c, [x, FL + 0.45, z], 0.29, 0.9, { mat: 'metal' });
    // 복도: 사물함 몇 개, 쓰러진 의자
    this.box('locker', [-3, FL, -6.45], [-1.8, FL + 1.85, -6.0], { tile: 0.6, mat: 'metal' });
    this.box('cardboard', [5, FL, -6.5], [5.6, FL + 0.4, -6.0], { tile: 0.6, mat: 'cardboard' });
    // 홀: 기둥, 합판 훈련벽, 팔레트·나무상자 엄폐물, 드럼통
    for (const x of [-8, -4, 0]) for (const z of [-9.8, -12.9]) this.box('concrete', [x - 0.2, FL, z - 0.2], [x + 0.2, CH, z + 0.2], { tile: 2, mat: 'concrete' });
    this.box('plywood', [-10.8, FL, -11.0], [-8.4, FL + 2.4, -10.95], { tile: 2.44, mat: 'wood', cover: true });
    this.box('plywood', [-6.5, FL, -14.6], [-6.45, FL + 2.4, -12.2], { tile: 2.44, mat: 'wood', cover: true });
    this.box('plywood', [-3.0, FL, -8.6], [-0.6, FL + 2.4, -8.55], { tile: 2.44, mat: 'wood', cover: true });
    this.box('plywood', [1.2, FL, -13.0], [3.6, FL + 2.4, -12.95], { tile: 2.44, mat: 'wood', cover: true });
    this.box('metalDark', [-10.8, FL, -11.1], [-10.7, FL + 2.4, -10.85], { collide: false });
    this.palletStack(-2.4, FL, -11.5, 6, 0.3);
    this.palletStack(2.6, FL, -9.6, 4, -0.2);
    this.crate(-9.5, -14.6, 1.0, 0.1); this.crate(-9.3, -13.4, 0.8, -0.3); this.crate(-0.5, -15.0, 1.1, 0.05);
    this.crate(-5.2, -8.0, 0.9, 0.4);
    for (const [x, z, c] of [[3.7, -15.3, 'drumRed'], [3.1, -15.4, 'drumBlue'], [-11.3, -7.4, 'drumBlue']]) this.cyl(c, [x, FL + 0.45, z], 0.29, 0.9, { mat: 'metal' });
    this.tire(-4.0, FL + 0.11, -14.5, 0.5); this.tire(-3.9, FL + 0.33, -14.45, 1.4);
    // 로커룸: 사물함 줄, 벤치
    for (let i = 0; i < 8; i++) this.box('locker', [11.4, FL, -15.6 + i * 0.6], [11.85, FL + 1.85, -15.02 + i * 0.6], { tile: 0.6, mat: 'metal', cover: true });
    for (let i = 0; i < 5; i++) this.box('locker', [4.65, FL, -10.0 + i * 0.6], [5.1, FL + 1.85, -9.42 + i * 0.6], { tile: 0.6, mat: 'metal' });
    this.box('pallet', [7.4, FL + 0.42, -14.5], [7.75, FL + 0.47, -11.5], { tile: 2, mat: 'wood' });
    this.box('metalDark', [7.45, FL, -14.3], [7.7, FL + 0.42, -14.2], { collide: false });
    this.box('metalDark', [7.45, FL, -11.8], [7.7, FL + 0.42, -11.7], { collide: false });
    this.box('locker', [8.6, FL, -8.1], [9.2, FL + 1.85, -7.6], { tile: 0.6, mat: 'metal', cover: true }, 0);

    // 바닥 얼룩·물웅덩이
    for (const [x, z, s] of [[-2, 3, 2.4], [3.5, 10, 3.2], [-1, 18, 2.2], [8, 26, 2.8], [-12, 3.5, 2.0], [14, 8, 2.6], [-3.5, 15.5, 1.6]]) this.puddle(x, 0.022, z, s);
    for (const [x, z, s] of [[-6, -12, 3], [2, -10.5, 2.4], [8.5, -2.5, 2]]) this.puddle(x, FL + 0.003, z, s, true);
    for (let i = 0; i < 26; i++) {
      const inside = i < 16;
      const x = inside ? -11 + r() * 22 : -20 + r() * 40, z = inside ? -15.5 + r() * 15 : r() * 26;
      this.stain(x, (inside ? FL : 0.021) + 0.002 + i * 0.0001, z, 0.8 + r() * 2.2, r() * 6);
    }
  }

  container([x, y, z], rot, mat, collide = true) {
    const W = 6.06, H = 2.59, D = 2.44;
    this.obox(mat, [x, y + H / 2, z], [D, H, W], rot, { tile: 2.44, collide, mat: 'metal' });
    // 모서리 기둥
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [dx, dz] of [[-D / 2, -W / 2], [D / 2, -W / 2], [-D / 2, W / 2], [D / 2, W / 2]]) {
      const px = x + dx * c + dz * s, pz = z - dx * s + dz * c;
      this.obox('metalDark', [px, y + H / 2, pz], [0.16, H + 0.02, 0.16], rot, { collide: false });
    }
  }
  jersey(x, z, a) {
    this.obox('jersey', [x, 0.2, z], [0.6, 0.4, 3.0], a, { tile: 2, mat: 'concrete' });
    this.obox('jersey', [x, 0.6, z], [0.3, 0.4, 3.0], a, { tile: 2, mat: 'concrete' });
    this.obox('jersey', [x, 0.86, z], [0.2, 0.12, 3.0], a, { tile: 2, collide: false });
  }
  palletStack(x, y, z, n, a) {
    for (let i = 0; i < n; i++) {
      const jx = (this.rng() - 0.5) * 0.12, jz = (this.rng() - 0.5) * 0.12, ja = (this.rng() - 0.5) * 0.12;
      const yy = y + i * 0.144;
      // 위판 7장, 받침 3줄
      for (let k = -3; k <= 3; k++) {
        const ox = Math.sin(a + ja) * k * 0.165, oz = Math.cos(a + ja) * k * 0.165;
        this.obox('pallet', [x + jx + ox, yy + 0.133, z + jz + oz], [1.2, 0.022, 0.1], a + ja, { tile: 1.2, collide: false });
      }
      for (const k of [-1, 0, 1]) {
        const ox = Math.cos(a + ja) * k * 0.52, oz = -Math.sin(a + ja) * k * 0.52;
        this.obox('pallet', [x + jx + ox, yy + 0.06, z + jz + oz], [0.1, 0.1, 1.0], a + ja, { tile: 1.2, collide: false });
      }
    }
    const h = n * 0.144;
    this.obox('pallet', [x, y + h / 2, z], [1.2, h, 1.0], a, { tile: 1.2, mat: 'wood' });
    this.buckets.get('pallet').pop(); // 충돌용 상자만 남기고 겉면은 판재로
    this.boxes[this.boxes.length - 1].cover = h > 0.8;
  }
  crate(x, z, s, a) { this.obox('plywood', [x, FL + s / 2, z], [s, s, s], a, { tile: 1.2, mat: 'wood' }); this.boxes[this.boxes.length - 1].cover = true; }
  tire(x, y, z, a) {
    const g = new THREE.TorusGeometry(0.3, 0.11, 8, 16); g.rotateX(Math.PI / 2); g.rotateY(a); g.translate(x, y, z);
    this.add('rubber', g); this.boxes.push({ min: [x - 0.42, y - 0.11, z - 0.42], max: [x + 0.42, y + 0.11, z + 0.42], mat: 'rubber' });
  }
  trashBag(x, z, s) {
    const g = new THREE.SphereGeometry(s, 9, 7);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const n = 0.8 + this.rng() * 0.35; p.setXYZ(i, p.getX(i) * n, Math.max(p.getY(i) * n * 0.8, -s * 0.35), p.getZ(i) * n); }
    g.computeVertexNormals(); g.translate(x, s * 0.35, z);
    this.add('trash', g);
    this.boxes.push({ min: [x - s, 0, z - s], max: [x + s, s * 1.1, z + s], mat: 'cloth' });
  }
  chair(x, z, a) {
    const y = FL;
    this.obox('fabricChair', [x, y + 0.46, z], [0.46, 0.06, 0.46], a, { tile: 1, collide: false });
    const bx = x + Math.sin(a) * 0.22, bz = z + Math.cos(a) * 0.22;
    this.obox('fabricChair', [bx, y + 0.75, bz], [0.44, 0.5, 0.05], a, { tile: 1, collide: false });
    this.cyl('metalDark', [x, y + 0.22, z], 0.025, 0.44, { collide: false });
    this.obox('metalDark', [x, y + 0.03, z], [0.55, 0.03, 0.06], a, { collide: false });
    this.obox('metalDark', [x, y + 0.03, z], [0.06, 0.03, 0.55], a, { collide: false });
    this.boxes.push({ min: [x - 0.3, y, z - 0.3], max: [x + 0.3, y + 0.95, z + 0.3], mat: 'cloth' });
  }
  desk(x, z, a) {
    const y = FL;
    this.obox('deskTop', [x, y + 0.74, z], [1.4, 0.035, 0.7], a, { tile: 1.4, collide: false });
    const c = Math.cos(a), s = Math.sin(a);
    for (const [dx, dz] of [[-0.66, -0.31], [0.66, -0.31], [-0.66, 0.31], [0.66, 0.31]]) this.cyl('metalDark', [x + dx * c + dz * s, y + 0.37, z - dx * s + dz * c], 0.02, 0.74, { collide: false });
    this.obox('metalGalv', [x + 0.4 * c, y + 0.36, z - 0.4 * s], [0.42, 0.66, 0.6], a, { tile: 1, collide: false });
    this.boxes.push(...[(() => { const bb = new THREE.Box3(); bb.setFromCenterAndSize(new THREE.Vector3(x, y + 0.38, z), new THREE.Vector3(Math.abs(1.4 * c) + Math.abs(0.7 * s), 0.76, Math.abs(1.4 * s) + Math.abs(0.7 * c))); return { min: bb.min.toArray(), max: bb.max.toArray(), mat: 'wood', cover: false }; })()]);
    // 모니터, 서류 더미
    this.obox('rubber', [x - 0.2 * c, y + 0.95, z + 0.2 * s], [0.5, 0.36, 0.05], a + 0.2, { collide: false });
    this.obox('paper', [x + 0.25 * c, y + 0.78, z - 0.1 * s], [0.3, 0.05, 0.22], a + 0.4, { collide: false, tile: 0.3 });
  }
  shelf(x, z, len, alongZ = false) {
    const d = 0.6, y = FL;
    const sx = alongZ ? d : len, sz = alongZ ? len : d;
    for (const h of [0.1, 0.8, 1.5, 2.1]) this.box('metalGalv', [x - sx / 2, y + h, z - sz / 2], [x + sx / 2, y + h + 0.03, z + sz / 2], { collide: false });
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box('metalDark', [x + dx * sx / 2 - 0.03, y, z + dz * sz / 2 - 0.03], [x + dx * sx / 2 + 0.03, y + 2.2, z + dz * sz / 2 + 0.03], { collide: false });
    this.boxes.push({ min: [x - sx / 2, y, z - sz / 2], max: [x + sx / 2, y + 2.2, z + sz / 2], mat: 'metal', cover: true });
    // 상자들
    for (const h of [0.13, 0.83, 1.53]) {
      let p = -len / 2 + 0.1;
      while (p < len / 2 - 0.5) {
        const w = 0.35 + this.rng() * 0.3, hh = 0.25 + this.rng() * 0.35;
        if (this.rng() < 0.75) {
          const cx = alongZ ? x : x + p + w / 2, cz = alongZ ? z + p + w / 2 : z;
          this.obox('cardboard', [cx, y + h + hh / 2, cz], [alongZ ? 0.45 : w, hh, alongZ ? w : 0.45], (this.rng() - 0.5) * 0.15, { tile: 0.6, collide: false });
        }
        p += w + 0.05;
      }
    }
  }
  paper(x, z, a) { this.obox('paper', [x, FL + 0.002, z], [0.21, 0.001, 0.297], a, { tile: 0.3, collide: false }); }
  puddle(x, y, z, s, inside = false) {
    const g = new THREE.CircleGeometry(1, 20);
    const p = g.attributes.position;
    for (let i = 1; i < p.count; i++) { const k = 0.65 + this.rng() * 0.5; p.setXY(i, p.getX(i) * k * s * 0.5, p.getY(i) * k * s * 0.35); }
    g.rotateX(-Math.PI / 2); g.rotateY(this.rng() * 3); g.translate(x, y, z);
    const m = new THREE.Mesh(g, this.mats.puddle); m.renderOrder = 1;
    this.group.add(m);
    this.puddles.push({ x, z, r: s * 0.35, inside });
  }
  stain(x, y, z, s, a) {
    const g = new THREE.PlaneGeometry(s, s * (0.6 + this.rng() * 0.6)); g.rotateX(-Math.PI / 2); g.rotateY(a); g.translate(x, y, z);
    const m = new THREE.Mesh(g, this.mats.stain); m.renderOrder = 1; this.group.add(m);
  }
  fence(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0);
    const g = new THREE.PlaneGeometry(len, 2.4);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 0.12, uv.getY(i) * 2.4 / 0.12);
    g.rotateY(a + Math.PI / 2); g.translate((x0 + x1) / 2, 1.2, (z0 + z1) / 2);
    this.group.add(new THREE.Mesh(g, this.mats.chain));
    const n = Math.ceil(len / 3);
    for (let i = 0; i <= n; i++) { const t = i / n; this.cyl('metalGalv', [x0 + (x1 - x0) * t, 1.25, z0 + (z1 - z0) * t], 0.035, 2.5, { collide: false, seg: 6 }); }
    this.cyl('metalGalv', [(x0 + x1) / 2, 2.42, (z0 + z1) / 2], 0.02, len, { collide: false, seg: 5, rotZ: Math.abs(x1 - x0) > 0.1 ? Math.PI / 2 : 0, rotX: Math.abs(z1 - z0) > 0.1 ? Math.PI / 2 : 0 });
    this.boxes.push({ min: [Math.min(x0, x1) - 0.05, 0, Math.min(z0, z1) - 0.05], max: [Math.max(x0, x1) + 0.05, 2.4, Math.max(z0, z1) + 0.05], mat: 'fence', thin: true });
  }

  finish() {
    for (const [k, list] of this.buckets) {
      if (!list.length) continue;
      const g = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(g, this.mats[k]);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    this.buckets.clear();
    // 품질 낮음: 형광등 일부 끔(광원 수를 줄임)
    this.buildNav();
  }

  setQuality(q) {
    this.fixtures.forEach((f, i) => { f.light.visible = q === 'high' || (q === 'medium' ? i % 3 !== 2 : i % 2 === 0); });
  }

  update(t, dt) {
    for (const f of this.fixtures) {
      if (!f.flicker) continue;
      const k = Math.sin(t * 61 + f.phase) * Math.sin(t * 3.1 + f.phase * 2);
      const off = (Math.sin(t * 0.7 + f.phase) > 0.82 && k > 0.2) ? 0.08 : 1;
      f.light.intensity = f.base * off * (0.93 + 0.07 * Math.sin(t * 120));
      f.tube.material = off < 1 ? this.mats.tubeDead : this.mats.tube;
      f.tube2.material = f.tube.material;
    }
  }

  // ===== 질의 =====
  insideBuilding(x, z) { return x > BLDG.x0 && x < BLDG.x1 && z > BLDG.z0 && z < BLDG.z1; }
  zoneAt(x, z) {
    if (!this.insideBuilding(x, z)) return 'outdoor';
    if (z > -5) return 'room';
    if (z > -6.6) return 'corridor';
    if (x < 4.5) return 'hall';
    return 'room';
  }
  floorMaterial(x, y, z) {
    for (const p of this.puddles) if (Math.hypot(x - p.x, z - p.z) < p.r && Math.abs(y - (p.inside ? FL : 0)) < 0.2) return 'water';
    if (x > 3.8 && x < 11 && z > 0 && z < 3.2) return 'metal';
    if (this.insideBuilding(x, z)) return (x > -3 && x < 4 && z > -5) ? 'tile' : 'concrete';
    if ((x > -5 && x < 5) || (z > 0 && z < 7 && Math.abs(x) < 14)) return 'concrete';
    return 'gravel';
  }

  // 발 아래 지면 높이 (발 높이 y에서 stepUp 이내로 올라설 수 있는 가장 높은 면)
  groundHeight(x, z, y, r = 0.18, stepUp = 0.42) {
    let best = -0.5;
    for (const b of this.boxes) {
      if (b.thin) continue;
      if (x < b.min[0] - r || x > b.max[0] + r || z < b.min[2] - r || z > b.max[2] + r) continue;
      // 중심이 상자 위에 있거나, 반경 안에서 걸침
      const top = b.max[1];
      if (top <= y + stepUp && top > best) {
        const inX = x >= b.min[0] - r * 0.5 && x <= b.max[0] + r * 0.5, inZ = z >= b.min[2] - r * 0.5 && z <= b.max[2] + r * 0.5;
        if (inX && inZ) best = top;
      }
    }
    return best;
  }

  // 원기둥(반경 r, 발 높이 y, 키 h)을 상자들 밖으로 밀어낸다
  collide(pos, r, y, h, stepUp = 0.42) {
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.boxes) {
        if (b.max[1] <= y + stepUp || b.min[1] >= y + h) continue;
        const cx = Math.max(b.min[0], Math.min(pos.x, b.max[0]));
        const cz = Math.max(b.min[2], Math.min(pos.z, b.max[2]));
        const dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = (r - d) / d;
          pos.x += dx * push; pos.z += dz * push;
        } else {
          // 중심이 상자 안: 가장 얕은 축으로 밀기
          const ex = [pos.x - b.min[0] + r, b.max[0] - pos.x + r, pos.z - b.min[2] + r, b.max[2] - pos.z + r];
          const m = Math.min(...ex);
          if (m === ex[0]) pos.x = b.min[0] - r; else if (m === ex[1]) pos.x = b.max[0] + r; else if (m === ex[2]) pos.z = b.min[2] - r; else pos.z = b.max[2] + r;
        }
      }
    }
  }

  // 광선과 상자들의 첫 교차
  raycast(o, d, maxDist = 200, skipThin = false) {
    let best = maxDist, hit = null, nAxis = 0, nSign = 0;
    const inv = [1 / d.x, 1 / d.y, 1 / d.z], oo = [o.x, o.y, o.z];
    for (const b of this.boxes) {
      if (skipThin && b.thin) continue;
      let tmin = 0, tmax = best, ax = -1, sg = 0;
      let ok = true;
      for (let a = 0; a < 3; a++) {
        let t1 = (b.min[a] - oo[a]) * inv[a], t2 = (b.max[a] - oo[a]) * inv[a];
        let s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; ax = a; sg = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { ok = false; break; }
      }
      if (ok && ax >= 0 && tmin < best) {
        if (b.thin && ((Math.floor((o.x + d.x * tmin) * 8) + Math.floor((o.y + d.y * tmin) * 8)) % 3 !== 0)) continue; // 철망은 대부분 통과
        best = tmin; hit = b; nAxis = ax; nSign = sg;
      }
    }
    if (!hit) return null;
    const n = new THREE.Vector3(); n.setComponent(nAxis, nSign);
    return { dist: best, point: new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best), normal: n, mat: hit.mat, box: hit };
  }

  lineClear(a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const L = d.length(); if (L < 1e-4) return true;
    d.divideScalar(L);
    const h = this.raycast(a, d, L, true);
    return !h;
  }

  // ===== 이동 경로 그래프 =====
  buildNav() {
    const pts = [
      // 마당
      [0, 24], [0, 16], [0, 8], [-8, 8], [-7.5, 3.6], [-7.5, 0.8], [-12, 12], [-16, 10.5], [-13, 3.0], [-20, 4], [-20, -4], [-20, -14], [-12, -18], [0, -18], [10, -18], [18, -14],
      [8, 12], [16, 20], [16, 6], [3.3, 1.8], [6, 1.6], [8, 1.0], [14, 3.5], [18, -2], [16, -6], [12.9, -5.8], [-20, 22], [-10, 24], [10, 26], [20, 10],
      // 로비
      [-7.5, -0.9], [-10, -2.5], [-5, -3.0], [-9, -4.3], [-3.7, -3.6], [-2.3, -3.6],
      // 사무실
      [0.5, -4.2], [0.5, -2.4], [-1.8, -3.3], [2.8, -1.2], [-0.5, -0.7],
      // 창고
      [8, -4.3], [8, -2.6], [5.5, -2.8], [10, -0.8], [8, -0.4],
      // 복도
      [-11, -5.8], [-9, -5.8], [-6, -5.8], [-3, -5.8], [0, -5.8], [3, -5.8], [6, -5.8], [8, -5.8], [11, -5.8],
      // 홀
      [-8, -7.4], [0, -7.4], [-10, -8.6], [-6, -9.5], [-2, -9.6], [2, -8.0], [-10, -12.2], [-6, -11.4], [-2, -13.6], [2, -11.4], [-8.2, -15.0], [-4.4, -15.0], [1.0, -14.6], [3.7, -11], [-11, -15.2], [-1.5, -7.6],
      // 로커룸
      [8, -7.4], [8, -9.5], [5.3, -11], [6.2, -14.6], [9.8, -13], [10, -9.2], [6.2, -12.3],
    ];
    this.nodes = pts.map(([x, z], i) => {
      const y = this.groundHeight(x, z, 3.0, 0.05, 0.0) ;
      return { i, x, z, y: Math.max(0, y > 3 ? 0 : y), links: [] };
    });
    // 실제 바닥 높이 다시 계산(위에서 내려다보는 대신 바닥 후보 중 건물 바닥/지면)
    for (const n of this.nodes) n.y = this.insideBuilding(n.x, n.z) ? FL : this.groundHeight(n.x, n.z, 0.8, 0.05, 0.3);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
      const a = this.nodes[i], b = this.nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 11) continue;
      if (this.walkable(a, b)) { a.links.push([j, d]); b.links.push([i, d]); }
    }
  }
  walkable(a, b) {
    // 무릎·가슴 높이 두 줄과 양옆 오프셋으로 막힘 확인
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    const px = -dz / L * 0.28, pz = dx / L * 0.28;
    for (const off of [-1, 0, 1]) for (const h of [0.55, 1.3]) {
      const A = new THREE.Vector3(a.x + px * off, a.y + h, a.z + pz * off), B = new THREE.Vector3(b.x + px * off, b.y + h, b.z + pz * off);
      if (!this.lineClear(A, B)) return false;
    }
    return true;
  }
  nearestNode(x, z, y = null, needClear = true) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - x, n.z - z) + (y !== null ? Math.abs(n.y - y) * 3 : 0);
      if (d < bd) {
        if (needClear && !this.lineClear(new THREE.Vector3(x, (y ?? n.y) + 0.9, z), new THREE.Vector3(n.x, n.y + 0.9, n.z))) continue;
        bd = d; best = n;
      }
    }
    return best;
  }
  path(fromNode, toNode, avoid = null) {
    // A*; avoid(node) → 추가 비용
    const N = this.nodes, open = new Set([fromNode.i]), g = new Map([[fromNode.i, 0]]), came = new Map(), f = new Map([[fromNode.i, 0]]);
    const h = (n) => Math.hypot(n.x - toNode.x, n.z - toNode.z);
    while (open.size) {
      let cur = null, cf = Infinity;
      for (const i of open) { const v = f.get(i); if (v < cf) { cf = v; cur = i; } }
      if (cur === toNode.i) { const out = [N[cur]]; while (came.has(cur)) { cur = came.get(cur); out.unshift(N[cur]); } return out; }
      open.delete(cur);
      for (const [j, d] of N[cur].links) {
        const ng = g.get(cur) + d + (avoid ? avoid(N[j]) : 0);
        if (ng < (g.get(j) ?? Infinity)) { came.set(j, cur); g.set(j, ng); f.set(j, ng + h(N[j])); open.add(j); }
      }
    }
    return null;
  }
}
