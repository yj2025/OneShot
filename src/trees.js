// 나무 도구(1단계 ④): 종 설명으로 가지를 재귀로 키운다. 굵은 가지는 관 도형으로, 가장 가는 잔가지와 잎은 잔가지 그림을 그린 알파 카드로 만든다.
// 닫힌 덩어리(정이십면체 잎)로 만든 나무는 무엇을 더해도 덩어리로 읽혔다(3, 6, 13, 15라운드). 실제 나무의 윤곽은 갈라지는 가지이고 그 사이로 하늘이 보인다.
// 레퍼런스는 흐린 늦가을이다. 잎이 거의 없는 활엽수, 흰 줄기에 성긴 노란 잎이 남은 자작나무, 먼 곳의 침엽수.
//
// 빛: 담장 밖은 조도 볼륨 밖이라 가려지지 않은 하늘빛을 받는다. 그래서 수관의 자기 그늘은 꼭짓점 색으로 굽는다(안쪽과 아래쪽이 어둡다).
// 카드의 법선은 수관 중심에서 바깥으로 둔다. 판마다 방향이 제각각인 카드가 수관 하나의 덩어리처럼 빛을 받는다.
// 바람: 가지 끝으로 갈수록 크게 흔들린다(aSway). 시간은 게임 시계를 따르므로 수동 시계 촬영에서도 같은 화면이 나온다.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { bcMaterial } from './materials.js';

// ---------------- 텍스처 ----------------
// 껍질: 왼쪽 반은 자작나무(희고 가로 껍질눈, 밑동은 검게 갈라짐), 오른쪽 반은 어두운 활엽수·침엽수 껍질(세로 골)
function barkTexture(rng) {
  const W = 256, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // 자작나무
  g.fillStyle = '#c9c6bc'; g.fillRect(0, 0, W / 2, H);
  for (let i = 0; i < 900; i++) { const x = rng() * W / 2, y = rng() * H, w = 3 + rng() * 14, h = 1 + rng() * 2.2; g.fillStyle = `rgba(${40 + rng() * 30},${38 + rng() * 25},${34 + rng() * 20},${0.35 + rng() * 0.5})`; g.fillRect(x, y, w, h); }
  for (let i = 0; i < 400; i++) { const x = rng() * W / 2, y = rng() * H; g.fillStyle = `rgba(${150 + rng() * 60},${145 + rng() * 55},${130 + rng() * 50},0.35)`; g.fillRect(x, y, 2 + rng() * 10, 4 + rng() * 20); }
  for (let i = 0; i < 18; i++) { const x = rng() * W / 2, y = rng() * H; g.fillStyle = 'rgba(30,28,25,0.75)'; g.beginPath(); g.ellipse(x, y, 4 + rng() * 9, 3 + rng() * 6, 0, 0, Math.PI * 2); g.fill(); }
  // 어두운 껍질
  g.fillStyle = '#4b4640'; g.fillRect(W / 2, 0, W / 2, H);
  for (let i = 0; i < 70; i++) { let x = W / 2 + rng() * W / 2, y = 0; g.strokeStyle = `rgba(${18 + rng() * 15},${16 + rng() * 12},${14 + rng() * 10},${0.5 + rng() * 0.4})`; g.lineWidth = 1 + rng() * 3; g.beginPath(); g.moveTo(x, y); while (y < H) { y += 10 + rng() * 30; x += (rng() - 0.5) * 6; g.lineTo(x, y); } g.stroke(); }
  for (let i = 0; i < 600; i++) { const x = W / 2 + rng() * W / 2, y = rng() * H; g.fillStyle = `rgba(${90 + rng() * 50},${85 + rng() * 45},${75 + rng() * 40},0.25)`; g.fillRect(x, y, 1 + rng() * 4, 3 + rng() * 12); }
  // 이끼 기운(아래쪽에서 옅게): 실제 줄기의 그늘진 쪽은 푸르스름하다
  return c;
}

