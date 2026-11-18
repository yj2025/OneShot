// 봇 판단 검사(3단계 ①): 봇의 시야, 엄폐, 제압 반응, 우회가 '보이는 형상'과 맞는지 잰다.
// 기준은 탄이 쓰는 보이는 삼각형의 BVH(level.trace)다. 봇이 무엇으로 판단하든(상자든 BVH든) 이 기준으로 맞았는지만 본다.
// 테스트 진입 경로(?test=1)의 __bc.ai(name, opts)로만 불린다. scripts/check.mjs의 (t)(u)(v)(w)가 쓴다.
import * as THREE from 'three';
import { FL } from './level.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 보이는 형상으로 a에서 b가 트였는가
function vis(L, a, b) {
  const d = V(b.x - a.x, b.y - a.y, b.z - a.z), l = d.length();
  if (l < 1e-3) return true;
  d.divideScalar(l);
  return !L.trace.ray(a, d, l - 0.04);
}
// 사람 몸의 점(발 자리 p, 앉은 정도 c). 옆 방향은 보는 사람 쪽에 수직
function bodyPts(p, c, from) {
  const s = V(-(p.z - from.z), 0, p.x - from.x); if (s.lengthSq() < 1e-6) s.set(1, 0, 0); s.normalize().multiplyScalar(0.2);
  const y = p.y;
  return [V(p.x, y + 1.62 - 0.5 * c, p.z), V(p.x, y + 1.25 - 0.4 * c, p.z), V(p.x, y + 0.95 - 0.3 * c, p.z),
    V(p.x + s.x, y + 1.38 - 0.45 * c, p.z + s.z), V(p.x - s.x, y + 1.38 - 0.45 * c, p.z - s.z)];
}
function seenPts(L, eye, p, c) { const P = bodyPts(p, c, eye); return P.map((q) => vis(L, eye, q)); }
// 사람이 설 수 있는 자리인가(움직임 상자에 걸리지 않고 땅이 있다)
function standY(L, x, z) {
  if (L.insideBuilding(x, z)) return FL;
  const h = L.groundHeight(x, z, 1.0, 0.1, 0.3);
  return h > -0.4 ? h : null;
}
function free(L, x, y, z) { const q = V(x, y, z); L.collide(q, 0.3, y, 1.7); return Math.hypot(q.x - x, q.z - z) < 0.01; }
function rnd(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }
function spots(L, seed = 7) {
  const r = rnd(seed), out = [];
  for (const n of L.nodes) {
    out.push(V(n.x, n.y, n.z));
    for (let k = 0; k < 3; k++) {
      const x = n.x + (r() - 0.5) * 3.5, z = n.z + (r() - 0.5) * 3.5, y = standY(L, x, z);
      if (y === null || Math.abs(y - n.y) > 0.5 || !free(L, x, y, z)) continue;
      out.push(V(x, y, z));
    }
  }
  return out;
}

