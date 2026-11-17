// 장갑 낀 손: 해부 치수를 따른 뼈대에 부드럽게 이은 거리장(SDF)으로 표면을 짓고, 격자에서 메시로 뽑아 뼈마다 가중치를 준 스키닝 메시로 만든다.
// 쥔 자세는 손가락을 손잡이(상자 거리장)에 닿을 때까지 오므려서 구한다(마디마다 닿으면 그 마디와 그 앞쪽 마디를 멈추고 끝 마디만 더 굽힌다).
// 처음 구현은 둥근 상자 22개였다. 마디 사이가 이어지지 않고 손가락이 네모나서 critic이 16~28라운드 내내 '손가락 없는 덩어리'로 꼽았다(2026-11-15).
//
// 손 기준(오른손): 원점 = 손목 관절, −Z = 손가락 쪽, +Y = 손등, −Y = 손바닥, −X = 엄지 쪽. 왼손은 X를 뒤집은 거울상이다.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- 치수(장갑 두께 포함, m) ----------
// mcp: 손허리손가락 관절, splay: 손가락이 벌어진 각(Y축), lens: 마디 길이(첫·가운데·끝), rad: 관절마다 반지름(MCP, PIP, DIP, 끝)
const FINGERS = [
  { mcp: [-0.0292, 0.0012, -0.0905], splay: -0.07, lens: [0.0405, 0.0240, 0.0185], rad: [0.0107, 0.0100, 0.0092, 0.0083] },   // 검지
  { mcp: [-0.0094, 0.0018, -0.0945], splay: -0.012, lens: [0.0445, 0.0275, 0.0195], rad: [0.0111, 0.0103, 0.0095, 0.0085] }, // 중지
  { mcp: [0.0101, 0.0006, -0.0912], splay: 0.05, lens: [0.0415, 0.0262, 0.0190], rad: [0.0105, 0.0098, 0.0090, 0.0081] },    // 약지
  { mcp: [0.0279, -0.0016, -0.0838], splay: 0.12, lens: [0.0330, 0.0195, 0.0172], rad: [0.0093, 0.0086, 0.0079, 0.0072] },   // 새끼
];
// 엄지: 손목 쪽 안장 관절(CMC)에서 손바닥 아래 앞쪽으로 뻗는다. flex 축은 엄지가 손바닥 쪽으로 감기는 축
const THUMB = { cmc: [-0.0205, -0.0095, -0.021], dir: [-0.6, -0.36, -0.715], lens: [0.041, 0.031, 0.0245], rad: [0.0150, 0.0130, 0.0117, 0.0099] };
// 묶는 자세(바인드 포즈): 반쯤 굽힌 손. 펼친 손(짚기)과 꽉 쥔 손(손잡이) 사이라 어느 쪽으로 굽혀도 피부(장갑)가 덜 무너진다
export const BIND = { f: [[0.35, 0, 0.4, 0.2], [0.35, 0, 0.42, 0.2], [0.35, 0, 0.42, 0.2], [0.35, 0, 0.4, 0.2]], t: [0.15, 0, 0, 0.15, 0.15] };

const qAxis = (x, y, z, a) => new THREE.Quaternion().setFromAxisAngle(V(x, y, z), a);
// 엄지의 기본 방향: −Z가 dir을 향하고, X(굽힘 축)는 (−Y) × dir. 그래야 굽힘(+)이 손바닥 쪽(−Y)으로 감긴다
const THUMB_Q = (() => {
  const z = V(...THUMB.dir).normalize().negate();          // 뼈의 +Z(손목 쪽)
  const x = new THREE.Vector3().crossVectors(V(0, -1, 0), V(...THUMB.dir).normalize()).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
})();

