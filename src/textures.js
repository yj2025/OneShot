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

const GEN = {
  concrete(rng, S = 512) {
    const c = field(S, (u, v) => {
      const n = fbm(u * 6, v * 6, 6, 5, 1), m = fbm(u * 2, v * 2, 2, 3, 2), s = fbm(u * 24, v * 24, 24, 2, 3);
      let g = 118 + (n - 0.5) * 50 + (s - 0.5) * 22 - sstep(0.55, 0.75, m) * 34;
      const wet = sstep(0.62, 0.7, fbm(u * 3 + 0.3, v * 3, 3, 4, 9)) * 18;
      g -= wet;
      return [g + 3, g + 2, g - 2];
    });
    const ctx = c.getContext('2d');
    crackLines(ctx, rng, S, 7, 'rgba(40,38,35,0.55)', 1.2);
    ctx.strokeStyle = 'rgba(60,56,50,0.18)'; ctx.lineWidth = 3;
    for (let i = 0; i < 14; i++) { const x = rng() * S, y = rng() * S, a = rng() * 6.28, l = 40 + rng() * 120; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rng() - 0.5) * 30, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); }
    speckle(ctx, rng, S, 25, ['rgba(200,190,150,0.5)', 'rgba(170,60,40,0.35)', 'rgba(220,220,215,0.5)'], 1, 4);
    speckle(ctx, rng, S, 900, ['rgba(70,68,64,0.5)', 'rgba(160,158,150,0.4)', 'rgba(50,45,40,0.35)'], 0.5, 1.8);
    // 기름 얼룩
    for (let i = 0; i < 5; i++) { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); ctx.save(); ctx.translate(rng() * S, rng() * S); ctx.scale(20 + rng() * 60, 14 + rng() * 40); g.addColorStop(0, 'rgba(30,28,24,0.35)'); g.addColorStop(1, 'rgba(30,28,24,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 7); ctx.fill(); ctx.restore(); }
    return c;
  },
  plaster(rng, S = 512) {
    // 연한 회녹색 페인트, 벗겨진 곳은 회색 콘크리트, 위에서 흘러내린 물자국
    const c = field(S, (u, v) => {
      const n = fbm(u * 8, v * 8, 8, 4, 11), big = fbm(u * 2, v * 2, 2, 3, 12);
      const fine = vnoise(u * 180, v * 180, 180, 15);
      const chip = fbm(u * 14, v * 14, 14, 4, 13);
      const zone = fbm(u * 2.5, v * 2.5, 2.5, 3, 16);
      const peel = sstep(0.76, 0.78, chip * 0.7 + zone * 0.45);
      const edge = sstep(0.73, 0.76, chip * 0.7 + zone * 0.45) - peel;
      const streak = sstep(0.62, 0.8, fbm(u * 9, v * 0.8, 9, 3, 14)) * sstep(0.2, 0.9, 1 - v) * sstep(0.55, 0.7, fbm(u * 3, 0.5, 3, 2, 17)) * 0.9;
      let r = 158 + (n - 0.5) * 16 - big * 22 + (fine - 0.5) * 8, g = 158 + (n - 0.5) * 16 - big * 20 + (fine - 0.5) * 8, b = 146 + (n - 0.5) * 12 - big * 12 + (fine - 0.5) * 8;
      r -= streak * 40; g -= streak * 38; b -= streak * 42;
      const cr = 126 + (n - 0.5) * 26 + (fine - 0.5) * 20;
      r = mix(r, cr + 4, peel) - edge * 30; g = mix(g, cr, peel) - edge * 30; b = mix(b, cr - 8, peel) - edge * 28;
      return [r, g, b];
    });
    const ctx = c.getContext('2d');
    // 긁힘
    ctx.strokeStyle = 'rgba(80,80,74,0.35)'; ctx.lineWidth = 0.8;
    for (let i = 0; i < 60; i++) { const x = rng() * S, y = S * (0.45 + rng() * 0.55); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 40, y + (rng() - 0.5) * 8); ctx.stroke(); }
    crackLines(ctx, rng, S, 4, 'rgba(70,70,64,0.45)', 0.9);
    return c;
  },
  ceiling(rng, S = 512) {
    // 0.6 m 텍스 천장 타일 (텍스처 1장 = 2.4 m → 4×4 타일)
    const c = field(S, (u, v) => {
      const n = fbm(u * 40, v * 40, 40, 2, 21) * 0.5 + vnoise(u * 160, v * 160, 160, 22) * 0.5;
      let g = 196 + (n - 0.5) * 30;
      const stain = sstep(0.6, 0.72, fbm(u * 3, v * 3, 3, 5, 23));
      const ring = sstep(0.69, 0.7, fbm(u * 3, v * 3, 3, 5, 23)) - sstep(0.7, 0.715, fbm(u * 3, v * 3, 3, 5, 23));
      return [g - stain * 40 - ring * 30, g - stain * 52 - ring * 40, g - 6 - stain * 75 - ring * 55];
    });
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(150,150,145,1)';
    for (let i = 0; i <= 4; i++) { ctx.fillRect(i * S / 4 - 2, 0, 4, S); ctx.fillRect(0, i * S / 4 - 2, S, 4); }
    return c;
  },
  block(rng, S = 1024) {
    // 낡은 시멘트 미장 외벽 (텍스처 1장 = 2 m): 격자 없이 얼룩·보수 자국·빗물 줄·균열
    const c = field(S, (u, v) => {
      const n = fbm(u * 9, v * 9, 9, 5, 31), big = fbm(u * 1.5, v * 1.5, 1.5, 3, 32), fine = vnoise(u * 300, v * 300, 300, 38);
      const rain = sstep(0.5, 0.85, fbm(u * 14, v * 0.7, 14, 3, 33)) * (0.4 + 0.6 * sstep(0.2, 1.0, 1 - v));
      const patch = sstep(0.68, 0.7, fbm(u * 3, v * 3, 3, 4, 34));
      let g = 150 + (n - 0.5) * 34 - big * 26 - rain * 40 + (fine - 0.5) * 14;
      g += patch * 14;
      const rust = sstep(0.72, 0.92, fbm(u * 10, v * 1.3, 10, 3, 37)) * sstep(0.3, 0.9, 1 - v) * 0.5;
      const green = sstep(0.6, 0.85, fbm(u * 4, v * 4, 4, 3, 39)) * sstep(0.5, 1.0, v) * 0.5;
      return [g + 4 + rust * 28 - green * 10, g + 2 + rust * 6 + green * 2, g - 4 - rust * 18 - green * 16];
    });
    const ctx = c.getContext('2d');
    crackLines(ctx, rng, S, 9, 'rgba(45,42,38,0.55)', 1.3);
    // 수평 이음(타설 이음) 하나와 드문 보수 자국
    ctx.fillStyle = 'rgba(60,58,52,0.25)'; ctx.fillRect(0, S * (0.42 + rng() * 0.1), S, 3);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = `rgba(${170 + rng() * 30 | 0},${165 + rng() * 25 | 0},${150 + rng() * 20 | 0},0.35)`; ctx.fillRect(rng() * S, rng() * S, 30 + rng() * 120, 20 + rng() * 70); }
    speckle(ctx, rng, S, 500, ['rgba(60,58,52,0.35)', 'rgba(200,198,190,0.3)'], 0.6, 2);
    return c;
  },
  asphalt(rng, S = 512) {
    const c = field(S, (u, v) => {
      const n = vnoise(u * 200, v * 200, 200, 41), m = fbm(u * 4, v * 4, 4, 4, 42);
      let g = 98 + (n - 0.5) * 34 + (m - 0.5) * 30;
      const patch = sstep(0.6, 0.62, fbm(u * 2.5, v * 2.5, 2.5, 3, 43)) * -14;
      return [g + patch, g + patch + 1, g + patch + 3];
    });
    const ctx = c.getContext('2d');
    crackLines(ctx, rng, S, 10, 'rgba(18,18,18,0.7)', 1.6);
    speckle(ctx, rng, S, 1500, ['rgba(130,128,120,0.5)', 'rgba(20,20,20,0.5)'], 0.4, 1.2);
    return c;
  },
  gravel(rng, S = 512) {
    const c = field(S, (u, v) => { const m = fbm(u * 3, v * 3, 3, 3, 51); const g = 96 + (m - 0.5) * 40; return [g + 6, g + 2, g - 6]; });
    const ctx = c.getContext('2d');
    speckle(ctx, rng, S, 9000, ['#7d776c', '#5f5a52', '#958e82', '#4a4640', '#8a8070', '#6b6458'], 1.0, 3.2);
    speckle(ctx, rng, S, 2500, ['rgba(30,28,24,0.6)'], 0.6, 1.5);
    // 흙 바닥이 드러난 곳
    for (let i = 0; i < 8; i++) { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); ctx.save(); ctx.translate(rng() * S, rng() * S); ctx.scale(30 + rng() * 60, 20 + rng() * 40); g.addColorStop(0, 'rgba(84,72,58,0.55)'); g.addColorStop(1, 'rgba(84,72,58,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 7); ctx.fill(); ctx.restore(); }
    return c;
  },
  corrugated(rng, S = 512) {
    // 컨테이너 골판 (흰 바탕에 음영, 색은 재질 색으로), 녹은 주황
    return field(S, (u, v) => {
      const rib = Math.sin(u * Math.PI * 2 * 12);
      const shade = 0.82 + 0.18 * Math.sign(rib) * Math.pow(Math.abs(rib), 0.35);
      const n = fbm(u * 8, v * 8, 8, 4, 61);
      const rust = sstep(0.62, 0.72, fbm(u * 4, v * 4, 4, 5, 62) + sstep(0.85, 1, v) * 0.25);
      const streak = Math.pow(fbm(u * 30, v * 1.5, 30, 2, 63), 3) * 1.5;
      let r = 200 * shade * (0.9 + n * 0.2) - streak * 60, g = 200 * shade * (0.9 + n * 0.2) - streak * 64, b = 200 * shade * (0.9 + n * 0.2) - streak * 66;
      r = mix(r, 150, rust); g = mix(g, 92, rust); b = mix(b, 60, rust);
      return [r, g, b];
    });
  },
  plywood(rng, S = 512) {
    const c = field(S, (u, v) => {
      const w = fbm(u * 2, v * 30, 2, 3, 71);
      const grain = Math.sin((v * 60 + w * 12) * Math.PI) * 0.5 + 0.5;
      const n = fbm(u * 6, v * 6, 6, 4, 72);
      const dirt = sstep(0.55, 0.8, fbm(u * 3, v * 3, 3, 4, 73)) * 0.35 + sstep(0.7, 1, v) * 0.25;
      let r = 150 + grain * 18 + (n - 0.5) * 28, g = 132 + grain * 15 + (n - 0.5) * 24, b = 106 + grain * 10 + (n - 0.5) * 20;
      return [r * (1 - dirt), g * (1 - dirt * 1.05), b * (1 - dirt * 1.1)];
    });
    const ctx = c.getContext('2d');
    // 스프레이로 적은 구역 표시
    ctx.save(); ctx.translate(S * (0.1 + rng() * 0.5), S * (0.3 + rng() * 0.4)); ctx.rotate(-0.05 + (rng() - 0.5) * 0.2);
    ctx.font = `bold ${S * 0.09}px Arial`; ctx.fillStyle = 'rgba(150,45,35,0.5)'; ctx.shadowColor = 'rgba(160,40,30,0.5)'; ctx.shadowBlur = 6;
    const marks = ['B2', 'C4', 'A1', '7', 'D3', '→ 2', 'X', '12'];
    ctx.fillText(marks[Math.floor(rng() * marks.length)], 0, 0);
    if (rng() < 0.6) { ctx.font = `${S * 0.07}px Arial`; ctx.fillStyle = 'rgba(30,30,30,0.6)'; ctx.fillText(['탄착 금지', 'STOP', '진입로', '사선 2'][Math.floor(rng() * 4)], S * 0.05, S * 0.32); }
    ctx.restore();
    speckle(ctx, rng, S, 140, ['rgba(40,30,20,0.5)', 'rgba(20,20,20,0.4)'], 1, 3);
    return c;
  },
  plywoodB(rng, S = 512) { return GEN.plywood(rng, S); },
  plywoodC(rng, S = 512) { return GEN.plywood(rng, S); },
  linoleum(rng, S = 512) {
    // 30 cm 리놀륨 타일 (텍스처 1장 = 2.4 m → 8×8)
    return field(S, (u, v, x, y) => {
      const tx = Math.floor(u * 8), ty = Math.floor(v * 8);
      const alt = (tx + ty) % 2 ? 0 : 1;
      const n = fbm(u * 30, v * 30, 30, 3, 81);
      const wear = sstep(0.45, 0.8, fbm(u * 3, v * 3, 3, 4, 82));
      const grout = ((u * 8) % 1 < 0.012 || (v * 8) % 1 < 0.012) ? 0.75 : 1;
      let r = (alt ? 150 : 128) + (n - 0.5) * 20, g = (alt ? 144 : 122) + (n - 0.5) * 20, b = (alt ? 128 : 106) + (n - 0.5) * 18;
      r = mix(r, 110, wear * 0.5); g = mix(g, 100, wear * 0.5); b = mix(b, 84, wear * 0.5);
      return [r * grout, g * grout, b * grout];
    });
  },
  cardboard(rng, S = 256) {
    const c = field(S, (u, v) => { const n = fbm(u * 6, v * 6, 6, 4, 91); const g = 0.8 + n * 0.3; return [146 * g, 122 * g, 94 * g]; });
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(190,170,130,0.8)'; ctx.fillRect(0, S * 0.46, S, S * 0.08);
    ctx.fillStyle = 'rgba(40,30,20,0.6)'; ctx.font = `${S * 0.08}px Arial`; ctx.fillText('↑↑  취급주의', S * 0.1, S * 0.3);
    return c;
  },
  locker(rng, S = 256) {
    return field(S, (u, v) => {
      const n = fbm(u * 6, v * 6, 6, 4, 101);
      const vent = (v > 0.08 && v < 0.2 && (u * 10) % 1 < 0.5 && u > 0.2 && u < 0.8) ? 0.35 : 1;
      const seam = (u < 0.02 || u > 0.98) ? 0.6 : 1;
      const scratch = sstep(0.7, 0.75, fbm(u * 20, v * 3, 20, 3, 102)) * 40;
      const g = (0.85 + n * 0.25) * vent * seam;
      return [118 * g + scratch, 130 * g + scratch, 120 * g + scratch];
    });
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
  for (const k of TEXTURE_LIST) {
    const c = GEN[k](rng);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    out[k] = t;
    i++;
    onProgress?.(i / TEXTURE_LIST.length, k);
    await new Promise(r => setTimeout(r, 0));
  }
  return out;
}
