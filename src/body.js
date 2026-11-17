// 봇의 몸(2026-11-17, 2단계 ①): 옷 입은 사람 하나를 거리장(SDF)으로 짓고 surface nets로 메시 하나를 뽑아,
// 봇의 관절 15개를 따르는 뼈 11개에 스키닝한다. 이전에는 관절 사이에 둥근 상자와 원뿔대 49개를 따로 놓았다.
// 그래서 어느 자세에서든 실루엣이 '관절에서 끊기는 관 + 상자'였다(critic 3~28라운드 '마네킹', '막대 팔다리').
//  - 몸: 가슴, 배, 골반, 엉덩이, 어깨세모근의 부피를 타원체로 잇는다. 팔다리는 둥근 원뿔이다.
//  - 옷: 헐렁한 정도만큼 두께를 더하고, 주름은 '어디서 왜 접히는가'로 넣는다.
//    팔꿈치 안쪽과 무릎 뒤의 압축 주름, 허벅지 앞 접힘, 부츠 위로 접혀 내려온 바짓단, 소맷부리, 허리띠 위로 부푼 셔츠.
//    모든 관에 같은 무늬를 되풀이하지 않는다.
//  - 장비: 판 조끼(앞뒤 판, 허리 띠, 어깨끈, 탄창 주머니)와 허리띠, 무릎 보호대, 부츠는 몸 거리장에 같이 넣는다.
//    흔들리는 장비(배낭, 덤프 주머니, 무전기 안테나)는 따로 두고 감쇠 스프링으로 몸을 늦게 따라오게 한다(Gear).
//  - 영역(셔츠, 바지, 조끼, 장갑, 부츠, 얼굴 가리개, 띠, 보호대)은 그 자리에서 가장 가까운 성분으로 나누고 재질 묶음으로 그린다.
// 네 봇이 바인드 메시 하나를 나눠 쓴다(처음 한 번 짓는다).
import * as THREE from 'three';
import { surfaceNets, sdRoundCone, sdEllipsoid, smin } from './hands.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// 영역(재질 묶음 차례)
export const REGIONS = ['shirt', 'pants', 'vest', 'glove', 'boot', 'face', 'strap', 'pad'];
const R = Object.fromEntries(REGIONS.map((k, i) => [k, i]));
// 뼈
export const BONES = ['pelvis', 'chest', 'head', 'uArmL', 'fArmL', 'uArmR', 'fArmR', 'thighL', 'shinL', 'thighR', 'shinR'];
const B = Object.fromEntries(BONES.map((k, i) => [k, i]));

// 바인드 자세(키 비율 1, 앞이 -z, 오른쪽이 +x). 팔은 28° 벌리고 팔꿈치를 앞으로 굽힌 A자세다.
// 관절 번호는 bots.js의 J와 같다
export const BIND_J = (() => {
  const j = [];
  j[0] = V(0, 1.0, 0); j[1] = V(0, 1.5, 0); j[2] = V(0, 1.715, 0);
  for (const s of [-1, 1]) {
    const sh = V(0.19 * s, 1.46, 0), up = V(0.468 * s, -0.882, -0.05).normalize(), fo = V(0.359 * s, -0.619, -0.699).normalize();
    const el = sh.clone().addScaledVector(up, 0.3), ha = el.clone().addScaledVector(fo, 0.3);
    const k = s < 0 ? 3 : 6; j[k] = sh; j[k + 1] = el; j[k + 2] = ha;
    const h = s < 0 ? 9 : 12; j[h] = V(0.11 * s, 0.95, 0); j[h + 1] = V(0.11 * s, 0.495, -0.035); j[h + 2] = V(0.115 * s, 0.06, 0);
  }
  return j;
})();

// ---------- 거리장 도구 ----------
function hash3(i, j, k) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(i, j, k), hash3(i + 1, j, k), u), l(hash3(i, j + 1, k), hash3(i + 1, j + 1, k), u), v),
    l(l(hash3(i, j, k + 1), hash3(i + 1, j, k + 1), u), l(hash3(i, j + 1, k + 1), hash3(i + 1, j + 1, k + 1), u), v), w);
}
function sdBox(px, py, pz, c, h, r) {
  const qx = Math.abs(px - c.x) - h.x + r, qy = Math.abs(py - c.y) - h.y + r, qz = Math.abs(pz - c.z) - h.z + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
// 수직 타원 기둥의 띠(허리띠, 조끼 허리 띠): 단면 반지름 rx·rz, 높이 yc ± hh
function sdBand(px, py, pz, cx, cz, rx, rz, yc, hh, r) {
  const e = (Math.sqrt(((px - cx) / rx) ** 2 + ((pz - cz) / rz) ** 2) - 1) * Math.min(rx, rz);
  const a = e + r, b = Math.abs(py - yc) - hh + r;
  return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0) - r;
}
// 주름 단면: 마루는 둥글고 골은 날카롭다(천이 접힌 자리)
const ridge = (x) => Math.sqrt(Math.abs(Math.sin(Math.PI * x))) - 0.62;

