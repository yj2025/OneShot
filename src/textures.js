// 모든 텍스처를 캔버스로 절차 생성한다 (이미지 파일 없음)
import * as THREE from 'three';
import { fbm, vnoise, mulberry32 } from './rng.js';

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function canvas(size, h = size) { const c = document.createElement('canvas'); c.width = size; c.height = h; return c; }

// fn(u, v) → [r,g,b] (0–255) 또는 [r,g,b,a]
function field(size, fn, h = size) {
  const c = canvas(size, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const p = fn(x / size, y / h, x, y);
      d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = p.length > 3 ? p[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function crackLines(ctx, rng, size, n, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let x = rng() * size, y = rng() * size, a = rng() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    const segs = 8 + rng() * 22;
    for (let s = 0; s < segs; s++) {
      a += (rng() - 0.5) * 0.9; const l = 3 + rng() * 10;
      x += Math.cos(a) * l; y += Math.sin(a) * l; ctx.lineTo(x, y);
      if (rng() < 0.12) { ctx.stroke(); ctx.lineWidth = width * (0.4 + rng() * 0.8); ctx.beginPath(); ctx.moveTo(x, y); }
    }
    ctx.stroke();
  }
}

function speckle(ctx, rng, size, n, colors, rmin, rmax) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    const r = rmin + rng() * (rmax - rmin);
    ctx.beginPath(); ctx.ellipse(rng() * size, rng() * size, r, r * (0.6 + rng() * 0.5), rng() * 3, 0, Math.PI * 2); ctx.fill();
  }
}

// ---- 표면 도구 ----
// 색(C), 높이(H), 거칠기(R) 캔버스 셋을 한 번에 만든다. fn(u, v, x, y) → [r, g, b, 높이(0~1, 0.5가 평면), 거칠기(0~1)].
// 덧그리기(균열, 얼룩)는 cx, hx, rx에 함께 그린다. finishSurface가 높이에서 노멀 맵을 만들고, 오목한 곳은 색을 조금 어둡게 한다(틈새 그늘)
function surface(size, fn, h = size) {
  const C = canvas(size, h), H = canvas(size, h), R = canvas(size, h);
  const cx = C.getContext('2d'), hx = H.getContext('2d', { willReadFrequently: true }), rx = R.getContext('2d');
  const ci = cx.createImageData(size, h), hi = hx.createImageData(size, h), ri = rx.createImageData(size, h);
  const cd = ci.data, hd = hi.data, rd = ri.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4, p = fn(x / size, y / h, x, y);
    cd[o] = p[0]; cd[o + 1] = p[1]; cd[o + 2] = p[2]; cd[o + 3] = 255;
    const hv = clamp(p[3]) * 255; hd[o] = hd[o + 1] = hd[o + 2] = hv; hd[o + 3] = 255;
    const rv = clamp(p[4]) * 255; rd[o] = rd[o + 1] = rd[o + 2] = rv; rd[o + 3] = 255;   // 거칠기는 초록 채널을 읽는다
  }
  cx.putImageData(ci, 0, 0); hx.putImageData(hi, 0, 0); rx.putImageData(ri, 0, 0);
  return { C, H, R, cx, hx, rx, k: 4, cav: 1 };
}
// 균열: 색에는 어두운 선, 높이에는 홈, 거칠기에는 거친 선으로 같은 경로를 그린다
function cracks(s, rng, size, n, width, color) {
  const paths = [];
  for (let i = 0; i < n; i++) {
    let x = rng() * size, y = rng() * size, a = rng() * Math.PI * 2;
    const pts = [[x, y, width]]; const segs = 8 + rng() * 22;
    for (let k = 0; k < segs; k++) { a += (rng() - 0.5) * 0.9; const l = 3 + rng() * 10; x += Math.cos(a) * l; y += Math.sin(a) * l; pts.push([x, y, rng() < 0.12 ? width * (0.4 + rng() * 0.8) : 0]); }
    paths.push(pts);
  }
  for (const [ctx, col, wk] of [[s.cx, color, 1], [s.hx, 'rgba(0,0,0,0.85)', 1.3], [s.rx, 'rgba(255,255,255,0.8)', 1.3]]) {
    ctx.strokeStyle = col; ctx.lineCap = 'round';
    for (const pts of paths) {
      ctx.lineWidth = width * wk; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) { ctx.lineTo(pts[k][0], pts[k][1]); if (pts[k][2]) { ctx.stroke(); ctx.lineWidth = pts[k][2] * wk; ctx.beginPath(); ctx.moveTo(pts[k][0], pts[k][1]); } }
      ctx.stroke();
    }
  }
}
// 둥근 얼룩: 색에 덧칠하고, rough >= 0이면 그 자리의 거칠기를 rough 쪽으로, hcol이 있으면 높이도 칠한다
function blot(s, x, y, sx, sy, color, rough = -1, hcol = null) {
  const paint = (ctx, col) => { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, col); g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)')); ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 7); ctx.fill(); ctx.restore(); };
  paint(s.cx, color);
  if (rough >= 0) { const v = rough * 255 | 0; paint(s.rx, `rgba(${v},${v},${v},0.85)`); }
  if (hcol) paint(s.hx, hcol);
}
function finishSurface(s) {
  const W = s.C.width, Hh = s.C.height, hd = s.hx.getImageData(0, 0, W, Hh).data;
  const h = new Float32Array(W * Hh); for (let i = 0; i < W * Hh; i++) h[i] = hd[i * 4] / 255;
  const at = (x, y) => h[((y + Hh) % Hh) * W + ((x + W) % W)];
  // 노멀(접선 공간). 캔버스는 아래로 갈수록 v가 줄어든다(텍스처는 위아래를 뒤집어 올린다)
  const N = canvas(W, Hh), nx = N.getContext('2d'), ni = nx.createImageData(W, Hh), nd = ni.data, k = s.k;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * k, dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * k;
    const l = Math.hypot(dx, dy, 1), o = (y * W + x) * 4;
    nd[o] = (-dx / l * 0.5 + 0.5) * 255; nd[o + 1] = (dy / l * 0.5 + 0.5) * 255; nd[o + 2] = (1 / l * 0.5 + 0.5) * 255; nd[o + 3] = 255;
  }
  nx.putImageData(ni, 0, 0);
  // 틈새 그늘: 주변(반경 4화소)보다 낮은 곳은 어둡게, 높은 곳은 조금 밝게
  if (s.cav > 0) {
    const r = 4, tmp = new Float32Array(W * Hh), blur = new Float32Array(W * Hh);
    for (let y = 0; y < Hh; y++) { let acc = 0; for (let i = -r; i <= r; i++) acc += at(i, y); for (let x = 0; x < W; x++) { tmp[y * W + x] = acc / (2 * r + 1); acc += at(x + r + 1, y) - at(x - r, y); } }
    for (let x = 0; x < W; x++) { let acc = 0; for (let i = -r; i <= r; i++) acc += tmp[((i + Hh) % Hh) * W + x]; for (let y = 0; y < Hh; y++) { blur[y * W + x] = acc / (2 * r + 1); acc += tmp[((y + r + 1) % Hh) * W + x] - tmp[((y - r + Hh) % Hh) * W + x]; } }
    const ci = s.cx.getImageData(0, 0, W, Hh), cd = ci.data;
    for (let i = 0; i < W * Hh; i++) { const m = clamp(1 + (h[i] - blur[i]) * 1.6 * s.cav, 0.55, 1.12); cd[i * 4] *= m; cd[i * 4 + 1] *= m; cd[i * 4 + 2] *= m; }
    s.cx.putImageData(ci, 0, 0);
  }
  return { map: s.C, normal: N, rough: s.R };
}
const hash2 = (a, b, c) => { let n = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791); n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };

