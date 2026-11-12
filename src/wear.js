// 형상 도구: 레벨의 모든 상자가 거치는 '닳은 상자' 생성기.
// 상자의 모서리는 두 면이 만나는 폭 0의 선이 아니라 폭이 있는 띠이고, 면은 완전한 평면이 아니다. 이 도구는
//  1) 모서리마다 이웃 상자를 보고 드러난 모서리, 평평한 이음, 오목한 접합을 가른다(드러난 모서리만 깎는다. 벽의 이음에 홈이 생기지 않는다)
//  2) 드러난 모서리의 폭을 재질별 기본값 + 모서리를 따라 변하는 잡음 + 이 빠짐 + 드문 큰 깨짐으로 정한다
//  3) 닳은 자리와 그 둘레를 꼭짓점 속성(aWear)으로 표시해 재질 셰이더가 그 자리의 밝기를 바꾸게 한다
//  4) 큰 면에 완만한 굴곡을 준다(손으로 바른 회벽, 고르지 않은 바닥, 찌그러진 철판). 굴곡은 월드 좌표의 함수라 이웃 상자와 이어진다
//  5) 상자 전체를 휘거나 찌그러뜨리는 함수(warp)를 받는다(휜 합판, 눌린 종이 상자)
// 형상은 '격자점 → 깎인 위치'의 순수 함수라서 여섯 면을 따로 만들어도 모서리에서 정확히 만난다.
// 충돌 상자와 빛 굽기에 쓰는 형상은 이 도구를 거치지 않은 반듯한 상자다(level.js).
import * as THREE from 'three';

// 재질 묶음별 닳는 방식.
// r: 기본 모서리 폭(m), chip/brk: [1 m당 빈도, 최소 크기, 최대 크기], tint: 닳은 자리의 밝기(+ 밝게, - 어둡게),
// spread: 깨진 자리 둘레로 표면이 벗겨지거나 바랜 범위(깨진 크기의 몇 배),
// off: 모서리에서 격자선을 두는 거리(깎인 단면을 표현할 해상도), seg: 그 사이의 격자 간격,
// relief: 큰 면의 굴곡 [높이(m), 물결 길이(m)]
export const WEAR = {
  masonry: { r: 0.011, chip: [0.55, 0.03, 0.09], brk: [0.07, 0.12, 0.3], tint: 0.6, spread: 2.6, off: [0.035, 0.08, 0.16, 0.3], seg: 0.16, relief: [0.004, 0.9] },
  plaster: { r: 0.006, chip: [0.35, 0.03, 0.09], brk: [0.05, 0.12, 0.35], tint: -0.6, spread: 4.5, off: [0.04, 0.12], seg: 0.2, relief: [0.007, 0.7] },
  wood: { r: 0.004, chip: [0.8, 0.015, 0.05], brk: [0.08, 0.06, 0.15], tint: 0.45, spread: 2.5, off: [0.025, 0.07], seg: 0.12, relief: [0.0, 1] },
  metal: { r: 0.003, chip: [0.5, 0.01, 0.03], brk: [0.03, 0.04, 0.08], tint: -0.5, spread: 3.5, off: [0.03], seg: 0.2, relief: [0.005, 0.45] },
  soft: { r: 0.014, chip: [0.8, 0.015, 0.05], brk: [0.1, 0.05, 0.1], tint: 0.25, spread: 2.0, off: [0.04], seg: 0.1, relief: [0.006, 0.22] },
  // 땅: 모서리는 닳지 않고 면만 울퉁불퉁하다. 굴곡은 위쪽으로만 준다(놓인 물건이 뜨지 않고 조금 묻힌다). cap: 긴 면을 나누는 칸 수의 상한
  ground: { r: 0.004, chip: [0, 0, 0], brk: [0, 0, 0], tint: 0, spread: 0, off: [], seg: 0.45, relief: [0.022, 2.3], reliefUp: true, cap: 110 },
};

