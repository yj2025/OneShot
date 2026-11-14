// 파쿠르(Space 두 번): 몸 앞의 충돌 상자를 재서 넘기(vault), 오르기(climb), 올라 넘기(over) 중 하나를 고르고 그 경로를 만든다.
// 넘을 자리를 장면마다 정해 두지 않는다. 레벨의 상자 목록 전체에 같은 규칙을 쓴다. 레벨을 고쳐도 다시 맞출 것이 없다.
//   vault: 허리 높이(1.3 m 이하)이고 깊이가 1.25 m 안쪽인 것. 왼손을 짚고 몸을 넘겨 반대편 땅에 내린다
//   over : 그보다 높고(2.0 m 이하) 얇은 것(0.65 m 안쪽). 창문, 높은 담. 손으로 당겨 올라 웅크린 채 넘어 내려간다
//   climb: 위가 디딜 만큼 깊은 것(하역장, 큰 상자). 손을 짚고 무릎을 올려 그 위에 선다(머리 위가 낮으면 앉은 채)
const STEP = 0.42;       // 걸어서 오르는 턱(level.groundHeight, level.collide와 같은 값)
const REACH = 1.3;       // 몸 중심에서 손이 닿는 앞쪽 거리
const MAX_H = 2.0;       // 손을 짚고 오를 수 있는 높이(장비를 멘 사람)
const LOW_H = 1.3;       // 이보다 낮으면 짚고 넘고, 높으면 올라서 넘는다
const STAND = 1.75, CROUCH = 1.25;
const EYE = 1.37;        // 선 자세의 가슴 카메라 높이(player.eyeHeight)
// 넘은 뒤 내릴 자리: 먼 면에서 0.32~0.9 m 안. 그보다 멀면 넘지 않는다(멀리 내리려면 몸을 던져야 한다. 처음 구현은 1.3 m까지 찾아서
// 얇은 것을 넘을 때 몸이 날아갔다). 꼭대기보다 0.45 m 넘게 낮은 곳이어야 한다(창 안쪽 책상 위에 내려서지 않게)
const LAND_MIN = 0.32, LAND_MAX = 0.9, LAND_BELOW = 0.45;

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
      // 먼 면에 가장 가까운, 몸이 설 수 있는 낮은 땅
      for (let d = d1 + LAND_MIN; d <= d1 + LAND_MAX + 1e-6; d += 0.04) {
        const [x, z] = at(d);
        const g = level.groundHeight(x, z, top - 0.1, 0.3, 0);
        if (g > top - LAND_BELOW || top - g > 3.0 || g < -0.4) continue;
        if (!bodyFree(boxes, x, z, g, STAND, 0.3)) continue;
        return { ...base, kind, land: d, landY: g, crouch: false };
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

// 단조 3차 보간(Fritsch–Carlson). 키 사이에서 넘치지 않고 속도가 이어진다. m0, m1: 시작과 끝 기울기(없으면 양 끝 구간의 기울기)
function pchip(ts, vs, m0, m1) {
  const n = ts.length, hs = [], dl = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { hs[i] = ts[i + 1] - ts[i]; dl[i] = (vs[i + 1] - vs[i]) / hs[i]; }
  // 양 끝 기울기가 그 구간 기울기의 3배를 넘으면 구간 안에서 키를 지나쳤다 돌아온다. 그 안으로 묶는다
  const lim = (v, d) => (d === 0 ? 0 : Math.sign(d) * Math.min(Math.abs(v), 3 * Math.abs(d)) * (v * d < 0 ? 0 : 1));
  m[0] = m0 == null ? dl[0] : lim(m0, dl[0]);
  m[n - 1] = m1 == null ? dl[n - 2] : lim(m1, dl[n - 2]);
  for (let i = 1; i < n - 1; i++) {
    if (dl[i - 1] * dl[i] <= 0) m[i] = 0;
    else { const w1 = 2 * hs[i] + hs[i - 1], w2 = hs[i] + 2 * hs[i - 1]; m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i]); }
  }
  const f = (t) => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0; while (t > ts[i + 1]) i++;
    const u = (t - ts[i]) / hs[i], u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * hs[i] * m[i] + (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * hs[i] * m[i + 1];
  };
  f.endSlope = m[n - 1];
  return f;
}

