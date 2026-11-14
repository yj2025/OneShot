// 건물 도구(1단계 ④): 담장 밖 건물을 평면, 층수, 양식으로 만든다. 이전에는 box() 하나짜리 회색 직육면체였다(14, 15라운드: '창도 문도 지붕선도 이음매도 없다').
// 벽은 창 줄(띠벽 + 창 사이 기둥)로 짓고, 창은 벽면보다 들어간 판(어두운 유리, 깨져 빈 창, 합판으로 막은 창, 방범창)으로 채운다.
// 지붕선은 평지붕과 파라펫, 박공, 톱날 지붕 가운데 하나다. 옥상에는 계단실, 실외기, 물탱크, 환기관, 안테나가 있다.
// 멀리 있으므로 충돌은 없고, 형상 도구(닳음)는 담장 안에만 걸린다. 재질 키는 모두 'bg'로 시작한다(형광등 가림 계산에서 뺀다).
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

export const BG_STYLES = {
  // 3~4층 콘크리트 사무동: 층마다 창 줄, 평지붕과 파라펫
  office: { wall: 'bgConcrete', bay: 3.6, floorH: 3.4, ww: 0.6, wh: 0.5, sill: 0.95, roof: 'flat', fill: [0.5, 0.25, 0.17, 0.08] },
  // 칠한 블록 건물: 창이 작고 띄엄띄엄
  block: { wall: 'bgPlaster', bay: 4.2, floorH: 3.5, ww: 0.42, wh: 0.45, sill: 1.05, roof: 'flat', fill: [0.45, 0.2, 0.25, 0.1], skip: 0.25 },
  // 골판 창고: 아래 1.2 m는 콘크리트, 위는 골판. 높은 곳에 띠창, 셔터 문, 박공지붕
  shed: { wall: 'bgClad', base: 'bgConcrete', bay: 5.0, floorH: 0, ww: 0.75, wh: 1.0, sill: 0, roof: 'gable', fill: [0.4, 0.45, 0.1, 0.05], band: true, roller: true },
  // 공장: 칠한 벽, 키 큰 창, 톱날 지붕
  factory: { wall: 'bgPaintB', bay: 4.5, floorH: 0, ww: 0.55, wh: 0.55, sill: 1.4, roof: 'saw', fill: [0.45, 0.3, 0.15, 0.1], tall: true },
};

export class BackdropTool {
  constructor(level, seed) { this.L = level; this.r = mulberry32(seed); }
  box(key, min, max, tile = 2) { this.L.box(key, min, max, { collide: false, tile }); }