// 옷 입은 팔다리 하나. a→b 둥근 원뿔에 헐렁한 굴곡과 자리마다 다른 주름을 더한다.
//  inner: 굽는 안쪽(관에 수직인 단위 벡터). folds: [{ at(0~1, 관절 쪽), span(m), lam(간격 m), amp(깊이 m), side(1이면 안쪽만, 0이면 둘레 전체), seed }]
function tube(a, b, r1, r2, inner, { loose = 0.004, folds = [], seed = 1, flare = null } = {}) {
  const ax = b.clone().sub(a), len = ax.length(), u = ax.clone().divideScalar(len);
  const e1 = inner.clone().addScaledVector(u, -inner.dot(u)).normalize(), e2 = new THREE.Vector3().crossVectors(u, e1);
  return (px, py, pz) => {
    let d = sdRoundCone(px, py, pz, a, b, r1, r2);
    if (d > 0.03) return d;
    const qx = px - a.x, qy = py - a.y, qz = pz - a.z;
    const s = qx * u.x + qy * u.y + qz * u.z;
    const rx = qx - u.x * s, ry = qy - u.y * s, rz = qz - u.z * s;
    const c1 = rx * e1.x + ry * e1.y + rz * e1.z, c2 = rx * e2.x + ry * e2.y + rz * e2.z, ang = Math.atan2(c2, c1);
    // 헐렁한 천: 길이 방향과 둘레로 느리게 바뀌는 굴곡(관마다 다른 씨앗)
    let disp = loose * (vnoise(s * 16 + seed * 7.1, Math.cos(ang) * 1.7 + 5, Math.sin(ang) * 1.7 + seed) * 2 - 1);
    for (const f of folds) {
      const ds = s - f.at * len, env = Math.exp(-((ds / f.span) ** 2));
      if (env < 0.03) continue;
      const side = f.side ? Math.pow(Math.max(0, Math.cos(ang)), 1.3) : 1;
      if (side < 0.01) continue;
      // 주름 줄마다 기울기와 자리가 조금씩 다르다
      const wob = (vnoise(Math.cos(ang) * 1.4 + f.seed, Math.sin(ang) * 1.4, ds * 9 + f.seed) - 0.5) * 1.3;
      disp += f.amp * env * side * ridge(ds / f.lam + wob);
    }
    if (flare) { const ds = s - flare.at * len; disp += flare.amp * Math.exp(-((ds / flare.span) ** 2)); }
    return d - disp;
  };
}