// 동작 경로: 시간에 따른 앞쪽 거리 s(몸 중심), 발 높이 y, 눈 높이 낮춤 dip(웅크림·숙임), 카메라 숙임 pitch, 기울기 roll, 돌림 yaw.
// 가슴 카메라는 상체를 따라간다. 키마다 '카메라 높이(발 기준) cam'을 정하고 dip을 거기서 거꾸로 구한다.
//
// 처음 구현(2026-11-14)은 동작 시간을 정해 두고 그 안에 거리를 채웠다. 그래서 먼 곳에 내릴수록 빨라졌고(서서 넘어도 최고 5.4 m/s),
// 끝나면 2 m/s로 밀어냈고, 카메라가 꼭대기 위로 0.4~0.6 m 솟았다가 떨어졌다. 사용자에게는 몸이 튕겨 나가는 것으로 보였다(2026-11-15).
// 이제 각 단계의 시간은 그 단계가 움직이는 거리에서 나온다:
//   다가가기(손이 면에 닿을 거리까지, 들어오던 속도 그대로 또는 걸음 속도) → 짚기(상체를 숙여 왼손을 꼭대기 모서리에) →
//   차오르기(엉덩이가 손 위로) → 넘기(꼭대기 위, 몸이 옆으로 돌며 다리를 넘긴다) → 놓기(손을 떼고 다리를 내린다) →
//   닿기(발이 땅에, 무릎으로 받는다) → 받기(일어서며 들어오던 속도의 일부로 이어 걷는다)
// 넘을 때 가슴은 꼭대기 위 0.45 m 남짓을 지난다. 허리 높이 방벽이면 선 자세보다 낮다(상체를 숙인 채 넘는다)
// 걸린 시간과 자세는 매번 조금씩 다르다(rng)
//   start: { y0, dip0, pitch0, vS, vY } 시작할 때 발 높이, 눈 낮춤, 숙임, 앞쪽 속도, 위아래 속도
export function buildParkourPath(P, rng, start) {
  const r = rng, j = (a) => a * (0.9 + r() * 0.2), jr = (a) => a * (0.8 + r() * 0.4);
  const { y0, dip0, pitch0, vS: vIn, vY } = start;
  const vS = Math.max(0, Math.min(6, vIn));
  const fast = Math.min(1, vS / 3);                // 들어오던 속도가 빠르면 각 단계가 짧다
  const sp = (a) => a * (1 - 0.3 * fast);
  const foot = P.foot;
  // 키: [시각, s, 발 높이 y, 발 기준 카메라 높이 cam, pitch, roll, yaw, 사건]
  const keys = [[0, 0, y0, (y0 - foot) + EYE - dip0, pitch0, 0, 0]];
  // 단계의 시간은 그 단계에서 몸이 앞으로 가는 거리를 평균 cap 이하로 지나게 늘린다.
  // 발로 딛는 단계는 1.7 m/s, 손으로 버티며 몸을 흔들어 넘기는 단계는 2.2 m/s(들어오던 속도가 더 빠르면 그 속도)
  const vCap = Math.max(1.7, vS), vAir = Math.max(2.2, vS * 1.1);
  const add = (dt, s, y, cam, pitch, roll, yaw, ev, cap = vCap) => { const k = keys[keys.length - 1]; keys.push([k[0] + Math.max(dt, Math.abs(s - k[1]) / cap), s, y, cam, pitch, roll, yaw, ev]); };
  let hand = null, vExit;
  const camLand = (dip) => (P.landY - foot) + EYE - dip;
  if (P.kind === 'vault' || P.kind === 'over') {
    const drop = Math.max(0, P.top - P.landY);
    if (P.kind === 'vault') {
      // 왼손은 가까운 모서리에서 7 cm 안쪽을 짚는다. 그때 몸 중심은 면에서 0.45 m 뒤(팔을 뻗어 숙인 자세)
      const sp0 = Math.max(0, P.d0 - 0.45 - 0.12 * fast), a = sp0;
      const camPlant = Math.min(1.3, Math.max(1.0, P.h + 0.5)), camX = Math.max(1.2, P.h + 0.45) + jr(0.03);
      const tA = a < 0.03 ? 0.12 : 0.06 + a / Math.max(1.8, vS);
      add(j(tA), sp0, foot, camPlant, j(-0.55), j(0.05), 0, 'hands');
      add(sp(j(0.12 + 0.1 * P.h)), Math.max(sp0, P.d0 - 0.08), foot + 0.35 * P.h, (camPlant + camX) / 2, j(-0.5), j(0.12), j(0.1));
      add(sp(j(0.06 + P.depth / 3.5)), (P.d0 + P.d1) / 2 + 0.05, P.top + 0.06, camX, j(-0.4), j(0.2), j(0.22), undefined, vAir);
      add(sp(j(0.06 + P.depth / 3.5)), P.d1 + 0.12, P.top - 0.05, camX - 0.06, j(-0.3), j(0.12), j(0.12), 'release', vAir);
    } else {
      // 두 손으로 꼭대기(창턱)를 잡고 당겨 오른다. 무릎을 올리고 웅크린 채 넘어 내려간다. 가슴은 위쪽 틀(빈틈) 아래로 지난다
      const sp0 = Math.max(0, P.d0 - 0.32), a = sp0;
      const room = P.gap - 0.17;
      const tA = a < 0.03 ? 0.14 : 0.12 + a / Math.max(1.4, vS);
      add(j(tA), sp0, foot, EYE - 0.05, j(0.12), 0, 0, 'hands');
      add(sp(j(0.3 + 0.12 * P.h)), Math.max(sp0, P.d0 - 0.2), P.top - 1.0, P.h + Math.min(0.12, room), j(-0.25), j(0.05), 0);
      add(sp(j(0.22)), P.d0 + 0.02, P.top - 0.35, P.h + Math.min(0.38, room), j(-0.5), j(0.1), j(0.05), 'knee');
      add(sp(j(0.18 + P.depth / 2)), (P.d0 + P.d1) / 2 + 0.08, P.top + 0.02, P.h + Math.min(0.5, room), j(-0.55), j(0.05), j(0.04), undefined, vAir);
      add(sp(j(0.18)), P.d1 + 0.1, P.top - 0.3, P.h + Math.min(0.2, room), j(-0.4), 0, 0, 'release', vAir);
    }
    vExit = Math.min(2.5, 0.3 + 0.45 * vS);
    const tE = j(0.16);
    // 발이 닿는 곳: 마지막 구간을 끝 속도로 이을 만큼 앞(높이 떨어질수록 무릎을 깊이 굽힌다)
    add(j(0.12 + 0.1 * drop), Math.max(P.d1 + 0.12, P.land - Math.max(0.06, 0.5 * vExit * tE)), P.landY, camLand(0.3 + 0.06 * Math.max(0, drop - 0.8)), j(-0.15), j(0.04), j(0.04), 'land', vAir);
    add(tE, P.land, P.landY, camLand(0.12), -0.05, 0, 0);
    const iH = keys.findIndex(k => k[7] === 'hands'), iR = keys.findIndex(k => k[7] === 'release');
    hand = { s: P.d0 + 0.07, y: P.top, t0: keys[iH][0], t1: keys[iR][0], kind: P.kind };
  } else {
    // 오르기: 처음 구현의 자세와 시간 배분 그대로(사용자가 잘 된다고 했다). 다만 멀리서 시작하면 첫 구간이 0.2초에 1 m를 덮쳤다(4 m/s).
    // 다른 동작처럼 걸음 속도(1.7 m/s) 상한을 둔다
    const T = j(0.55 + 0.38 * P.h);
    const cam = (y, d) => (y - foot) + EYE - d;
    const y1 = P.foot + Math.min(0.3, 0.2 + 0.1 * P.h), y2 = P.top - 0.2;
    add(0.25 * T, Math.max(0, P.d0 - 0.34), y1, cam(y1, j(0.1)), j(-0.5), 0, 0, 'hands');
    add(0.37 * T, Math.max(0, P.d0 - 0.05), y2, cam(y2, j(0.5)), j(-0.45), 0, 0, 'knee');
    add(0.38 * T, P.land, P.landY, cam(P.landY, P.crouch ? 0.45 : 0), -0.05, 0, 0, 'stand');
    vExit = 0.4;
    const iH = keys.findIndex(k => k[7] === 'hands'), iK = keys.findIndex(k => k[7] === 'knee');
    hand = { s: P.d0 + 0.08, y: P.top, t0: keys[iH][0], t1: keys[iK][0] + 0.12, kind: 'climb' };
  }
  // 앞쪽 거리는 뒤로 가지 않는다(이미 면에 붙어 있으면 첫 키를 제자리로)
  for (let i = 1; i < keys.length; i++) keys[i][1] = Math.max(keys[i][1], keys[i - 1][1]);
  const ts = keys.map(k => k[0]), T = ts[ts.length - 1];
  const s = pchip(ts, keys.map(k => k[1]), vS, vExit);
  return {
    T, events: keys.map(k => ({ t: k[0], ev: k[7] })).filter(e => e.ev),
    s, vExit: Math.max(0, s.endSlope),
    y: pchip(ts, keys.map(k => k[2]), vY, 0),
    // 눈 높이 낮춤 = 발 높이 + 선 눈높이 − 카메라 높이
    dip: pchip(ts, keys.map(k => (k[2] - foot) + EYE - k[3]), 0, 0),
    pitch: pchip(ts, keys.map(k => k[4]), 0, 0),
    roll: pchip(ts, keys.map(k => k[5]), 0, 0),
    yaw: pchip(ts, keys.map(k => k[6]), 0, 0),
    hand,
  };
}