// ---------- 뼈대 ----------
// 뼈: 0 손목, 1~12 손가락(손가락마다 첫·가운데·끝), 13~15 엄지(손허리·첫·끝). mir = 1(오른손) 또는 −1(왼손)
// 거울상: 위치 x → −x, 회전 (x, y, z, w) → (x, −y, −z, w), 굽힘(X축)은 그대로이고 벌림·비틀림(Y·Z축)은 부호가 바뀐다
function mirQ(q, mir) { return mir > 0 ? q : new THREE.Quaternion(q.x, -q.y, -q.z, q.w); }
export function makeSkeleton(mir = 1) {
  const root = new THREE.Bone(); root.name = 'wrist';
  const bones = [root], rest = [new THREE.Quaternion()];
  for (const F of FINGERS) {
    let parent = root;
    for (let k = 0; k < 3; k++) {
      const b = new THREE.Bone();
      if (k === 0) b.position.set(F.mcp[0] * mir, F.mcp[1], F.mcp[2]); else b.position.set(0, 0, -F.lens[k - 1]);
      const q = k === 0 ? qAxis(0, 1, 0, -F.splay) : new THREE.Quaternion();
      rest.push(mirQ(q, mir)); parent.add(b); bones.push(b); parent = b;
    }
  }
  let parent = root;
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Bone();
    if (k === 0) b.position.set(THUMB.cmc[0] * mir, THUMB.cmc[1], THUMB.cmc[2]); else b.position.set(0, 0, -THUMB.lens[k - 1]);
    rest.push(mirQ(k === 0 ? THUMB_Q.clone() : new THREE.Quaternion(), mir)); parent.add(b); bones.push(b); parent = b;
  }
  const sk = { root, bones, rest, mir };
  setPose(sk, BIND);
  return sk;
}
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
// pose.f[i] = [MCP 굽힘, MCP 벌림, PIP 굽힘, DIP 굽힘], pose.t = [CMC 굽힘, CMC 벌림, CMC 비틀림(맞섬), MCP 굽힘, IP 굽힘] (라디안, 굽힘 +는 손바닥 쪽)
export function setPose(sk, pose) {
  const { bones, rest, mir } = sk;
  for (let i = 0; i < 4; i++) {
    const [mf, ma, pf, df] = pose.f[i];
    bones[1 + i * 3].quaternion.copy(rest[1 + i * 3]).multiply(mirQ(_qa.setFromAxisAngle(V(0, 1, 0), -ma), mir)).multiply(_qb.setFromAxisAngle(V(1, 0, 0), -mf));
    bones[2 + i * 3].quaternion.setFromAxisAngle(V(1, 0, 0), -pf);
    bones[3 + i * 3].quaternion.setFromAxisAngle(V(1, 0, 0), -df);
  }
  const [cf, ca, cr, tm, ti] = pose.t;
  bones[13].quaternion.copy(rest[13]).multiply(mirQ(_qa.setFromAxisAngle(V(0, 0, 1), cr), mir)).multiply(mirQ(_qb.setFromAxisAngle(V(0, 1, 0), -ca), mir)).multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -cf));
  bones[14].quaternion.setFromAxisAngle(V(1, 0, 0), -tm);
  bones[15].quaternion.setFromAxisAngle(V(1, 0, 0), -ti);
}
export function lerpPose(a, b, t) {
  const L = (x, y) => x + (y - x) * t;
  return { f: a.f.map((r, i) => r.map((v, k) => L(v, b.f[i][k]))), t: a.t.map((v, k) => L(v, b.t[k])) };
}
export const clonePose = (p) => ({ f: p.f.map(r => r.slice()), t: p.t.slice() });

// 관절 위치(손 기준, 지금 자세). 손가락마다 [MCP, PIP, DIP, 끝], 엄지 [CMC, MCP, IP, 끝]
const _m = new THREE.Matrix4();
export function joints(sk, frame = null) {
  sk.root.updateMatrixWorld(true);
  const inv = frame ? null : _m.copy(sk.root.matrixWorld).invert();
  const toL = (b, off) => { const v = V(0, 0, off).applyMatrix4(b.matrixWorld); return frame ? v : v.applyMatrix4(inv); };
  const out = { f: [], t: [] };
  for (let i = 0; i < 4; i++) {
    const F = FINGERS[i], b = [sk.bones[1 + i * 3], sk.bones[2 + i * 3], sk.bones[3 + i * 3]];
    out.f.push([toL(b[0], 0), toL(b[1], 0), toL(b[2], 0), toL(b[2], -F.lens[2])]);
  }
  const t = [sk.bones[13], sk.bones[14], sk.bones[15]];
  out.t = [toL(t[0], 0), toL(t[1], 0), toL(t[2], 0), toL(t[2], -THUMB.lens[2])];
  return out;
}

