// 파쿠르(Space 두 번): 몸 앞의 충돌 상자를 재서 넘기(vault), 오르기(climb), 올라 넘기(over) 중 하나를 고르고 그 경로를 만든다.
// 넘을 자리를 장면마다 정해 두지 않는다. 레벨의 상자 목록 전체에 같은 규칙을 쓴다. 레벨을 고쳐도 다시 맞출 것이 없다.
//   vault: 허리 높이(1.3 m 이하)이고 깊이가 1.25 m 안쪽인 것. 손을 짚고 몸을 넘겨 반대편 땅에 내린다
//   over : 그보다 높고(2.0 m 이하) 얇은 것(0.65 m 안쪽). 창문, 높은 담. 손으로 당겨 올라 웅크린 채 넘어 내려간다
//   climb: 위가 디딜 만큼 깊은 것(하역장, 큰 상자). 손을 짚고 무릎을 올려 그 위에 선다(머리 위가 낮으면 앉은 채)
const STEP = 0.42;       // 걸어서 오르는 턱(level.groundHeight, level.collide와 같은 값)
const REACH = 1.3;       // 몸 중심에서 손이 닿는 앞쪽 거리
const MAX_H = 2.0;       // 손을 짚고 오를 수 있는 높이(장비를 멘 사람)
const LOW_H = 1.3;       // 이보다 낮으면 짚고 넘고, 높으면 올라서 넘는다
const STAND = 1.75, CROUCH = 1.25;

const hitsXZ = (b, x, z, r) => x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2];

// (x, z) 기둥에서 발 높이 foot부터 위로 이어진 단단한 부분의 꼭대기(top)와 그 위 빈틈의 천장(ceil)
function column(boxes, x, z, foot) {
  const bs = boxes.filter(b => hitsXZ(b, x, z, 0.04) && b.max[1] > foot + 0.02).sort((a, b) => a.min[1] - b.min[1]);
  let top = foot, mat = null, i = 0;
  for (; i < bs.length && bs[i].min[1] <= top + 0.05; i++) if (bs[i].max[1] > top) { top = bs[i].max[1]; mat = bs[i].mat; }
  return { top, mat, ceil: i < bs.length ? bs[i].min[1] : Infinity };
}

// 발 높이 y에서 키 h, 반폭 r인 몸이 막는 상자(발보다 5 cm 넘게 솟은 것)와 겹치지 않는가
function bodyFree(boxes, x, z, y, h, r) {
  for (const b of boxes) if (b.max[1] > y + 0.05 && b.min[1] < y + h && hitsXZ(b, x, z, r)) return false;
  return true;
}

// pos: 몸 중심(발), foot: 디딘 땅 높이(뛰어오른 중이면 뛰기 전 높이), yaw: 몸이 향한 방향
export function planParkour(level, pos, foot, yaw) {
  const boxes = level.boxes;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const at = (d) => [pos.x + fx * d, pos.z + fz * d];
  const col = (d) => { const [x, z] = at(d); return column(boxes, x, z, foot); };
  // 1. 앞쪽 면: 걸어서 오를 수 없는 첫 기둥
  let d0 = -1;
  for (let d = 0.2; d <= REACH + 1e-6; d += 0.04) if (col(d).top > foot + STEP) { d0 = d; break; }
  if (d0 < 0) return null;
  // 2. 꼭대기: 면에서 12 cm 안쪽까지의 가장 높은 곳(비스듬한 면을 계단으로 나눈 상자도 있다)
  let top = -1e9, mat = 'concrete';
  for (let d = d0; d <= d0 + 0.121; d += 0.04) { const c = col(d); if (c.top > top) { top = c.top; mat = c.mat || mat; } }
  const h = top - foot;
  if (h > MAX_H) return null;
  // 3. 깊이: 꼭대기 높이(±0.2 m)가 이어지는 거리. 더 높은 것(벽)이 나오면 넘을 수 없고 오르기만 한다
  let d1 = d0, ceil = Infinity, wall = false;
  for (let d = d0; d <= d0 + 2.5; d += 0.04) {
    const c = col(d);
    if (c.top < top - 0.2) break;
    if (c.top > top + 0.2) { wall = true; break; }
    d1 = d + 0.04; ceil = Math.min(ceil, c.ceil);
  }
  const depth = d1 - d0, gap = ceil - top;
  const base = { d0, d1, top, h, depth, gap, mat, fx, fz, foot };
  // 4. 넘기: 얇고 반대편이 트였으면 넘어서 반대편 땅에 내린다
  if (!wall && depth < (h <= LOW_H ? 1.25 : 0.65)) {
    const kind = h <= LOW_H ? 'vault' : 'over';
    const tuck = kind === 'vault' ? 0.85 : 1.0;   // 꼭대기 위를 지나는 동안 몸이 차지하는 높이(웅크림)
    let clear = gap >= tuck;
    for (let d = d0 + 0.04; clear && d < d1; d += 0.12) { const [x, z] = at(d); clear = bodyFree(boxes, x, z, top + 0.02, tuck, 0.25); }
    if (clear) {
      const [xf, zf] = at(d1 + 0.9);
      const gFar = level.groundHeight(xf, zf, top - 0.1, 0.05, 0);
      if (top - gFar <= 3.0 && gFar > -0.4) {
        for (let d = d1 + 0.3; d <= d1 + 1.3; d += 0.04) {
          const [x, z] = at(d);
          const g = level.groundHeight(x, z, top - 0.1, 0.3, 0);
          if (Math.abs(g - gFar) > 0.06 || !bodyFree(boxes, x, z, g, STAND, 0.3)) continue;
          return { ...base, kind, land: d, landY: g, crouch: false };
        }
      }
    }
  }
  // 5. 오르기: 위가 디딜 만큼 깊고 그 위에 설 자리가 있으면 올라선다
  if (depth >= 0.5) {
    const ds = d0 + Math.min(0.55, Math.max(0.3, depth / 2));
    const [x, z] = at(ds);
    const g = level.groundHeight(x, z, top + 0.05, 0.2, 0.1);
    if (Math.abs(g - top) < 0.2) {
      if (bodyFree(boxes, x, z, g, STAND, 0.28)) return { ...base, kind: 'climb', land: ds, landY: g, crouch: false };
      if (bodyFree(boxes, x, z, g, CROUCH, 0.28)) return { ...base, kind: 'climb', land: ds, landY: g, crouch: true };
    }
  }
  return null;
}

