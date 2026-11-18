// 탄의 길(2026-11-18): 레벨의 보이는 삼각형으로 BVH를 지어, 탄이 화면에 보이는 면에서 멈추고 보이는 빈틈은 지나가게 한다.
// 그 전에는 탄도 움직임용 충돌 상자(level.boxes)로 쐈다. 상자는 보이는 형상과 따로 손으로 둔 것이라
//  - 선반, 의자, 돌린 상자와 팔레트는 감싸는 상자가 빈틈까지 덮어 탄이 허공에서 멈췄고(검사 (q) '막힘' 10.7%),
//  - 팔레트 더미, 드럼통, 방벽, 나무 줄기, 잔해 둔덕은 상자가 없거나 작아 탄이 보이는 물체를 지나갔다('뚫림' 4.8%).
// 움직임(플레이어와 봇의 몸)은 그대로 상자로 막는다. 탄만 보이는 형상을 쓴다.
import * as THREE from 'three';

// 보이는 재질 키 → 맞은 자리의 재질(탄흔, 먼지, 소리). 여기 없는 재질은 탄이 지나간다(잎, 낙엽, 철망, 비닐, 웅덩이, 얼룩, 종이, 전선, 형광등 관)
const HIT = {
  concrete: 'concrete', plaster: 'concrete', block: 'concrete', ceiling: 'concrete', jersey: 'concrete', skirt: 'concrete', linoleum: 'concrete',
  bgConcrete: 'concrete', bgPlaster: 'concrete', bgPaintB: 'concrete', bgVoid: 'concrete', bgGlass: 'concrete',
  asphalt: 'gravel', gravel: 'gravel', grass: 'gravel',
  contBlue: 'metal', contRust: 'metal', roofMetal: 'metal', locker: 'metal', metalDark: 'metal', metalGalv: 'metal', steelGrate: 'metal',
  acUnit: 'metal', drumBlue: 'metal', drumRed: 'metal', bgClad: 'metal', bgRoof: 'metal', tubeDead: 'metal', sign: 'metal',
  plywood: 'wood', plywoodB: 'wood', plywoodC: 'wood', pallet: 'wood', doorPaint: 'wood', deskTop: 'wood', treeBark: 'wood',
  cardboard: 'cardboard', cardboardB: 'cardboard', cardboardC: 'cardboard',
  fabricChair: 'cloth', rubber: 'rubber', trash: 'plastic', bottle: 'plastic', cone: 'plastic',
};
const LEAF = 6;
// 나무 껍질은 줄기와 낮은 가지만 넣는다(4 m 위의 잔가지는 사람 키의 탄길과 상관없고 삼각형이 100만 개가 넘는다)
const BARK_TOP = 4;