// ---------- 몸 거리장 ----------
// 성분 목록: { f(px,py,pz), region, bone }. 같은 묶음끼리 부드럽게 잇는다
function bodyParts() {
  const J = BIND_J, P = [];
  const add = (f, region, bone, group) => P.push({ f, region: R[region], bone: B[bone], group });
  // 몸통(셔츠): 가슴, 어깨띠, 어깨세모근, 배, 골반, 엉덩이, 허리띠 위로 부푼 셔츠, 깃
  add((x, y, z) => sdEllipsoid(x, y, z, V(0, 1.33, 0.004), V(0.178, 0.175, 0.13)), 'shirt', 'chest', 'torso');
  add((x, y, z) => sdEllipsoid(x, y, z, V(0, 1.43, 0.014), V(0.215, 0.08, 0.105)), 'shirt', 'chest', 'torso');
  for (const s of [-1, 1]) add((x, y, z) => sdEllipsoid(x, y, z, V(0.205 * s, 1.425, 0.004), V(0.08, 0.085, 0.082)), 'shirt', 'chest', 'torso');
  add((x, y, z) => sdEllipsoid(x, y, z, V(0, 1.13, 0.008), V(0.162, 0.135, 0.118)), 'shirt', 'pelvis', 'torso');
  add((x, y, z) => sdEllipsoid(x, y, z, V(0, 0.95, 0.014), V(0.178, 0.12, 0.122)), 'pants', 'pelvis', 'torso');
  for (const s of [-1, 1]) add((x, y, z) => sdEllipsoid(x, y, z, V(0.072 * s, 0.895, 0.06), V(0.092, 0.098, 0.078)), 'pants', 'pelvis', 'torso');
  add((x, y, z) => {
    // 허리띠 위로 부푼 셔츠: 둘레를 따라 불규칙하게 처진 접힘
    const a = Math.atan2(z, x), sag = 0.006 * (vnoise(a * 2.2 + 3, 1, 2) - 0.5);
    return sdEllipsoid(x, y + sag, z, V(0, 1.03, 0.008), V(0.182, 0.05, 0.13)) - 0.003 * ridge(a * 3.1 + vnoise(a, 4, 4));
  }, 'shirt', 'pelvis', 'torso');
  add((x, y, z) => sdBand(x, y, z, 0, 0.003, 0.074, 0.07, 1.505, 0.022, 0.008), 'shirt', 'chest', 'torso');
  // 승모근: 목 밑에서 어깨로 내려가는 비탈(목이 어깨 위로 길게 솟아 보이지 않게)
  for (const s of [-1, 1]) add((x, y, z) => sdRoundCone(x, y, z, V(0.03 * s, 1.53, 0.025), V(0.17 * s, 1.465, 0.012), 0.05, 0.045), 'shirt', 'chest', 'torso');
  // 목과 머리(얼굴 가리개). 헬멧과 고글은 bots.js가 따로 단다
  add((x, y, z) => sdRoundCone(x, y, z, V(0, 1.49, 0.006), V(0, 1.63, -0.004), 0.058, 0.052) - 0.0025 * ridge((y - 1.5) / 0.022 + vnoise(x * 30, z * 30, 1)), 'face', 'head', 'head');
  add((x, y, z) => sdEllipsoid(x, y, z, V(0, 1.712, -0.006), V(0.092, 0.11, 0.104)), 'face', 'head', 'head');
  add((x, y, z) => sdEllipsoid(x, y, z, V(0, 1.668, -0.072), V(0.05, 0.04, 0.04)), 'face', 'head', 'head');   // 턱과 입 쪽

  for (const s of [-1, 1]) {
    const L = s < 0, sh = J[L ? 3 : 6], el = J[L ? 4 : 7], ha = J[L ? 5 : 8];
    const ua = L ? 'uArmL' : 'uArmR', fa = L ? 'fArmL' : 'fArmR', th = L ? 'thighL' : 'thighR', sn = L ? 'shinL' : 'shinR';
    const sd = L ? 11 : 23;
    const up = el.clone().sub(sh).normalize(), fo = ha.clone().sub(el).normalize();
    const wrist = ha.clone().addScaledVector(fo, -0.075);
    // 위팔 소매: 팔꿈치 안쪽(아래팔 쪽)으로 압축 주름, 겨드랑이 아래 처진 천
    const inU = fo.clone().addScaledVector(up, -fo.dot(up));
    add(tube(sh.clone().addScaledVector(up, 0.02), el, 0.077, 0.063, inU, { loose: 0.011, seed: sd,
      folds: [{ at: 1.0, span: 0.09, lam: 0.034, amp: 0.012, side: 1, seed: sd + 1 }, { at: 0.12, span: 0.06, lam: 0.038, amp: 0.008, side: 0, seed: sd + 2 }, { at: 0.55, span: 0.08, lam: 0.06, amp: 0.006, side: 0, seed: sd + 12 }] }), 'shirt', ua, 'arm' + s);
    // 아래팔 소매: 팔꿈치 쪽 압축 주름, 손목 위로 밀려 올라간 소맷부리
    const inF = up.clone().negate().addScaledVector(fo, up.dot(fo));
    add(tube(el, wrist, 0.061, 0.05, inF, { loose: 0.009, seed: sd + 3,
      folds: [{ at: 0.0, span: 0.08, lam: 0.032, amp: 0.011, side: 1, seed: sd + 4 }, { at: 0.84, span: 0.05, lam: 0.024, amp: 0.008, side: 0, seed: sd + 5 }],
      flare: { at: 0.92, span: 0.03, amp: 0.007 } }), 'shirt', fa, 'arm' + s);
    // 장갑: 쥔 주먹(손바닥에서 손가락 마디까지 둥근 덩어리)과 엄지, 손등 보호대
    const side = new THREE.Vector3().crossVectors(fo, V(0, 1, 0)).normalize().multiplyScalar(s);
    add((x, y, z) => smin(sdRoundCone(x, y, z, wrist, ha.clone().addScaledVector(fo, 0.035), 0.034, 0.039),
      sdRoundCone(x, y, z, ha.clone().addScaledVector(fo, 0.01).addScaledVector(side, -0.035).add(V(0, -0.01, 0)), ha.clone().addScaledVector(fo, 0.045).addScaledVector(side, -0.03), 0.015, 0.013), 0.012), 'glove', fa, 'hand' + s);
    // 바지: 허벅지(무릎 뒤 압축 주름, 허벅지 앞 접힘, 바깥쪽 건빵 주머니), 정강이(무릎 뒤 주름, 부츠 위로 접혀 내려온 바짓단)
    const hip = J[L ? 9 : 12], kn = J[L ? 10 : 13], ft = J[L ? 11 : 14];
    const back = V(0, 0, 1);
    add(tube(hip, kn, 0.116, 0.082, back, { loose: 0.012, seed: sd + 6,
      folds: [{ at: 1.0, span: 0.09, lam: 0.04, amp: 0.013, side: 1, seed: sd + 7 }, { at: 0.06, span: 0.07, lam: 0.04, amp: 0.009, side: 0, seed: sd + 8 }, { at: 0.55, span: 0.1, lam: 0.07, amp: 0.006, side: 0, seed: sd + 13 }] }), 'pants', th, 'leg' + s);
    const pk = hip.clone().lerp(kn, 0.5).add(V(0.098 * s, 0, 0.0));
    add((x, y, z) => sdBox(x, y, z, pk, V(0.022, 0.085, 0.07), 0.018) - 0.002 * ridge((y - pk.y) / 0.03), 'pants', th, 'leg' + s);
    const bootTop = V(ft.x, 0.2, ft.z + 0.004);
    add(tube(kn, bootTop, 0.076, 0.062, back, { loose: 0.011, seed: sd + 9,
      folds: [{ at: 0.0, span: 0.08, lam: 0.04, amp: 0.012, side: 1, seed: sd + 10 }, { at: 0.92, span: 0.07, lam: 0.03, amp: 0.013, side: 0, seed: sd + 11 }],
      flare: { at: 0.92, span: 0.05, amp: 0.013 } }), 'pants', sn, 'leg' + s);
    // 무릎 보호대
    add((x, y, z) => sdEllipsoid(x, y, z, kn.clone().add(V(0, -0.015, -0.062)), V(0.058, 0.074, 0.032)), 'pad', sn, 'pad' + s);
    // 부츠: 발목 기둥, 발등, 밑창
    add((x, y, z) => smin(sdRoundCone(x, y, z, V(ft.x, 0.06, ft.z + 0.005), V(ft.x, 0.215, ft.z + 0.006), 0.057, 0.055),
      sdBox(x, y, z, V(ft.x, 0.058, ft.z - 0.045), V(0.05, 0.055, 0.125), 0.04), 0.03), 'boot', sn, 'boot' + s);
    add((x, y, z) => sdBox(x, y, z, V(ft.x, 0.013, ft.z - 0.04), V(0.056, 0.013, 0.138), 0.01), 'boot', sn, 'boot' + s);
  }
  // 허리띠
  add((x, y, z) => sdBand(x, y, z, 0, 0.008, 0.188, 0.133, 0.99, 0.022, 0.006), 'strap', 'pelvis', 'gear');
  // 판 조끼: 앞뒤 판(가로 웨빙 줄), 허리 띠, 어깨끈, 탄창 주머니 셋, 왼쪽 옆 주머니
  const molle = (y) => 0.0016 * (Math.sin(y * Math.PI * 2 / 0.025) > 0.55 ? 1 : 0);
  add((x, y, z) => sdBox(x, y, z, V(0, 1.29, -0.152), V(0.152, 0.165, 0.028), 0.02) - (z < -0.165 ? molle(y) : 0), 'vest', 'chest', 'gear');
  add((x, y, z) => sdBox(x, y, z, V(0, 1.3, 0.158), V(0.152, 0.16, 0.028), 0.02) - (z > 0.171 ? molle(y) : 0), 'vest', 'chest', 'gear');
  add((x, y, z) => sdBand(x, y, z, 0, 0.006, 0.198, 0.15, 1.2, 0.075, 0.012) - molle(y) * 0.6, 'vest', 'chest', 'gear');
  for (const s of [-1, 1]) {
    add((x, y, z) => Math.min(sdRoundCone(x, y, z, V(0.1 * s, 1.44, -0.14), V(0.115 * s, 1.545, -0.01), 0.024, 0.022), sdRoundCone(x, y, z, V(0.115 * s, 1.545, -0.01), V(0.1 * s, 1.44, 0.145), 0.022, 0.024)), 'vest', 'chest', 'gear');
  }
  for (const k of [-1, 0, 1]) add((x, y, z) => sdBox(x, y, z, V(k * 0.082, 1.185, -0.203), V(0.036, 0.066, 0.031), 0.009) - 0.0015 * (Math.abs(y - 1.235) < 0.012 ? 1 : 0), 'vest', 'chest', 'gear');
  add((x, y, z) => sdBox(x, y, z, V(-0.21, 1.28, 0.06), V(0.03, 0.075, 0.045), 0.012), 'vest', 'chest', 'gear');
  // 오른쪽 허리의 권총집
  add((x, y, z) => sdBox(x, y, z, V(0.215, 0.9, 0.02), V(0.03, 0.09, 0.05), 0.014), 'strap', 'pelvis', 'gear');
  return P;
}