const GEN = {
  // ---- 표면 도구를 쓰는 재질: 같은 사건(균열, 벗겨진 칠, 골재, 결, 골, 닳은 길, 젖은 자리)에서 색, 높이, 거칠기를 함께 만든다 ----
  concrete(rng, S = 512) {
    const s = surface(S, (u, v) => {
      const n = fbm(u * 6, v * 6, 6, 5, 1), m = fbm(u * 2, v * 2, 2, 3, 2), sf = fbm(u * 24, v * 24, 24, 2, 3);
      const pore = vnoise(u * 170, v * 170, 170, 4), agg = vnoise(u * 64, v * 64, 64, 5);
      const wet = sstep(0.62, 0.7, fbm(u * 3 + 0.3, v * 3, 3, 4, 9));
      // 닳은 자리: 골재가 갈려 매끈하고 반들거린다
      const worn = sstep(0.52, 0.74, fbm(u * 1.5 + 0.7, v * 1.5, 1.5, 3, 6));
      const g = 118 + (n - 0.5) * 50 + (sf - 0.5) * 22 - sstep(0.55, 0.75, m) * 34 - wet * 18 + worn * 6;
      const h = 0.5 + (sf - 0.5) * 0.15 + (agg - 0.5) * 0.25 * (1 - worn * 0.7) - sstep(0.72, 0.9, pore) * 0.25 * (1 - worn * 0.8);
      const r = 0.9 - worn * 0.32 - wet * 0.45 + (pore - 0.5) * 0.12;
      return [g + 3, g + 2, g - 2, h, r];
    });
    cracks(s, rng, S, 7, 1.2, 'rgba(40,38,35,0.55)');
    const ctx = s.cx;
    ctx.strokeStyle = 'rgba(60,56,50,0.18)'; ctx.lineWidth = 3;
    for (let i = 0; i < 14; i++) { const x = rng() * S, y = rng() * S, a = rng() * 6.28, l = 40 + rng() * 120; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rng() - 0.5) * 30, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); }
    speckle(ctx, rng, S, 25, ['rgba(200,190,150,0.5)', 'rgba(170,60,40,0.35)', 'rgba(220,220,215,0.5)'], 1, 4);
    speckle(ctx, rng, S, 900, ['rgba(70,68,64,0.5)', 'rgba(160,158,150,0.4)', 'rgba(50,45,40,0.35)'], 0.5, 1.8);
    // 기름 얼룩: 어둡고 반들거린다
    for (let i = 0; i < 5; i++) blot(s, rng() * S, rng() * S, 20 + rng() * 60, 14 + rng() * 40, 'rgba(30,28,24,0.35)', 0.45);
    s.k = 3.5; s.cav = 0.7;
    return s;
  },
  plaster(rng, S = 512) {
    // 연한 회녹색 페인트(반무광), 벗겨진 곳은 칠 두께만큼 패인 거친 콘크리트, 칠의 끝은 살짝 들떠 있다, 흘러내린 물자국은 매끈하다
    const s = surface(S, (u, v) => {
      const n = fbm(u * 8, v * 8, 8, 4, 11), big = fbm(u * 2, v * 2, 2, 3, 12);
      const fine = vnoise(u * 180, v * 180, 180, 15);
      const chip = fbm(u * 14, v * 14, 14, 4, 13);
      const zone = fbm(u * 2.5, v * 2.5, 2.5, 3, 16);
      const trowel = fbm(u * 5 + 3, v * 3, 5, 3, 18);
      const peel = sstep(0.76, 0.78, chip * 0.7 + zone * 0.45);
      const edge = sstep(0.73, 0.76, chip * 0.7 + zone * 0.45) - peel;
      const streak = sstep(0.62, 0.8, fbm(u * 9, v * 0.8, 9, 3, 14)) * sstep(0.2, 0.9, 1 - v) * sstep(0.55, 0.7, fbm(u * 3, 0.5, 3, 2, 17)) * 0.9;
      let r = 158 + (n - 0.5) * 16 - big * 22 + (fine - 0.5) * 8, g = 158 + (n - 0.5) * 16 - big * 20 + (fine - 0.5) * 8, b = 146 + (n - 0.5) * 12 - big * 12 + (fine - 0.5) * 8;
      r -= streak * 40; g -= streak * 38; b -= streak * 42;
      const cr = 126 + (n - 0.5) * 26 + (fine - 0.5) * 20;
      r = mix(r, cr + 4, peel) - edge * 30; g = mix(g, cr, peel) - edge * 30; b = mix(b, cr - 8, peel) - edge * 28;
      const crete = vnoise(u * 120, v * 120, 120, 19);
      const h = 0.5 + (trowel - 0.5) * 0.04 + (fine - 0.5) * 0.03 * (1 - peel) - peel * 0.22 + (crete - 0.5) * 0.25 * peel + edge * 0.1;
      const ro = mix(0.72 - streak * 0.25, 0.97, peel);
      return [r, g, b, h, ro];
    });
    // 긁힘(색), 균열(색과 홈)
    const ctx = s.cx;
    ctx.strokeStyle = 'rgba(80,80,74,0.35)'; ctx.lineWidth = 0.8;
    for (let i = 0; i < 60; i++) { const x = rng() * S, y = S * (0.45 + rng() * 0.55); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 40, y + (rng() - 0.5) * 8); ctx.stroke(); }
    cracks(s, rng, S, 4, 0.9, 'rgba(70,70,64,0.45)');
    s.k = 4; s.cav = 0.5;
    return s;
  },
  ceiling(rng, S = 512) {
    // 0.6 m 광물섬유 천장 타일(텍스처 1장 = 2.4 m → 4×4): 잔 구멍과 갈라진 무늬가 패여 있고, 타일 사이 줄눈은 패여 있다
    const s = surface(S, (u, v) => {
      const n = fbm(u * 40, v * 40, 40, 2, 21) * 0.5 + vnoise(u * 160, v * 160, 160, 22) * 0.5;
      let g = 196 + (n - 0.5) * 30;
      const stain = sstep(0.6, 0.72, fbm(u * 3, v * 3, 3, 5, 23));
      const ring = sstep(0.69, 0.7, fbm(u * 3, v * 3, 3, 5, 23)) - sstep(0.7, 0.715, fbm(u * 3, v * 3, 3, 5, 23));
      const pit = sstep(0.72, 0.85, vnoise(u * 110, v * 110, 110, 24)), fis = sstep(0.62, 0.7, fbm(u * 26, v * 9, 26, 3, 25));
      const gu = (u * 4) % 1, gv = (v * 4) % 1, grid = Math.min(gu, 1 - gu, gv, 1 - gv) < 0.006 ? 1 : 0;
      const h = 0.55 - pit * 0.17 - fis * 0.1 - grid * 0.4 + (n - 0.5) * 0.06;
      return [g - stain * 40 - ring * 30 - grid * 46, g - stain * 52 - ring * 40 - grid * 46, g - 6 - stain * 75 - ring * 55 - grid * 46, h, 0.97];
    });
    s.k = 3.5; s.cav = 0.7;
    return s;
  },
  block(rng, S = 1024) {
    // 낡은 시멘트 미장 외벽(텍스처 1장 = 2 m): 거친 뿜칠 요철, 얼룩, 보수 자국(매끈하다), 빗물 줄(매끈하다), 균열
    const s = surface(S, (u, v) => {
      const n = fbm(u * 9, v * 9, 9, 5, 31), big = fbm(u * 1.5, v * 1.5, 1.5, 3, 32), fine = vnoise(u * 300, v * 300, 300, 38);
      const rain = sstep(0.5, 0.85, fbm(u * 14, v * 0.7, 14, 3, 33)) * (0.4 + 0.6 * sstep(0.2, 1.0, 1 - v));
      const patch = sstep(0.68, 0.7, fbm(u * 3, v * 3, 3, 4, 34));
      let g = 150 + (n - 0.5) * 34 - big * 26 - rain * 40 + (fine - 0.5) * 14;
      g += patch * 14;
      const rust = sstep(0.72, 0.92, fbm(u * 10, v * 1.3, 10, 3, 37)) * sstep(0.3, 0.9, 1 - v) * 0.5;
      const green = sstep(0.6, 0.85, fbm(u * 4, v * 4, 4, 3, 39)) * sstep(0.5, 1.0, v) * 0.5;
      const stucco = vnoise(u * 220, v * 220, 220, 36), lump = fbm(u * 40, v * 40, 40, 3, 35);
      const h = 0.5 + ((stucco - 0.5) * 0.45 + (lump - 0.5) * 0.3) * (1 - patch * 0.75) + patch * 0.06;
      const ro = 0.96 - patch * 0.2 - rain * 0.2;
      return [g + 4 + rust * 28 - green * 10, g + 2 + rust * 6 + green * 2, g - 4 - rust * 18 - green * 16, h, ro];
    });
    cracks(s, rng, S, 9, 1.3, 'rgba(45,42,38,0.55)');
    const ctx = s.cx;
    ctx.fillStyle = 'rgba(60,58,52,0.25)'; const jy = S * (0.42 + rng() * 0.1); ctx.fillRect(0, jy, S, 3);
    s.hx.fillStyle = 'rgba(0,0,0,0.5)'; s.hx.fillRect(0, jy, S, 3);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = `rgba(${170 + rng() * 30 | 0},${165 + rng() * 25 | 0},${150 + rng() * 20 | 0},0.35)`; ctx.fillRect(rng() * S, rng() * S, 30 + rng() * 120, 20 + rng() * 70); }
    speckle(ctx, rng, S, 500, ['rgba(60,58,52,0.35)', 'rgba(200,198,190,0.3)'], 0.6, 2);
    s.k = 5; s.cav = 1.0;
    return s;
  },
  asphalt(rng, S = 512) {
    const s = surface(S, (u, v) => {
      const n = vnoise(u * 200, v * 200, 200, 41), m = fbm(u * 4, v * 4, 4, 4, 42);
      const patch = sstep(0.6, 0.62, fbm(u * 2.5, v * 2.5, 2.5, 3, 43));
      const g = 98 + (n - 0.5) * 34 + (m - 0.5) * 30 - patch * 14;
      const h = 0.5 + (n - 0.5) * 0.45 * (1 - patch * 0.6) + patch * 0.05;
      return [g, g + 1, g + 3, h, 0.88 - patch * 0.15];
    });
    cracks(s, rng, S, 10, 1.6, 'rgba(18,18,18,0.7)');
    speckle(s.cx, rng, S, 1500, ['rgba(130,128,120,0.5)', 'rgba(20,20,20,0.5)'], 0.4, 1.2);
    s.k = 5; s.cav = 1.0;
    return s;
  },
  gravel(rng, S = 512) {
    const s = surface(S, (u, v) => { const m = fbm(u * 3, v * 3, 3, 3, 51); const g = 96 + (m - 0.5) * 40; return [g + 6, g + 2, g - 6, 0.35 + (m - 0.5) * 0.1, 0.97]; });
    // 자갈: 색과 함께 높이도 그린다(돌은 솟아 있다)
    const cols = ['#7d776c', '#5f5a52', '#958e82', '#4a4640', '#8a8070', '#6b6458'];
    for (let i = 0; i < 9000; i++) {
      const x = rng() * S, y = rng() * S, r = 1.0 + rng() * 2.2, e = 0.6 + rng() * 0.5, a = rng() * 3;
      s.cx.fillStyle = cols[Math.floor(rng() * cols.length)]; s.cx.beginPath(); s.cx.ellipse(x, y, r, r * e, a, 0, 7); s.cx.fill();
      const hv = 150 + rng() * 105 | 0; s.hx.fillStyle = `rgb(${hv},${hv},${hv})`; s.hx.beginPath(); s.hx.ellipse(x, y, r, r * e, a, 0, 7); s.hx.fill();
    }
    speckle(s.cx, rng, S, 2500, ['rgba(30,28,24,0.6)'], 0.6, 1.5);
    // 흙이 드러난 곳: 돌이 묻혀 평평하다
    for (let i = 0; i < 8; i++) { const x = rng() * S, y = rng() * S, sx = 30 + rng() * 60, sy = 20 + rng() * 40; blot(s, x, y, sx, sy, 'rgba(84,72,58,0.55)', -1, 'rgba(90,90,90,0.6)'); }
    s.k = 4; s.cav = 1.3;
    return s;
  },
  corrugated(rng, S = 512) {
    // 컨테이너 골판(흰 바탕, 색은 재질 색으로): 골은 높이로 만들어 빛을 따라 밝고 어두워진다. 녹은 주황이고 거칠다
    const s = surface(S, (u, v) => {
      const rib = Math.sin(u * Math.PI * 2 * 12);
      const prof = Math.sign(rib) * Math.pow(Math.abs(rib), 0.5);
      const n = fbm(u * 8, v * 8, 8, 4, 61), dent = fbm(u * 3, v * 2, 3, 3, 64);
      const rust = sstep(0.62, 0.72, fbm(u * 4, v * 4, 4, 5, 62) + sstep(0.85, 1, v) * 0.25);
      const streak = Math.pow(fbm(u * 30, v * 1.5, 30, 2, 63), 3) * 1.5;
      const base = 190 * (0.9 + n * 0.2);
      let r = base - streak * 60, g = base - streak * 64, b = base - streak * 66;
      r = mix(r, 150, rust); g = mix(g, 92, rust); b = mix(b, 60, rust);
      const h = 0.5 + prof * 0.4 + (dent - 0.5) * 0.25 + (vnoise(u * 90, v * 90, 90, 65) - 0.5) * 0.08 * rust;
      return [r, g, b, h, mix(0.55, 0.92, rust)];
    });
    s.k = 2.2; s.cav = 0.5;
    return s;
  },
  plywood(rng, S = 512, vr = 0) {
    // 합판: 결은 아주 얕은 요철, 겉의 때와 젖었다 마른 자리는 거칠다. vr: 낱장마다 다른 결과 색(B, C)
    const k = vr * 100;
    const tint = [[1, 1, 1], [1.04, 0.98, 0.9], [0.9, 0.9, 0.86]][vr];
    const s = surface(S, (u, v) => {
      const w = fbm(u * 2, v * 30, 2, 3, 71 + k);
      const grain = Math.sin((v * (54 + vr * 9) + w * 12) * Math.PI) * 0.5 + 0.5;
      const n = fbm(u * 6, v * 6, 6, 4, 72 + k);
      const dirt = sstep(0.55, 0.8, fbm(u * 3, v * 3, 3, 4, 73 + k)) * 0.35 + sstep(0.7, 1, v) * 0.25;
      const r = (150 + grain * 18 + (n - 0.5) * 28) * tint[0], g = (132 + grain * 15 + (n - 0.5) * 24) * tint[1], b = (106 + grain * 10 + (n - 0.5) * 20) * tint[2];
      const h = 0.5 + (grain - 0.5) * 0.12 + (n - 0.5) * 0.1;
      return [r * (1 - dirt), g * (1 - dirt * 1.05), b * (1 - dirt * 1.1), h, 0.78 + dirt * 0.2];
    });
    const ctx = s.cx;
    ctx.save(); ctx.translate(S * (0.1 + rng() * 0.5), S * (0.3 + rng() * 0.4)); ctx.rotate(-0.05 + (rng() - 0.5) * 0.2);
    ctx.font = `bold ${S * 0.09}px Arial`; ctx.fillStyle = 'rgba(150,45,35,0.5)'; ctx.shadowColor = 'rgba(160,40,30,0.5)'; ctx.shadowBlur = 6;
    const marks = ['B2', 'C4', 'A1', '7', 'D3', '→ 2', 'X', '12'];
    ctx.fillText(marks[Math.floor(rng() * marks.length)], 0, 0);
    if (rng() < 0.6) { ctx.font = `${S * 0.07}px Arial`; ctx.fillStyle = 'rgba(30,30,30,0.6)'; ctx.fillText(['탄착 금지', 'STOP', '진입로', '사선 2'][Math.floor(rng() * 4)], S * 0.05, S * 0.32); }
    ctx.restore();
    speckle(ctx, rng, S, 140, ['rgba(40,30,20,0.5)', 'rgba(20,20,20,0.4)'], 1, 3);
    // 못 자국과 패인 자국
    for (let i = 0; i < 30; i++) { const x = rng() * S, y = rng() * S, r = 1 + rng() * 3; s.hx.fillStyle = 'rgba(0,0,0,0.6)'; s.hx.beginPath(); s.hx.arc(x, y, r, 0, 7); s.hx.fill(); }
    s.k = 4; s.cav = 0.8;
    return s;
  },
  plywoodB(rng, S = 512) { return GEN.plywood(rng, S, 1); },
  plywoodC(rng, S = 512) { return GEN.plywood(rng, S, 2); },
  linoleum(rng, S = 512) {
    // 30 cm 리놀륨 타일(텍스처 1장 = 2.4 m → 8×8): 줄눈은 패여 있고, 사람이 다니던 길은 닳아 반들거리며, 긁힌 자국은 거칠다
    const s = surface(S, (u, v) => {
      const tx = Math.floor(u * 8), ty = Math.floor(v * 8);
      const alt = (tx + ty) % 2 ? 0 : 1;
      const n = fbm(u * 30, v * 30, 30, 3, 81);
      const wear = sstep(0.45, 0.8, fbm(u * 3, v * 3, 3, 4, 82));
      const fu = (u * 8) % 1, fv = (v * 8) % 1, gr = Math.min(fu, 1 - fu, fv, 1 - fv);
      const grout = gr < 0.012 ? 1 : 0;
      const lift = hash2(tx, ty, 83) < 0.12 ? sstep(0.25, 0.0, gr) * 0.25 : 0;   // 들뜬 타일 가장자리
      let r = (alt ? 150 : 128) + (n - 0.5) * 20, g = (alt ? 144 : 122) + (n - 0.5) * 20, b = (alt ? 128 : 106) + (n - 0.5) * 18;
      r = mix(r, 110, wear * 0.5); g = mix(g, 100, wear * 0.5); b = mix(b, 84, wear * 0.5);
      const gk = grout ? 0.75 : 1;
      const h = 0.55 - grout * 0.4 + lift + (n - 0.5) * 0.05;
      return [r * gk, g * gk, b * gk, h, grout ? 0.95 : 0.62 - (1 - wear) * 0.0 - wear * 0.25 + (n - 0.5) * 0.1];
    });
    // 끌린 자국: 거칠고 어둡다
    for (let i = 0; i < 40; i++) { const x = rng() * S, y = rng() * S, a = rng() * 6.28, l = 10 + rng() * 50; for (const [c2, w] of [[s.cx, 'rgba(60,55,45,0.25)'], [s.rx, 'rgba(240,240,240,0.5)']]) { c2.strokeStyle = w; c2.lineWidth = 1 + rng(); c2.beginPath(); c2.moveTo(x, y); c2.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c2.stroke(); } }
    s.k = 5; s.cav = 0.8;
    return s;
  },
  cardboard(rng, S = 256) {
    // 골판지: 안쪽 골이 겉면에 희미한 줄로 드러난다. 테이프는 매끈하다
    const s = surface(S, (u, v) => { const n = fbm(u * 6, v * 6, 6, 4, 91); const g = 0.8 + n * 0.3; return [146 * g, 122 * g, 94 * g, 0.5 + Math.sin(v * S * 0.9) * 0.06 + (n - 0.5) * 0.15, 1]; });
    s.cx.fillStyle = 'rgba(190,170,130,0.8)'; s.cx.fillRect(0, S * 0.46, S, S * 0.08);
    s.rx.fillStyle = 'rgba(110,110,110,1)'; s.rx.fillRect(0, S * 0.46, S, S * 0.08);
    s.hx.fillStyle = 'rgba(160,160,160,1)'; s.hx.fillRect(0, S * 0.46, S, S * 0.08);
    s.cx.fillStyle = 'rgba(40,30,20,0.6)'; s.cx.font = `${S * 0.08}px Arial`; s.cx.fillText('↑↑  취급주의', S * 0.1, S * 0.3);
    s.k = 3; s.cav = 0.6;
    return s;
  },
  locker(rng, S = 256) {
    // 철제 사물함: 찌그러짐(높이), 환기 구멍과 이음은 패여 있고, 긁힌 자리는 칠이 벗겨져 거칠다
    const s = surface(S, (u, v) => {
      const n = fbm(u * 6, v * 6, 6, 4, 101), dent = fbm(u * 3 + 5, v * 3, 3, 3, 103);
      const vent = (v > 0.08 && v < 0.2 && (u * 10) % 1 < 0.5 && u > 0.2 && u < 0.8) ? 1 : 0;
      const seam = (u < 0.02 || u > 0.98) ? 1 : 0;
      const sc = sstep(0.7, 0.75, fbm(u * 20, v * 3, 20, 3, 102));
      const g = (0.85 + n * 0.25) * (vent ? 0.35 : 1) * (seam ? 0.6 : 1);
      const h = 0.5 + (dent - 0.5) * 0.5 - vent * 0.4 - seam * 0.3 - sc * 0.05;
      return [118 * g + sc * 40, 130 * g + sc * 40, 120 * g + sc * 40, h, 0.5 + sc * 0.35 + (n - 0.5) * 0.1];
    });
    s.k = 3; s.cav = 0.6;
    return s;
  },
  fabric(rng, S = 256) {
    return field(S, (u, v, x, y) => {
      const weave = ((x + y) % 4 < 2 ? 0.94 : 1.0);
      const n = fbm(u * 8, v * 8, 8, 4, 111);
      const g = (0.8 + n * 0.4) * weave;
      return [90 * g, 92 * g, 78 * g];
    });
  },
  chainlink(rng, S = 128) {
    const c = canvas(S); const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(150,150,145,1)'; ctx.lineWidth = 3;
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath(); ctx.moveTo(k * S, 0); ctx.lineTo(k * S + S, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(k * S + S, 0); ctx.lineTo(k * S, S); ctx.stroke();
    }
    return c;
  },
  holes(rng, S = 256) {
    // 4칸 아틀라스: 콘크리트, 나무, 금속, 흙
    const c = canvas(S); const ctx = c.getContext('2d'); const h = S / 2;
    const draw = (ox, oy, inner, ring, chips) => {
      ctx.save(); ctx.translate(ox + h / 2, oy + h / 2);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.45);
      g.addColorStop(0, ring[0]); g.addColorStop(0.55, ring[1]); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, h * 0.45, 0, 7); ctx.fill();
      for (let i = 0; i < chips; i++) { ctx.fillStyle = ring[1]; const a = rng() * 7, r = h * (0.12 + rng() * 0.25); ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 1 + rng() * h * 0.05, 0, 7); ctx.fill(); }
      ctx.fillStyle = inner; ctx.beginPath(); ctx.arc(0, 0, h * 0.07, 0, 7); ctx.fill();
      ctx.restore();
    };
    draw(0, 0, 'rgba(15,15,15,1)', ['rgba(80,78,72,0.9)', 'rgba(150,148,140,0.6)'], 14);
    draw(h, 0, 'rgba(25,15,8,1)', ['rgba(120,90,50,0.8)', 'rgba(210,180,130,0.6)'], 8);
    draw(0, h, 'rgba(10,10,10,1)', ['rgba(60,60,62,0.9)', 'rgba(190,190,195,0.5)'], 2);
    draw(h, h, 'rgba(30,24,18,0.9)', ['rgba(60,50,40,0.8)', 'rgba(80,70,55,0.4)'], 6);
    return c;
  },
  puff(rng, S = 128) {
    return field(S, (u, v) => {
      const dx = u - 0.5, dy = v - 0.5, r = Math.sqrt(dx * dx + dy * dy) * 2;
      const n = fbm(u * 4, v * 4, 4, 4, 121);
      const a = clamp((1 - r) * 1.4 - (1 - n) * 0.6) * 255;
      return [255, 255, 255, a];
    });
  },
  flash(rng, S = 128) {
    const c = canvas(S); const ctx = c.getContext('2d');
    ctx.translate(S / 2, S / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S / 2);
    g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.18, 'rgba(255,200,110,0.9)'); g.addColorStop(0.5, 'rgba(255,120,30,0.25)'); g.addColorStop(1, 'rgba(255,90,10,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, S / 2, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,170,0.8)';
    for (let i = 0; i < 5; i++) { ctx.rotate(Math.PI * 2 / 5 + (rng() - 0.5) * 0.4); ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(0, S * (0.3 + rng() * 0.18)); ctx.lineTo(3, 0); ctx.fill(); }
    return c;
  },
  stain(rng, S = 256) {
    return field(S, (u, v) => {
      const dx = u - 0.5, dy = v - 0.5, r = Math.sqrt(dx * dx + dy * dy) * 2;
      const n = fbm(u * 5, v * 5, 5, 5, 131);
      const a = clamp((1 - r) * 1.6 + (n - 0.5) * 1.8 - 0.4);
      const edge = clamp(1 - Math.abs(a - 0.15) * 8) * 0.5;
      return [40, 36, 30, (a * 0.55 + edge * 0.3) * 255];
    });
  },
  weeds(rng, S = 256) {
    // 잡초 덤불 (알파)
    const c = canvas(S); const x = c.getContext('2d'); x.clearRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const bx = S * (0.15 + rng() * 0.7), h = S * (0.3 + rng() * 0.65), lean = (rng() - 0.5) * S * 0.35;
      const g = 70 + rng() * 50, r = g * (0.75 + rng() * 0.25), b = g * 0.45;
      x.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},1)`; x.lineWidth = 1 + rng() * 2.2;
      x.beginPath(); x.moveTo(bx, S); x.quadraticCurveTo(bx + lean * 0.3, S - h * 0.6, bx + lean, S - h); x.stroke();
    }
    for (let i = 0; i < 25; i++) { x.fillStyle = `rgba(${110 + rng() * 40 | 0},${100 + rng() * 30 | 0},${60 | 0},1)`; x.beginPath(); x.ellipse(S * (0.2 + rng() * 0.6), S * (0.3 + rng() * 0.5), 2 + rng() * 4, 1 + rng() * 2, rng() * 3, 0, 7); x.fill(); }
    return c;
  },
  sign(rng, S = 512) {
    const c = canvas(S, S / 2); const x = c.getContext('2d');
    x.fillStyle = '#d9d5c8'; x.fillRect(0, 0, S, S / 2);
    x.fillStyle = '#7a1f18'; x.fillRect(0, 0, S, S * 0.12);
    x.fillStyle = '#f0ece0'; x.font = `bold ${S * 0.07}px "Malgun Gothic", sans-serif`; x.fillText('관계자 외 출입금지', S * 0.06, S * 0.09);
    x.fillStyle = '#2a2a2a'; x.font = `bold ${S * 0.085}px "Malgun Gothic", sans-serif`; x.fillText('근접전 훈련장 3동', S * 0.06, S * 0.25);
    x.font = `${S * 0.045}px "Malgun Gothic", sans-serif`; x.fillText('실탄 반입 금지 · 훈련 중 무단 진입 금지', S * 0.06, S * 0.34);
    x.fillText('안전관리 담당 내선 214', S * 0.06, S * 0.42);
    for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(${rng() < 0.5 ? '90,70,50' : '255,255,255'},${rng() * 0.12})`; x.fillRect(rng() * S, rng() * S / 2, 1 + rng() * 3, 1 + rng() * 3); }
    const g = x.createLinearGradient(0, 0, 0, S / 2); g.addColorStop(0, 'rgba(80,60,40,0)'); g.addColorStop(1, 'rgba(80,60,40,0.35)'); x.fillStyle = g; x.fillRect(0, 0, S, S / 2);
    return c;
  },
  paper(rng, S = 128) {
    const c = field(S, (u, v) => { const n = fbm(u * 5, v * 5, 5, 3, 141); const g = 205 + n * 30; return [g, g - 4, g - 16]; });
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(60,60,70,0.55)';
    for (let i = 0; i < 14; i++) ctx.fillRect(S * 0.1, S * (0.12 + i * 0.055), S * (0.5 + rng() * 0.3), 1.5);
    ctx.fillStyle = 'rgba(90,70,50,0.25)'; ctx.beginPath(); ctx.arc(S * 0.7, S * 0.75, S * 0.15, 0, 7); ctx.fill();
    return c;
  },
};

export const TEXTURE_LIST = Object.keys(GEN);

// 진행률을 알리며 하나씩 생성
export async function buildTextures(seed, onProgress) {
  const out = {};
  const rng = mulberry32(seed * 7 + 3);
  let i = 0;
  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.needsUpdate = true; return t; };
  for (const k of TEXTURE_LIST) {
    const c = GEN[k](rng);
    // 표면 도구로 만든 재질은 색, 노멀(k + 'N'), 거칠기(k + 'R') 세 장을 낸다
    if (c.C) { const f = finishSurface(c); out[k] = tex(f.map, true); out[k + 'N'] = tex(f.normal, false); out[k + 'R'] = tex(f.rough, false); }
    else out[k] = tex(c, true);
    i++;
    onProgress?.(i / TEXTURE_LIST.length, k);
    await new Promise(r => setTimeout(r, 0));
  }
  return out;
}