  // 축 정렬 벽 하나. along: 'x'면 x로 뻗고(z = face), 'z'면 z로 뻗는다(x = face). out: 바깥 방향 부호. a0~a1: 벽의 범위, y0~y1: 높이
  wall(along, face, out, a0, a1, y0, y1, S, opt = {}) {
    const r = this.r, t = 0.3;
    // d0~d1: 바깥 면에서 안쪽으로 잰 깊이(음수는 바깥으로 튀어나옴)
    const B = (key, b0, b1, c0, c1, d0, d1, tile = 2) => {
      if (b1 - b0 < 0.01 || c1 - c0 < 0.01) return;
      const f0 = face - out * d1, f1 = face - out * d0, lo = Math.min(f0, f1), hi = Math.max(f0, f1);
      if (along === 'x') this.box(key, [b0, c0, lo], [b1, c1, hi], tile); else this.box(key, [lo, c0, b0], [hi, c1, b1], tile);
    };
    const L = a1 - a0, nb = Math.max(1, Math.floor(L / S.bay)), bay = L / nb;
    const wallKey = S.wall, baseH = S.base ? 1.2 : 0;
    if (S.base) B(S.base, a0, a1, y0, y0 + baseH, 0, t, 3);
    // 창 줄: 층마다 하나(창고는 높은 띠창 한 줄)
    const rows = [];
    if (S.band) rows.push([y1 - 1.9, y1 - 1.9 + S.wh * 1.4]);
    else if (S.tall) rows.push([y0 + S.sill, y1 - 1.2]);
    else for (let f = 0; f < opt.floors; f++) { const b = y0 + f * S.floorH + S.sill; rows.push([b, b + S.floorH * S.wh]); }
    // 1층 문(사무동, 블록) 또는 셔터 문(창고): 창 칸 하나를 바꾼다
    const doorBay = opt.door ? Math.floor(r() * nb) : -1;
    let y = y0 + baseH;
    for (const [rb, rt] of rows) {
      B(wallKey, a0, a1, y, rb, 0, t);   // 아래 띠벽
      const ww = bay * S.ww;
      let a = a0;
      for (let i = 0; i < nb; i++) {
        const c = a0 + (i + 0.5) * bay, wl = c - ww / 2, wr = c + ww / 2;
        if (S.skip && r() < S.skip) continue;   // 창이 없는 칸(띠벽이 이어진다)
        B(wallKey, a, wl, rb, rt, 0, t);
        this.fillWindow(B, wl, wr, rb, rt, S, wallKey);
        a = wr;
      }
      B(wallKey, a, a1, rb, rt, 0, t);
      y = rt;
    }
    B(wallKey, a0, a1, y, y1, 0, t);
    // 문: 벽 앞에 붙은 문틀과 들어간 문짝. 띠벽 위에 덧대므로 앞쪽 2 cm에 둔다
    if (doorBay >= 0) {
      const c = a0 + (doorBay + 0.5) * bay;
      if (S.roller) { const w = Math.min(bay * 0.8, 4.2), h = Math.min(y1 - 1.0, 4.5); B('bgVoid', c - w / 2, c + w / 2, y0, y0 + h, -0.01, 0.02); B('metalGalv', c - w / 2 + 0.05, c + w / 2 - 0.05, y0 + h * (0.15 + r() * 0.8), y0 + h, -0.03, -0.01, 1); B('metalDark', c - w / 2 - 0.15, c + w / 2 + 0.15, y0 + h, y0 + h + 0.35, -0.12, 0); }
      else { const w = 1.0 + r() * 0.8; B('bgVoid', c - w / 2, c + w / 2, y0, y0 + 2.2, -0.01, 0.02); if (r() < 0.6) B('doorPaint', c - w / 2 + 0.05, c + w / 2 - 0.05, y0, y0 + 2.15, -0.025, -0.012, 2); B('metalDark', c - w / 2 - 0.08, c + w / 2 + 0.08, y0 + 2.2, y0 + 2.3, -0.06, 0); }
    }
    // 홈통: 벽 끝 가까이 지붕에서 땅까지
    if (opt.pipes) for (const pa of [a0 + 0.5, a1 - 0.5]) if (r() < 0.6) {
      const o = face + out * 0.12;
      if (along === 'x') this.L.cyl('metalGalv', [pa, (y0 + y1) / 2, o], 0.06, y1 - y0, { collide: false, seg: 6 }); else this.L.cyl('metalGalv', [o, (y0 + y1) / 2, pa], 0.06, y1 - y0, { collide: false, seg: 6 });
    }
  }