// 잔가지 카드 2×2: 0 잎 진 잔가지, 1 성긴 노란 잎(자작나무), 2 마른 갈색 잎이 남은 잔가지, 3 침엽수 가지
// 그림은 칸 아래 가운데에서 위로 자란다. 카드의 v 방향이 가지가 자라는 방향이다
function twigTexture(rng) {
  const S = 1024, C = S / 2, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.lineCap = 'round';
  const twig = (ox, oy, x, y, a, len, w, depth, leaves, kind) => {
    const n = 4;
    let px = x, py = y;
    const pts = [];
    for (let i = 1; i <= n; i++) {
      a += (rng() - 0.5) * 0.35;
      const nx = px + Math.sin(a) * len / n, ny = py - Math.cos(a) * len / n;
      g.strokeStyle = kind === 3 ? '#2b2a22' : `rgb(${46 + rng() * 14},${42 + rng() * 12},${38 + rng() * 10})`;
      g.lineWidth = Math.max(0.7, w * (1 - i / (n + 1) * 0.6));
      g.beginPath(); g.moveTo(ox + px, oy + py); g.lineTo(ox + nx, oy + ny); g.stroke();
      pts.push([nx, ny, a]); px = nx; py = ny;
    }
    if (kind === 3) {
      // 바늘잎: 가지 양쪽으로 짧은 선을 촘촘히
      for (const [nx, ny, aa] of pts) for (let k = 0; k < 14; k++) {
        const t = rng(), bx = nx - Math.sin(aa) * len / n * t, by = ny + Math.cos(aa) * len / n * t;
        for (const sd of [-1, 1]) {
          const na = aa + sd * (0.9 + rng() * 0.5), nl = 10 + rng() * 12 * (w / 3 + 0.4);
          g.strokeStyle = `rgb(${28 + rng() * 18},${42 + rng() * 22},${30 + rng() * 14})`; g.lineWidth = 1.2 + rng();
          g.beginPath(); g.moveTo(ox + bx, oy + by); g.lineTo(ox + bx + Math.sin(na) * nl, oy + by - Math.cos(na) * nl); g.stroke();
        }
      }
    }
    if (leaves > 0) for (const [nx, ny] of pts) if (rng() < leaves) {
      const n2 = 1 + Math.floor(rng() * 2);
      for (let k = 0; k < n2; k++) {
        const lx = nx + (rng() - 0.5) * 14, ly = ny + (rng() - 0.5) * 14, r = kind === 1 ? 5 + rng() * 5 : 7 + rng() * 7;
        g.fillStyle = kind === 1 ? `rgb(${170 + rng() * 50},${140 + rng() * 45},${40 + rng() * 40})` : `rgb(${105 + rng() * 45},${70 + rng() * 30},${38 + rng() * 22})`;
        g.beginPath(); g.ellipse(ox + lx, oy + ly, r, r * (0.55 + rng() * 0.2), rng() * Math.PI, 0, Math.PI * 2); g.fill();
      }
    }
    if (depth > 0) {
      const nb = kind === 3 ? 3 : 2 + Math.floor(rng() * 2);
      for (let b = 0; b < nb; b++) {
        const [bx, by, ba] = pts[Math.min(pts.length - 1, 1 + Math.floor(rng() * (pts.length - 1)))];
        twig(ox, oy, bx, by, ba + (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 0.5), len * (0.5 + rng() * 0.2), w * 0.62, depth - 1, leaves, kind);
      }
    }
  };
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * C, oy = Math.floor(k / 2) * C;
    g.save(); g.beginPath(); g.rect(ox + 2, oy + 2, C - 4, C - 4); g.clip();
    const leaves = k === 1 ? 0.35 : k === 2 ? 0.45 : 0;
    // 줄기 하나에서 갈라지는 잔가지 묶음. 카드 아래 끝이 가지에 붙는다
    twig(ox, oy, C / 2, C - 6, (rng() - 0.5) * 0.2, C * 0.62, k === 3 ? 4.5 : 3.6, k === 3 ? 2 : 3, leaves, k);
    if (k !== 3) for (let b = 0; b < 2; b++) twig(ox, oy, C / 2 + (rng() - 0.5) * 20, C - 30 - rng() * 60, (rng() < 0.5 ? -1 : 1) * (0.4 + rng() * 0.4), C * 0.42, 2.4, 2, leaves, k);
    g.restore();
  }
  return c;
}