// 단조 3차 보간(Fritsch–Carlson). 키 사이에서 넘치지 않고 속도가 이어진다. m0: 시작 기울기(현재 속도)
function pchip(ts, vs, m0) {
  const n = ts.length, hs = [], dl = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { hs[i] = ts[i + 1] - ts[i]; dl[i] = (vs[i + 1] - vs[i]) / hs[i]; }
  m[0] = m0 ?? dl[0]; m[n - 1] = dl[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (dl[i - 1] * dl[i] <= 0) m[i] = 0;
    else { const w1 = 2 * hs[i] + hs[i - 1], w2 = hs[i] + 2 * hs[i - 1]; m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i]); }
  }
  return (t) => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0; while (t > ts[i + 1]) i++;
    const u = (t - ts[i]) / hs[i], u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * hs[i] * m[i] + (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * hs[i] * m[i + 1];
  };
}

// 동작 경로: 시간에 따른 앞쪽 거리 s, 발 높이 y, 눈 높이 낮춤 dip(웅크림), 카메라 숙임 pitch.
// 가슴 카메라는 상체를 따라간다. 손을 짚으며 상체를 30도 남짓 숙이면 카메라도 장애물 꼭대기를 내려다본다
// 키는 실제 사람이 하는 순서를 따른다. 걸린 시간과 자세는 매번 조금씩 다르다(rng)
//   s0, y0, dip0, pitch0: 시작할 때 값. vS, vY: 시작할 때 앞쪽 속도와 위아래 속도(이어지게)
export function buildParkourPath(P, rng, start) {
  const r = rng, j = (a) => a * (0.9 + r() * 0.2);
  const { y0, dip0, pitch0, vS, vY } = start;
  const crossDip = (room, want) => Math.max(want, 1.37 - (room - 0.15));   // 꼭대기 위 빈틈에 카메라가 들어가게
  let T, keys;
  if (P.kind === 'vault') {
    T = j(0.42 + 0.2 * P.h + 0.2 * P.depth);
    keys = [
      [0, 0, y0, dip0, pitch0],
      [0.28, Math.max(0, P.d0 - 0.36), P.foot + 0.22 + 0.2 * P.h, j(0.2), j(-0.55), 'hands'],
      [0.62, (P.d0 + P.d1) / 2, P.top + 0.08, crossDip(P.gap, j(0.42)), j(-0.4)],
      [1, P.land, P.landY, j(0.32), j(-0.08), 'land'],
    ];
  } else if (P.kind === 'over') {
    T = j(0.85 + 0.35 * P.h);
    keys = [
      [0, 0, y0, dip0, pitch0],
      [0.2, Math.max(0, P.d0 - 0.34), P.foot + 0.35, j(0.06), j(0.1), 'hands'],
      [0.52, P.d0 - 0.05, P.top - 0.35, j(0.45), j(-0.4)],
      [0.75, (P.d0 + P.d1) / 2 + 0.05, P.top + 0.03, crossDip(P.gap - 0.1, j(0.58)), j(-0.55), 'knee'],
      [1, P.land, P.landY, j(0.38), j(-0.05), 'land'],
    ];
  } else {
    T = j(0.55 + 0.38 * P.h);
    keys = [
      [0, 0, y0, dip0, pitch0],
      [0.25, Math.max(0, P.d0 - 0.34), P.foot + Math.min(0.3, 0.2 + 0.1 * P.h), j(0.1), j(-0.5), 'hands'],
      [0.62, P.d0 - 0.05, P.top - 0.2, j(0.5), j(-0.45), 'knee'],
      [1, P.land, P.landY, P.crouch ? 0.45 : 0, -0.05, 'stand'],
    ];
  }
  const ts = keys.map(k => k[0] * T);
  // 앞쪽 거리는 뒤로 가지 않는다(이미 면에 붙어 있으면 첫 키를 제자리로)
  for (let i = 1; i < keys.length; i++) keys[i][1] = Math.max(keys[i][1], keys[i - 1][1]);
  return {
    T, events: keys.map((k, i) => ({ t: ts[i], ev: k[5] })).filter(e => e.ev),
    s: pchip(ts, keys.map(k => k[1]), Math.max(0, vS)),
    y: pchip(ts, keys.map(k => k[2]), vY),
    dip: pchip(ts, keys.map(k => k[3]), 0),
    pitch: pchip(ts, keys.map(k => k[4]), 0),
  };
}