  // 창 하나를 채운다: 어두운 유리(창살 한두 줄), 깨져 빈 창(깊고 어둡다), 합판으로 막은 창, 방범창
  fillWindow(B, wl, wr, wb, wt, S, wallKey) {
    const r = this.r, u = r(), [pg, pv, pb] = S.fill;
    B(wallKey, wl - 0.06, wr + 0.06, wb - 0.07, wb, -0.06, 0.08);   // 창턱(튀어나옴)
    if (u < pg + pv) {
      const broken = u >= pg;
      B(broken ? 'bgVoid' : 'bgGlass', wl, wr, wb, wt, broken ? 0.28 : 0.17, broken ? 0.3 : 0.22);
      // 창틀과 창살: 깨진 창에는 틀만 남는다
      const m = (wl + wr) / 2;
      B('metalDark', m - 0.03, m + 0.03, wb, wt, 0.12, 0.17);
      if (wt - wb > 1.4) B('metalDark', wl, wr, (wb + wt) / 2 - 0.03, (wb + wt) / 2 + 0.03, 0.12, 0.17);
    } else if (u < pg + pv + pb) {
      B('bgGlass', wl, wr, wb, wt, 0.17, 0.22);
      B(r() < 0.5 ? 'plywoodC' : 'plywoodB', wl - 0.04, wr + 0.04, wb - 0.02, wt + 0.03, -0.035, -0.005, 2.44);   // 벽 바깥에 덧댄 합판
    } else {
      B('bgGlass', wl, wr, wb, wt, 0.17, 0.22);
      const n = Math.max(3, Math.round((wr - wl) / 0.13));
      for (let k = 1; k < n; k++) { const x = wl + (wr - wl) * k / n; B('metalDark', x - 0.012, x + 0.012, wb, wt, -0.05, -0.025); }
    }
  }

  // 삼각 판(박공벽, 톱날의 옆면): 꼭짓점 셋과 두께 방향
  tri(key, p0, p1, p2, n, th, tile = 2) {
    const P = [p0, p1, p2].map(p => new THREE.Vector3(...p)), N = new THREE.Vector3(...n).normalize(), back = P.map(p => p.clone().addScaledVector(N, -th));
    const pos = [], nor = [], uv = [];
    const ax = Math.abs(N.x) > 0.5 ? 'z' : 'x';
    const face = (a, b, c, nn) => { for (const p of [a, b, c]) { pos.push(p.x, p.y, p.z); nor.push(nn.x, nn.y, nn.z); uv.push(p[ax] / tile, p.y / tile); } };
    face(P[0], P[1], P[2], N); face(back[0], back[2], back[1], N.clone().negate());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    // 앞면이 N을 향하도록 감는 방향을 맞춘다
    const e1 = P[1].clone().sub(P[0]), e2 = P[2].clone().sub(P[0]);
    if (e1.cross(e2).dot(N) < 0) { const a = g.attributes.position.array; for (let i = 0; i < 2; i++) { const o = i * 9; for (let k = 0; k < 3; k++) { const tmp = a[o + 3 + k]; a[o + 3 + k] = a[o + 6 + k]; a[o + 6 + k] = tmp; } } const u2 = g.attributes.uv.array; for (let i = 0; i < 2; i++) { const o = i * 6; for (let k = 0; k < 2; k++) { const tmp = u2[o + 2 + k]; u2[o + 2 + k] = u2[o + 4 + k]; u2[o + 4 + k] = tmp; } } }
    this.L.add(key, g);
  }