// 같은 묶음끼리 부드럽게(smin), 묶음 사이는 조금 부드럽게 잇는다
const K = { torso: 0.05, head: 0.03, gear: 0.006 };
function makeField(P) {
  const groups = [...new Set(P.map(p => p.group))];
  const gi = P.map(p => groups.indexOf(p.group));
  const ks = groups.map(g => K[g] ?? (g.startsWith('arm') ? 0.022 : g.startsWith('leg') ? 0.03 : g.startsWith('hand') ? 0.012 : 0.01));
  const gd = new Float64Array(groups.length);
  // 성분마다 경계 구: 6 cm 격자에서 표면 근처(거리 0.06 안)인 점을 모아 중심과 반지름을 정한다.
  // 그보다 먼 점에서는 성분을 계산하지 않고 경계 구까지의 거리(실제 거리의 하한)를 쓴다
  const bc = new Float64Array(P.length * 4);
  P.forEach((p, i) => {
    const pts = [];
    for (let x = -0.62; x <= 0.62; x += 0.06) for (let y = -0.01; y <= 1.86; y += 0.06) for (let z = -0.4; z <= 0.32; z += 0.06) if (p.f(x, y, z) < 0.06) pts.push([x, y, z]);
    const c = pts.reduce((a, q) => [a[0] + q[0], a[1] + q[1], a[2] + q[2]], [0, 0, 0]).map(v => v / Math.max(1, pts.length));
    let r = 0; for (const q of pts) r = Math.max(r, Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]));
    bc[i * 4] = c[0]; bc[i * 4 + 1] = c[1]; bc[i * 4 + 2] = c[2]; bc[i * 4 + 3] = pts.length ? r + 0.04 : 10;
  });
  const val = (i, x, y, z) => { const o = i * 4, ds = Math.hypot(x - bc[o], y - bc[o + 1], z - bc[o + 2]) - bc[o + 3]; return ds > 0.05 ? ds : P[i].f(x, y, z); };
  const field = (x, y, z) => {
    gd.fill(1);
    for (let i = 0; i < P.length; i++) { const g = gi[i]; gd[g] = smin(gd[g], val(i, x, y, z), ks[g]); }
    // 묶음 사이: 팔·다리·머리는 몸통과 조금 부드럽게, 장비는 거의 맞붙게
    let d = gd[0];
    for (let g = 1; g < groups.length; g++) d = groups[g] === 'gear' || groups[g].startsWith('pad') || groups[g].startsWith('boot') ? Math.min(d, gd[g]) : smin(d, gd[g], 0.02);
    return d;
  };
  // 그 자리에서 가장 가까운 성분(영역과 뼈)
  const nearest = (x, y, z) => { let best = 0, bd = Infinity; for (let i = 0; i < P.length; i++) { const d = val(i, x, y, z); if (d < bd) { bd = d; best = i; } } return P[best]; };
  return { field, nearest };
}