// 낙엽 조각 2칸: 왼쪽은 몇 장이 흩어진 것, 오른쪽은 겹쳐 깔린 것. 한 무더기를 둥글게 모으면 판마다 동그란 더미로 보였다.
// 잎을 칸 전체에 고르게 흩고, 여러 판이 겹쳐 쌓인 곳과 몇 장만 떨어진 곳을 판의 수와 칸으로 나눈다
function litterTexture(rng) {
  const S = 512, c = document.createElement('canvas'); c.width = S * 2; c.height = S;
  const g = c.getContext('2d');
  for (let i = 0; i < 26 + 300; i++) {
    const dense = i >= 26, ox = dense ? S : 0, m = 0.07;
    const x = ox + S * (m + (1 - 2 * m) * rng()), y = S * (m + (1 - 2 * m) * rng());
    const r = 7 + rng() * 11, t = rng();
    // 땅에 떨어진 지 오래된 잎은 갈색과 회갈색이고, 젖은 잎은 검다. 노란 잎은 갓 떨어진 몇 장뿐이다
    g.fillStyle = t < 0.38 ? `rgb(${92 + rng() * 34},${70 + rng() * 22},${48 + rng() * 16})` : t < 0.5 ? `rgb(${140 + rng() * 35},${118 + rng() * 28},${70 + rng() * 25})` : t < 0.78 ? `rgb(${54 + rng() * 20},${46 + rng() * 14},${38 + rng() * 10})` : `rgb(${118 + rng() * 28},${108 + rng() * 22},${92 + rng() * 18})`;
    g.save(); g.translate(x, y); g.rotate(rng() * Math.PI);
    g.beginPath(); g.ellipse(0, 0, r, r * (0.45 + rng() * 0.25), 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(40,30,20,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-r, 0); g.lineTo(r * 1.2, 0); g.stroke();
    g.restore();
  }
  g.strokeStyle = '#3a332b'; g.lineCap = 'round';
  for (let i = 0; i < 12; i++) { const x = (i < 3 ? 0 : S) + S * (0.2 + rng() * 0.6), y = S * (0.2 + rng() * 0.6), a = rng() * Math.PI * 2, l = 30 + rng() * 70; g.lineWidth = 1.5 + rng() * 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  return c;
}

const canvasTex = (c, wrap) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; };

// ---------------- 재질 ----------------
const swayU = { uTreeT: { value: 0 } };
// 바람: 가지 끝으로 갈수록(aSway) 크게, 큰 흔들림과 잔떨림을 섞는다. 위상은 위치로 정한다
const SWAY = `
#include <begin_vertex>
{
  float ph = dot(position.xz, vec2(0.071, 0.093)) + position.y * 0.05;
  float t = uTreeT;
  vec2 big = vec2(sin(t * 0.9 + ph) + 0.5 * sin(t * 2.3 + ph * 1.7), 0.6 * cos(t * 0.7 + ph * 1.3));
  float fl = sin(t * 6.1 + ph * 9.0 + position.x * 3.0) * 0.5 + sin(t * 9.7 + position.z * 4.0) * 0.5;
  transformed.xz += big * aSway * 0.06 + vec2(fl) * aSway * aSway * 0.025;
  transformed.y += fl * aSway * aSway * 0.015;
}
`;
// 알파 시험: 밉맵이 내려갈수록 알파 평균이 낮아져 먼 나무의 잔가지가 사라진다. 밉 단계만큼 알파를 키워 덮는 면적을 지킨다
const ALPHA_MIP = `
#ifdef USE_ALPHATEST
{
  vec2 ts = vec2(textureSize(map, 0));
  vec2 dx = dFdx(vMapUv * ts), dy = dFdy(vMapUv * ts);
  float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
  diffuseColor.a *= 1.0 + lod * 0.32;
  if (diffuseColor.a < alphaTest) discard;
}
#endif
`;
function treeMaterial(params, opt, key, cards) {
  const m = bcMaterial({ vertexColors: true, roughness: 1, ...params }, opt);
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh) => {
    base(sh);
    Object.assign(sh.uniforms, swayU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uTreeT;').replace('#include <begin_vertex>', SWAY);
    if (cards) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', ALPHA_MIP);
      // 양면 카드: 뒷면에서 법선을 뒤집지 않는다(법선은 수관 바깥쪽이다)
      const nb = THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');
      if (nb === THREE.ShaderChunk.normal_fragment_begin) console.warn('잔가지 카드: 법선 뒤집기를 찾지 못했다');
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', nb);
    }
  };
  m.customProgramCacheKey = () => 'bcTree' + key;
  return m;
}