// ---------- 거리장 ----------
function sdRoundCone(px, py, pz, a, b, r1, r2) {
  // Inigo Quilez, 두 구를 잇는 원뿔(정확한 거리)
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a.x, pay = py - a.y, paz = pz - a.z;
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function sdEllipsoid(px, py, pz, c, r) {
  const x = (px - c.x) / r.x, y = (py - c.y) / r.y, z = (pz - c.z) / r.z;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const x1 = x / r.x, y1 = y / r.y, z1 = z / r.z, k1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1);
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(r.x, r.y, r.z);
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// 바인드 포즈의 관절로 손의 거리장을 짓는다. 부위별 거리도 돌려준다(정점 색과 스키닝에 쓴다)
function handField(J) {
  const P = (v) => V(v.x, v.y, v.z);
  // 손바닥: 손목 가까운 곳에서 MCP로 가는 손허리뼈 넷(손등이 살짝 둥글게)
  const metaBase = [V(-0.0175, 0.0005, -0.014), V(-0.006, 0.0015, -0.012), V(0.0058, 0.0005, -0.0135), V(0.0165, -0.0015, -0.016)];
  const metaR = [[0.0128, 0.0124], [0.013, 0.0128], [0.0122, 0.012], [0.0118, 0.0108]];
  const mcp = J.f.map(f => P(f[0]));
  // 손등 보호대: MCP 위(손등 쪽 반지름만큼)를 잇는 띠, 가운데 마디(PIP) 위 작은 덧댐
  const dorsal = (i, k, lift) => { const a = J.f[i][k], b = J.f[i][Math.min(3, k + 1)]; const d = b.clone().sub(a).normalize(); const up = V(0, 1, 0).sub(d.clone().multiplyScalar(d.y)).normalize(); return a.clone().addScaledVector(up, lift); };
  const ridge = [0, 1, 2, 3].map(i => dorsal(i, 0, FINGERS[i].rad[0] * 0.78));
  const pip = [0, 1, 2, 3].map(i => dorsal(i, 1, FINGERS[i].rad[1] * 0.72));
  const thumbJ = J.t.map(P);
  // 손목과 장갑 소맷부리(타원 단면): 손목은 납작하다(가로 0.03, 세로 0.022)
  const cuffA = V(0, -0.002, -0.004), cuffB = V(0, -0.001, 0.07);
  const sdCuff = (px, py, pz) => {
    const t = Math.max(0, Math.min(1, (pz - cuffA.z) / (cuffB.z - cuffA.z)));
    const flare = 1 + 0.12 * Math.max(0, (pz - 0.02) / 0.05);           // 소맷부리가 조금 벌어진다
    const rx = 0.0315 * flare, ry = 0.0235 * flare, cy = cuffA.y + (cuffB.y - cuffA.y) * t;
    const e = Math.sqrt((px / rx) ** 2 + ((py - cy) / ry) ** 2) - 1;
    const side = e * Math.min(rx, ry);
    const cap = Math.max(cuffA.z - pz, pz - cuffB.z);
    return Math.max(side, cap) > 0 ? Math.hypot(Math.max(side, 0), Math.max(cap, 0)) + Math.min(Math.max(side, cap), 0) : Math.max(side, cap);
  };
  const pads = [
    { c: V(0.0005, -0.0085, -0.058), r: V(0.034, 0.0115, 0.032) },   // 손바닥 가운데
    { c: V(0.0215, -0.0075, -0.037), r: V(0.0135, 0.0115, 0.03) },   // 새끼 두덩
    { c: V(-0.0215, -0.0105, -0.03), r: V(0.0165, 0.0135, 0.026) },  // 엄지 두덩
  ];
  const parts = (px, py, pz) => {
    let palm = 1;
    for (let i = 0; i < 4; i++) palm = smin(palm, sdRoundCone(px, py, pz, metaBase[i], mcp[i], metaR[i][0], metaR[i][1]), 0.014);
    for (const p of pads) palm = smin(palm, sdEllipsoid(px, py, pz, p.c, p.r), 0.01);
    const cuff = sdCuff(px, py, pz);
    palm = smin(palm, cuff, 0.012);
    let rg = 1;
    for (let i = 0; i < 3; i++) rg = Math.min(rg, sdRoundCone(px, py, pz, ridge[i], ridge[i + 1], 0.0062, 0.0062));
    palm = smin(palm, rg, 0.003);
    const fing = [], pipd = [];
    for (let i = 0; i < 4; i++) {
      const F = FINGERS[i], j = J.f[i];
      let d = 1;
      for (let k = 0; k < 3; k++) d = smin(d, sdRoundCone(px, py, pz, j[k], j[k + 1], F.rad[k], F.rad[k + 1]), 0.002);
      const pd = sdEllipsoid(px, py, pz, pip[i], V(F.rad[1] * 0.75, 0.0035, F.rad[1] * 0.9));
      pipd.push(pd);
      fing.push(smin(d, pd, 0.002));
    }
    let th = 1;
    for (let k = 0; k < 3; k++) th = smin(th, sdRoundCone(px, py, pz, thumbJ[k], thumbJ[k + 1], THUMB.rad[k], THUMB.rad[k + 1]), 0.002);
    return { palm, cuff, rg, fing, pipd, th };
  };
  const field = (px, py, pz) => {
    const q = parts(px, py, pz);
    let d = smin(q.palm, q.th, 0.011);
    for (let i = 0; i < 4; i++) d = Math.min(d, smin(q.palm, q.fing[i], 0.0065));
    return d;
  };
  return { field, parts };
}

// ---------- 표면 뽑기: surface nets ----------
// 칸마다 부호가 바뀌면 그 칸 안에 정점 하나(모서리 교차점의 평균)를 두고, 부호가 바뀌는 격자 모서리마다 그 둘레 네 칸을 사각형으로 잇는다.
// 정점은 거리장의 기울기를 따라 표면으로 두 번 당긴다
function surfaceNets(f, min, max, h) {
  const nx = Math.ceil((max.x - min.x) / h) + 1, ny = Math.ceil((max.y - min.y) / h) + 1, nz = Math.ceil((max.z - min.z) / h) + 1;
  const N = nx * ny * nz, val = new Float32Array(N);
  // 굵은 격자(4칸)로 먼저 재서 표면에서 먼 덩어리는 건너뛴다(거리장은 1-립시츠라 굵은 값이 크면 그 안에 표면이 없다)
  const C = 4, cx = Math.ceil(nx / C) + 1, cy = Math.ceil(ny / C) + 1, cz = Math.ceil(nz / C) + 1, coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) coarse[i + cx * (j + cy * k)] = f(min.x + i * C * h, min.y + j * C * h, min.z + k * C * h);
  const far = C * h * 0.9;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ci = Math.round(i / C), cj = Math.round(j / C), ck = Math.round(k / C);
    const cv = coarse[ci + cx * (cj + cy * ck)];
    val[i + nx * (j + ny * k)] = Math.abs(cv) > far ? cv : f(min.x + i * h, min.y + j * h, min.z + k * h);
  }
  const idx = (i, j, k) => i + nx * (j + ny * k);
  const vmap = new Int32Array(N).fill(-1), pos = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const g = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { g[c] = val[idx(i + corner[c][0], j + corner[c][1], k + corner[c][2])]; if (g[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((g[a] < 0) === (g[b] < 0)) continue;
      const t = g[a] / (g[a] - g[b]);
      sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t; sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t; sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t; n++;
    }
    vmap[idx(i, j, k)] = pos.length / 3;
    pos.push(min.x + (i + sx / n) * h, min.y + (j + sy / n) * h, min.z + (k + sz / n) * h);
  }
  const tri = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) tri.push(a, c, b, a, d, c); else tri.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val[idx(i, j, k)] < 0;
    if (v0 !== (val[idx(i + 1, j, k)] < 0)) quad(vmap[idx(i, j - 1, k - 1)], vmap[idx(i, j, k - 1)], vmap[idx(i, j, k)], vmap[idx(i, j - 1, k)], !v0);
    if (v0 !== (val[idx(i, j + 1, k)] < 0)) quad(vmap[idx(i - 1, j, k - 1)], vmap[idx(i - 1, j, k)], vmap[idx(i, j, k)], vmap[idx(i, j, k - 1)], !v0);
    if (v0 !== (val[idx(i, j, k + 1)] < 0)) quad(vmap[idx(i - 1, j - 1, k)], vmap[idx(i, j - 1, k)], vmap[idx(i, j, k)], vmap[idx(i - 1, j, k)], !v0);
  }
  // 표면으로 당기기와 노멀(기울기). 삼각형 감김은 마지막에 노멀과 맞춘다
  const e = h * 0.25, nrm = new Float32Array(pos.length);
  for (let v = 0; v < pos.length; v += 3) {
    let x = pos[v], y = pos[v + 1], z = pos[v + 2], gx = 0, gy = 0, gz = 0;
    for (let it = 0; it < 3; it++) {
      const d = f(x, y, z);
      gx = f(x + e, y, z) - f(x - e, y, z); gy = f(x, y + e, z) - f(x, y - e, z); gz = f(x, y, z + e) - f(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1; gx /= gl; gy /= gl; gz /= gl;
      if (it < 2) { const s = Math.max(-h, Math.min(h, d)); x -= gx * s; y -= gy * s; z -= gz * s; }
    }
    pos[v] = x; pos[v + 1] = y; pos[v + 2] = z; nrm[v] = gx; nrm[v + 1] = gy; nrm[v + 2] = gz;
  }
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * (nrm[a] + nrm[b] + nrm[c]) + fy * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + fz * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]) < 0) { const k = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = k; }
  }
  return { pos: new Float32Array(pos), nrm, index: tri };
}