// ---------- 스키닝 ----------
// 뼈 틀: 원점, 옆(X), 길이 방향(Y). bind와 실시간이 같은 식을 쓴다
export function boneFrames(j, out) {
  const side = (a, b) => j[b].clone().sub(j[a]);
  const torsoUp = j[1].clone().sub(j[0]);
  const chestSide = side(3, 6), hipSide = side(9, 12);
  const csn = chestSide.clone().normalize();
  const hinge = (s, e, h) => {
    const u = j[e].clone().sub(j[s]).normalize(), f = j[h].clone().sub(j[e]).normalize();
    return new THREE.Vector3().crossVectors(u, f).addScaledVector(csn, 0.25);
  };
  out[0] = { p: j[0], x: hipSide, y: torsoUp, len: torsoUp.length() };
  out[1] = { p: j[1], x: chestSide, y: torsoUp, len: torsoUp.length() };
  out[2] = { p: j[2], x: chestSide, y: j[2].clone().sub(j[1]), len: null };
  const hl = hinge(3, 4, 5), hr = hinge(6, 7, 8);
  out[3] = { p: j[3], x: hl, y: j[4].clone().sub(j[3]) }; out[4] = { p: j[4], x: hl, y: j[5].clone().sub(j[4]) };
  out[5] = { p: j[6], x: hr, y: j[7].clone().sub(j[6]) }; out[6] = { p: j[7], x: hr, y: j[8].clone().sub(j[7]) };
  out[7] = { p: j[9], x: hipSide, y: j[10].clone().sub(j[9]) }; out[8] = { p: j[10], x: hipSide, y: j[11].clone().sub(j[10]) };
  out[9] = { p: j[12], x: hipSide, y: j[13].clone().sub(j[12]) }; out[10] = { p: j[13], x: hipSide, y: j[14].clone().sub(j[13]) };
  return out;
}
const _m = new THREE.Matrix4(), _s = V(0, 0, 0), _u = V(0, 0, 0), _f = V(0, 0, 0);
// 뼈 행렬: 길이 방향은 바인드 길이에 대한 지금 길이만큼 늘인다(키 차이와 팔 늘임)
export function frameMatrix(fr, bindLen, out) {
  _u.copy(fr.y); const L = _u.length(); _u.divideScalar(L || 1);
  _s.copy(fr.x).addScaledVector(_u, -fr.x.dot(_u)); if (_s.lengthSq() < 1e-8) _s.set(1, 0, 0); _s.normalize();
  _f.crossVectors(_s, _u);
  const k = bindLen ? L / bindLen : 1;
  out.makeBasis(_s, _u.clone().multiplyScalar(k), _f); out.setPosition(fr.p);
  return out;
}