  // 건물 하나. x, z: 중심, w: x 방향 폭, d: z 방향 깊이, h: 처마 높이
  building({ x, z, w, d, h, style }) {
    const S = BG_STYLES[style], r = this.r, L = this.L;
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, t = 0.3;
    const floors = S.floorH ? Math.max(1, Math.floor((h - 0.4) / S.floorH)) : 1;
    const opt = { floors, pipes: true };
    // 네 벽: x로 뻗는 벽이 모서리를 덮고, z로 뻗는 벽은 그 사이에 든다
    this.wall('x', z1, 1, x0, x1, 0, h, S, { ...opt, door: r() < 0.8 });
    this.wall('x', z0, -1, x0, x1, 0, h, S, { ...opt, door: r() < 0.5 });
    this.wall('z', x1, 1, z0 + t, z1 - t, 0, h, S, { ...opt, door: r() < 0.5 });
    this.wall('z', x0, -1, z0 + t, z1 - t, 0, h, S, { ...opt, door: r() < 0.5 });
    // 층 이음(띠): 사무동과 블록 건물은 층마다 바닥판이 벽 밖으로 살짝 드러난다
    if (S.floorH) for (let f = 1; f < floors; f++) { const y = f * S.floorH - 0.12; this.box(S.wall, [x0 - 0.04, y, z0 - 0.04], [x1 + 0.04, y + 0.16, z1 + 0.04], 3); }
    const longX = w >= d;
    if (S.roof === 'flat') {
      this.box('bgConcrete', [x0, h - 0.3, z0], [x1, h, z1], 4);
      const ph = 0.7 + r() * 0.5, pt = 0.25;
      this.box(S.wall, [x0, h, z0], [x1, h + ph, z0 + pt], 3); this.box(S.wall, [x0, h, z1 - pt], [x1, h + ph, z1], 3);
      this.box(S.wall, [x0, h, z0 + pt], [x0 + pt, h + ph, z1 - pt], 3); this.box(S.wall, [x1 - pt, h, z0 + pt], [x1, h + ph, z1 - pt], 3);
      this.box('bgConcrete', [x0 - 0.05, h + ph, z0 - 0.05], [x1 + 0.05, h + ph + 0.08, z1 + 0.05], 3);   // 갓돌
      // 옥상: 계단실, 실외기, 물탱크, 환기관, 안테나
      const sx = x0 + 2 + r() * (w - 6), sz = z0 + 2 + r() * (d - 6);
      this.box(S.wall, [sx, h, sz], [sx + 2.6, h + 2.6, sz + 3.0], 3);
      this.box('bgConcrete', [sx - 0.1, h + 2.6, sz - 0.1], [sx + 2.7, h + 2.75, sz + 3.1], 3);
      for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) { const ax = x0 + 1.5 + r() * (w - 3), az = z0 + 1.5 + r() * (d - 3); this.box('acUnit', [ax, h, az], [ax + 1.3, h + 1.0, az + 0.9], 1); }
      if (r() < 0.6) { const tx = x0 + 2 + r() * (w - 4), tz = z0 + 2 + r() * (d - 4); L.cyl('metalGalv', [tx, h + 1.6, tz], 1.0, 1.9, { collide: false, seg: 12 }); for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) this.box('metalDark', [tx + dx - 0.05, h, tz + dz - 0.05], [tx + dx + 0.05, h + 0.65, tz + dz + 0.05]); }
      for (let k = 0; k < 3; k++) { const vx = x0 + 1 + r() * (w - 2), vz = z0 + 1 + r() * (d - 2), vh = 0.6 + r() * 1.2; L.cyl('metalGalv', [vx, h + vh / 2, vz], 0.12, vh, { collide: false, seg: 8 }); }
      if (r() < 0.5) L.cyl('metalDark', [x0 + 1 + r() * (w - 2), h + 2.5, z0 + 1 + r() * (d - 2)], 0.03, 5, { collide: false, seg: 5 });
    } else if (S.roof === 'gable') {
      // 용마루는 긴 쪽을 따라 간다. 경사 15~20°, 처마 0.4 m
      const half = (longX ? d : w) / 2, ang = 0.26 + r() * 0.08, rise = half * Math.tan(ang), ov = 0.4, len = (longX ? w : d) + 0.6;
      const cx = x, cz = z, sl = (half + ov) / Math.cos(ang);
      for (const s of [-1, 1]) {
        const off = (half + ov) / 2 * s, cy = h + (rise - ov * Math.tan(ang)) / 2 + 0.06;
        if (longX) L.obox('bgRoof', [cx, cy, cz + off], [len, 0.12, sl], 0, { collide: false, tile: 2.4, rotX: s * ang });
        else L.obox('bgRoof', [cx + off, cy, cz], [sl, 0.12, len], 0, { collide: false, tile: 2.4, rotZ: -s * ang });
      }
      // 박공벽(삼각)
      if (longX) for (const [fx, nx] of [[x0, -1], [x1, 1]]) this.tri(S.wall, [fx, h, z0], [fx, h, z1], [fx, h + rise, z], [nx, 0, 0], t, 2.4);
      else for (const [fz, nz] of [[z0, -1], [z1, 1]]) this.tri(S.wall, [x0, h, fz], [x1, h, fz], [x, h + rise, fz], [0, 0, nz], t, 2.4);
      // 용마루 환기구
      if (r() < 0.6) { const n = 2 + Math.floor(r() * 3); for (let k = 0; k < n; k++) { const f = (k + 0.5) / n - 0.5; if (longX) this.box('metalGalv', [x + f * w - 0.6, h + rise, z - 0.5], [x + f * w + 0.6, h + rise + 0.6, z + 0.5]); else this.box('metalGalv', [x - 0.5, h + rise, z + f * d - 0.6], [x + 0.5, h + rise + 0.6, z + f * d + 0.6]); } }
    } else if (S.roof === 'saw') {
      // 톱날 지붕: 긴 쪽을 따라 이빨이 선다. 이빨마다 완만한 지붕판과 수직 유리면(북쪽 채광창)
      const Lr = longX ? w : d, n = Math.max(3, Math.round(Lr / 6)), tw = Lr / n, rise = 2.2, span = longX ? d : w;
      this.box('bgConcrete', [x0, h - 0.2, z0], [x1, h, z1], 4);
      for (let k = 0; k < n; k++) {
        const a0 = (longX ? x0 : z0) + k * tw, a1 = a0 + tw, ang = Math.atan2(rise, tw), sl = Math.hypot(tw, rise);
        if (longX) {
          L.obox('bgRoof', [(a0 + a1) / 2, h + rise / 2, z], [sl, 0.1, span + 0.3], 0, { collide: false, tile: 2.4, rotZ: ang });
          this.box('bgGlass', [a1 - 0.08, h, z0 + 0.2], [a1, h + rise, z1 - 0.2]);
          for (const fz of [z0, z1]) this.tri(S.wall, [a0, h, fz], [a1, h, fz], [a1, h + rise, fz], [0, 0, fz === z0 ? -1 : 1], 0.25, 2.4);
        } else {
          L.obox('bgRoof', [x, h + rise / 2, (a0 + a1) / 2], [span + 0.3, 0.1, sl], 0, { collide: false, tile: 2.4, rotX: -ang });
          this.box('bgGlass', [x0 + 0.2, h, a1 - 0.08], [x1 - 0.2, h + rise, a1]);
          for (const fx of [x0, x1]) this.tri(S.wall, [fx, h, a0], [fx, h, a1], [fx, h + rise, a1], [fx === x0 ? -1 : 1, 0, 0], 0.25, 2.4);
        }
      }
    }
  }

  // 공장 굴뚝: 위로 갈수록 가늘고, 꼭대기에 검은 띠
  chimney(x, z, h) {
    this.L.cyl('bgPaintB', [x, h / 2, z], 1.2, h, { collide: false, seg: 14, r2: 0.8 });
    this.L.cyl('metalDark', [x, h - 0.6, z], 0.86, 1.2, { collide: false, seg: 14 });
    for (let y = 3; y < h - 1; y += 2.5) this.L.cyl('metalDark', [x, y, z], 1.2 - 0.4 * y / h + 0.04, 0.12, { collide: false, seg: 14 });
  }

  // 이웃 부지의 담: 콘크리트 판과 기둥
  wallRun(x0, z0, x1, z1, hgt) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / 3);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0, bx = x0 + (x1 - x0) * t1, bz = z0 + (z1 - z0) * t1;
      const hh = hgt * (this.r() < 0.08 ? 0.5 + this.r() * 0.3 : 1);   // 군데군데 무너진 판
      this.box('bgConcrete', [Math.min(ax, bx) - 0.1, 0, Math.min(az, bz) - 0.1], [Math.max(ax, bx) + 0.1, hh, Math.max(az, bz) + 0.1], 3);
      this.box('bgConcrete', [ax - 0.18, 0, az - 0.18], [ax + 0.18, hgt + 0.15, az + 0.18], 3);
    }
  }
}