// ---------- 손 메시 ----------
let _cache = null;   // 오른손 바인드 메시를 한 번만 짓고 왼손은 거울로 만든다
function buildRightHandData() {
  if (_cache) return _cache;
  const t0 = performance.now();
  const sk = makeSkeleton(1);
  const J = joints(sk);
  const { field, parts } = handField(J);
  // 경계: 관절과 소맷부리를 감싸는 상자
  const pts = [...J.f.flat(), ...J.t, V(0.04, 0.03, 0.075), V(-0.04, -0.03, -0.01)];
  const min = V(Infinity, Infinity, Infinity), max = V(-Infinity, -Infinity, -Infinity);
  for (const p of pts) { min.min(p); max.max(p); }
  min.subScalar(0.02); max.addScalar(0.02);
  const H = 0.0021;
  const { pos, nrm, index } = surfaceNets(field, min, max, H);
  const nv = pos.length / 3;
  // 뼈 구간(스키닝): 손목 뼈는 손바닥(손허리뼈 넷)과 소맷부리, 손가락 뼈는 각 마디, 엄지 뼈는 각 마디
  const segs = [];   // { bone, chain, a, b }
  const metaBase = [V(-0.0175, 0.0005, -0.014), V(-0.006, 0.0015, -0.012), V(0.0058, 0.0005, -0.0135), V(0.0165, -0.0015, -0.016)];
  for (let i = 0; i < 4; i++) segs.push({ bone: 0, chain: -1, a: metaBase[i], b: J.f[i][0].clone().lerp(metaBase[i], 0.25) });
  segs.push({ bone: 0, chain: -1, a: V(0, 0, 0.07), b: V(0, 0, -0.02) });
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) segs.push({ bone: 1 + i * 3 + k, chain: i, a: J.f[i][k], b: J.f[i][k + 1] });
  for (let k = 0; k < 3; k++) segs.push({ bone: 13 + k, chain: 4, a: J.t[k], b: J.t[k + 1] });
  const segDist = (p, s) => { const ab = s.b.clone().sub(s.a), t = Math.max(0, Math.min(1, p.clone().sub(s.a).dot(ab) / ab.lengthSq())); return p.distanceTo(s.a.clone().addScaledVector(ab, t)); };
  const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4), color = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), gloss = new Float32Array(nv);
  const p = V(0, 0, 0), n = V(0, 0, 0);
  for (let v = 0; v < nv; v++) {
    p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); n.set(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
    // 가장 가까운 구간의 사슬(손가락)에 속하는 뼈와 손목 뼈만 쓴다(옆 손가락이 끌어당기지 않게)
    let best = Infinity, chain = -1;
    const ds = segs.map(s => { const d = segDist(p, s); if (d < best) { best = d; chain = s.chain; } return d; });
    const wb = new Map();
    segs.forEach((s, i) => {
      if (s.chain !== chain && s.chain !== -1) return;
      const w = 1 / Math.pow(ds[i] + 0.0025, 6);
      wb.set(s.bone, Math.max(wb.get(s.bone) || 0, w));
    });
    const top = [...wb.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((a, b) => a + b[1], 0);
    top.forEach(([b, w], k) => { skinIndex[v * 4 + k] = b; skinWeight[v * 4 + k] = w / sum; });
    // 색: 손등 천 1.0, 손바닥 합성 가죽 0.62, 손등 보호대와 마디 덧댐 0.45, 소맷부리 0.86(조임 띠 0.6), 손가락 옆 솔기 0.78, 거리장으로 구한 틈 그늘
    const q = parts(p.x, p.y, p.z);
    let c = 1;
    const ownBone = top[0][0];
    if (ownBone === 0 || ownBone >= 13) { if (n.y < -0.35 && q.cuff > 0.004) c = 0.62; }
    else {
      const b = segs.find(s => s.bone === ownBone), d = b.b.clone().sub(b.a).normalize();
      const up = V(0, 1, 0).sub(d.clone().multiplyScalar(d.y)).normalize();   // 그 마디의 손등 방향(바인드 포즈 근사)
      const nu = n.dot(up);
      if (nu < -0.3) c = 0.62; else if (Math.abs(nu) < 0.1) c = 0.78;
      // 손끝 바닥은 덧댄 가죽이 손톱 쪽으로 감아 올라간다
      if (ownBone % 3 === 0 && nu < 0.35) c = Math.min(c, 0.66);
    }
    if (q.rg < 0.0012 || Math.min(...q.pipd) < 0.0009) c = 0.45;
    if (q.cuff < 0.0015 && p.z > 0.012) c = (p.z > 0.03 && p.z < 0.052 && n.y > -0.2) ? 0.6 : 0.86;
    // 틈 그늘: 노멀 방향으로 몇 걸음 나가며 거리장이 기대보다 작으면(옆에 다른 면이 있으면) 어둡게
    let occ = 0;
    for (let s = 1; s <= 5; s++) { const dd = 0.0035 * s; occ += Math.max(0, dd - field(p.x + n.x * dd, p.y + n.y * dd, p.z + n.z * dd)) / Math.pow(2, s); }
    const ao = Math.max(0.3, 1 - occ * 95);
    color[v * 3] = color[v * 3 + 1] = color[v * 3 + 2] = c * ao;
    // 매끈한 면(materials.js aGloss): 합성 가죽 손바닥과 손끝(0.62, 0.66), 손등 보호대와 마디 덧댐(0.45)은 천이 아니라 정반사가 있다
    gloss[v] = c === 0.62 || c === 0.66 || c === 0.45 ? 1 : 0;
    // 천 무늬 좌표: 바인드 포즈 위치를 가장 큰 노멀 축으로 투영
    const ax = Math.abs(n.x), ay = Math.abs(n.y);
    if (ay >= ax && ay >= Math.abs(n.z)) { uv[v * 2] = p.x * 22; uv[v * 2 + 1] = p.z * 22; }
    else if (ax >= Math.abs(n.z)) { uv[v * 2] = p.z * 22; uv[v * 2 + 1] = p.y * 22; }
    else { uv[v * 2] = p.x * 22; uv[v * 2 + 1] = p.y * 22; }
  }
  _cache = { pos, nrm, index, skinIndex, skinWeight, color, uv, gloss, nv, ms: performance.now() - t0 };
  return _cache;
}