// 관절 사이 섞기: 관절 면(두 뼈 방향의 평균에 수직)을 기준으로 앞뒤 R 안에서 넘어간다. 관절에서 Rr보다 먼 정점은 섞지 않는다
const JOINTS = [
  { a: 'chest', b: 'head', p: 2, axis: 'up', R: 0.035, Rr: 0.13, at: V(0, 1.535, 0) },
  { a: 'chest', b: 'uArmL', p: 3, R: 0.06, Rr: 0.13 }, { a: 'uArmL', b: 'fArmL', p: 4, R: 0.045, Rr: 0.11 },
  { a: 'chest', b: 'uArmR', p: 6, R: 0.06, Rr: 0.13 }, { a: 'uArmR', b: 'fArmR', p: 7, R: 0.045, Rr: 0.11 },
  { a: 'pelvis', b: 'thighL', p: 9, R: 0.07, Rr: 0.17 }, { a: 'thighL', b: 'shinL', p: 10, R: 0.05, Rr: 0.12 },
  { a: 'pelvis', b: 'thighR', p: 12, R: 0.07, Rr: 0.17 }, { a: 'thighR', b: 'shinR', p: 13, R: 0.05, Rr: 0.12 },
];
const CHILD = { 3: 4, 4: 5, 6: 7, 7: 8, 9: 10, 10: 11, 12: 13, 13: 14 };
const PARENT = { 4: 3, 7: 6, 10: 9, 13: 12, 3: 1, 6: 1, 9: 0, 12: 0 };
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function skinWeights(p, owner) {
  const J = BIND_J, w = new Map();
  if (owner === B.pelvis || owner === B.chest) { const c = ss(1.08, 1.36, p.y); w.set(B.chest, c); w.set(B.pelvis, 1 - c); }
  else w.set(owner, 1);
  for (const jt of JOINTS) {
    const ba = B[jt.a], bb = B[jt.b];
    const isA = owner === ba || (ba === B.chest && owner === B.pelvis) || (ba === B.pelvis && owner === B.chest);
    if (!isA && owner !== bb) continue;
    const P = jt.at || J[jt.p];
    let axis;
    if (jt.axis === 'up') axis = V(0, 1, 0);
    else { const c = CHILD[jt.p], pr = PARENT[jt.p]; const d1 = P.clone().sub(J[pr]).normalize(), d2 = J[c].clone().sub(P).normalize(); axis = d1.add(d2).normalize(); }
    const s = p.clone().sub(P).dot(axis), w2 = ss(-jt.R, jt.R, s), fade = 1 - ss(jt.Rr * 0.7, jt.Rr, p.distanceTo(P));
    if (owner === bb) { const share = 1 + (w2 - 1) * fade; w.clear(); w.set(bb, share); w.set(ba, 1 - share); }
    else { const share = w2 * fade; if (share <= 0) continue; for (const [k, v] of w) w.set(k, v * (1 - share)); w.set(bb, (w.get(bb) || 0) + share); }
  }
  const top = [...w.entries()].filter(e => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((a, b) => a + b[1], 0) || 1;
  return top.map(([b, v]) => [b, v / sum]);
}

// ---------- 바인드 메시 ----------
let _cache = null;
export function buildBody(h = 0.011) {
  if (_cache) return _cache;
  const t0 = performance.now();
  const P = bodyParts();
  const { field, nearest } = makeField(P);
  const { pos, nrm, index } = surfaceNets(field, V(-0.62, -0.01, -0.4), V(0.62, 1.86, 0.32), h);
  const nv = pos.length / 3;
  const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4), color = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), region = new Uint8Array(nv);
  const p = V(0, 0, 0), n = V(0, 0, 0);
  for (let v = 0; v < nv; v++) {
    p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); n.set(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
    const part = nearest(p.x, p.y, p.z);
    region[v] = part.region;
    skinWeights(p, part.bone).forEach(([b, w], k) => { skinIndex[v * 4 + k] = b; skinWeight[v * 4 + k] = w; });
    // 틈 그늘: 노멀 방향으로 나가며 거리장이 기대보다 작으면(접힌 골, 장비 밑, 겨드랑이) 어둡게
    let occ = 0;
    for (let s = 1; s <= 5; s++) { const dd = 0.012 * s; occ += Math.max(0, dd - field(p.x + n.x * dd, p.y + n.y * dd, p.z + n.z * dd)) / Math.pow(2, s); }
    let c = Math.max(0.28, 1 - occ * 34);
    c *= 0.93 + 0.14 * vnoise(p.x * 9, p.y * 9, p.z * 9);
    const rgb = [c, c, c];
    const mul = (k, a) => { rgb[0] *= 1 + (k[0] - 1) * a; rgb[1] *= 1 + (k[1] - 1) * a; rgb[2] *= 1 + (k[2] - 1) * a; };
    const cloth = part.region === R.shirt || part.region === R.pants;
    if (cloth) {
      // 위장 얼룩: 셔츠와 바지에 10~20 cm 크기의 세 가지 톤. 색은 옷 색에 곱하는 배율이라 네 봇의 옷 색마다 다른 무늬가 된다.
      // 한 가지 색의 매끈한 천은 가까이서 '칠한 마네킹'으로 읽힌다(2단계 ① 중간 관찰)
      const q = 6.5, o = part.region === R.pants ? 11 : 0;
      const n1 = vnoise(p.x * q + o, p.y * q, p.z * q) * 0.7 + vnoise(p.x * q * 2.3, p.y * q * 2.3 + o, p.z * q * 2.3) * 0.3;
      const n2 = vnoise(p.x * q * 1.3 + 40, p.y * q * 1.3, p.z * q * 1.3 + o) * 0.75 + vnoise(p.x * 19, p.y * 19 + 40, p.z * 19) * 0.25;
      mul([0.56, 0.52, 0.45], ss(0.38, 0.34, n1));      // 짙은 갈색 얼룩
      mul([1.24, 1.22, 1.1], ss(0.62, 0.66, n1));     // 밝은 바탕
      mul([0.78, 0.9, 0.72], ss(0.6, 0.64, n2));       // 녹색 얼룩
    }
    // 바랜 자리: 무릎 앞, 팔꿈치, 엉덩이(닳고 먼지가 낀다). 먼지는 밝은 흙색이다
    const dust = [1.16, 1.1, 0.96];
    if (part.region === R.pants || part.region === R.pad) {
      for (const sx of [-1, 1]) {
        const dk = Math.hypot(p.x - 0.11 * sx, (p.y - 0.5) * 0.8, Math.min(0, p.z + 0.03) * 0.5);
        if (p.z < 0.02) mul(dust, 0.6 * ss(0.11, 0.03, dk));
      }
      if (p.z > 0.06 && p.y > 0.8) mul(dust, 0.35 * ss(0.84, 0.95, p.y));
    }
    // 바짓단과 부츠: 아래로 갈수록 흙먼지
    if (part.region === R.pants || part.region === R.boot) mul(dust, 0.7 * ss(0.42, 0.08, p.y));
    if (part.region === R.shirt) {
      for (const k of [4, 7]) { const e = BIND_J[k]; mul(dust, 0.4 * ss(0.07, 0.02, Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z - 0.03))); }
    }
    // 바지 바깥 솔기: 다리 바깥쪽 세로 선(재봉 자리의 골)
    if (part.region === R.pants && p.y < 0.92) {
      const ax = Math.abs(p.x) - 0.11, az = p.z + 0.035 * ss(0.95, 0.5, p.y);
      const a = Math.abs(Math.atan2(az, ax));
      mul([0.78, 0.78, 0.78], ss(0.09, 0.03, a));
    }
    color[v * 3] = rgb[0]; color[v * 3 + 1] = rgb[1]; color[v * 3 + 2] = rgb[2];
    const ax = Math.abs(n.x), ay = Math.abs(n.y);
    const S = 4;
    if (ay >= ax && ay >= Math.abs(n.z)) { uv[v * 2] = p.x * S; uv[v * 2 + 1] = p.z * S; }
    else if (ax >= Math.abs(n.z)) { uv[v * 2] = p.z * S; uv[v * 2 + 1] = p.y * S; }
    else { uv[v * 2] = p.x * S; uv[v * 2 + 1] = p.y * S; }
  }
  // 삼각형을 영역별로 모아 재질 묶음을 만든다(삼각형의 영역은 세 정점의 다수결)
  const byR = REGIONS.map(() => []);
  for (let t = 0; t < index.length; t += 3) {
    const a = region[index[t]], b = region[index[t + 1]], c = region[index[t + 2]];
    const r = a === b || a === c ? a : b === c ? b : a;
    byR[r].push(index[t], index[t + 1], index[t + 2]);
  }
  const idx = [], groups = [];
  byR.forEach((tris, r) => { if (tris.length) { groups.push({ start: idx.length, count: tris.length, materialIndex: r }); idx.push(...tris); } });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geo.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);
  geo.computeBoundingSphere();
  // 바인드 뼈 행렬과 그 역행렬
  const fr = boneFrames(BIND_J, []);
  const bindLen = fr.map(f => f.len === null ? null : (f.len ?? f.y.length()));
  const bindMat = fr.map((f, i) => i === B.head ? new THREE.Matrix4().makeTranslation(BIND_J[2].x, BIND_J[2].y, BIND_J[2].z) : frameMatrix(f, bindLen[i], new THREE.Matrix4()));
  const inverses = bindMat.map(m => m.clone().invert());
  _cache = { geo, bindLen, inverses, tris: idx.length / 3, verts: nv, ms: performance.now() - t0 };
  return _cache;
}