export class BulletTrace {
  constructor(group) {
    const t0 = performance.now();
    group.updateMatrixWorld(true);
    const src = [], I = new THREE.Matrix4();
    group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
      const mat = HIT[o.name]; if (!mat) return;
      const ga = o.geometry.attributes.position;
      let pos = ga.array;
      if (ga.isInterleavedBufferAttribute || ga.itemSize !== 3) { pos = new Float32Array(ga.count * 3); for (let i = 0; i < ga.count; i++) { pos[i * 3] = ga.getX(i); pos[i * 3 + 1] = ga.getY(i); pos[i * 3 + 2] = ga.getZ(i); } }
      if (!o.matrixWorld.equals(I)) { pos = Float32Array.from(pos); const v = new THREE.Vector3(); for (let i = 0; i < pos.length; i += 3) { v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(o.matrixWorld); pos[i] = v.x; pos[i + 1] = v.y; pos[i + 2] = v.z; } }
      const idx = o.geometry.index ? o.geometry.index.array : null;
      src.push({ pos, idx, mat, n: idx ? idx.length / 3 : pos.length / 9, bark: o.name === 'treeBark' });
    });
    this.src = src;
    // 삼각형 목록과 경계
    let N = 0; for (const s of src) N += s.n;
    const tS = new Uint16Array(N), tI = new Uint32Array(N), bmin = new Float32Array(N * 3), bmax = new Float32Array(N * 3);
    let n = 0;
    for (let si = 0; si < src.length; si++) {
      const { pos, idx, n: cnt, bark } = src[si];
      for (let t = 0; t < cnt; t++) {
        const a = (idx ? idx[t * 3] : t * 3) * 3, b = (idx ? idx[t * 3 + 1] : t * 3 + 1) * 3, c = (idx ? idx[t * 3 + 2] : t * 3 + 2) * 3;
        const y0 = Math.min(pos[a + 1], pos[b + 1], pos[c + 1]);
        if (bark && y0 > BARK_TOP) continue;
        tS[n] = si; tI[n] = t;
        for (let k = 0; k < 3; k++) { bmin[n * 3 + k] = Math.min(pos[a + k], pos[b + k], pos[c + k]); bmax[n * 3 + k] = Math.max(pos[a + k], pos[b + k], pos[c + k]); }
        n++;
      }
    }
    N = n;
    // BVH: 중심 경계의 가장 긴 축을 가운데에서 나눈다(한쪽으로 몰리면 개수로 반씩)
    const order = new Uint32Array(N); for (let i = 0; i < N; i++) order[i] = i;
    const maxNodes = Math.max(1, Math.ceil(N / LEAF) * 4);
    const nb = new Float32Array(maxNodes * 6), nFirst = new Uint32Array(maxNodes), nCount = new Uint32Array(maxNodes);
    let nodes = 1;
    const stack = [[0, 0, N]];
    while (stack.length) {
      const [node, s, e] = stack.pop();
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
      for (let i = s; i < e; i++) {
        const t = order[i] * 3;
        if (bmin[t] < x0) x0 = bmin[t]; if (bmin[t + 1] < y0) y0 = bmin[t + 1]; if (bmin[t + 2] < z0) z0 = bmin[t + 2];
        if (bmax[t] > x1) x1 = bmax[t]; if (bmax[t + 1] > y1) y1 = bmax[t + 1]; if (bmax[t + 2] > z1) z1 = bmax[t + 2];
        const cx = bmin[t] + bmax[t], cy = bmin[t + 1] + bmax[t + 1], cz = bmin[t + 2] + bmax[t + 2];
        if (cx < cx0) cx0 = cx; if (cx > cx1) cx1 = cx; if (cy < cy0) cy0 = cy; if (cy > cy1) cy1 = cy; if (cz < cz0) cz0 = cz; if (cz > cz1) cz1 = cz;
      }
      const o6 = node * 6; nb[o6] = x0; nb[o6 + 1] = y0; nb[o6 + 2] = z0; nb[o6 + 3] = x1; nb[o6 + 4] = y1; nb[o6 + 5] = z1;
      const cnt = e - s;
      if (cnt <= LEAF) { nFirst[node] = s; nCount[node] = cnt; continue; }
      const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0;
      const ax = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2, mid = ax === 0 ? (cx0 + cx1) / 2 : ax === 1 ? (cy0 + cy1) / 2 : (cz0 + cz1) / 2;
      let i = s, j = e - 1;
      while (i <= j) {
        const t = order[i] * 3 + ax;
        if (bmin[t] + bmax[t] < mid) i++; else { const tmp = order[i]; order[i] = order[j]; order[j] = tmp; j--; }
      }
      let m = i;
      if (m === s || m === e) m = (s + e) >> 1;
      const L = nodes; nodes += 2;
      nFirst[node] = L; nCount[node] = 0;
      stack.push([L, s, m], [L + 1, m, e]);
    }
    this.N = N; this.order = order; this.tS = tS; this.tI = tI; this.nb = nb.subarray(0, nodes * 6); this.nFirst = nFirst; this.nCount = nCount; this.nodes = nodes;
    this.ms = performance.now() - t0;
    this._st = new Int32Array(256);
  }

  // 광선의 첫 교차. { dist, point, normal(광선 쪽을 향함), mat }
  ray(o, d, maxDist = 200) {
    const nb = this.nb, nFirst = this.nFirst, nCount = this.nCount, order = this.order, tS = this.tS, tI = this.tI, src = this.src, st = this._st;
    const ox = o.x, oy = o.y, oz = o.z, dx = d.x, dy = d.y, dz = d.z;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    let best = maxDist, hitT = -1, nx = 0, ny = 0, nz = 0;
    let sp = 0; st[sp++] = 0;
    while (sp > 0) {
      const node = st[--sp], o6 = node * 6;
      // 상자와의 교차(슬랩)
      let t1 = (nb[o6] - ox) * ix, t2 = (nb[o6 + 3] - ox) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
      t1 = (nb[o6 + 1] - oy) * iy; t2 = (nb[o6 + 4] - oy) * iy;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (nb[o6 + 2] - oz) * iz; t2 = (nb[o6 + 5] - oz) * iz;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      if (!(tmax >= Math.max(tmin, 0)) || tmin > best) continue;
      const cnt = nCount[node];
      if (cnt === 0) {
        if (sp + 2 > st.length) continue;
        st[sp++] = nFirst[node] + 1; st[sp++] = nFirst[node];
        continue;
      }
      for (let k = nFirst[node], e = k + cnt; k < e; k++) {
        const tri = order[k], s = src[tS[tri]], pos = s.pos, idx = s.idx, t = tI[tri];
        const a = (idx ? idx[t * 3] : t * 3) * 3, b = (idx ? idx[t * 3 + 1] : t * 3 + 1) * 3, c = (idx ? idx[t * 3 + 2] : t * 3 + 2) * 3;
        const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
        const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) continue;
        const inv = 1 / det, tx = ox - pos[a], ty = oy - pos[a + 1], tz = oz - pos[a + 2];
        const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt > 1e-4 && tt < best) { best = tt; hitT = tri; nx = e1y * e2z - e1z * e2y; ny = e1z * e2x - e1x * e2z; nz = e1x * e2y - e1y * e2x; }
      }
    }
    if (hitT < 0) return null;
    const nl = Math.hypot(nx, ny, nz) || 1, sg = nx * dx + ny * dy + nz * dz > 0 ? -1 / nl : 1 / nl;
    return { dist: best, point: new THREE.Vector3(ox + dx * best, oy + dy * best, oz + dz * best), normal: new THREE.Vector3(nx * sg, ny * sg, nz * sg), mat: src[tS[hitT]].mat };
  }
}