// 손 하나: root(손목 뼈)를 원하는 부모에 붙이고 setPose로 자세를 바꾼다
export function createHand(material, mirror = false) {
  const D = buildRightHandData();
  const mir = mirror ? -1 : 1;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(D.pos), nrm = new Float32Array(D.nrm);
  let index = D.index;
  if (mirror) {
    for (let i = 0; i < pos.length; i += 3) { pos[i] = -pos[i]; nrm[i] = -nrm[i]; }
    index = index.slice(); for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(D.color, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(D.uv, 2));
  geo.setAttribute('aGloss', new THREE.BufferAttribute(D.gloss, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(D.skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(D.skinWeight, 4));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const sk = makeSkeleton(mir);          // 바인드 포즈로 만들어진다
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.add(sk.root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(sk.bones));
  mesh.frustumCulled = false;
  return { mesh, sk, tris: index.length / 3, ms: D.ms };
}

// ---------- 쥐기 맞춤 ----------
// 손잡이를 둥근 상자들로 준다: { c: 중심, h: 반치수, r: 모서리 둥글기, q: 회전(총 기준) }
function sdRBox(p, b) {
  const l = p.clone().sub(b.c).applyQuaternion(b.qi);
  const qx = Math.abs(l.x) - b.h.x + b.r, qy = Math.abs(l.y) - b.h.y + b.r, qz = Math.abs(l.z) - b.h.z + b.r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - b.r;
}
export function rbox(c, size, rot = [0, 0, 0], r = 0.004) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot));
  return { c: V(...c), h: V(size[0] / 2, size[1] / 2, size[2] / 2), r, q, qi: q.clone().invert() };
}
// sk: 오른손 뼈대(맞춤용, 화면에 그리지 않는다). wrist: 총 기준 손목 행렬. boxes: 손잡이 거리장. start: 시작 자세.
// opts.fingers[i] = { boxes?, max: [MCP, PIP, DIP], ratio } 손가락마다 다른 대상(검지는 방아쇠)과 한계
export function fitGrasp(sk, wrist, boxes, start, opts = {}) {
  const pose = clonePose(start);
  const holder = new THREE.Group(); holder.matrixAutoUpdate = false; holder.matrix.copy(wrist); holder.add(sk.root);
  const margin = opts.margin ?? 0.0012;
  const sdAll = (p, bs) => { let d = 1; for (const b of bs) d = Math.min(d, sdRBox(p, b)); return d; };
  const touch = (a, b, ra, rb, bs) => { for (let s = 0; s <= 4; s++) { const t = s / 4, p = a.clone().lerp(b, t); if (sdAll(p, bs) < ra + (rb - ra) * t - margin) return true; } return false; };
  const fk = () => { setPose(sk, pose); holder.updateMatrixWorld(true); return joints(sk, true); };
  const chains = [0, 1, 2, 3, 4];
  for (const ci of chains) {
    const o = (opts.fingers && opts.fingers[ci]) || {};
    const bs = o.boxes || boxes;
    const isT = ci === 4;
    const idx = isT ? [0, 3, 4] : [0, 2, 3];               // 굽힘 값의 자리
    const max = o.max || (isT ? [0.9, 0.8, 0.9] : [1.45, 1.75, 1.25]);
    const ratio = o.ratio || (isT ? [0.6, 0.8, 1] : [1, 1.25, 0.85]);
    const get = (k) => (isT ? pose.t[idx[k]] : pose.f[ci][idx[k]]);
    const set = (k, v) => { if (isT) pose.t[idx[k]] = v; else pose.f[ci][idx[k]] = v; };
    const R = isT ? THUMB.rad : FINGERS[ci].rad;
    const active = [true, true, true];
    for (let it = 0; it < 120 && active.some(Boolean); it++) {
      const prev = [get(0), get(1), get(2)];
      for (let k = 0; k < 3; k++) if (active[k]) set(k, Math.min(max[k], get(k) + 0.025 * ratio[k]));
      const J = fk(), j = isT ? J.t : J.f[ci];
      let hit = -1;
      for (let s = 0; s < 3; s++) if (touch(j[s], j[s + 1], R[s], R[s + 1], bs)) { hit = s; break; }
      if (hit >= 0) { for (let k = 0; k <= hit; k++) { set(k, prev[k]); active[k] = false; } }
      for (let k = 0; k < 3; k++) if (get(k) >= max[k]) active[k] = false;
    }
  }
  holder.remove(sk.root);
  return pose;
}
export { FINGERS, THUMB };
// 거리장 도구: 봇의 몸(body.js)도 같이 쓴다
export { surfaceNets, sdRoundCone, sdEllipsoid, smin };