// 봇 하나의 몸: 재질 배열(REGIONS 차례)을 받아 SkinnedMesh를 만든다
export function createBody(mats) {
  const D = buildBody();
  const bones = BONES.map(() => { const b = new THREE.Bone(); b.matrixAutoUpdate = false; b.matrixWorldAutoUpdate = false; return b; });
  const mesh = new THREE.SkinnedMesh(D.geo, REGIONS.map(k => mats[k]));
  mesh.bind(new THREE.Skeleton(bones, D.inverses.map(m => m.clone())), new THREE.Matrix4());
  mesh.frustumCulled = false;
  const frames = [];
  return {
    mesh, bones, D,
    // 관절 15개와 머리 행렬(헬멧과 같은 틀)로 뼈를 놓는다
    pose(j, headMatrix) {
      boneFrames(j, frames);
      for (let i = 0; i < bones.length; i++) {
        if (i === B.head) bones[i].matrixWorld.copy(headMatrix);
        else frameMatrix(frames[i], D.bindLen[i], bones[i].matrixWorld);
      }
    },
    boneMatrix(name) { return bones[B[name]].matrixWorld; },
  };
}

// ---------- 흔들리는 장비 ----------
// 몸의 한 점(뼈 틀 안의 자리)에 매달린 강체. 매단 점의 가속도를 뼈 틀로 옮겨, 반대쪽으로 기우는 감쇠 스프링(앞뒤·좌우 기울기, 위아래 튐)으로 늦게 따라온다
export class Gear {
  constructor(mesh, bone, pivot, { k = 60, c = 7, gain = 0.06, bounce = 0.004, maxTilt = 0.5 } = {}) {
    this.mesh = mesh; this.bone = bone; this.pivot = pivot; this.k = k; this.c = c; this.gain = gain; this.bounce = bounce; this.maxTilt = maxTilt;
    this.th = V(0, 0, 0); this.om = V(0, 0, 0); this.wp = []; this.mesh.matrixAutoUpdate = false;
  }
  reset() { this.th.set(0, 0, 0); this.om.set(0, 0, 0); this.wp.length = 0; }
  update(boneM, dt) {
    const w = this.pivot.clone().applyMatrix4(boneM);
    this.wp.unshift(w); if (this.wp.length > 3) this.wp.pop();
    let a = V(0, 0, 0);
    if (this.wp.length === 3 && dt > 0) a = this.wp[0].clone().sub(this.wp[1].clone().multiplyScalar(2)).add(this.wp[2]).divideScalar(dt * dt);
    a.clampLength(0, 40);
    // 뼈 틀의 축(크기 없는 회전)
    const q = new THREE.Quaternion(), sc = V(0, 0, 0), tp = V(0, 0, 0); boneM.decompose(tp, q, sc);
    const al = a.applyQuaternion(q.clone().invert());
    // 앞뒤 가속(z) → x축 기울기, 좌우 가속(x) → z축 기울기, 위아래 가속(y) → 튐
    const h = Math.min(dt, 1 / 30), sub = 4;
    for (let s = 0; s < sub; s++) {
      const hs = h / sub;
      const tx = al.z * this.gain, tz = -al.x * this.gain, ty = -al.y * this.bounce / 9.8;
      this.om.x += (-this.k * (this.th.x - tx) - this.c * this.om.x) * hs;
      this.om.z += (-this.k * (this.th.z - tz) - this.c * this.om.z) * hs;
      this.om.y += (-this.k * 1.6 * (this.th.y - ty) - this.c * this.om.y) * hs;
      this.th.addScaledVector(this.om, hs);
    }
    this.th.x = Math.max(-this.maxTilt, Math.min(this.maxTilt, this.th.x)); this.th.z = Math.max(-this.maxTilt, Math.min(this.maxTilt, this.th.z));
    const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(this.th.x, 0, this.th.z));
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q).setPosition(w.x, w.y + this.th.y, w.z);
    this.mesh.matrix.copy(m.multiply(rot));
    this.mesh.matrixWorldNeedsUpdate = true;
  }
}