// ---------------- 형상 묶음 ----------------
class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.s = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  v(p, n, u, v, col, sw) { this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v); this.c.push(col[0], col[1], col[2]); this.s.push(sw); return this.count - 1; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.s, 1));
    g.setAttribute('aWear', new THREE.Float32BufferAttribute(new Float32Array(this.count), 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
function perp(d) { const a = Math.abs(d.y) < 0.9 ? UP : V(1, 0, 0); return a.clone().cross(d).normalize(); }

// 종 설명. levels[k]: 그 단계의 가지가 부모에서 갈라지는 수(길이 1 m당), 각도, 길이 비율, 시작 위치
// card: 잔가지 카드 칸(0 잎 진, 1 노란 잎, 2 갈색 잎, 3 침엽), cardMix: 다른 칸이 섞이는 비율, bark: 0 자작나무, 1 어두운 껍질
export const SPECIES = {
  birch: { bark: 0, H: [9, 16], R: [0.11, 0.2], lean: 0.08, kink: 0.12, trop: [0.05, -0.05, -0.25], splitAt: 0, leaders: 1,
    levels: [{ per: 2.2, ang: [0.45, 0.9], len: [0.32, 0.5], start: 0.3, rr: 0.5 }, { per: 2.4, ang: [0.4, 0.8], len: [0.35, 0.55], start: 0.2, rr: 0.55 }, { per: 3.0, ang: [0.35, 0.7], len: [0.4, 0.6], start: 0.15, rr: 0.6 }],
    card: 1, cardMix: [0, 0.35], cardSize: [0.7, 1.1], cardPer: 2.6, crownTint: [1, 1, 1] },
  broadleaf: { bark: 1, H: [10, 17], R: [0.2, 0.34], lean: 0.05, kink: 0.18, trop: [0.08, 0.05, -0.08], splitAt: [0.3, 0.45], leaders: [2, 3],
    levels: [{ per: 1.3, ang: [0.6, 1.1], len: [0.4, 0.62], start: 0.35, rr: 0.5 }, { per: 2.0, ang: [0.5, 0.95], len: [0.38, 0.55], start: 0.2, rr: 0.55 }, { per: 2.6, ang: [0.4, 0.85], len: [0.4, 0.6], start: 0.15, rr: 0.6 }],
    card: 0, cardMix: [2, 0.3], cardSize: [0.8, 1.3], cardPer: 2.2, crownTint: [1, 1, 1] },
  conifer: { bark: 1, H: [12, 22], R: [0.18, 0.3], lean: 0.02, kink: 0.04, trop: [0.15, -0.12, -0.2], splitAt: 0, leaders: 1, conifer: true,
    levels: [{ per: 4.0, ang: [1.25, 1.55], len: [0.18, 0.3], start: 0.12, rr: 0.35 }, { per: 2.5, ang: [0.6, 0.9], len: [0.35, 0.5], start: 0.1, rr: 0.5 }],
    card: 3, cardMix: [3, 0], cardSize: [0.9, 1.4], cardPer: 3.2, crownTint: [0.92, 0.95, 0.92] },
  sapling: { bark: 0, H: [2.5, 5], R: [0.025, 0.05], lean: 0.12, kink: 0.15, trop: [0.04, -0.04, -0.2], splitAt: 0, leaders: 1,
    levels: [{ per: 3.0, ang: [0.4, 0.8], len: [0.3, 0.5], start: 0.3, rr: 0.5 }, { per: 3.0, ang: [0.35, 0.7], len: [0.4, 0.6], start: 0.2, rr: 0.6 }],
    card: 1, cardMix: [0, 0.4], cardSize: [0.45, 0.7], cardPer: 4.0, crownTint: [1, 1, 1] },
  shrub: { bark: 1, H: [1.0, 2.2], R: [0.012, 0.025], lean: 0.35, kink: 0.2, trop: [0.02, 0.0], splitAt: 0, leaders: [5, 10], shrub: true,
    levels: [{ per: 3.0, ang: [0.35, 0.8], len: [0.35, 0.6], start: 0.25, rr: 0.6 }],
    card: 0, cardMix: [2, 0.35], cardSize: [0.4, 0.65], cardPer: 4.5, crownTint: [1, 1, 1] },
};

export class TreeTool {
  constructor(seed, quality) {
    this.rng = mulberry32(seed);
    this.q = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
    this.bark = new Buf(); this.cards = new Buf(); this.litter = new Buf();
    this.trees = [];   // {x, z, r, h}: 낙엽 밀도와 배치 검사용
    this.casters = []; // 줄기 관(빛 굽기용)
  }

  // 관 하나: 점 목록과 반지름 목록. 고리마다 seg개의 꼭짓점
  tube(pts, rad, seg, barkU, sway, ao) {
    const B = this.bark, base = B.count, rings = [];
    let vAcc = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
      const a = perp(d), b = d.clone().cross(a).normalize();
      if (i > 0) vAcc += pts[i].distanceTo(pts[i - 1]);
      const ring = [];
      for (let k = 0; k <= seg; k++) {
        const t = k / seg * Math.PI * 2, n = a.clone().multiplyScalar(Math.cos(t)).add(b.clone().multiplyScalar(Math.sin(t)));
        const p = pts[i].clone().add(n.clone().multiplyScalar(rad[i]));
        const o = ao[i] * (0.85 + 0.15 * Math.max(0, n.y + 0.3));
        ring.push(B.v(p, n, barkU + (k / seg) * 0.5, vAcc / 1.6, [o, o, o], sway[i]));
      }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < seg; k++) {
      const a = rings[i][k], b = rings[i][k + 1], c = rings[i + 1][k], d = rings[i + 1][k + 1];
      B.idx.push(a, c, b, b, c, d);
    }
    return base;
  }

  // 잔가지 카드: 가지 끝 근처의 점 p에서 방향 d로 자라는 사각형
  card(p, d, size, cell, sway) {
    const r = this.rng, C = this.cards;
    const up = d.clone().add(V((r() - 0.5) * 0.7, (r() - 0.5) * 0.5, (r() - 0.5) * 0.7)).normalize();
    const side = perp(up).applyAxisAngle(up, r() * Math.PI * 2).multiplyScalar(size * 0.5);
    const top = up.clone().multiplyScalar(size);
    const u0 = (cell % 2) * 0.5, v0 = 1 - (Math.floor(cell / 2) + 1) * 0.5;   // 캔버스는 위아래가 뒤집혀 올라간다
    const P = [p.clone().sub(side), p.clone().add(side), p.clone().add(side).add(top), p.clone().sub(side).add(top)];
    const UV = [[u0 + 0.004, v0 + 0.004], [u0 + 0.496, v0 + 0.004], [u0 + 0.496, v0 + 0.496], [u0 + 0.004, v0 + 0.496]];
    const i0 = C.count;
    for (let k = 0; k < 4; k++) C.v(P[k], UP, UV[k][0], UV[k][1], [1, 1, 1], sway + (k >= 2 ? 0.25 : 0));
    C.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }

  // 가지 하나를 키운다. 반환: 없음. 끝 단계에서는 카드를 단다
  branch(p0, dir, len, r0, lvl, sp, sway0, ctx) {
    const r = this.rng;
    const lastLvl = sp.levels.length;
    const nSeg = lvl === 0 ? 7 : lvl === 1 ? 4 : 3;
    const pts = [p0.clone()], rad = [r0], sw = [sway0], ao = [1];
    let d = dir.clone(), p = p0.clone();
    const rEnd = lvl === 0 ? r0 * 0.25 : r0 * 0.3;
    for (let i = 1; i <= nSeg; i++) {
      const tr = sp.trop[Math.min(lvl, sp.trop.length - 1)];
      d.add(V((r() - 0.5) * sp.kink * 2, (r() - 0.5) * sp.kink, (r() - 0.5) * sp.kink * 2)).add(V(0, tr * (lvl === 0 ? 0.3 : 1), 0)).normalize();
      if (lvl === 0) d.y = Math.max(d.y, 0.55);
      p = p.clone().add(d.clone().multiplyScalar(len / nSeg));
      pts.push(p); rad.push(r0 + (rEnd - r0) * (i / nSeg)); sw.push(sway0 + (lvl === 0 ? 0.25 : 0.35) * (i / nSeg) * (len / 4));
    }
    for (let i = 0; i < pts.length; i++) ao[i] = ctx.ao(pts[i]);
    // 아주 가는 가지는 관을 만들지 않는다(카드의 잔가지 그림이 맡는다)
    const minR = 0.006 / this.q;
    if (r0 > minR) {
      const seg = r0 > 0.12 ? 7 : r0 > 0.05 ? 5 : r0 > 0.02 ? 4 : 3;
      this.tube(pts, rad, seg, sp.bark * 0.5, sw, ao);
      if (lvl === 0) this.casters.push({ pts, rad });
    }
    const along = (t) => { const f = t * nSeg, i = Math.min(nSeg - 1, Math.floor(f)), k = f - i; return { p: pts[i].clone().lerp(pts[i + 1], k), r: rad[i] + (rad[i + 1] - rad[i]) * k, s: sw[i] + (sw[i + 1] - sw[i]) * k, d: pts[i + 1].clone().sub(pts[i]).normalize() }; };
    if (lvl < lastLvl) {
      const L = sp.levels[lvl];
      let n = Math.max(1, Math.round(L.per * len * (sp.conifer && lvl === 0 ? 1 : 0.9) * (lvl >= 1 ? this.q * 0.5 + 0.5 : 1)));
      let az = r() * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const t = L.start + (1 - L.start) * (sp.conifer && lvl === 0 ? k / n : r() * 0.9 + 0.05);
        const A = along(t);
        az += 2.4 + (r() - 0.5) * 0.6;   // 엇갈려 돌아가며 난다(약 137°)
        const ax = perp(A.d).applyAxisAngle(A.d, az);
        const ang = L.ang[0] + (L.ang[1] - L.ang[0]) * r();
        const cd = A.d.clone().applyAxisAngle(ax, ang).normalize();
        // 침엽수: 아래 가지가 길고 위로 갈수록 짧다(원뿔). 활엽수: 가운데가 길다
        const shape = sp.conifer && lvl === 0 ? (1 - t) * 1.25 + 0.1 : 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.1));
        const cl = len * (L.len[0] + (L.len[1] - L.len[0]) * r()) * shape * (sp.conifer && lvl === 0 ? 1.0 : 1);
        if (cl < 0.12) continue;
        this.branch(A.p, cd, cl, Math.max(0.003, A.r * L.rr * (0.8 + 0.3 * r())), lvl + 1, sp, A.s, ctx);
      }
    }
    // 잔가지 카드: 끝 단계 가지, 그리고 그 앞 단계 가지의 끝 부분
    if (lvl >= lastLvl - 1 || (sp.conifer && lvl >= 1)) {
      const nc = Math.max(1, Math.round(sp.cardPer * len * this.q * (lvl === lastLvl ? 1 : 0.4)));
      for (let k = 0; k < nc; k++) {
        const A = along(0.25 + 0.75 * r());
        const cell = r() < sp.cardMix[1] ? sp.cardMix[0] : sp.card;
        const size = (sp.cardSize[0] + (sp.cardSize[1] - sp.cardSize[0]) * r()) * ctx.scale;
        this.card(A.p, A.d, size, cell, A.s + 0.3);
      }
    }
  }

  // 나무 한 그루. kind: SPECIES의 키
  tree(kind, x, y, z, scale = 1) {
    const sp = SPECIES[kind], r = this.rng;
    const H = (sp.H[0] + (sp.H[1] - sp.H[0]) * r()) * scale, R = (sp.R[0] + (sp.R[1] - sp.R[0]) * r()) * scale;
    const c0 = this.cards.count;
    // 수관의 자기 그늘: 수관 중심에서 가까울수록, 수관 아래쪽일수록 어둡다(볼륨 밖이라 따로 굽는다)
    const cy = y + H * (sp.conifer ? 0.45 : 0.62), cr = H * (sp.conifer ? 0.22 : 0.33), cry = H * (sp.conifer ? 0.5 : 0.38);
    const ctx = { scale: Math.max(0.6, Math.min(1.3, scale)), ao: (p) => {
      const dx = (p.x - x) / cr, dy = (p.y - cy) / cry, dz = (p.z - z) / cr, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const inner = Math.max(0, 1 - d), below = Math.max(0, Math.min(1, -dy));
      return 1 - inner * (sp.conifer ? 0.55 : 0.35) - below * 0.18;
    } };
    const leaders = Array.isArray(sp.leaders) ? sp.leaders[0] + Math.floor(r() * (sp.leaders[1] - sp.leaders[0] + 1)) : sp.leaders;
    const lean = V((r() - 0.5) * sp.lean * 2, 1, (r() - 0.5) * sp.lean * 2).normalize();
    if (sp.shrub) {
      for (let k = 0; k < leaders; k++) {
        const a = r() * Math.PI * 2, d = V(Math.cos(a) * (0.2 + r() * sp.lean), 1, Math.sin(a) * (0.2 + r() * sp.lean)).normalize();
        this.branch(V(x + (r() - 0.5) * 0.3, y, z + (r() - 0.5) * 0.3), d, H * (0.6 + r() * 0.5), R, 1 - 1, { ...sp, levels: sp.levels }, 0.1, ctx);
      }
    } else if (sp.splitAt) {
      // 줄기가 몇 m 올라가 두세 갈래로 나뉜다
      const sh = H * (sp.splitAt[0] + (sp.splitAt[1] - sp.splitAt[0]) * r());
      const pts = [V(x, y - 0.2, z)], rad = [R * 1.25], sw = [0], ao = [];
      let p = V(x, y, z), d = lean.clone();
      for (let i = 1; i <= 4; i++) { d.add(V((r() - 0.5) * 0.1, 0, (r() - 0.5) * 0.1)).normalize(); p = p.clone().add(d.clone().multiplyScalar(sh / 4)); pts.push(p); rad.push(R * (1.1 - 0.15 * i / 4)); sw.push(0.02 * i); }
      for (const q of pts) ao.push(ctx.ao(q));
      this.tube(pts, rad, 8, sp.bark * 0.5, sw, ao);
      this.casters.push({ pts, rad });
      for (let k = 0; k < leaders; k++) {
        const a = k / leaders * Math.PI * 2 + r(), ld = V(Math.cos(a) * (0.35 + r() * 0.25), 1, Math.sin(a) * (0.35 + r() * 0.25)).normalize();
        this.branch(p, ld, (H - sh) * (0.85 + r() * 0.2), R * 0.72, 0, sp, 0.08, ctx);
      }
    } else {
      this.branch(V(x, y - 0.2, z), lean, H, R, 0, sp, 0, ctx);
    }
    // 카드의 법선: 수관 중심에서 바깥으로(윗쪽으로 조금 기울여 하늘을 받게). 자기 그늘을 꼭짓점 색에 굽는다
    const C = this.cards, tint = sp.crownTint;
    for (let i = c0; i < C.count; i++) {
      const px = C.p[i * 3], py = C.p[i * 3 + 1], pz = C.p[i * 3 + 2];
      const n = V((px - x) / cr, (py - cy) / cry + 0.35, (pz - z) / cr).normalize();
      C.n[i * 3] = n.x; C.n[i * 3 + 1] = n.y; C.n[i * 3 + 2] = n.z;
      const o = ctx.ao(V(px, py, pz)) * (0.92 + 0.16 * r());
      C.c[i * 3] = o * tint[0]; C.c[i * 3 + 1] = o * tint[1]; C.c[i * 3 + 2] = o * tint[2];
    }
    this.trees.push({ x, z, r: kind === 'shrub' ? 1 : cr * 1.3, h: H, kind });
  }

  // 낙엽 한 무더기(바닥에 누운 카드). 놓인 면의 높이 y
  leafPatch(x, y, z, s, dark, dense) {
    const r = this.rng, L = this.litter, a = r() * Math.PI * 2, c = Math.cos(a) * s * 0.5, sn = Math.sin(a) * s * 0.5;
    const tx = (r() - 0.5) * 0.08, tz = (r() - 0.5) * 0.08;   // 살짝 기울어 땅의 굴곡을 따른다
    const P = [[-c + sn, -sn - c], [c + sn, sn - c], [c - sn, sn + c], [-c - sn, -sn + c]];
    const i0 = L.count, o = (0.75 + 0.3 * r()) * (dark ? 0.6 : 1), u0 = dense ? 0.5 : 0;
    for (let k = 0; k < 4; k++) L.v(V(x + P[k][0], y + 0.012 + P[k][0] * tx + P[k][1] * tz, z + P[k][1]), UP, u0 + (k === 1 || k === 2 ? 0.5 : 0), k >= 2 ? 1 : 0, [o, o * 0.97, o * 0.93], 0);
    L.idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
  }

  // 메시를 만든다. 카드와 낙엽은 빛을 가리지 않는다(구멍이 숭숭한 잔가지를 불투명한 판으로 굽게 된다)
  meshes() {
    const r = mulberry32(911);
    const bt = canvasTex(barkTexture(r), true), tt = canvasTex(twigTexture(r)), lt = canvasTex(litterTexture(r));
    bt.wrapS = THREE.ClampToEdgeWrapping;
    const mBark = treeMaterial({ map: bt, color: 0xffffff }, { grime: 0.3, ao: 1 }, 'B', false);
    const mCard = treeMaterial({ map: tt, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xffffff }, { grime: 0, ao: 1 }, 'C', true);
    const mLit = treeMaterial({ map: lt, alphaTest: 0.45, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }, { grime: 0.2, ao: 1 }, 'L', true);
    const out = [];
    for (const [B, m] of [[this.bark, mBark], [this.cards, mCard], [this.litter, mLit]]) {
      if (!B.count) continue;
      const mesh = new THREE.Mesh(B.geometry(), m);
      mesh.matrixAutoUpdate = false;
      out.push(mesh);
    }
    return out;
  }
  // 줄기의 빛 굽기용 형상(위치와 인덱스만)
  casterGeometry() {
    if (!this.casters.length) return null;
    const pos = [], idx = [];
    for (const { pts, rad } of this.casters) {
      const base = pos.length / 3, seg = 6;
      for (let i = 0; i < pts.length; i++) {
        const d = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize(), a = perp(d), b = d.clone().cross(a);
        for (let k = 0; k < seg; k++) { const t = k / seg * Math.PI * 2; const p = pts[i].clone().add(a.clone().multiplyScalar(Math.cos(t) * rad[i])).add(b.clone().multiplyScalar(Math.sin(t) * rad[i])); pos.push(p.x, p.y, p.z); }
      }
      for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < seg; k++) { const a = base + i * seg + k, b = base + i * seg + (k + 1) % seg, c = a + seg, d = b + seg; idx.push(a, c, b, b, c, d); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
  }
}

export function setTreeTime(t) { swayU.uTreeT.value = t; }