// 면: [법선 축, 부호, u축, v축, uv 함수] (boxGeometry와 같은 월드 좌표 UV)
const FACES = [
  [0, 1, 2, 1, (p) => [-p[2], p[1]]], [0, -1, 2, 1, (p) => [p[2], p[1]]],
  [1, 1, 0, 2, (p) => [p[0], -p[2]]], [1, -1, 0, 2, (p) => [p[0], p[2]]],
  [2, 1, 0, 1, (p) => [p[0], p[1]]], [2, -1, 0, 1, (p) => [-p[0], p[1]]],
];

function h1(n) { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; }
export const hash = (a, b = 0, c = 0) => h1(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791));
function vnoise(seed, x) { const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f); return hash(seed, i, 7) * (1 - t) + hash(seed, i + 1, 7) * t; }
// 월드 좌표의 매끄러운 잡음(0~1)
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const c = (a, b, d) => hash(ix + a, iy + b, iz + d);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy), l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}

export class WearTool {
  // segScale: 격자 간격 배율(품질이 낮을수록 크다)
  constructor(segScale = 1) { this.segScale = segScale; this.solids = []; this.grid = new Map(); this.tris = 0; }

  // 이웃 판정에 쓰는 상자를 등록한다. spec: { min, max } 또는 { m(Matrix4), h }
  addSolid(spec) {
    const id = this.solids.length;
    let lo, hi, inv = null, h = null;
    if (spec.m) {
      const e = spec.m.elements; h = spec.h;
      const ext = [0, 1, 2].map(a => Math.abs(e[a]) * h[0] + Math.abs(e[4 + a]) * h[1] + Math.abs(e[8 + a]) * h[2]);
      lo = [e[12] - ext[0], e[13] - ext[1], e[14] - ext[2]]; hi = [e[12] + ext[0], e[13] + ext[1], e[14] + ext[2]];
      inv = new THREE.Matrix4().copy(spec.m).invert().elements;
    } else { lo = spec.min; hi = spec.max; }
    this.solids.push({ lo, hi, inv, h });
    // 1 m 칸에 등록한다. 마당 밖으로 길게 뻗은 것은 레벨 범위에서 자른다
    const c0 = [Math.max(-30, lo[0]), Math.max(-2, lo[1]), Math.max(-30, lo[2])], c1 = [Math.min(30, hi[0]), Math.min(9, hi[1]), Math.min(36, hi[2])];
    for (let x = Math.floor(c0[0]); x <= Math.floor(c1[0]); x++) for (let y = Math.floor(c0[1]); y <= Math.floor(c1[1]); y++) for (let z = Math.floor(c0[2]); z <= Math.floor(c1[2]); z++) {
      const k = (x + 64) + (y + 64) * 256 + (z + 64) * 65536;
      let l = this.grid.get(k); if (!l) this.grid.set(k, l = []); l.push(id);
    }
    return id;
  }

  // 월드 좌표의 한 점이 self가 아닌 다른 상자 안에 있는가
  solid(x, y, z, self) {
    const l = this.grid.get((Math.floor(x) + 64) + (Math.floor(y) + 64) * 256 + (Math.floor(z) + 64) * 65536);
    if (!l) return false;
    for (const id of l) {
      if (id === self) continue;
      const s = this.solids[id];
      if (x < s.lo[0] || x > s.hi[0] || y < s.lo[1] || y > s.hi[1] || z < s.lo[2] || z > s.hi[2]) continue;
      if (!s.inv) return true;
      const e = s.inv, lx = e[0] * x + e[4] * y + e[8] * z + e[12], ly = e[1] * x + e[5] * y + e[9] * z + e[13], lz = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (Math.abs(lx) <= s.h[0] && Math.abs(ly) <= s.h[1] && Math.abs(lz) <= s.h[2]) return true;
    }
    return false;
  }