export const AIAUDIT = {
  // 진단: 자리 격자의 연결. from에서 닿는 자리 수와 각 점의 닿음
  grid(g, { from = [0, 24], to = [[8, -2.6], [-15.5, 2.6], [-6, -11.4], [0, 16], [-20, -14]] } = {}) {
    const L = g.level, a = L.nearestSpot(from[0], from[1], 0), seen = new Set([a.i]), Q = [a];
    while (Q.length) { const p = Q.pop(); for (const [q] of L.spotLinks(p)) if (!seen.has(q.i)) { seen.add(q.i); Q.push(q); } }
    return { spots: L.spots.length, reached: seen.size, to: to.map(([x, z]) => { const s = L.nearestSpot(x, z, standY(L, x, z) ?? 0); return s ? [x, z, +s.y.toFixed(2), seen.has(s.i)] : [x, z, null]; }) };
  },
  // (u) 시야: 봇이 '보인다/안 보인다'고 판단한 것이 보이는 형상과 맞는가
  //  거짓 봄: 봇은 보인다는데 몸의 다섯 점이 모두 가렸다(가린 물체 너머로 쏜다)
  //  못 봄: 봇은 안 보인다는데 머리와 가슴이 모두 트였다(선반 빈틈 너머의 사람을 못 본다)
  sight(g, { maxD = 40 } = {}) {
    const L = g.level, b = g.bots[0], S = spots(L), N = L.nodes;
    let pairs = 0, falseSee = 0, blind = 0; const exF = [], exB = [];
    for (const n of N) {
      const eye = V(n.x, n.y + 1.62, n.z);
      for (const p of S) {
        const d = Math.hypot(p.x - n.x, p.z - n.z); if (d < 3 || d > maxD) continue;
        for (const c of [0, 1]) {
          pairs++;
          const says = b.bodyVisible(eye, p, c, 1.37 - 0.45 * c);
          const s = seenPts(L, eye, p, c);
          if (says && !s.some(Boolean)) { falseSee++; if (exF.length < 6) exF.push([n.x, n.z, +p.x.toFixed(1), +p.z.toFixed(1), c]); }
          if (!says && s[0] && s[1]) { blind++; if (exB.length < 6) exB.push([n.x, n.z, +p.x.toFixed(1), +p.z.toFixed(1), c]); }
        }
      }
    }
    return { pairs, falseSee, blind, falseSeeRate: falseSee / pairs, blindRate: blind / pairs, exFalseSee: exF, exBlind: exB };
  },

  // (t) 엄폐: 드러난 봇이 고른 엄폐 자리가 위협(플레이어)에게서 앉은 몸을 실제로 가리는가.
  //  나쁜 엄폐: 고른 자리에서 앉은 몸의 다섯 점 가운데 하나라도 보인다. 놓침: 10 m 안에 가리는 자리가 있는데 찾지 못했다
  cover(g, { max = 160 } = {}) {
    const L = g.level, b = g.bots[0], p = g.player, N = L.nodes;
    const save = { pp: p.pos.clone(), bp: b.pos.clone(), st: b.state, path: b.path, alive: b.alive };
    const sc = [];
    for (const a of N) for (const t of N) {
      const d = Math.hypot(a.x - t.x, a.z - t.z); if (d < 6 || d > 25) continue;
      const te = V(t.x, t.y + 1.55, t.z);
      if (!seenPts(L, te, a, 0)[1]) continue;   // 위협에게 가슴이 드러난 봇만
      sc.push([a, t]);
    }
    const step = Math.max(1, Math.floor(sc.length / max));
    let n = 0, chosen = 0, bad = 0, none = 0, missed = 0; const exBad = [], exMiss = [];
    for (let k = 0; k < sc.length; k += step) {
      const [a, t] = sc[k]; n++;
      const te = V(t.x, t.y + 1.55, t.z);
      p.pos.set(t.x, t.y, t.z); b.pos.set(a.x, a.y, a.z); b.alive = true; b.state = 'engage'; b.path = null; b.coverPt = null; b.coverNode = null;
      const ok = b.seekCover(g.time);
      const c = b.coverPt || b.coverNode;
      if (ok && c) {
        chosen++;
        if (seenPts(L, te, V(c.x, c.y, c.z), 1).some(Boolean)) { bad++; if (exBad.length < 6) exBad.push([a.x, a.z, t.x, t.z, +c.x.toFixed(1), +c.z.toFixed(1)]); }
      } else {
        none++;
        // 10 m 안에 가리는 자리가 있었나(0.75 m 격자)
        let exists = false;
        for (let x = -10; x <= 10 && !exists; x += 0.75) for (let z = -10; z <= 10 && !exists; z += 0.75) {
          if (x * x + z * z > 100) continue;
          const X = a.x + x, Z = a.z + z, Y = standY(L, X, Z);
          if (Y === null || Math.abs(Y - a.y) > 0.5 || !free(L, X, Y, Z)) continue;
          if (Math.hypot(X - t.x, Z - t.z) < 4) continue;
          if (!seenPts(L, te, V(X, Y, Z), 1).some(Boolean)) exists = true;
        }
        if (exists) { missed++; if (exMiss.length < 6) exMiss.push([a.x, a.z, t.x, t.z]); }
      }
    }
    p.pos.copy(save.pp); b.pos.copy(save.bp); b.state = save.st; b.path = save.path; b.alive = save.alive;
    return { scenarios: n, chosen, bad, none, missed, badRate: chosen ? bad / chosen : 0, missRate: n ? missed / n : 0, exBad, exMiss };
  },

  // (v) 제압: 수동 시계에서 봇 0을 교전시키고, 플레이어 탄을 봇 머리 옆(miss m)으로 지나가게 쏜다(notifyBots, 게임과 같은 길).
  //  wall이면 봇 쪽으로 쏘되 탄이 봇 앞의 벽에서 멈춘다. 반응: 앉음(0.6 넘게), 엄폐로 감, 또는 플레이어에게서 가려짐
  suppress(g, { miss = 0.7, shots = 4, wall = false, i = 0 } = {}) {
    const L = g.level, b = g.bots[i], p = g.player;
    const keep = () => { p.hp = 100; p.alive = true; };
    let f = 0;
    for (; f < (wall ? 0 : 150) && b.state !== 'engage'; f++) { keep(); g.tick(1 / 60); }
    const engaged = b.state === 'engage';
    for (let i = 0; i < 30; i++) { keep(); g.tick(1 / 60); }
    const sup0 = b.suppressed;
    const eye = V(p.pos.x, p.pos.y + 1.4, p.pos.z);
    let stopped = 0, reacted = false, rt = null;
    const t0 = g.time;
    const look = () => {
      keep(); g.tick(1 / 60);
      if (reacted) return;
      const hidden = !seenPts(L, V(p.pos.x, p.pos.y + 1.55, p.pos.z), b.pos, b.crouch).some(Boolean);
      if (b.crouch > 0.6 || b.state === 'tocover' || b.state === 'cover' || hidden) { reacted = true; rt = g.time - t0; }
    };
    // 반응 시간은 첫 탄부터 잰다
    for (let k = 0; k < shots; k++) {
      const h = b.headPos, side = V(-(h.z - eye.z), 0, h.x - eye.x).normalize();
      const aim = wall ? h : h.clone().addScaledVector(side, (k % 2 ? -1 : 1) * miss).add(V(0, 0.15, 0));
      const dir = aim.clone().sub(eye).normalize();
      const hit = L.bulletRay(eye, dir, 150), maxD = hit ? hit.dist : 150;
      if (maxD < eye.distanceTo(h) - 0.5) stopped++;
      g.notifyBots(p.pos, eye, dir, maxD, g.time);
      for (let i = 0; i < 8; i++) look();
    }
    for (let i = 0; i < 90 && !reacted; i++) look();
    return { engaged, suppressedChanged: b.suppressed !== sup0, reacted, rt, state: b.state, crouch: +b.crouch.toFixed(2), stopped, shots };
  },

  // (w) 우회: 측면 역할의 봇이 짠 길이 정면 길보다 덜 드러나는가(보이는 형상으로, 위협 6 m 안은 빼고 0.5 m마다 가슴이 보이는 길이의 비율).
  //  정면 길이 20% 넘게 드러나고, 가장 덜 드러나는 길(기준)이 정면보다 30% 넘게 덜 드러나는 시나리오, 곧 '돌아갈 길이 있는' 시나리오에서 잰다
  flank(g, { threats = null } = {}) {
    const L = g.level, b = g.bots[2], p = g.player, N = L.nodes;
    const save = { pp: p.pos.clone(), bp: b.pos.clone(), role: b.role, path: b.path };
    const T = threats || [[0, 16], [8, -2.6], [-7.5, 0.8], [0.5, -2.4], [-2, -9.6], [8, -9.5], [-13, 3.0], [14, 3.5]].concat(N.filter((n, k) => k % 3 === 1).map((n) => [n.x, n.z]));
    const starts = [[-15.5, 2.6], [8, -2.6], [-6, -11.4], [6.2, -12.3], [-20, -14], [10, -18], [16, 20], [-20, 22]];
    const exposure = (path, t) => {
      const te = V(t.x, t.y + 1.55, t.z); let tot = 0, ex = 0;
      for (let i = 1; i < path.length; i++) {
        const A = path[i - 1], B = path[i], l = Math.hypot(B.x - A.x, B.z - A.z), n = Math.max(1, Math.ceil(l / 0.5));
        for (let k = 0; k < n; k++) {
          const u = (k + 0.5) / n, x = A.x + (B.x - A.x) * u, z = A.z + (B.z - A.z) * u, y = A.y + (B.y - A.y) * u;
          if (Math.hypot(x - t.x, z - t.z) < 6) continue;
          tot += l / n; if (seenPts(L, te, V(x, y, z), 0)[1]) ex += l / n;
        }
      }
      return tot > 0 ? ex / tot : 0;
    };
    const rows = [], ms = [];
    for (const [tx, tz] of T) {
      const ty = standY(L, tx, tz) ?? 0; const t = V(tx, ty, tz);
      for (const [sx, sz] of starts) {
        if (Math.hypot(sx - tx, sz - tz) < 10) continue;
        p.pos.copy(t); b.pos.set(sx, standY(L, sx, sz) ?? 0, sz);
        b.path = null; if (!b.planTo(t, false)) continue; const direct = b.path.slice();
        b.path = null; const t0 = performance.now(); if (!b.planTo(t, true)) continue; ms.push(performance.now() - t0); const fl = b.path.slice();
        const ed = exposure(direct, t), ef = exposure(fl, t);
        // 가장 덜 드러나는 길(기준): 자리 격자 전체에서 드러난 1 m를 200 m로 치는 길. 이것도 정면보다 30% 넘게 덜 드러나지 않으면 '돌아갈 길이 없는' 시나리오다
        const te = V(t.x, t.y + 1.55, t.z), A = L.nearestSpot(b.pos.x, b.pos.z, b.pos.y), Bs = L.nearestSpot(t.x, t.z, t.y);
        const ref = A && Bs && L.spotPath(A, Bs, (s) => (Math.hypot(s.x - t.x, s.z - t.z) >= 6 && vis(L, te, V(s.x, s.y + 1.25, s.z)) ? 200 : 0), 1e6);
        const eb = ref ? exposure(ref, t) : ed;
        rows.push({ t: [tx, tz], s: [sx, sz], direct: +ed.toFixed(2), flank: +ef.toFixed(2), best: +eb.toFixed(2) });
      }
    }
    p.pos.copy(save.pp); b.pos.copy(save.bp); b.path = save.path;
    const open = rows.filter((r) => r.direct > 0.2);
    const better = open.filter((r) => r.flank <= r.direct * 0.7).length;
    const alt = open.filter((r) => r.best <= r.direct * 0.7), altBetter = alt.filter((r) => r.flank <= r.direct * 0.7).length;
    const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / Math.max(1, rows.length);
    return { rows: rows.length, open: open.length, better, betterRate: open.length ? better / open.length : 1, alt: alt.length, altBetter, altRate: alt.length ? altBetter / alt.length : 1, worse: rows.filter((r) => r.flank > r.direct + 0.1).length, meanDirect: +mean('direct').toFixed(3), meanFlank: +mean('flank').toFixed(3), planMs: +(ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length)).toFixed(1), planMsMax: +Math.max(0, ...ms).toFixed(1), worst: alt.filter((r) => r.flank > r.direct * 0.7).slice(0, 6) };
  },
};