  // 닳은 상자 하나. spec: { min, max } 또는 { m, h }, 그리고
  //  tile, self(이웃 판정에서 뺄 등록 번호), lite(얇거나 작은 것: 모서리만 살짝), round(기본 폭을 이 값 이상으로),
  //  warp(x, y, z) → [x, y, z] (국소 좌표를 받아 휘게 하는 함수), relief(false면 면의 굴곡을 끈다), shade(상자 전체의 밝기 차이, aWear에 더한다)
  build(spec, P) {
    const m = spec.m || null;
    const c = m ? [0, 0, 0] : [0, 1, 2].map(a => (spec.min[a] + spec.max[a]) / 2);
    const h = m ? spec.h : [0, 1, 2].map(a => (spec.max[a] - spec.min[a]) / 2);
    const me = m ? m.elements : null;
    const toWorld = (p) => me ? [me[0] * p[0] + me[4] * p[1] + me[8] * p[2] + me[12], me[1] * p[0] + me[5] * p[1] + me[9] * p[2] + me[13], me[2] * p[0] + me[6] * p[1] + me[10] * p[2] + me[14]] : [p[0] + c[0], p[1] + c[1], p[2] + c[2]];
    const self = spec.self ?? -1, lite = !!spec.lite, shade = spec.shade || 0;
    const seedBox = (Math.round((me ? me[12] : c[0]) * 131) * 31 + Math.round((me ? me[13] : c[1]) * 173) * 17 + Math.round((me ? me[14] : c[2]) * 197)) | 0;
    const rb = Math.min(Math.max(P.r, spec.round || 0), Math.min(h[0], h[1], h[2]) * 0.45);
    const dims = [h[0], h[1], h[2]].sort((a, b) => b - a);
    const cap = P.cap || (dims[1] > 1.25 ? 16 : 44);   // 넓은 판(벽, 바닥)은 굵게 나눈다
    const relief = !lite && spec.relief !== false && P.relief[0] > 0 && dims[1] > 0.25 ? [P.relief[0] * (spec.reliefK || 1), P.relief[1]] : null;

    // 축마다 격자선: 양 끝은 모서리 가까이 촘촘하게, 가운데는 seg 간격
    const L = [0, 1, 2].map(a => {
      const half = h[a], offs = [0, ...(rb >= 0.006 ? [rb * 0.45] : []), rb, ...(lite ? [] : P.off)].filter((o, i, arr) => o < half * 0.92 && (i === 0 || o > arr[i - 1] + 1e-4));
      const lines = offs.map(o => -half + o);
      const last = offs[offs.length - 1], span = 2 * (half - last);
      const n = lite ? 1 : Math.min(cap, Math.max(1, Math.round(span / (P.seg * this.segScale))));
      for (let i = 1; i < n; i++) lines.push(-half + last + span * i / n);
      for (let i = offs.length - 1; i >= 0; i--) lines.push(half - offs[i]);
      return lines;
    });

    // 모서리 12개: 축 a를 따라 뻗고, 나머지 두 축 b, c의 부호로 구분한다. rad[e][i] = 격자선 i에서의 깎인 폭, pat[e][i] = 그 둘레의 벗겨진 범위
    const rad = [], pat = [];
    const eps = 0.012;
    const p3 = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, cc = (a + 2) % 3;
      for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
        const n = L[a].length, ex = new Uint8Array(n), r = new Float32Array(n), pt = new Float32Array(n);
        // 모서리의 씨앗: 축 정렬 상자는 모서리 선의 월드 좌표로 정한다. 같은 선을 나눠 가진 두 상자가 같은 닳음을 얻는다
        let seed;
        if (me) seed = hash(seedBox, a * 4 + (sb > 0 ? 2 : 0) + (sc > 0 ? 1 : 0), 3) * 1e9 | 0;
        else seed = hash(a + 1, Math.round((c[b] + sb * h[b]) * 500), Math.round((c[cc] + sc * h[cc]) * 500)) * 1e9 | 0;
        const rmax = Math.min(h[b], h[cc]) * 0.34;
        for (let i = 0; i < n; i++) {
          p3[a] = Math.max(-h[a] + 0.015, Math.min(h[a] - 0.015, L[a][i])); p3[b] = sb * h[b]; p3[cc] = sc * h[cc];
          // 모서리 둘레의 세 방향(면 b의 바깥, 면 c의 바깥, 대각선 바깥)이 모두 비어 있어야 드러난 모서리다
          let open = true;
          for (const [kb, kc] of [[1, 1], [1, -1], [-1, 1]]) {
            const q = [p3[0], p3[1], p3[2]]; q[b] += kb * sb * eps; q[cc] += kc * sc * eps;
            const w = toWorld(q);
            if (this.solid(w[0], w[1], w[2], self)) { open = false; break; }
          }
          ex[i] = open ? 1 : 0;
          if (!open) continue;
          const wp = toWorld(p3), s = me ? L[a][i] : wp[a];
          // 사람 손과 발이 닿는 높이(바닥에서 1.3 m 안쪽)의 모서리가 더 닳는다
          const use = wp[1] < 2.0 ? 1.6 : 0.8;
          let v = rb * (0.55 + 0.9 * vnoise(seed, s / 0.35));
          if (!lite) {
            let bite = 0;
            const cl = 0.22, k0 = Math.floor(s / cl);
            for (let k = k0 - 1; k <= k0 + 1; k++) {
              if (hash(seed, k, 1) > P.chip[0] * cl * use) continue;
              const size = P.chip[1] + (P.chip[2] - P.chip[1]) * hash(seed, k, 3) ** 2, span = size * (1.2 + 1.6 * hash(seed, k, 4));
              bite = Math.max(bite, size * Math.max(0, 1 - Math.abs(s - (k + hash(seed, k, 2)) * cl) / span) ** 0.8);
            }
            const bl = 1.1, j0 = Math.floor(s / bl);
            for (let k = j0 - 1; k <= j0 + 1; k++) {
              if (hash(seed, k, 11) > P.brk[0] * bl * use) continue;
              const size = P.brk[1] + (P.brk[2] - P.brk[1]) * hash(seed, k, 13), span = size * (0.9 + hash(seed, k, 14));
              bite = Math.max(bite, size * Math.max(0, 1 - Math.abs(s - (k + hash(seed, k, 12)) * bl) / span) ** 0.6 * (0.7 + 0.6 * vnoise(seed + 5, s / 0.07)));
            }
            v += bite;
            pt[i] = Math.min(0.6, bite * P.spread);
          }
          r[i] = Math.min(v, rmax);
        }
        // 이음으로 넘어가는 자리에서 폭이 갑자기 0이 되지 않게 이웃 격자선의 드러남과 맞춘다
        for (let i = 0; i < n; i++) if (!(ex[i] && ex[Math.max(0, i - 1)] && ex[Math.min(n - 1, i + 1)])) { r[i] = 0; pt[i] = 0; }
        rad.push(r); pat.push(pt);
      }
    }
    const eIdx = (a, sg) => a * 4 + (sg[(a + 1) % 3] > 0 ? 2 : 0) + (sg[(a + 2) % 3] > 0 ? 1 : 0);
    // 꼭짓점: 만나는 세 모서리 중 둘 이상이 깎였으면 끝 폭을 같은 값으로 맞춘다(세 면이 같은 위치를 내도록)
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const sg = [sx, sy, sz], ends = [0, 1, 2].map(a => { const r = rad[eIdx(a, sg)]; return [r, sg[a] < 0 ? 0 : r.length - 1]; });
      const vals = ends.map(([r, i]) => r[i]).filter(v => v > 0);
      if (vals.length >= 2) { const rc = Math.max(...vals); for (const [r, i] of ends) if (r[i] > 0) r[i] = rc; }
    }

    const pos = [], nor = [], uv = [], wear = [], idx = [];
    const tile = spec.tile || 2, sg = [1, 1, 1], d = [0, 0, 0], q = [0, 0, 0], out = [0, 0, 0], nrm = [0, 0, 0];
    let fade = 1;   // 드러난 모서리 가까이에서는 면의 굴곡을 줄인다(깎인 띠와 이어지도록)
    // 격자점 → 깎인 위치와 법선. 면과 무관하게 점의 위치와 모서리 폭만으로 정해진다. 돌려주는 값은 닳음 표시(0~1), 깎인 띠 안이면 음수가 아닌 값에 1을 더해 알린다
    const shape = (p, ix, fn, fs) => {
      for (let a = 0; a < 3; a++) { sg[a] = p[a] >= 0 ? 1 : -1; d[a] = h[a] - Math.abs(p[a]); }
      let r = 0, act = 0, patch = 0; fade = 1;
      for (let a = 0; a < 3; a++) {
        const b = (a + 1) % 3, cc = (a + 2) % 3, e = eIdx(a, sg), ra = rad[e][ix[a]], pa = pat[e][ix[a]];
        if (ra > 0) {
          if (d[b] < ra && d[cc] < ra) { r = Math.max(r, ra); act |= (1 << b) | (1 << cc); }
          fade = Math.min(fade, Math.max(d[b], d[cc]) / 0.08);
        }
        // 깨진 자리 둘레: 모서리에서 멀어질수록 옅어지는 벗겨짐
        if (pa > 0) { const dd = Math.max(d[b], d[cc]); if (dd < pa) patch = Math.max(patch, 1 - dd / pa); }
      }
      patch = 0.85 * patch ** 1.2;
      if (!act) { out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; nrm[0] = nrm[1] = nrm[2] = 0; nrm[fn] = fs; return patch; }
      // 작은 폭은 둥글게(p=2), 이 빠진 자리는 비스듬히 잘린 면에 가깝게(p→1.25)
      const pw = 2 - 0.75 * Math.min(1, Math.max(0, (r - rb * 1.6) / (rb * 3 + 1e-6)));
      let len = 0;
      for (let a = 0; a < 3; a++) {
        if ((act >> a) & 1 && d[a] < r) q[a] = sg[a] * (h[a] - r); else q[a] = p[a];
        len += Math.abs(p[a] - q[a]) ** pw;
      }
      len = len ** (1 / pw) || 1;
      let nl = 0;
      for (let a = 0; a < 3; a++) { const D = p[a] - q[a]; out[a] = q[a] + D * r / len; nrm[a] = Math.sign(D) * Math.abs(D) ** (pw - 1); nl += nrm[a] * nrm[a]; }
      nl = Math.sqrt(nl) || 1; nrm[0] /= nl; nrm[1] /= nl; nrm[2] /= nl;
      let dm = Infinity; for (let a = 0; a < 3; a++) if ((act >> a) & 1) dm = Math.min(dm, d[a]);
      // 닳음 표시: 기본 폭을 넘게 깎인 자리만, 모서리 쪽으로 갈수록 짙게
      return 1 + Math.max(patch, Math.min(1, Math.max(0, (r - rb * 1.5) / (rb * 2.5 + 0.004))) * Math.min(1, Math.max(0, 1.15 - dm / r)));
    };

    const p = [0, 0, 0], ix = [0, 0, 0], o = [0, 0, 0];
    const fd = !!(relief || spec.warp);   // 면이 평면이 아니면 법선을 격자에서 다시 구한다
    for (const [fn, fs, fu, fv, uvf] of FACES) {
      // 다른 상자에 완전히 묻힌 면은 만들지 않는다
      let hidden = self >= 0;
      if (hidden) for (const [tu, tv] of [[0, 0], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7], [0.92, 0], [-0.92, 0], [0, 0.92], [0, -0.92]]) {
        o[fn] = fs * (h[fn] + eps); o[fu] = tu * h[fu]; o[fv] = tv * h[fv];
        const w = toWorld(o);
        if (!this.solid(w[0], w[1], w[2], self)) { hidden = false; break; }
      }
      if (hidden) continue;
      const nu = L[fu].length, nv = L[fv].length, base = pos.length / 3, cnt = nu * nv;
      const lp = new Float32Array(cnt * 3), ln = new Float32Array(cnt * 3), flat = new Uint8Array(cnt);
      ix[fn] = fs > 0 ? L[fn].length - 1 : 0; p[fn] = fs * h[fn];
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const k = j * nu + i;
        ix[fu] = i; ix[fv] = j; p[fu] = L[fu][i]; p[fv] = L[fv][j];
        let wv = shape(p, ix, fn, fs);
        let x = out[0], y = out[1], z = out[2];
        if (wv >= 1) wv -= 1; else {
          flat[k] = 1;
          if (relief) {
            // 면의 굴곡: 월드 좌표의 함수라서 같은 평면을 나눠 가진 이웃 상자와 이어진다
            const w = toWorld(out), nz3 = noise3(w[0] / relief[1] + 7.3, w[1] / relief[1] + 3.1, w[2] / relief[1] + 5.7), dz = (P.reliefUp ? nz3 * nz3 * 2 : (nz3 - 0.5) * 2) * relief[0] * Math.min(1, fade);
            if (fn === 0) x += fs * dz; else if (fn === 1) y += fs * dz; else z += fs * dz;
          }
        }
        if (spec.warp) { const w = spec.warp(x, y, z); x = w[0]; y = w[1]; z = w[2]; }
        lp[k * 3] = x; lp[k * 3 + 1] = y; lp[k * 3 + 2] = z; ln[k * 3] = nrm[0]; ln[k * 3 + 1] = nrm[1]; ln[k * 3 + 2] = nrm[2];
        const t = uvf(me ? p : [p[0] + c[0], p[1] + c[1], p[2] + c[2]]);
        uv.push(t[0] / tile, t[1] / tile);
        wear.push(wv * P.tint + shade);
      }
      // 삼각형의 감는 방향: u × v 가 법선 쪽을 향하게
      const flip = ((fu + 1) % 3 === fv ? 1 : -1) * fs < 0;
      if (fd) for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const k = j * nu + i; if (!flat[k] && !spec.warp) continue;
        const a = j * nu + Math.max(0, i - 1), b = j * nu + Math.min(nu - 1, i + 1), cI = Math.max(0, j - 1) * nu + i, dI = Math.min(nv - 1, j + 1) * nu + i;
        const ux = lp[b * 3] - lp[a * 3], uy = lp[b * 3 + 1] - lp[a * 3 + 1], uz = lp[b * 3 + 2] - lp[a * 3 + 2];
        const vx = lp[dI * 3] - lp[cI * 3], vy = lp[dI * 3 + 1] - lp[cI * 3 + 1], vz = lp[dI * 3 + 2] - lp[cI * 3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (flip) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz);
        if (l > 1e-12) {
          if (flat[k]) { ln[k * 3] = nx / l; ln[k * 3 + 1] = ny / l; ln[k * 3 + 2] = nz / l; }   // 깎인 띠 안의 점은 계산한 법선을 그대로 둔다
        }
      }
      for (let k = 0; k < cnt; k++) {
        const x = lp[k * 3], y = lp[k * 3 + 1], z = lp[k * 3 + 2], nx = ln[k * 3], ny = ln[k * 3 + 1], nz = ln[k * 3 + 2];
        if (me) {
          pos.push(me[0] * x + me[4] * y + me[8] * z + me[12], me[1] * x + me[5] * y + me[9] * z + me[13], me[2] * x + me[6] * y + me[10] * z + me[14]);
          nor.push(me[0] * nx + me[4] * ny + me[8] * nz, me[1] * nx + me[5] * ny + me[9] * nz, me[2] * nx + me[6] * ny + me[10] * nz);
        } else { pos.push(x + c[0], y + c[1], z + c[2]); nor.push(nx, ny, nz); }
      }
      for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
        const a = base + j * nu + i, b = a + 1, cI = a + nu, dI = cI + 1;
        if (flip) idx.push(a, cI, b, b, cI, dI); else idx.push(a, b, cI, b, dI, cI);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aWear', new THREE.Float32BufferAttribute(wear, 1));
    g.setIndex(idx);
    this.tris += idx.length / 3;
    return g;
  }
}
